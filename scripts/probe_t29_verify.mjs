// T29 · 功能测试 agent 独立验证：v0.8.0 重建 vs v0.9.0 现状，全库逐词差分 + 靶词/哨兵/代价/倒排表。
// 方法：v0.8.0 词素表从 packages/data-pipeline/roots_ru.json.bak-2026-09-13T13-46-08-977Z（441 条，mtime 09-13 05:32:31）重建，
//       经 scripts/_tmp/eng_t28_v080 的 __setReplace 整表替换注入；v0.9.0 = scripts/_tmp/eng_t28（= 生产 dist，保真已验证）直读 DB。
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const dbPath = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const BASE_JSON = path.join(REPO, 'packages', 'data-pipeline', 'roots_ru.json.bak-2026-09-13T13-46-08-977Z');

const V080 = await import('./_tmp/eng_t28_v080/db/index.js');
const V090 = await import('./_tmp/eng_t28/db/index.js');
const db = new DatabaseSync(dbPath);

const baseline = JSON.parse(fs.readFileSync(BASE_JSON, 'utf8'));
const fromDb = db.prepare("SELECT morpheme, kind, meaning_zh AS meaningZh, meaning_en AS meaningEn, origin, examples FROM morphemes WHERE lang='ru'").all()
  .map((r) => ({ ...r, examples: safeEx(r.examples) }));
function safeEx(s) { try { const p = JSON.parse(s); return Array.isArray(p) ? p : []; } catch { return []; } }

console.log('════ T29 §0 重建自检 ════');
console.log(`baseline JSON 条数 = ${baseline.length}（预期 441）| DB 现值 = ${fromDb.length}（预期 450）| 净增 = ${fromDb.length - baseline.length}`);
const addSet = new Set(fromDb.map((m) => m.morpheme));
const removed = baseline.filter((m) => !addSet.has(m.morpheme)).map((m) => m.morpheme);
const added = fromDb.filter((m) => !new Set(baseline.map((x) => x.morpheme)).has(m.morpheme)).map((m) => m.morpheme);
console.log(`DB 相对基线【新增】= ${added.length} 条: ${added.join(' ')}`);
console.log(`DB 相对基线【移除】= ${removed.length} 条: ${removed.join(' ') || '（无）'}`);

const P1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => w.trim().toLowerCase().replace(/ё/g, 'е');
function holes(parts, n) {
  if (!parts.length) return { total: n, max: n };
  const iv = parts.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
  const runs = []; let cur = 0;
  for (const [s, e] of iv) { if (s > cur) runs.push(s - cur); cur = Math.max(cur, e); }
  if (cur < n) runs.push(n - cur);
  return { total: runs.reduce((a, b) => a + b, 0), max: runs.length ? Math.max(...runs) : 0 };
}
const key = (ps) => ps.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');

const allWords = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' ORDER BY rowid").all().map((r) => r.word);
const R = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0").all().map((r) => r.word);

function measure(name, engineModule, morphemeList) {
  if (typeof engineModule.__setReplace === 'function') engineModule.__setReplace(morphemeList ?? null);
  else engineModule.__setInjected([]);
  const bd = (w) => engineModule.breakdownWord(db, w, 'ru');
  let split = 0, A = 0, B = 0, realPrefix = 0, da = 0, zero = 0, le1 = 0;
  const parts = new Map(); const hole = new Map();
  for (const w of allWords) {
    const p = bd(w); const n = norm(w).length;
    parts.set(w, key(p)); hole.set(w, p.length ? holes(p, n).total : n);
    if (!p.length) continue;
    split++;
    const h = holes(p, n);
    if (h.total >= 3) A++;
    if (h.max >= 3) B++;
    if (h.total === 0) zero++;
    if (h.total <= 1) le1++;
    if (p.length >= 2 && p[0].start === 1 && P1.has(norm(w)[0])) { realPrefix++; if (p[0].morpheme === 'да-') da++; }
  }
  let rSplit = 0, rA = 0, rB = 0;
  for (const w of R) {
    const p = bd(w); if (!p.length) continue;
    rSplit++; const h = holes(p, norm(w).length);
    if (h.total >= 3) rA++;
    if (h.max >= 3) rB++;
  }
  return { name, split, A, B, realPrefix, da, zero, le1, rSplit, rA, rB, parts, hole };
}

const M080 = measure('v0.8.0(重建)', V080, baseline);
const M090 = measure('v0.9.0(现状)', V090, null);

console.log('\n════ T29 §2 全库判据（我的独立探针）════');
console.log('指标'.padEnd(24) + 'v0.8.0(重建)'.padEnd(16) + 'v0.9.0(实测)'.padEnd(16) + '主管报值'.padEnd(14) + '判定');
const rows = [
  ['全库可拆', M080.split, M090.split, 33495, (v) => v === 33495],
  ['口径A(绝对值)', M080.A, M090.A, 20243, (v) => v === 20243],
  ['口径B(绝对值)', M080.B, M090.B, 18799, (v) => v === 18799],
  ['真前缀组', M080.realPrefix, M090.realPrefix, 63, (v) => v === 63],
  ['да- 子集', M080.da, M090.da, 63, (v) => v === 63],
  ['尺子R可拆', M080.rSplit, M090.rSplit, 241, (v) => v === 241],
  ['L4口径A', M080.rA, M090.rA, 132, (v) => v === 132],
  ['L4口径B', M080.rB, M090.rB, 127, null],
  ['零空洞', M080.zero, M090.zero, 43, null],
  ['空洞≤1', M080.le1, M090.le1, 73, null],
];
for (const [n, a, b, rep, chk] of rows) {
  console.log(String(n).padEnd(22) + String(a).padStart(12) + '  ' + String(b).padStart(12) + '  ' + String(rep).padStart(12) + '   ' + (chk ? (chk(b) ? '✔ 一致' : '✗ 不一致') : '（未报）'));
}
console.log(`重建自检：v0.8.0 重建的可拆=${M080.split}（须 33174）口径A=${M080.A}（须 20214）真前缀组=${M080.realPrefix}（须 75）R=${M080.rSplit}（须 238）L4A=${M080.rA}（须 134）`);
const ok080 = M080.split === 33174 && M080.A === 20214 && M080.realPrefix === 75 && M080.rSplit === 238 && M080.rA === 134 && M080.da === 63 && M080.B === 18762;
console.log(`  ⇒ ${ok080 ? '✔ v0.8.0 重建与 T28 冻结基线逐项一致（重建法成立）' : '✗ 重建不符，后续 loses 判定不可信'}`);
console.log(`率：口径A ${(100 * M080.A / M080.split).toFixed(4)}% → ${(100 * M090.A / M090.split).toFixed(4)}%  (Δ ${(100 * M090.A / M090.split - 100 * M080.A / M080.split).toFixed(4)}pp)`);
console.log(`    口径B ${(100 * M080.B / M080.split).toFixed(4)}% → ${(100 * M090.B / M090.split).toFixed(4)}%  (Δ ${(100 * M090.B / M090.split - 100 * M080.B / M080.split).toFixed(4)}pp)`);
console.log(`    尺子R ${(100 * M080.rSplit / R.length).toFixed(4)}% → ${(100 * M090.rSplit / R.length).toFixed(4)}%`);

console.log('\n════ T29 §3 全库逐词差分（v0.8.0 重建 → v0.9.0 现状）════');
const loses = [], gains = [], changed = [];
for (const w of allWords) {
  const a = M080.parts.get(w), b = M090.parts.get(w);
  if (a === b) continue;
  if (a !== '' && b === '') loses.push([w, a]);
  else if (a === '' && b !== '') gains.push([w, b]);
  else changed.push([w, a, b]);
}
console.log(`★ loses（可拆→不可拆）= ${loses.length}  ${loses.length === 0 ? '✔ 零回归' : '✗ 有真回归'}`);
for (const [w, a] of loses) console.log(`    ${w}: ${a} → []`);
console.log(`gains（不可拆→可拆）= ${gains.length}（主管报 176）`);
console.log(`changed（parts 变但仍有拆解）= ${changed.length}`);
console.log(`参照：可拆 ${M080.split} + ${gains.length} − ${loses.length} = ${M080.split + gains.length - loses.length}（实测 ${M090.split}）${M080.split + gains.length - loses.length === M090.split ? ' ✔ 算术自洽' : ' ✗'}`);
console.log('\n  gains 全名单（按词长）：');
console.log('    ' + gains.map(([w]) => w).join(' '));
console.log('\n  changed 全名单：');
console.log('    ' + changed.map(([w]) => w).join(' '));

console.log('\n════ T29 §4 靶词逐词 ════');
const TARGETS = ['сучить', 'сучок', 'сучковатый', 'самосуд', 'доминировать', 'больной', 'столп', 'казус', 'однако', 'землетрясение', 'водопад', 'термостат', 'сучение', 'сучковый', 'сучкорезка', 'сучёный', 'сучка', 'сучковатость', 'сучкорезный', 'сучильный'];
for (const w of TARGETS) console.log(`  ${w.padEnd(16)} v0.8.0: ${(M080.parts.get(w) || '[]').padEnd(34)} v0.9.0: ${M090.parts.get(w) || '[]'}`);

console.log('\n════ T29 §5 哨兵（须逐字不变）════');
const SENT = ['вдаваться', 'одалживать', 'сдабривать', 'удачный', 'удаться', 'вдаться', 'вдавить', 'ударить', 'смекать', 'вода', 'поднаковальня', 'поднакопить', 'экстатический', 'столп', 'земной', 'петух'];
for (const w of SENT) {
  const a = M080.parts.get(w) || '[]', b = M090.parts.get(w) || '[]';
  console.log(`  ${w.padEnd(16)} ${(a === b ? '不变 ✔' : '★变化').padEnd(8)} ${a.padEnd(34)} ${a === b ? '' : '→ ' + b}`);
}

console.log('\n════ T29 §6 да- 族（真族 10 / 假族 26）════');
const DA_TRUE = ['вдаваться', 'вдаться', 'сдавать', 'сдаваться', 'сдаточный', 'сдаться', 'удаваться', 'удаться', 'удачливый', 'удачный'];
const DA_FALSE = ['вдавить', 'вдавливать', 'сдавить', 'сдавливать', 'удавить', 'удавиться', 'удавка', 'удавливать', 'удавливаться', 'одаривать', 'одарить', 'одарять', 'одарённость', 'удаление', 'удалец', 'удалить', 'удалиться', 'удалять', 'удаляться', 'удалённость', 'одалживать', 'ударение', 'ударник', 'ударный', 'ударять', 'ударяться'];
let tOk = 0, fSame = 0;
for (const w of DA_TRUE) { const a = M080.parts.get(w) || '[]', b = M090.parts.get(w) || '[]'; if (a === b) tOk++; else console.log(`  ★真族变化 ${w}: ${a} → ${b}`); }
for (const w of DA_FALSE) { const a = M080.parts.get(w) || '[]', b = M090.parts.get(w) || '[]'; if (a === b) fSame++; else console.log(`  ★假族变化 ${w}: ${a} → ${b}`); }
console.log(`  真族 10 词逐字不变 = ${tOk}/10 ${tOk === 10 ? '✔' : '✗'}；假族 26 词维持现状 = ${fSame}/26（本轮明确不做，应全不变）`);
console.log(`  真族样本：${DA_TRUE.slice(0, 3).map((w) => `${w}=${M090.parts.get(w) || '[]'}`).join('  ')}`);
console.log(`  假族样本：${DA_FALSE.slice(0, 3).map((w) => `${w}=${M090.parts.get(w) || '[]'}`).join('  ')}`);

console.log('\n════ T29 §7 -ной 代价复核（现任词素表 vs 去掉 -ной）════');
{
  const withoutNoi = fromDb.filter((m) => m.morpheme !== '-ной');
  const MN = measure('no-ной', V090, withoutNoi);
  const losesN = [], gainsN = [], holeBetter = [], holeWorse = [];
  for (const w of allWords) {
    const a = MN.parts.get(w), b = M090.parts.get(w);
    if (a !== '' && b === '') losesN.push(w);
    else if (a === '' && b !== '') gainsN.push([w, b]);
    const ha = MN.hole.get(w), hb = M090.hole.get(w);
    if (hb < ha) holeBetter.push(w); else if (hb > ha) holeWorse.push(w);
  }
  console.log(`  加 -ной 后：新增可拆 = ${gainsN.length}（主管报 176）`);
  console.log(`  加 -ной 后：变差（可拆→[]）= ${losesN.length}（主管报 0）${losesN.length ? '：' + losesN.join(' ') : ' ✔'}`);
  console.log(`  空洞变少 = ${holeBetter.length}（主管报 90）| 空洞变多 = ${holeWorse.length}${holeWorse.length ? '：' + holeWorse.slice(0, 20).join(' ') : ' ✔'}`);
  console.log(`  -ной 使口径A ${MN.A} → ${M090.A}（Δ ${M090.A - MN.A >= 0 ? '+' : ''}${M090.A - MN.A}）· 口径B ${MN.B} → ${M090.B}（Δ ${M090.B - MN.B >= 0 ? '+' : ''}${M090.B - MN.B}）`);
}

console.log('\n════ T29 §8 整词兜底条目代价（去掉 однако-）════');
{
  const withoutOd = fromDb.filter((m) => m.morpheme !== 'однако-');
  const MO = measure('no-однако-', V090, withoutOd);
  const lost = [];
  for (const w of allWords) if (MO.parts.get(w) !== '' && M090.parts.get(w) === '') lost.push([w, MO.parts.get(w)]);
  const gained = [];
  for (const w of allWords) if (MO.parts.get(w) === '' && M090.parts.get(w) !== '') gained.push([w, M090.parts.get(w)]);
  console.log(`  去掉 однако- 后：由可拆变不可拆 = ${lost.length}：${lost.map(([w, a]) => `${w}(${a})`).join(' ')}`);
  console.log(`  去掉 однако- 后：新增可拆 = ${gained.length}：${gained.map(([w, a]) => `${w}(${a})`).join(' ')}`);
  console.log(`  口径A ${MO.A} → ${M090.A}（Δ ${M090.A - MO.A}）· 口径B ${MO.B} → ${M090.B}（Δ ${M090.B - MO.B}）`);
  for (const w of ['поднаковальня', 'поднакопить', 'однако']) console.log(`    ${w.padEnd(16)} 无однако-: ${(MO.parts.get(w) || '[]').padEnd(40)} 现状: ${M090.parts.get(w) || '[]'}`);
}

console.log('\n════ T29 §9 roots / affixes 倒排表 ════');
console.log('  roots 行数 =', db.prepare('SELECT COUNT(1) c FROM roots').get().c, ' affixes =', db.prepare('SELECT COUNT(1) c FROM affixes').get().c);
const byLang = (t) => db.prepare(`SELECT lang, COUNT(1) c FROM ${t} GROUP BY lang`).all().map((r) => `${r.lang}:${r.c}`).join(' ');
console.log('  roots by lang:', byLang('roots'), '| affixes by lang:', byLang('affixes'));
console.log('  语言隔离检查：跨语言污染行 =', db.prepare("SELECT COUNT(1) c FROM roots WHERE lang='ru' AND morpheme GLOB '*[a-z]*'").get().c, '(ru 含 ASCII 小写字母的行数)');
console.log('  新增 9 条是否入表：');
for (const m of added) {
  const r = db.prepare('SELECT morpheme, word_count FROM roots WHERE lang=? AND morpheme=?').get('ru', m);
  const a = db.prepare('SELECT morpheme, word_count FROM affixes WHERE lang=? AND morpheme=?').get('ru', m);
  const hit = r || a;
  console.log(`    ${m.padEnd(10)} ${hit ? `已入表(roots/affixes) word_count=${hit.word_count}` : '⚠ 未入表（word_count=0 或非拆出词素）'}`);
}
const zero = db.prepare("SELECT COUNT(1) c FROM roots WHERE lang='ru' AND (word_count IS NULL OR word_count=0)").get().c;
console.log('  ru roots 中 word_count=0 的行 =', zero, '（倒排表设计上只收有真实关联词者）');
