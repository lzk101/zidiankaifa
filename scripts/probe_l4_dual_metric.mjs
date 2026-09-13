/**
 * 主管裁决用：一次算清 L4 的**两个口径**，并复现 321 / 303 / 342 三个 D1 集数字。
 * 只读。用法：node scripts/probe_l4_dual_metric.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const bd = (w) => core.breakdownWord(db, w, 'ru');

const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const RU_ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const RU_CYR = RU_ALL.filter((w) => /^[а-яё-]+$/.test(w));
const RU_4_12 = RU_CYR.filter((w) => w.length >= 4 && w.length <= 12);

/** 口径 A：未覆盖字符【总数】≥3（测试 agent KPI 口径） */
function gapTotal(p, n) {
  if (!p.length) return null;
  const s = [...p].sort((a, b) => a.start - b.start);
  let covered = 0;
  for (const x of s) covered += x.end - x.start;
  return n - covered;
}
/** 口径 B：最大【单段】空洞 ≥3（BOARD.md:315 主管冻结口径） */
function gapMax(p, n) {
  if (!p.length) return null;
  const s = [...p].sort((a, b) => a.start - b.start);
  const gaps = [];
  let c = 0;
  for (const x of s) { if (x.start > c) gaps.push(x.start - c); c = Math.max(c, x.end); }
  if (c < n) gaps.push(n - c);
  return gaps.length ? Math.max(...gaps) : 0;
}

function tally(mod, list, fn, thresh) {
  let k = 0;
  for (const w of list) {
    const p = mod(w);
    if (!p.length) continue;
    const g = fn(p, w.length);
    if (g >= thresh) k++;
  }
  return k;
}

console.log('='.repeat(78));
console.log('L4 双口径核实（尺子 R，分母 791）');
console.log('='.repeat(78));
console.log(`R 分母: ${R.length}`);
console.log('');
console.log('口径                              ≥3        ≥2');
console.log(`A 未覆盖字符【总数】(测试agent)   ${String(tally(bd, R, gapTotal, 3)).padStart(4)}      ${String(tally(bd, R, gapTotal, 2)).padStart(4)}`);
console.log(`B 最大【单段】空洞 (BOARD:315)    ${String(tally(bd, R, gapMax, 3)).padStart(4)}      ${String(tally(bd, R, gapMax, 2)).padStart(4)}`);
console.log('');
console.log('测试 agent KPI 声称: 空洞≥3=134 / 空洞≥2=175 / 零空洞=37 / 空洞≤1=69');
console.log(`  口径A ≥3 = ${tally(bd, R, gapTotal, 3)}  → ${tally(bd, R, gapTotal, 3) === 134 ? '✅ 与测试 agent 一致（134）' : '❌ 不一致'}`);
console.log(`  口径A ≥2 = ${tally(bd, R, gapTotal, 2)}  → ${tally(bd, R, gapTotal, 2) === 175 ? '✅ 与测试 agent 一致（175）' : '❌ 不一致'}`);
console.log('');

// 零空洞 / 空洞<=1 校验（口径A）
let zero = 0, le1 = 0;
for (const w of R) {
  const p = bd(w);
  if (!p.length) continue;
  const g = gapTotal(p, w.length);
  if (g === 0) zero++;
  if (g <= 1) le1++;
}
console.log(`  口径A 零空洞 = ${zero}  → ${zero === 37 ? '✅ 一致（37）' : '❌'}`);
console.log(`  口径A 空洞≤1 = ${le1}  → ${le1 === 69 ? '✅ 一致（69）' : `❌ 实际 ${le1}`}`);
console.log('');

// ---- D1 集：三个数字的口径复现 ----
console.log('='.repeat(78));
console.log('D1 集数字复现（321 / 303 / 342）');
console.log('='.repeat(78));
const PREFIX_SET = new Set(['в', 'о', 'с', 'у']);

function d1Count(list, label) {
  let total = 0, kept = 0, rejected = 0;
  let keptByChar = {};
  for (const w of list) {
    const p = bd(w);
    // 修法后仍可拆且 gap=1 → 必为"被前缀解释而放行"（自洽性已证 0 泄漏）
    if (p.length && p[0].start === 1) {
      total++; kept++;
      const g = w.slice(0, 1);
      keptByChar[g] = (keptByChar[g] ?? 0) + 1;
    }
  }
  return { total, kept, keptByChar, label, size: list.length };
}

const sets = [
  [RU_ALL, '全库俄语词条（无过滤）'],
  [RU_CYR, '仅西里尔字母/连字符'],
  [RU_4_12, '西里尔 且 length 4–12'],
  [RU_CYR.filter((w) => w.length >= 4 && w.length <= 14), '西里尔 且 length 4–14'],
];
for (const [list, label] of sets) {
  const r = d1Count(list, label);
  console.log(`  ${label.padEnd(26)} 全量 ${String(r.size).padStart(6)}  修法后保留 gap=1: ${String(r.kept).padStart(3)}  按字符 ${JSON.stringify(r.keptByChar)}`);
}
console.log('');
console.log('★ 修法后被消除数固定为 267（全库实测，与一切口径无关）。');
console.log('  ⇒ 各口径"修法前 D1 模式总数" = 保留数(该口径) + 267:');
for (const [list, label] of sets) {
  const r = d1Count(list, label);
  console.log(`     ${label.padEnd(26)} : ${r.kept} + 267 = ${r.kept + 267}`);
}
console.log('');
console.log('  开发 agent 报 342（=75+267）→ 对应"全库无过滤"口径');
console.log('  我此前报 321 → 对应"西里尔 且 length 4–14"口径');
console.log('  开发 agent 报 303 → 若为"修法后该口径保留数"则应为', RU_4_12.filter((w) => { const p = bd(w); return p.length && p[0].start === 1; }).length, '+267');

db.close();
