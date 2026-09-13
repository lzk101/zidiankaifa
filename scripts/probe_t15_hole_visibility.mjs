/**
 * 只读探针（功能测试 agent · R6 定点反驳）：核主管「267 个误拆在质量口径下根本不可见」的说法。
 * 主管举例 `плескание` 空洞为 0、`зверство` 空洞为 0。逐词实测。
 * 用法：node scripts/probe_t15_hole_visibility.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as pre from './_tmp/prefix_engine/db/index.js';
import * as post from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const dp = (w) => pre.breakdownWord(db, w, 'ru') ?? [];
const doo = (w) => post.breakdownWord(db, w, 'ru') ?? [];

const cover = (w, p) => {
  const c = new Array(norm(w).length).fill(false);
  for (const x of p) for (let i = x.start; i < x.end && i < c.length; i++) c[i] = true;
  return c;
};
const holeTotal = (w, p) => cover(w, p).filter((v) => !v).length;
const holeMaxRun = (w, p) => {
  let max = 0;
  let cur = 0;
  for (const v of cover(w, p)) {
    if (!v) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
};

console.log('=== A. 主管点名的两个词，逐字实测（修法前引擎） ===');
for (const w of ['плескание', 'зверство']) {
  const p = dp(w);
  const mw = norm(w);
  console.log(`\n${w}（${mw.length} 字符, ${mw}）`);
  console.log(`  修法前: ${JSON.stringify(p.map((x) => `${x.morpheme}@${x.start}-${x.end}`))}`);
  console.log(`  覆盖向量: ${cover(w, p).map((v) => (v ? '#' : '.')).join('')}   (${mw})`);
  console.log(`  空洞总数 = ${holeTotal(w, p)}   最大单段空洞 = ${holeMaxRun(w, p)}`);
  console.log(`  cov = ${p.reduce((s, x) => s + (x.end - x.start), 0)}/${mw.length}`);
  console.log(`  修法后: ${JSON.stringify(doo(w).map((x) => x.morpheme))}`);
}

console.log('\n\n=== B. 全库 267 个被消除词的空洞分布 ===');
const flipped = [];
for (const w of ALL) {
  const a = dp(w);
  const b = doo(w);
  if (a.length && !b.length) flipped.push({ w, hT: holeTotal(w, a), hM: holeMaxRun(w, a) });
}
const bucket = (f) => flipped.filter(f).length;
console.log(`  被消除总数: ${flipped.length}`);
console.log(`  空洞总数 = 0 : ${bucket((x) => x.hT === 0)}   ← 主管说的「根本不可见」`);
console.log(`  空洞总数 = 1 : ${bucket((x) => x.hT === 1)}`);
console.log(`  空洞总数 ≥ 2 : ${bucket((x) => x.hT >= 2)}`);
console.log(`  空洞总数 ≥ 3 : ${bucket((x) => x.hT >= 3)}   ← L4 口径A 守卫本可看见`);
console.log(`  最大单段 ≥ 3 : ${bucket((x) => x.hM >= 3)}   ← L4 口径B 守卫本可看见`);
console.log(`\n  空洞总数≥3 的实例(前20): ${flipped.filter((x) => x.hT >= 3).slice(0, 20).map((x) => `${x.w}(${x.hT})`).join(' ')}`);

console.log('\n\n=== C. 为什么 R 样本的 L4 仍是 134→134？（采样解释） ===');
console.log('  R 内翻转子集逐词:');
for (const w of R) {
  const a = dp(w);
  const b = doo(w);
  if (a.length && !b.length) {
    console.log(`    ${w.padEnd(14)} 空洞总数=${holeTotal(w, a)}  最大单段=${holeMaxRun(w, a)}  ${holeTotal(w, a) >= 3 ? '★会被 L4 看见' : '（L4 看不见）'}`);
  }
}
const rFlip3 = R.filter((w) => {
  const a = dp(w);
  const b = doo(w);
  return a.length && !b.length && holeTotal(w, a) >= 3;
});
console.log(`  ⇒ R 内翻转的 6 词中，空洞总数≥3 的有 ${rFlip3.length} 个`);
console.log(`  ⇒ 故 R 的 L4(口径A, ≥3) = 134 → ${134 - rFlip3.length}  ... 实测却是 134→134，需核对`);

// R 内 L4 前后
const rA = R.filter((w) => {
  const a = dp(w);
  return a.length && holeTotal(w, a) >= 3;
}).length;
const rB = R.filter((w) => {
  const b = doo(w);
  return b.length && holeTotal(w, b) >= 3;
}).length;
console.log(`  复算 R 口径A：修法前 ${rA} → 修法后 ${rB}`);

// 反向：修法后有没有词「从空洞<3 变成空洞≥3」？
let newVisible = [];
for (const w of R) {
  const a = dp(w);
  const b = doo(w);
  if (b.length && holeTotal(w, b) >= 3 && !(a.length && holeTotal(w, a) >= 3)) newVisible.push(w);
}
console.log(`  R 内修法后新进入「空洞≥3」的词: ${newVisible.length} ${newVisible.join(' ')}`);

db.close();
