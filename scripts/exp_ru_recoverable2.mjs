/**
 * 修正版判别实验（只读）：加**位置约束**，避免上一版「任意位置子串命中」的假象。
 *
 * 位置约束（语言学正当性）：
 *   prefix 只允许出现在词首 (at === 0)
 *   suffix 只允许出现在词尾 (at + len === word.length)
 *   root   只统计，不单独作为「可提升」依据（词根常在词中，易假命中）
 *
 * 并要求：剥离已知词素后**剩余部分长度 ≥ 3**（否则是碎片，如 арест 剥 ре 只剩 аст）。
 *
 * 用法：node scripts/exp_ru_recoverable2.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const rows = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const morphemes = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }))
  .filter((m) => m.stem.length >= 2);

const prefixes = morphemes.filter((m) => m.kind === 'prefix').sort((a, b) => b.stem.length - a.stem.length);
const suffixes = morphemes.filter((m) => m.kind === 'suffix').sort((a, b) => b.stem.length - a.stem.length);
const roots = morphemes.filter((m) => m.kind === 'root').sort((a, b) => b.stem.length - a.stem.length);

const noBreakdown = [];
const withBreakdown = [];
for (const w of rows) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (parts.length) withBreakdown.push(w);
  else noBreakdown.push(w);
}

const MIN_REST = 3;

/** 合法的前缀剥离：前缀在词首，剩余长度 >= MIN_REST */
function legalPrefix(w) {
  const out = [];
  for (const m of prefixes) {
    if (w.startsWith(m.stem) && w.length - m.stem.length >= MIN_REST) {
      out.push({ morpheme: m.stem, kind: 'prefix', rest: w.slice(m.stem.length) });
    }
  }
  return out;
}

/** 合法的后缀剥离：后缀在词尾，剩余长度 >= MIN_REST */
function legalSuffix(w) {
  const out = [];
  for (const m of suffixes) {
    if (w.endsWith(m.stem) && w.length - m.stem.length >= MIN_REST) {
      out.push({ morpheme: m.stem, kind: 'suffix', rest: w.slice(0, w.length - m.stem.length) });
    }
  }
  return out;
}

/** 词根命中（仅统计参考，不作为「可提升」依据） */
function anyRoot(w) {
  return roots.some((m) => w.includes(m.stem) && m.stem.length >= 3);
}

const prefixOnly = [];
const suffixOnly = [];
const both = [];
const rootOnly = [];
const nothing = [];
const detail = [];

for (const w of noBreakdown) {
  const p = legalPrefix(w);
  const s = legalSuffix(w);
  if (p.length || s.length) {
    const rec = { word: w, prefix: p.slice(0, 3), suffix: s.slice(0, 3) };
    detail.push(rec);
    if (p.length && s.length) both.push(w);
    else if (p.length) prefixOnly.push(w);
    else suffixOnly.push(w);
  } else if (anyRoot(w)) {
    rootOnly.push(w);
  } else {
    nothing.push(w);
  }
}

const total = rows.length;
const fmt = (n) => `${String(n).padStart(3)} (${((n / total) * 100).toFixed(1)}%)`;
const legalCount = detail.length;

console.log('='.repeat(74));
console.log('修正版判别：加位置约束（prefix 词首 / suffix 词尾 / 剩余 ≥3）');
console.log('='.repeat(74));
console.log(`样本总数                                 : ${total}`);
console.log(`  已有拆解                               : ${fmt(withBreakdown.length)}`);
console.log(`  无拆解                                 : ${fmt(noBreakdown.length)}`);
console.log('');
console.log('  无拆解中（位置约束后）：');
console.log(`    可剥离合法前缀或后缀（真·可提升）     : ${fmt(legalCount)}`);
console.log(`        └ 仅前缀                         : ${prefixOnly.length}`);
console.log(`        └ 仅后缀                         : ${suffixOnly.length}`);
console.log(`        └ 前后缀均可                     : ${both.length}`);
console.log(`    仅含 3+ 字母词根（不构成合法剥离）     : ${fmt(rootOnly.length)}`);
console.log(`    完全无任何已知词素（单词根/外来词）    : ${fmt(nothing.length)}`);
console.log('');
const ceiling = withBreakdown.length + legalCount;
console.log('【位置约束下的真实可达上限】把「可剥离合法前后缀」的词全部拆出：');
console.log(`  ${ceiling} / ${total} = ${((ceiling / total) * 100).toFixed(1)}%`);
console.log('');
console.log(`  45% 目标需 356 词，当前 244，缺口 112 词；`);
console.log(`  位置约束下可得 +${legalCount} 词 → ${ceiling}（${((ceiling / total) * 100).toFixed(1)}%）`);
console.log(`  ⇒ 45% ${ceiling >= 356 ? '在可达范围内（但需把可剥离项基本吃干）' : '不可达'}`);
console.log('');
console.log(`【可剥离合法词素 · 样例 70 / 共 ${detail.length}】`);
for (const d of detail.slice(0, 70)) {
  const bits = [
    ...d.prefix.map((x) => `P:${x.morpheme}-`),
    ...d.suffix.map((x) => `S:-${x.morpheme}`),
  ];
  console.log(`  ${d.word.padEnd(16)} ${bits.join(' ')}`);
}
console.log('');
console.log(`【无任何已知词素 · 样例 50 / 共 ${nothing.length}】`);
console.log(nothing.slice(0, 50).join(' '));

db.close();
