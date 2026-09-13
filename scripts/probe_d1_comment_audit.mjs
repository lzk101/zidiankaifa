/**
 * 主管核实：开发 agent 在 packages/core/src/db/index.ts:851 注释里写的三个数字。
 *   ① 「全库 342 词 D1 模式」  ② 「267 词被消除」  ③ 「75 词保留」  ④ 「L4 空洞≥3 持平 134」
 * 只读。用法：node scripts/probe_d1_comment_audit.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru'`)
  .all()
  .map((r) => String(r.word));

const PREFIX_SET = new Set(['в', 'о', 'с', 'у']);
const bd = (w) => core.breakdownWord(db, w, 'ru');

// --- D1 模式：修法**前**才存在的现象。修法后 >=1 会让 gap=1 被拒，
//     故此处枚举「修法后仍可拆 且首片段 start===1」+「修法后不可拆但在 R/全库中」无法直接观测。
//     改用等价判据：对每个词，用「放宽版」重算 D1 模式是本次修复的对象。
//     —— 由于 dist 已是修法后，我们改为直接统计：
//       (a) 修法后仍可拆且 start===1 的词 → 这些是「被前缀解释而放行」的
//       (b) gap 字符 ∈ PREFIX_SET 与否
//     并结合已知的「修法损失 267 词」复核。
let afterKeptGap1 = [];
for (const w of RU) {
  const p = bd(w);
  if (p.length && p[0].start === 1) afterKeptGap1.push({ w, gap: w.slice(0, p[0].start) });
}
const keptPrefix = afterKeptGap1.filter((x) => PREFIX_SET.has(x.gap));
const keptNonPrefix = afterKeptGap1.filter((x) => !PREFIX_SET.has(x.gap));

console.log('='.repeat(76));
console.log('开发 agent 代码注释数字核实（当前 dist = 修法后）');
console.log('='.repeat(76));
console.log(`全体俄语词条                    : ${RU.length}`);
console.log('');
console.log(`修法后仍可拆 且首片段 start===1 : ${afterKeptGap1.length} 词`);
console.log(`  其中 gap 字符 ∈ {в,о,с,у}   : ${keptPrefix.length} 词   ← 开发 agent 注释称 75`);
console.log(`  其中 gap 字符 ∉ {в,о,с,у}   : ${keptNonPrefix.length} 词   ← 应恒为 0（自洽性）`);
if (keptNonPrefix.length) {
  console.log('    泄漏样本:', keptNonPrefix.slice(0, 10).map((x) => `${x.w}(gap=${x.gap})`).join(', '));
}
console.log('');

const gapDist = new Map();
for (const x of keptPrefix) gapDist.set(x.gap, (gapDist.get(x.gap) ?? 0) + 1);
console.log(`  按 gap 字符分布: ${[...gapDist.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join('  ')}`);
console.log('');

// --- 「修法前 D1 模式总数」= 修法后被消除的 + 修法后仍可拆且 gap=1 的（被前缀放行）
//     修法后被消除数 = 267（已由 probe_preview_d1_fix.mjs 实测）
//     但"修法后仍可拆且 start===1"未必全部属于原 D1 模式（start===1 也可能是 gapExplain 之外情形）
const LOST = 267; // 由 probe_preview_d1_fix.mjs 实测（全库 33441→33174）
console.log('【推算 D1 模式总数】');
console.log(`  修法后仍可拆且 gap=1（被前缀放行）: ${afterKeptGap1.length}`);
console.log(`  修法后被消除                    : ${LOST}`);
console.log(`  ⇒ 推算原 D1 模式总数            : ${afterKeptGap1.length + LOST}   ← 开发 agent 注释称 342`);
console.log('');

// --- L4 指标真实值
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
function maxGap(p, n) {
  if (!p.length) return null;
  const s = [...p].sort((a, b) => a.start - b.start);
  const gaps = [];
  let c = 0;
  for (const x of s) { if (x.start > c) gaps.push(x.start - c); c = Math.max(c, x.end); }
  if (c < n) gaps.push(n - c);
  return gaps.length ? Math.max(...gaps) : 0;
}
let ge3 = 0, ge2 = 0;
for (const w of R) {
  const p = bd(w);
  if (!p.length) continue;
  const g = maxGap(p, w.length);
  if (g >= 3) ge3++;
  if (g >= 2) ge2++;
}
console.log('【L4 质量指标（尺子 R，修法后实测）】');
console.log(`  最大单段空洞 ≥3 : ${ge3}   ← 开发 agent 注释称「持平 134」`);
console.log(`  最大单段空洞 ≥2 : ${ge2}`);
console.log('');
console.log('【裁定输入】');
console.log(`  ① 「342」: ${afterKeptGap1.length + LOST === 342 ? '✅ 与我的推算一致' : `❌ 我的推算为 ${afterKeptGap1.length + LOST}，不一致`}`);
console.log(`  ② 「267」: ✅ 与 probe_preview_d1_fix.mjs 实测一致`);
console.log(`  ③ 「75」 : ${keptPrefix.length === 75 ? '✅ 一致' : `❌ 实测为 ${keptPrefix.length}（注意：我的 probe_verify_gap1_fix.mjs 曾报 71，因其只扫 length 4–14）`}`);
console.log(`  ④ 「134」: ${ge3 === 134 ? '✅ 一致' : `❌ 实测为 ${ge3}（134 是"冻结阈值上限"，非当前实测值；当前实测应为 ${ge3}）`}`);

db.close();
