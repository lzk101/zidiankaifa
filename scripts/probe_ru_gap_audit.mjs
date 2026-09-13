/**
 * A2 迭代 · 「拆解质量」审计（只读；测试 agent 独占）
 *
 * 动机：尺子 R 把「breakdownWord 返回非空数组」计为「有拆解」。
 *       但 DP 允许**词中间隙**——被跳过的字符不归属任何词素。
 *       于是 землетрясение 被判为「有拆解」，输出 зем- + лет- + -ение，
 *       而 позиции 6..9（"ряс"）整段落空，且 лет-（飞/夏）是**假命中**。
 *       （тряс- 真词根未收录，故真正的「震」这一半语义被整段跳过。）
 *
 * 本探针量化这一问题，回答三个问题：
 *   Q1 尺子 R 的 791 词里，有多少「有拆解」的词的片段**并不覆盖全词**（含间隙）？
 *   Q2 间隙出现在**词首**（v0.7.0 已修）还是**词中/词尾**（未修）？
 *   Q3 若把「含间隙的拆解」重新计为不可拆，尺子 R 的真实覆盖率是多少？
 *      —— 这是评估「45% 目标」时必须知道的：分母其实比 30.8% 显示的更差。
 *
 * 用法：node scripts/probe_ru_gap_audit.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const ruSampleR = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const classify = (w) => {
  const parts = core.breakdownWord(db, w, 'ru');
  if (!parts.length) return { kind: 'empty', parts };
  const n = w.length;
  const cov = new Array(n).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end; i++) cov[i] = true;
  const holes = [];
  let run = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && !cov[i]) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      holes.push([run, i]);
      run = -1;
    }
  }
  if (!holes.length) return { kind: 'full', parts, holes };
  const headGap = holes[0][0] === 0;
  return { kind: headGap ? 'gap-head' : 'gap-mid', parts, holes };
};

const tally = { full: 0, 'gap-head': 0, 'gap-mid': 0, empty: 0 };
const gapHead = [];
const gapMid = [];
/** 空洞总量分桶：≤1 字符（连接元音/接缝，可容忍）/ 2 / ≥3（≥3 = 整个词根被跳过） */
const bucket = { '0': 0, '1': 0, '2': 0, '>=3': 0 };

for (const w of ruSampleR) {
  let r;
  try {
    r = classify(w);
  } catch {
    r = { kind: 'empty', parts: [], holes: [] };
  }
  tally[r.kind]++;
  if (r.kind === 'gap-head') gapHead.push([w, r]);
  if (r.kind === 'gap-mid') gapMid.push([w, r]);
  if (r.kind !== 'empty') {
    const total = r.holes.reduce((s, [a, b]) => s + (b - a), 0);
    bucket[total === 0 ? '0' : total === 1 ? '1' : total === 2 ? '2' : '>=3']++;
  }
}

const fmt = (w, r) => {
  const segs = r.parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');
  const holes = r.holes.map(([a, b]) => `${a}..${b}「${w.slice(a, b)}」`).join(',');
  return `  ${w.padEnd(16)} [${segs}]  空洞: ${holes}`;
};

console.log('='.repeat(78));
console.log('尺子 R 拆解质量审计（791 词抽样）');
console.log('='.repeat(78));
console.log(`  全词覆盖（无空洞）      : ${tally.full}   ← 这些才算「真拆解」`);
console.log(`  词首空洞                : ${tally['gap-head']}   ← v0.7.0 只修了这一类的一部分`);
console.log(`  词中/词尾空洞           : ${tally['gap-mid']}   ← ⚠ 未被任何规则约束`);
console.log(`  不可拆（空）            : ${tally.empty}`);
console.log(`  ---- 计为「有拆解」的合计: ${tally.full + tally['gap-head'] + tally['gap-mid']}`);
console.log('');
const hit = tally.full + tally['gap-head'] + tally['gap-mid'];
console.log(`  尺子 R 现口径（非空即算）  : ${(hit / ruSampleR.length * 100).toFixed(1)}%  (${hit}/${ruSampleR.length})`);
console.log(`  尺子 R 严格口径（须无空洞）: ${(tally.full / ruSampleR.length * 100).toFixed(1)}%  (${tally.full}/${ruSampleR.length})`);
console.log(`  ⇒ 现口径把 ${tally['gap-head'] + tally['gap-mid']} 个「带空洞的拆解」算作了成功`);

console.log('\n--- 空洞总量分桶（仅统计「有拆解」的 244 词）---');
console.log(`  空洞 0 字符（完整覆盖）        : ${bucket['0']}   ← 严格意义上的完整拆解`);
console.log(`  空洞 1 字符（连接元音/接缝）   : ${bucket['1']}   ← 可容忍（чит-а-тель 的 -а- 属此类）`);
console.log(`  空洞 2 字符                    : ${bucket['2']}`);
console.log(`  空洞 ≥3 字符（整个词根被跳过）  : ${bucket['>=3']}   ← ⚠ 语义主干被丢，只剩前后缀`);
console.log('');
const strictish = bucket['0'] + bucket['1'];
console.log(`  「空洞 ≤1」口径的覆盖率        : ${(strictish / ruSampleR.length * 100).toFixed(1)}%  (${strictish}/${ruSampleR.length})`);
console.log(`  ⇒ 现口径 30.8% 中，有 ${bucket['2'] + bucket['>=3']} 词（占「有拆解」的 ${(((bucket['2'] + bucket['>=3']) / hit) * 100).toFixed(0)}%）词根被整段跳过`);

console.log(`\n--- 词首空洞样例（前 25 / 共 ${gapHead.length}）---`);
for (const [w, r] of gapHead.slice(0, 25)) console.log(fmt(w, r));

console.log(`\n--- 词中/词尾空洞样例（前 40 / 共 ${gapMid.length}）---`);
for (const [w, r] of gapMid.slice(0, 40)) console.log(fmt(w, r));

db.close();
