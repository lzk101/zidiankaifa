/**
 * 探针 3：修正版严格上界
 * 修正点：探针 2 里 `if (pat.length <= best) continue` 把「模式长度」与「已覆盖字符数」比较，
 * 导致短模式被大量错误剪枝，上界算出 17.8% < 实测 30.8%（自相矛盾）。此处去掉剪枝。
 * 单字符模式（俄语 в-/с-/у-/о-）仅允许出现在 pos 0 —— 这不是「被放宽的规则」，而是该模式本身的定义。
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../../packages/core/dist/db/index.js';

const DB_PATH = 'D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db';
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const cdb = core.openDatabase(DB_PATH);
const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%';

const patsFirst = new Set(); // 单字符模式：只允许 pos 0
const patsAny = [];         // 长度 >= 2：任意位置
const corePats = [];        // 后缀「屈折词尾吸收」核心（index.ts:738-743），可覆盖到词尾
for (const m of db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru'").all()) {
  const stem = String(m.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е');
  const list = [stem];
  if (m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
    const c = stem.slice(0, -1);
    if (c.length >= 3) { list.push(c); corePats.push(c); }
  }
  for (const p of list) {
    if (p.length === 1) patsFirst.add(p);
    else if (p.length >= 2) patsAny.push(p);
  }
}
console.log('模式：单字符(限 pos0) =', [...patsFirst].join(' '), '| 长度>=2 =', patsAny.length, '条 | 吸收核心 =', corePats.length, '条');

const cache = new Map();
/** 严格上界：只保留「模式自身最小长度 + 单字符前缀限词首」，放弃 55% 阈值与全部间隙/位置规则 */
function ruleFreeMaxCov(w) {
  const hit = cache.get(w);
  if (hit !== undefined) return hit;
  const mw = w.trim().toLowerCase().replace(/ё/g, 'е');
  const n = mw.length;
  const cov = new Int32Array(n + 1);
  for (let i = n - 1; i >= 0; i--) {
    let best = cov[i + 1];
    for (const pat of patsAny) {
      if (pat.length > n - i || !mw.startsWith(pat, i)) continue;
      const c = pat.length + cov[i + pat.length];
      if (c > best) best = c;
    }
    if (i === 0) {
      for (const pat of patsFirst) {
        if (!mw.startsWith(pat, 0)) continue;
        const c = pat.length + cov[pat.length];
        if (c > best) best = c;
      }
    }
    // 后缀吸收核心：可吃掉词尾屈折变化，覆盖到词尾（词尾超出 3 字符则规则本身不允许）
    for (const pat of corePats) {
      if (pat.length > n - i || !mw.startsWith(pat, i)) continue;
      if (n - (i + pat.length) > 3) continue;
      if (n - i > best) best = n - i;
    }
    cov[i] = best;
  }
  const r = cov[0] / n;
  cache.set(w, r);
  return r;
}

let UB_VIOLATION = 0;
function analyze(label, words) {
  let cur = 0, headroom = 0, libBound = 0;
  const bins = {};
  for (const w of words) {
    const parts = core.breakdownWord(cdb, w, 'ru');
    const got = parts.length > 0;
    if (got) cur++;
    const u = ruleFreeMaxCov(w);
    // 有效性自检：上界必须 >= 实测覆盖度
    const actualCov = parts.reduce((s, p) => s + (p.end - p.start), 0) / w.trim().toLowerCase().replace(/ё/g, 'е').length;
    if (u + 1e-9 < actualCov) UB_VIOLATION++;
    if (u >= 0.55) { if (!got) headroom++; } else libBound++;
    const k = u >= 0.9 ? '0.9-1.0' : u >= 0.7 ? '0.7-0.9' : u >= 0.55 ? '0.55-0.7' : u >= 0.4 ? '0.4-0.55' : '<0.4';
    bins[k] = (bins[k] ?? 0) + 1;
  }
  const ubHit = words.filter((w) => ruleFreeMaxCov(w) >= 0.55).length;
  console.log(`\n== ${label}（n=${words.length}）==`);
  console.log('当前实测覆盖率 =', cur, pct(cur, words.length));
  console.log('严格上界（阈值仍 0.55）=', ubHit, pct(ubHit, words.length));
  console.log('  「上界够但当前失败」= ', headroom, ' ← 改算法/规则可争取的余量');
  console.log('  「上界不足」（只能加库）=', libBound, pct(libBound, words.length));
  console.log('  上界分布 =', JSON.stringify(bins));
  return { cur, n: words.length, ubHit, headroom, libBound };
}

const rowsA = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0").all().map((r) => String(r.word));
const pool = db.prepare("SELECT w.word AS word FROM words_i18n w WHERE w.lang='ru' AND EXISTS (SELECT 1 FROM word_etymology e WHERE e.word=w.word AND e.lang='ru')").all().map((r) => String(r.word));
let seed = 20260913;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const p2 = pool.slice();
for (let i = p2.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p2[i], p2[j]] = [p2[j], p2[i]]; }
const sampleB = p2.slice(0, 800);
const rowsC = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND rowid % 97 = 0").all().map((r) => String(r.word));

const rA = analyze('尺子 A 样本', rowsA);
const rB = analyze('尺子 B 样本', sampleB);
const rC = analyze('尺子 C 样本（全词条）', rowsC);
console.log('\n上界有效性自检：违例数 =', UB_VIOLATION, UB_VIOLATION === 0 ? '（上界合法）' : '（上界不合法，结论作废）');

console.log('\n== 阈值敏感性（严格上界，即「把阈值降到 t 时的乐观极限」）==');
for (const t of [0.35, 0.4, 0.45, 0.5, 0.55]) {
  const a = rowsA.filter((w) => ruleFreeMaxCov(w) >= t).length;
  const b = sampleB.filter((w) => ruleFreeMaxCov(w) >= t).length;
  const c = rowsC.filter((w) => ruleFreeMaxCov(w) >= t).length;
  console.log(`  阈值 ${t}: 尺子A 上界 ${pct(a, rowsA.length)} | 尺子B 上界 ${pct(b, sampleB.length)} | 尺子C 上界 ${pct(c, rowsC.length)}`);
}

const head = rowsA.filter((w) => !core.breakdownWord(cdb, w, 'ru').length && ruleFreeMaxCov(w) >= 0.55);
console.log('\n「上界够但当前失败」样例(前 30):', head.slice(0, 30).join(' '));
console.log('\n汇总', JSON.stringify({ A: rA, B: rB, C: rC }));
db.close();
