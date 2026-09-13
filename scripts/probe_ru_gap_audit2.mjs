/**
 * 主管独立复核（只读）：尺子 R 的 30.8% 里，有多少是"词根被整段跳过"的伪拆解？
 *
 * 这是独立于功能测试 agent 的 probe_ru_gap_audit.mjs 的第二实现，用于交叉验证
 * 其 D3 结论（72% 伪拆解 / 空洞≥3 有 134 词）。裁决必须以两个独立来源为准。
 *
 * 与测试 agent 实现的差异（刻意不同，以保证独立性）：
 *   - 不逐字符打标记，改为对 parts 排序后求相邻片段的间隔
 *   - 空洞总量直接由「词长 − 已覆盖字符数」推导，再单独统计最大连续空洞
 *   - 额外统计"空洞出现在词尾"的情况（测试 agent 把词尾空洞并入 gap-mid）
 *
 * 用法：node scripts/probe_ru_gap_audit2.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const words = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const buckets = { '0': 0, '1': 0, '2': 0, '>=3': 0 };
let empty = 0;
let hit = 0;
let headGap = 0, midGap = 0, tailGap = 0, multiGap = 0;
const examples = { '>=3': [], '2': [] };
const maxHoleList = [];

for (const w of words) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  if (!parts.length) { empty++; continue; }
  hit++;

  const n = w.length;
  const sorted = [...parts].sort((a, b) => a.start - b.start);
  const covered = sorted.reduce((s, p) => s + (p.end - p.start), 0);
  const totalHole = n - covered;

  // 求各空洞区间
  const holes = [];
  let cursor = 0;
  for (const p of sorted) {
    if (p.start > cursor) holes.push([cursor, p.start]);
    cursor = Math.max(cursor, p.end);
  }
  if (cursor < n) holes.push([cursor, n]);

  if (holes.length === 0) buckets['0']++;
  else if (totalHole === 1) buckets['1']++;
  else if (totalHole === 2) buckets['2']++;
  else buckets['>=3']++;

  const maxHole = holes.reduce((m, [a, b]) => Math.max(m, b - a), 0);
  maxHoleList.push(maxHole);

  const hasHead = holes.some(([a]) => a === 0);
  const hasTail = holes.some(([, b]) => b === n);
  const hasMid = holes.some(([a, b]) => a > 0 && b < n);
  if (hasHead && holes.length > 1) multiGap++;
  if (hasHead) headGap++;
  if (hasMid) midGap++;
  if (hasTail) tailGap++;

  if (totalHole >= 3 && examples['>=3'].length < 30) {
    examples['>=3'].push(`  ${w.padEnd(16)} [${sorted.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ')}] 空洞${totalHole}: ${holes.map(([a, b]) => `${a}..${b}「${w.slice(a, b)}」`).join(',')}`);
  }
  if (totalHole === 2 && examples['2'].length < 15) {
    examples['2'].push(`  ${w.padEnd(16)} [${sorted.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ')}] 空洞2: ${holes.map(([a, b]) => `${a}..${b}「${w.slice(a, b)}」`).join(',')}`);
  }
}

const T = words.length;
const pct = (x) => `${(x / T * 100).toFixed(1)}%`;
const strict0 = buckets['0'];
const strict1 = buckets['0'] + buckets['1'];

console.log('='.repeat(80));
console.log('★主管独立复核：尺子 R 拆解质量审计（791 词）');
console.log('='.repeat(80));
console.log(`样本                          : ${T}`);
console.log(`  不可拆（空）                : ${empty}`);
console.log(`  计为「有拆解」              : ${hit}  = ${pct(hit)}   ← 现口径 30.8%`);
console.log('');
console.log('按"空洞总量"分桶（仅 244 个有拆解词）：');
console.log(`  空洞 0 字符（完整覆盖）     : ${String(buckets['0']).padStart(3)}   零空洞口径 = ${pct(strict0)}`);
console.log(`  空洞 1 字符（连接元音/接缝）: ${String(buckets['1']).padStart(3)}   空洞≤1 口径 = ${pct(strict1)}`);
console.log(`  空洞 2 字符                 : ${String(buckets['2']).padStart(3)}`);
console.log(`  空洞 ≥3 字符（词根被跳过）  : ${String(buckets['>=3']).padStart(3)}`);
console.log('');
const pseudo = buckets['2'] + buckets['>=3'];
console.log(`⇒ 跳过 ≥2 字符的词 = ${pseudo}，占「有拆解」的 ${(pseudo / hit * 100).toFixed(0)}%`);
console.log(`  （测试 agent 独立测得 175 词 / 72%；我测得 ${pseudo} 词 / ${(pseudo / hit * 100).toFixed(0)}%）`);
console.log('');
console.log(`  空洞≥3 我测得 ${buckets['>=3']} 词  ⇔ 测试 agent 测得 134 词`);
console.log(`  ${buckets['>=3'] === 134 ? '✅ 两者一致 —— D3 结论可采信' : '⚠ 存在差异，需查明口径'}`);
console.log('');
console.log('空洞位置分布（一个词可能同时命中多类）：');
console.log(`  含词首空洞  : ${headGap}   含词中空洞 : ${midGap}   含词尾空洞 : ${tailGap}   多段空洞 : ${multiGap}`);
console.log('');
const avgMax = (maxHoleList.reduce((a, b) => a + b, 0) / maxHoleList.length).toFixed(2);
const ge3 = maxHoleList.filter((m) => m >= 3).length;
const ge4 = maxHoleList.filter((m) => m >= 4).length;
const ge5 = maxHoleList.filter((m) => m >= 5).length;
console.log('最大单段空洞分布（244 个有拆解词）：');
console.log(`  最大空洞 ≥3 : ${ge3} 词    ≥4 : ${ge4} 词    ≥5 : ${ge5} 词    平均 : ${avgMax}`);
console.log('');
console.log('【空洞 ≥3 的样例 30】');
for (const e of examples['>=3']) console.log(e);
console.log('');
console.log('【空洞 =2 的样例 15】');
for (const e of examples['2']) console.log(e);

db.close();
