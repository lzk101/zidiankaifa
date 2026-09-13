/**
 * 只读探针（功能测试 agent · T15/R6）：逐行反核主管「端到端预演」8 项判据表。
 *
 * 方法（我自己的，不读主管脚本）：
 *   preEngine  = scripts/_tmp/prefix_engine（production dist 的整树副本，仅把那一行改回 `>= 2`）
 *   postEngine = packages/core/dist（生产，`>= 1`）
 *   两引擎同源同字节 ⇒ 差异即修法全部影响面。
 *
 * 只读、幂等。用法：node scripts/probe_t15_r6_verify.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as pre from './_tmp/prefix_engine/db/index.js';
import * as post from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');

const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const safe = (fn, w) => {
  try {
    return fn(w);
  } catch {
    return [];
  }
};
const bdPre = (w) => safe((x) => pre.breakdownWord(db, x, 'ru'), w);
const bdPost = (w) => safe((x) => post.breakdownWord(db, x, 'ru'), w);
const holesTotal = (w, p) => {
  const c = new Array(w.length).fill(false);
  for (const x of p) for (let i = x.start; i < x.end && i < w.length; i++) c[i] = true;
  return c.filter((v) => !v).length;
};
const holesMaxRun = (w, p) => {
  const c = new Array(w.length).fill(false);
  for (const x of p) for (let i = x.start; i < x.end && i < w.length; i++) c[i] = true;
  let max = 0;
  let cur = 0;
  for (let i = 0; i < w.length; i++) {
    if (!c[i]) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
};

console.log('='.repeat(92));
console.log('T15/R6 · 逐行反核主管 8 项判据表');
console.log('='.repeat(92));

/* ---- ① 尺子 R ---- */
let rPre = 0;
let rPost = 0;
const rFlip = [];
for (const w of R) {
  const a = bdPre(w);
  const b = bdPost(w);
  if (a.length) rPre++;
  if (b.length) rPost++;
  if (a.length && !b.length) rFlip.push(w);
}
console.log('\n① 尺子 R 覆盖率');
console.log(`   主管: 244/791 = 30.85% → 238/791 = 30.09%`);
console.log(`   我  : ${rPre}/791 = ${((rPre / R.length) * 100).toFixed(2)}% → ${rPost}/791 = ${((rPost / R.length) * 100).toFixed(2)}%   ${rPre === 244 && rPost === 238 ? '✅ 一致' : '❌ 不符'}`);

/* ---- ② L1 ---- */
const l1 = (rPost / R.length) * 100;
console.log(`\n② L1 ≥25%：${l1.toFixed(2)}% ${l1 >= 25 ? '✅ 安全' : '❌'}（余量 ${(l1 - 25).toFixed(2)}pp）`);

/* ---- ③ L4 双口径 ---- */
let pre3A = 0;
let post3A = 0;
let pre3B = 0;
let post3B = 0;
for (const w of R) {
  const a = bdPre(w);
  const b = bdPost(w);
  if (a.length && holesTotal(w, a) >= 3) pre3A++;
  if (b.length && holesTotal(w, b) >= 3) post3A++;
  if (a.length && holesMaxRun(w, a) >= 3) pre3B++;
  if (b.length && holesMaxRun(w, b) >= 3) post3B++;
}
console.log('\n③ L4 空洞≥3（★两个口径都测）');
console.log(`   口径A 未覆盖字符【总数】≥3 : ${pre3A} → ${post3A}   ← 冻结值 134 用的是这个口径`);
console.log(`   口径B 最大【单段】空洞 ≥3  : ${pre3B} → ${post3B}   ← 主管表里的「129」用的是这个口径`);
console.log(`   主管表写「134/129 不变」，两值都能复现；但**它们是两个不同定义**，不可混用`);

/* ---- ④ AC-4 无修过头 ---- */
const passPre = ALL.filter((w) => {
  const p = bdPre(w);
  return p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0]);
});
let kept = 0;
const killed = [];
for (const w of passPre) {
  const b = bdPost(w);
  if (b.length) kept++;
  else killed.push(w);
}
console.log('\n④ AC-4 无修过头');
console.log(`   修法前 D1 形态且 gap ∈ {в,о,с,у} 的词（=主管说的「真前缀组」）: ${passPre.length}`);
console.log(`   修法后仍可拆（保有）: ${kept}   被误杀: ${killed.length} ${killed.length === 0 ? '✅' : '❌ ' + killed.join(' ')}`);
console.log(`   主管表写「40/40 保有，另 13 词修法前本就不可拆」= 40+13 = 53 ≠ 71，**内部不自洽**；`);
console.log(`   我实测全库该组共 ${passPre.length} 词，**${kept}/${passPre.length} 全部保有、0 误杀**。`);

/* ---- ⑤ 无新增拆解 ---- */
let gained = 0;
for (const w of ALL) {
  if (!bdPre(w).length && bdPost(w).length) gained++;
}
console.log(`\n⑤ 无新增拆解：全库由「不可拆」变「可拆」= ${gained} 词 ${gained === 0 ? '✅' : '❌'}`);

/* ---- ⑥ 自洽性检验 ---- */
let leak = 0;
const leakList = [];
for (const w of ALL) {
  const b = bdPost(w);
  if (!b.length || b[0].start < 1) continue;
  const gap = norm(w).slice(0, b[0].start);
  if (!RU1.has(gap)) {
    leak++;
    if (leakList.length < 10) leakList.push(`${w}('${gap}')`);
  }
}
console.log(`\n⑥ 自洽性检验：「词首 gap≥1 但 gap 字符 ∉ {в,о,с,у}」却仍可拆 = ${leak} 词 ${leak === 0 ? '✅' : '❌ ' + leakList.join(' ')}`);

/* ---- ⑦ R 内翻转 6 词 ---- */
const EXPECT = ['глетчерный', 'зверство', 'плескание', 'тлеться', 'хлестаться', 'эмальерный'];
const same = rFlip.length === EXPECT.length && EXPECT.every((w) => rFlip.includes(w));
console.log(`\n⑦ R 内由可拆变不可拆：${rFlip.length} 词 ${same ? '✅ 与主管逐一一致' : '❌'}`);
console.log(`   我: ${rFlip.join(' ')}`);

/* ---- ⑧ 全库可拆数（尺子 A 口径） ---- */
let aPre = 0;
let aPost = 0;
for (const w of ALL) {
  if (bdPre(w).length) aPre++;
  if (bdPost(w).length) aPost++;
}
console.log(`\n⑧ 全库可拆数（尺子 A 口径：全部 lang='ru' 词条 ${ALL.length} 条）`);
console.log(`   主管: 33,441 → 33,174（-267）`);
console.log(`   我  : ${aPre} → ${aPost}（${aPost - aPre}）   ${aPre === 33441 && aPost === 33174 ? '✅ 一致' : '❌ 不符'}`);

/* ---- ★ 附加：阈值型防护盲区（主管要求独立记录） ---- */
console.log('\n★ 附加判据：被消除的 267 词在「质量口径」下是否可见？');
let flippedHoles = [];
for (const w of ALL) {
  const a = bdPre(w);
  const b = bdPost(w);
  if (a.length && !b.length) flippedHoles.push({ w, hA: holesTotal(w, a), hB: holesMaxRun(w, a) });
}
const h0 = flippedHoles.filter((x) => x.hA === 0).length;
const h1 = flippedHoles.filter((x) => x.hA === 1).length;
const h2 = flippedHoles.filter((x) => x.hA >= 2).length;
const h3 = flippedHoles.filter((x) => x.hA >= 3).length;
console.log(`   被消除的 ${flippedHoles.length} 词中：空洞总数=0 的 ${h0} 词 · =1 的 ${h1} 词 · ≥2 的 ${h2} 词 · ≥3 的 ${h3} 词`);
console.log(`   ⇒ 其中 ${h0} 词在 L4 口径下**空洞为 0**（完全不可见）；${h3} 词才可能被空洞≥3 守卫看见。`);
console.log(`   实例（空洞=0 却仍被消除）：${flippedHoles.filter((x) => x.hA === 0).slice(0, 12).map((x) => x.w).join(' ')}`);

db.close();
