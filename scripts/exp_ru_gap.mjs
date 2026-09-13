/**
 * 路径判别（只读）：310 个「可剥离合法前后缀」的词，能否靠「仅补词素」实现？
 *
 * 核心问题：breakdownWord 用的是「全局最优分段 DP + 覆盖率阈值」，它要求分段后
 * **每一段都是已知词素**。因此一个词要能被拆出，光有后缀不够——剥离后缀后剩下的
 * 词干也必须是一个已知词素（root）。
 *
 * 所以本实验把 310 词分成：
 *   A. 后缀已在库 + 剥离后词干也已在库  → 理论可拆，只是当前算法/阈值没拆出（算法问题）
 *   B. 后缀已在库 + 剥离后词干不在库    → 需要**新增词根**（数据问题）
 *   C. 后缀不在库                        → 需要**新增后缀**，且词干可能也要新增
 *
 * 用法：node scripts/exp_ru_gap.mjs
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
  .map((r) => ({ stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }));

const stemsByKind = { prefix: new Set(), suffix: new Set(), root: new Set() };
for (const m of morphemes) if (stemsByKind[m.kind]) stemsByKind[m.kind].add(m.stem);

// 所有已知词素的 stem（任意 kind），用于判断「词干是否是已知词素」
const allStems = new Set([...stemsByKind.prefix, ...stemsByKind.suffix, ...stemsByKind.root]);

const prefixes = [...stemsByKind.prefix].sort((a, b) => b.length - a.length);
const suffixes = [...stemsByKind.suffix].sort((a, b) => b.length - a.length);

const MIN_REST = 3;

const noBreakdown = [];
for (const w of rows) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (!parts.length) noBreakdown.push(w);
}

/** 已知词素 + 常见俄语词尾变体（软音符号/元音脱落），用于判断词干是否"接近"已知词素 */
const softStem = (s) => [s, s.replace(/[ьй]$/, ''), s.replace(/[аеиоуыюя]$/, '')].filter(Boolean);

const cases = { algoOnly: [], needRoot: [], needSuffix: [], needBoth: [] };
const suffixFreq = new Map(); // 缺失后缀 → 可覆盖词数

for (const w of noBreakdown) {
  // 找合法的前缀剥离
  const pCands = prefixes.filter((p) => w.startsWith(p) && w.length - p.length >= MIN_REST);
  // 找合法的后缀剥离
  const sCands = suffixes.filter((s) => w.endsWith(s) && w.length - s.length >= MIN_REST);

  // 只看最长的后缀剥离（最符合"词干"定义）
  const s = sCands[0];
  if (s) {
    const stem = w.slice(0, w.length - s.length);
    const stemKnown = softStem(stem).some((x) => allStems.has(x));
    if (stemKnown) {
      cases.algoOnly.push({ word: w, suffix: s, stem });
    } else {
      cases.needRoot.push({ word: w, suffix: s, stem });
    }
  } else if (pCands[0]) {
    const p = pCands[0];
    const rest = w.slice(p.length);
    const restKnown = softStem(rest).some((x) => allStems.has(x));
    if (restKnown) cases.algoOnly.push({ word: w, prefix: p, stem: rest });
    else cases.needRoot.push({ word: w, prefix: p, stem: rest });
  } else {
    // 既无合法前缀也无合法后缀 → 需要新增后缀本身
    cases.needSuffix.push({ word: w });
    // 猜一个"词尾 2-5 字符"作为候选后缀
    for (let L = Math.min(5, w.length - MIN_REST); L >= 2; L--) {
      const cand = w.slice(w.length - L);
      if (!suffixFreq.has(cand)) suffixFreq.set(cand, []);
      suffixFreq.get(cand).push(w);
      break;
    }
  }
}

const total = rows.length;
const withBreakdown = total - noBreakdown.length;
const legalCount = cases.algoOnly.length + cases.needRoot.length + cases.needSuffix.length;

const fmt = (n) => `${String(n).padStart(3)} (${((n / total) * 100).toFixed(1)}%)`;
console.log('='.repeat(76));
console.log('路径判别：310 词要拆出，代价是「补算法」还是「补数据」？');
console.log('='.repeat(76));
console.log(`样本总数                                     : ${total}`);
console.log(`  已有拆解                                   : ${fmt(withBreakdown)}`);
console.log(`  位置约束下的可提升空间                     : ${fmt(legalCount)}`);
console.log('');
console.log('  这 310 词按"拆出所需的代价"分类：');
console.log(`    A 后缀/前缀在库 + 词干也在库（纯算法问题）: ${fmt(cases.algoOnly.length)}`);
console.log(`    B 词缀在库 + 词干不在库（需新增词根）      : ${fmt(cases.needRoot.length)}`);
console.log(`    C 词缀本身不在库（需新增后缀）            : ${fmt(cases.needSuffix.length)}`);
console.log('');
const viaAlgorithmOnly = withBreakdown + cases.algoOnly.length;
console.log('【情景 1】只修算法/阈值，不新增任何词素：');
console.log(`  ${viaAlgorithmOnly} / ${total} = ${((viaAlgorithmOnly / total) * 100).toFixed(1)}%`);
console.log('');
const addRoots = viaAlgorithmOnly + cases.needRoot.length;
console.log('【情景 2】修算法 + 新增词根（词缀已在库）：');
console.log(`  ${addRoots} / ${total} = ${((addRoots / total) * 100).toFixed(1)}%`);
console.log('');
const all = addRoots + cases.needSuffix.length;
console.log('【情景 3】修算法 + 新增词根 + 新增后缀（理论上限）：');
console.log(`  ${all} / ${total} = ${((all / total) * 100).toFixed(1)}%`);
console.log('');
console.log('⇒ 45% 需 356 词。');
console.log(`  情景1 ${viaAlgorithmOnly >= 356 ? '✅ 够' : `❌ 差 ${356 - viaAlgorithmOnly} 词`}`);
console.log(`  情景2 ${addRoots >= 356 ? '✅ 够' : `❌ 差 ${356 - addRoots} 词`}`);
console.log(`  情景3 ${all >= 356 ? '✅ 够' : `❌ 差 ${356 - all} 词`}`);
console.log('');
console.log(`【B 类：需新增词根 · 样例 40 / 共 ${cases.needRoot.length}】`);
for (const c of cases.needRoot.slice(0, 40)) {
  console.log(`  ${c.word.padEnd(16)} = ${c.stem ?? ''} + ${c.suffix ? '-' + c.suffix : c.prefix + '-'}   (缺词根 ${c.stem})`);
}
console.log('');
console.log(`【A 类：词干已在库却未拆出 · 样例 30 / 共 ${cases.algoOnly.length}】`);
for (const c of cases.algoOnly.slice(0, 30)) {
  console.log(`  ${c.word.padEnd(16)} = ${c.stem ?? ''} + ${c.suffix ? '-' + c.suffix : c.prefix + '-'}`);
}
console.log('');
console.log(`【C 类：候选缺失后缀 TOP 20】`);
const topSuffix = [...suffixFreq.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
for (const [suf, ws] of topSuffix) {
  console.log(`  -${suf.padEnd(6)} 覆盖 ${String(ws.length).padStart(3)} 词  例: ${ws.slice(0, 3).join(', ')}`);
}

db.close();
