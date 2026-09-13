/**
 * 探针 2：A2 覆盖率严格上界（忽略全部规则约束的 DP 最大覆盖）+ 词源口径核对
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../../packages/core/dist/db/index.js';

const DB_PATH = 'D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db';
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const cdb = core.openDatabase(DB_PATH);
const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%';

const etymAll = db.prepare("SELECT COUNT(1) c FROM word_etymology WHERE lang='ru'").get().c;
const etymDistinct = db.prepare("SELECT COUNT(DISTINCT word) c FROM word_etymology WHERE lang='ru'").get().c;
const etymNotInWords = db.prepare("SELECT COUNT(1) c FROM (SELECT DISTINCT word FROM word_etymology WHERE lang='ru') e WHERE NOT EXISTS (SELECT 1 FROM words_i18n w WHERE w.lang='ru' AND w.word=e.word)").get().c;
console.log('== 词源口径核对 ==');
console.log('word_etymology(ru) 行数 =', etymAll, '/ distinct word =', etymDistinct, '/ 不在 words_i18n(ru) 的 =', etymNotInWords);

/* 词素模式（与 core 同规则） */
const entries = [];
for (const m of db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru'").all()) {
  const stem = String(m.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е');
  const pats = [stem];
  if (m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
    const c = stem.slice(0, -1);
    if (c.length >= 3) pats.push(c);
  }
  entries.push({ kind: m.kind, pats });
}
const flat = [];
for (const e of entries) for (const p of e.pats) if (p.length >= 2) flat.push(p);

/** 严格上界：无视「前缀限词首/后缀需≥3词干/间隙规则」，只做不重叠最大覆盖 DP */
function ruleFreeMaxCov(w) {
  const mw = w.replace(/ё/g, 'е');
  const n = mw.length;
  const cov = new Int32Array(n + 1);
  for (let i = n - 1; i >= 0; i--) {
    let best = cov[i + 1];
    for (const pat of flat) {
      if (pat.length <= best) continue;
      if (!mw.startsWith(pat, i)) continue;
      const c = pat.length + cov[i + pat.length];
      if (c > best) best = c;
    }
    cov[i] = best;
  }
  return cov[0] / n;
}

function analyze(label, words) {
  let cur = 0;
  const ub = [];
  let headroom = 0; // 上界≥0.55 但当前失败 → 算法/规则可争取
  let libBound = 0; // 上界<0.55 → 当前词素库封顶，只能加库
  for (const w of words) {
    const parts = core.breakdownWord(cdb, w, 'ru');
    const got = parts.length > 0;
    if (got) cur++;
    const u = ruleFreeMaxCov(w);
    ub.push(u);
    if (u >= 0.55) { if (!got) headroom++; } else libBound++;
  }
  const ubHit = ub.filter((u) => u >= 0.55).length;
  const bins = {};
  for (const u of ub) {
    const k = u >= 0.9 ? '0.9-1.0' : u >= 0.7 ? '0.7-0.9' : u >= 0.55 ? '0.55-0.7' : u >= 0.4 ? '0.4-0.55' : '<0.4';
    bins[k] = (bins[k] ?? 0) + 1;
  }
  console.log(`\n== ${label}（n=${words.length}）==`);
  console.log('当前实测覆盖率 =', cur, pct(cur, words.length));
  console.log('严格上界（忽略全部规则、仅不重叠最大覆盖≥0.55）=', ubHit, pct(ubHit, words.length), ' ← 当前 441 词素库下不可能超过此值');
  console.log('  其中「上界够但当前失败」= ', headroom, '（算法/规则可争取的余量）');
  console.log('  其中「上界不足」（加库才能救）=', libBound, pct(libBound, words.length));
  console.log('  上界覆盖度分布 =', JSON.stringify(bins));
  return { cur, ubHit, headroom, libBound, n: words.length };
}

/* 三个样本 */
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

/* 阈值敏感性：把 55% 放到 45%/50% 时，规则自由上界能到多少 */
console.log('\n== 阈值敏感性（严格上界视角）==');
for (const t of [0.45, 0.5, 0.55, 0.6]) {
  const all = [...rowsA.map((w) => ['A', w]), ...sampleB.map((w) => ['B', w])];
  let a = 0, an = 0, b = 0, bn = 0;
  for (const [k, w] of all) {
    const u = ruleFreeMaxCov(w);
    if (k === 'A') { an++; if (u >= t) a++; } else { bn++; if (u >= t) b++; }
  }
  console.log(`  阈值 ${t}: 尺子A 上界 ${pct(a, an)} | 尺子B 上界 ${pct(b, bn)}`);
}

/* 上界够但当前失败的样例（算法余量在哪） */
const head = [];
for (const w of rowsA) { if (!core.breakdownWord(cdb, w, 'ru').length && ruleFreeMaxCov(w) >= 0.55) head.push(w); }
console.log('\n上界够但当前失败 样例(前 30):', head.slice(0, 30).join(' '));
db.close();
console.log('\n== done ==');
console.log('汇总', JSON.stringify({ A: rA, B: rB, C: rC }));
