// T28 · 功能测试 agent 独立基线复算（只读；引擎 = scripts/_tmp/eng_t28 的 dist 副本 + 注入钩子）
// 目的：不信二手数字，自己把 v0.8.0 的每一个门禁数算一遍，并留作 P1/P2/P3 变体的同口径对照。
// 口径全部显式：真前缀组 / да- 子集 / R / L4(口径A,B) / 全库口径A,B / 判据①替代量。
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const dbPath = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');

import * as fixed from './_tmp/eng_t28/db/index.js';   // 修法后（>=1）
import * as pre from './_tmp/eng_t28_pre/db/index.js'; // 修法前（>=2）

const db = new DatabaseSync(dbPath);

const PREFIX1 = new Set(['в', 'о', 'с', 'у']);

/** 归一化：与引擎一致（trim+lowercase，ё→е 仅用于匹配副本；此处按原词保留输出） */
const norm = (w) => w.trim().toLowerCase();

/** 未覆盖片段（空洞）—— 我的独立实现：排序区间求补集 */
function holes(parts, n) {
  if (!parts.length) return { runs: [[0, n]], total: n, max: n };
  const iv = parts.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
  const runs = [];
  let cur = 0;
  for (const [s, e] of iv) {
    if (s > cur) runs.push([cur, s]);
    if (e > cur) cur = e;
  }
  if (cur < n) runs.push([cur, n]);
  const lens = runs.map(([a, b]) => b - a);
  return { runs, total: lens.reduce((a, b) => a + b, 0), max: lens.length ? Math.max(...lens) : 0 };
}

const bdF = (w) => fixed.breakdownWord(db, w, 'ru');
const bdP = (w) => pre.breakdownWord(db, w, 'ru');

// ---------- 全库 ----------
const allWords = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' ORDER BY rowid").all().map((r) => r.word);
const N = allWords.length;

let split = 0, holeA = 0, holeB = 0, preGap1 = 0, realPrefix = 0, daFamily = 0;
let daList = [], realPrefixList = [];
const firstSegDist = new Map();

for (const w of allWords) {
  const parts = bdF(w);
  const n = norm(w).replace(/ё/g, 'е').length;
  if (parts.length) {
    split++;
    const h = holes(parts, n);
    if (h.total >= 3) holeA++;
    if (h.max >= 3) holeB++;
    if (parts.length >= 2 && parts[0].start === 1) {
      const g = norm(w).replace(/ё/g, 'е')[0];
      if (PREFIX1.has(g)) {
        realPrefix++;
        realPrefixList.push({ w, gap: g, first: parts[0].morpheme });
        const f = parts[0].morpheme;
        firstSegDist.set(f, (firstSegDist.get(f) ?? 0) + 1);
        if (f === 'да-') { daFamily++; daList.push({ w, gap: g }); }
      }
    }
  }
  // 判据①替代量：修法前引擎（gapMin=2）下 parts[0].start===1 且片段数≥2
  const pp = bdP(w);
  if (pp.length >= 2 && pp[0].start === 1) preGap1++;
}

console.log('════ T28 §1 独立基线复算（v0.8.0 / dist 修法后）════');
console.log(`全库 ru 词条               = ${N}          （预期 101512）`);
console.log(`全库可拆                   = ${split}          （预期 33174）`);
console.log(`真前缀组(gap=1 & gap∈в,о,с,у, 片段≥2) = ${realPrefix}   （预期 75）`);
console.log(`  └ да- 子集               = ${daFamily}          （预期 63）`);
console.log(`  └ 首片段分布             = ${[...firstSegDist.entries()].map(([k, v]) => `${k}×${v}`).join(' / ')}`);
console.log(`判据①替代量(修法前引擎 gap=1,片段≥2) = ${preGap1}   （预期 342）`);
console.log(`口径A 全库(未覆盖总数≥3)    = ${holeA}  率=${(100 * holeA / split).toFixed(4)}%  （预期 20214 / 60.9333%）`);
console.log(`口径B 全库(最大单段≥3)      = ${holeB}  率=${(100 * holeB / split).toFixed(4)}%  （预期 18762 / 56.5563%）`);

// ---------- 尺子 R ----------
const R = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0").all().map((r) => r.word);
let rSplit = 0, rA = 0, rB = 0;
const zeroHoleR = [], holeLe1R = [], hole3R = [];
for (const w of R) {
  const parts = bdF(w);
  const n = norm(w).replace(/ё/g, 'е').length;
  if (!parts.length) continue;
  rSplit++;
  const h = holes(parts, n);
  if (h.total >= 3) { rA++; hole3R.push(w); }
  if (h.max >= 3) rB++;
  if (h.total === 0) zeroHoleR.push(w);
  if (h.total <= 1) holeLe1R.push(w);
}
console.log('');
console.log('════ T28 §2 尺子 R（related.mjs:144 同式）════');
console.log(`样本                       = ${R.length}          （预期 791）`);
console.log(`可拆(L1 分子)              = ${rSplit}  率=${(100 * rSplit / R.length).toFixed(4)}%  （预期 238 / 30.09%）`);
console.log(`L4 口径A(未覆盖总数≥3)      = ${rA}          （预期 134，冻结值）`);
console.log(`L4 口径B(最大单段≥3)        = ${rB}          （预期 129）`);
console.log(`零空洞                     = ${zeroHoleR.length}          （预期 37）`);
console.log(`空洞≤1                     = ${holeLe1R.length}          （预期 67）`);

// 一致性强校验：口径A + 空洞≤1 == 可拆
console.log(`校验: 口径A(${rA}) + 空洞≤1(${holeLe1R.length}) = ${rA + holeLe1R.length}  == 可拆(${rSplit}) ? ${rA + holeLe1R.length === rSplit ? '✔' : '✗'}`);
console.log(`校验: 零空洞(${zeroHoleR.length}) + 空洞1(${holeLe1R.length - zeroHoleR.length}) + 口径A(${rA}) = ${zeroHoleR.length + (holeLe1R.length - zeroHoleR.length) + rA}`);

// ---------- 与生产 dist 的保真自检 ----------
import * as prod from '../packages/core/dist/db/index.js';
let diff = 0;
for (const w of allWords) {
  const a = JSON.stringify(prod.breakdownWord(db, w, 'ru').map((p) => [p.morpheme, p.start, p.end]));
  const b = JSON.stringify(bdF(w).map((p) => [p.morpheme, p.start, p.end]));
  if (a !== b) { diff++; if (diff <= 5) console.log(`  保真差异: ${w} prod=${a} copy=${b}`); }
}
console.log('');
console.log('════ T28 §0 引擎副本保真自检 ════');
console.log(`全库 ${N} 词逐词比对（parts 逐项）不一致 = ${diff}  ${diff === 0 ? '✔ 副本=生产逐位等价' : '✗'}`);

console.log('');
console.log('════ 附：真前缀组 75 词全名单 ════');
console.log(realPrefixList.map((x) => `${x.w}[${x.gap}→${x.first}]`).join(' '));
console.log('');
console.log('════ 附：да- 族 63 词全名单 ════');
console.log(daList.map((x) => `${x.w}[${x.gap}]`).join(' '));
