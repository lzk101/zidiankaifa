// T29 · 逐条留一法归因：9 条新落库词素各自的边际增益/代价 + 保真自检 + '-ной' 专项。
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const db = new DatabaseSync(process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db'));

const ENG = await import('./_tmp/eng_t28/db/index.js');
const PROD = await import('../packages/core/dist/db/index.js');

const safeEx = (s) => { try { const p = JSON.parse(s); return Array.isArray(p) ? p : []; } catch { return []; } };
const ALL = db.prepare("SELECT morpheme, kind, meaning_zh AS meaningZh, meaning_en AS meaningEn, origin, examples FROM morphemes WHERE lang='ru'").all()
  .map((r) => ({ ...r, examples: safeEx(r.examples) }));
const ADDED = ['-ной', 'домин-', 'казус-', 'однако-', 'пад-', 'столп-', 'суд-', 'суч-', 'тряс-'];

const norm = (w) => w.trim().toLowerCase().replace(/ё/g, 'е');
function holeTotal(parts, n) {
  if (!parts.length) return n;
  const iv = parts.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
  let cur = 0, tot = 0;
  for (const [s, e] of iv) { if (s > cur) tot += s - cur; cur = Math.max(cur, e); }
  if (cur < n) tot += n - cur;
  return tot;
}
const key = (ps) => ps.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');

const words = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' ORDER BY rowid").all().map((r) => r.word);

function run(list) {
  ENG.__setReplace(list);
  const parts = new Map(), hole = new Map();
  let split = 0, A = 0, B = 0;
  for (const w of words) {
    const p = ENG.breakdownWord(db, w, 'ru');
    const n = norm(w).length;
    parts.set(w, key(p)); hole.set(w, holeTotal(p, n));
    if (!p.length) continue;
    split++;
    if (hole.get(w) >= 3) A++;
    // 口径B：最大连续段
    const iv = p.map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
    let cur = 0, mx = 0;
    for (const [s, e] of iv) { if (s > cur) mx = Math.max(mx, s - cur); cur = Math.max(cur, e); }
    if (cur < n) mx = Math.max(mx, n - cur);
    if (mx >= 3) B++;
  }
  return { split, A, B, parts, hole };
}

// ---- 保真：__REPL=null 时副本 == 生产 ----
ENG.__setReplace(null);
let diff = 0;
for (const w of words) {
  const a = JSON.stringify(PROD.breakdownWord(db, w, 'ru').map((p) => [p.morpheme, p.start, p.end]));
  const b = JSON.stringify(ENG.breakdownWord(db, w, 'ru').map((p) => [p.morpheme, p.start, p.end]));
  if (a !== b) diff++;
}
console.log(`§0 保真自检：eng_t28(__REPL=null) vs 生产 dist，全库 ${words.length} 词 parts 不一致 = ${diff} ${diff === 0 ? '✔' : '✗'}`);

const FULL = run(null);
console.log(`§0b 全表（450 条）：可拆 ${FULL.split} · 口径A ${FULL.A} · 口径B ${FULL.B}`);

console.log('\n§1 逐条留一法（去掉该条后，相对现状的变化）');
console.log('去掉条目'.padEnd(12) + '可拆Δ'.padStart(8) + '新增可拆'.padStart(10) + '变差(→[])'.padStart(12) + '空洞变多'.padStart(10) + '空洞变少'.padStart(10) + '口径AΔ'.padStart(9) + '口径BΔ'.padStart(9));
const detail = {};
for (const m of ADDED) {
  const list = ALL.filter((x) => x.morpheme !== m);
  if (list.length !== ALL.length - 1) throw new Error(`${m}: 过滤异常`);
  const R = run(list);
  const gained = [], lost = [], hMore = [], hLess = [];
  for (const w of words) {
    const a = R.parts.get(w), b = FULL.parts.get(w);
    if (a === '' && b !== '') gained.push(w);
    else if (a !== '' && b === '') lost.push(w);
    const ha = R.hole.get(w), hb = FULL.hole.get(w);
    if (hb > ha) hMore.push(w); else if (hb < ha) hLess.push(w);
  }
  detail[m] = { gained, lost, hMore, hLess, dA: FULL.A - R.A, dB: FULL.B - R.B };
  console.log(
    m.padEnd(12) + String(R.split - FULL.split).padStart(8) + String(gained.length).padStart(10) +
    String(lost.length).padStart(12) + String(hMore.length).padStart(10) + String(hLess.length).padStart(10) +
    String(FULL.A - R.A).padStart(9) + String(FULL.B - R.B).padStart(9),
  );
}

console.log('\n§2 -ной 专项（主管报：0 词变差 / 新增可拆 176 / 空洞变少 90）');
{
  const d = detail['-ной'];
  console.log(`  新增可拆 = ${d.gained.length}（主管 176）${d.gained.length === 176 ? ' ✔' : ' ✗'}`);
  console.log(`  变差(→[]) = ${d.lost.length}（主管 0）${d.lost.length === 0 ? ' ✔' : ' ✗ ' + d.lost.join(' ')}`);
  console.log(`  空洞变少 = ${d.hLess.length}（主管 90）${d.hLess.length === 90 ? ' ✔' : ' ✗'}`);
  console.log(`  空洞变多 = ${d.hMore.length}${d.hMore.length ? '：' + d.hMore.slice(0, 30).join(' ') : ' ✔'}`);
  console.log(`  口径A Δ = ${d.dA} · 口径B Δ = ${d.dB}`);
  console.log(`  新增可拆样例：${d.gained.slice(0, 20).join(' ')}`);
}

console.log('\n§3 全部 9 条合计（相对 441 基线的增量归因）');
{
  const sumGain = ADDED.reduce((s, m) => s + detail[m].gained.length, 0);
  const sumLost = ADDED.reduce((s, m) => s + detail[m].lost.length, 0);
  const unionGain = new Set(ADDED.flatMap((m) => detail[m].gained)).size;
  const unionLost = new Set(ADDED.flatMap((m) => detail[m].lost)).size;
  console.log(`  单条新增可拆之和 = ${sumGain}（含重复）· 并集 = ${unionGain}`);
  console.log(`  单条变差之和 = ${sumLost}（含重复）· 并集 = ${unionLost}`);
  console.log(`  全表 vs 基线实测：gains = 323 loses = 2`);
}

console.log('\n§4 兜底条目代价定性（поднаковальня / поднакопить）');
for (const w of ['поднаковальня', 'поднакопить']) {
  const b = detail['однако-'];
  const inGain = b.gained.includes(w), inLost = b.lost.includes(w);
  console.log(`  ${w.padEnd(16)} 去掉 однако- 后 ${inGain ? '由不可拆变可拆' : inLost ? '由可拆变不可拆' : '不变'}；现状 = ${FULL.parts.get(w) || '[]'}`);
}
