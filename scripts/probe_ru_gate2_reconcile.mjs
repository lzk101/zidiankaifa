/**
 * 只读探针（功能测试 agent，2026-09-16）：核对 BOARD.md:120 的「119 词卡在支撑规则」
 *
 * BOARD.md:120 写：「④ 单字符前缀无紧邻支撑 119 (15.0%)，如 вдыхать(cov 0.57)、
 *   велюровый(cov 0.56) —— 覆盖率够，卡在支撑规则」。
 *
 * 我的 probe_ru_gate2_prediction.mjs §② 测得：丢掉支撑规则后**最多**新增 28 词。
 * 28 ≠ 119，必须查清差异来源，否则开发 agent 会按错误的「119 词红利」去改规则。
 *
 * 本探针把「卡在支撑规则」拆成两个必要条件的交集：
 *   (A) 词中**确实存在**词首规范位的 1 字符前缀命中  —— 支撑规则才可能成为拦阻
 *   (B) 丢掉支撑规则后覆盖率**仍能** ≥ 0.55          —— 否则覆盖率阈值也是拦阻
 * 只有 A∧B 的词，才是「放宽支撑规则就能解锁」的真红利。
 *
 * 只读。用法：node scripts/probe_ru_gate2_reconcile.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const THRESHOLD = 0.55;
const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const morph = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ raw: String(r.morpheme), stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }));

function canonicalHits(w) {
  const lw = w.toLowerCase();
  const hits = [];
  for (const m of morph) {
    if (!m.stem.length) continue;
    for (let i = 0; i + m.stem.length <= lw.length; i++) {
      if (lw.slice(i, i + m.stem.length) !== m.stem) continue;
      const end = i + m.stem.length;
      if (m.kind === 'prefix' && i !== 0) continue;
      if (m.kind === 'suffix' && end !== lw.length) continue;
      hits.push({ raw: m.raw, kind: m.kind, start: i, end, len: m.stem.length });
    }
  }
  return hits;
}

/** 最大不重叠覆盖（按位置递增的简单 DP，等价于「最多覆盖多少字符」） */
function maxCovered(hits) {
  const byStart = new Map();
  for (const h of hits) {
    if (!byStart.has(h.start)) byStart.set(h.start, []);
    byStart.get(h.start).push(h);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const memo = new Map();
  const solve = (from) => {
    if (from >= starts.length) return { covered: 0, picked: [] };
    if (memo.has(from)) return memo.get(from);
    // 跳过 starts[from]
    const skip = solve(from + 1);
    let best = skip;
    for (const h of byStart.get(starts[from])) {
      const nxt = starts.findIndex((s) => s >= h.end);
      const sub = nxt < 0 ? { covered: 0, picked: [] } : solve(nxt);
      const cand = { covered: h.len + sub.covered, picked: [h, ...sub.picked] };
      if (cand.covered > best.covered) best = cand;
    }
    memo.set(from, best);
    return best;
  };
  return solve(0);
}

const sample = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const unsolved = [];
for (const w of sample) {
  let p = [];
  try {
    p = core.breakdownWord(db, w, 'ru');
  } catch {
    p = [];
  }
  if (!p.length) unsolved.push(w);
}

let A = 0; // 有词首 1 字符前缀命中
let AandB = 0; // 且丢规则后覆盖率够
const aNotB = [];
const aAndB = [];
for (const w of unsolved) {
  const hits = canonicalHits(w);
  const has1 = hits.some((h) => h.kind === 'prefix' && h.len === 1 && h.start === 0);
  if (!has1) continue;
  A++;
  const { covered, picked } = maxCovered(hits);
  const cov = covered / w.length;
  const oneCharPicked = picked.some((p) => p.kind === 'prefix' && p.len === 1);
  if (cov >= THRESHOLD && oneCharPicked) {
    AandB++;
    aAndB.push({ w, cov, picked: [...picked].sort((a, b) => a.start - b.start).map((p) => p.raw).join('+') });
  } else {
    aNotB.push({ w, cov });
  }
}

console.log('='.repeat(80));
console.log(`核对「119 词卡在支撑规则」（无拆解 ${unsolved.length} 词）`);
console.log('='.repeat(80));
console.log(`  (A) 存在词首规范位 1 字符前缀命中的词        : ${A}  (${(A / sample.length * 100).toFixed(1)}% of 791)`);
console.log(`      ├ (A∧B) 且丢规则后覆盖率 ≥0.55（真红利）: ${AandB}  (${(AandB / sample.length * 100).toFixed(1)}%)`);
console.log(`      └ (A∧¬B) 覆盖率仍 <0.55（覆盖率也是拦阻）: ${aNotB.length}  (${(aNotB.length / sample.length * 100).toFixed(1)}%)`);
console.log('');
if (Math.abs(A - 119) <= 12) {
  console.log('  ⇒ (A) 与 BOARD.md:120 的 119 量级吻合 ⇒ 119 的口径很可能是「词中存在词首 1 字符前缀」，');
  console.log('     即「支撑规则**是**拦阻之一」，而**不是**「放宽它就能解锁」。');
} else {
  console.log(`  ⇒ (A)=${A} 与 119 不吻合，差异需开发 agent 用 T2 实验核对（BOARD.md:87 约定）。`);
}
console.log(`  ⇒ 真正「放宽支撑规则即可解锁」的红利上界 = ${AandB} 词（${(AandB / sample.length * 100).toFixed(1)}%），`);
console.log(`     而非 119 词（15.0%）。缺口 ${A - AandB} 词同时卡在覆盖率阈值上。`);
console.log('');
console.log('  (A∧¬B) 样例（这些词**即使**放宽支撑规则也拆不出来，别把它们算进红利）：');
for (const r of aNotB.slice(0, 20)) console.log(`    ${r.w.padEnd(14)} cov=${r.cov.toFixed(3)}`);
console.log('');
console.log('  (A∧B) 全部（= 放宽支撑规则后会新增拆解的词，需逐个人工审定是否假拆解）：');
for (const r of aAndB) console.log(`    ${r.w.padEnd(14)} cov=${r.cov.toFixed(3)}  ${r.picked}`);

db.close();
