/**
 * 只读探针（功能测试 agent，2026-09-16）：用词库自带词源 parts 做地面真值 —— **修正版**
 *
 * ⚠⚠ 第一版（本文件的前身）得出「准确率 0.7%、假词根 48.3%」，**那是错的，已作废**。
 *   错因（我自己的判别集设计错误，对应 AGENTS.md §4.1 与主管的现场教学）：
 *     `word_etymology.chain[].parts` 记录的是**构词基（etymon 词）+ 词缀**，不是**词素**。
 *     例：регистрационный 的 parts 是 ["регистрация", "-ный"]，
 *         而算法拆的是词素 ["регистр-", "-аци-", "-онн-", "-ый"]。
 *     两者**粒度不同**，做集合相等比较必然几乎全不相等 —— 于是「假词根率」被虚抬到 48.3%。
 *     **度量工具本身必须先用已知正例校准**（主管 BOARD.md:95 的同一教训）。
 *
 * 修正做法：先**筛出粒度对齐的子集** —— 即「词源记载的每一个 part 本身**就是**词素库中的
 *   合法词素」的记录。只有在这种记录上，集合比较才有意义。
 *   例：больной 的 parts = ["боль", "-ной"]，而 боль 与 ной 都在词素库里 ⇒ 入选，可比较。
 *        регистрационный 的 parts 含 "регистрация"（不是词素）⇒ 剔除，不参与比较。
 *
 * 只读。用法：node scripts/probe_ru_etym_agreement.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const norm = (s) => String(s).replace(/-/g, '').toLowerCase();
const morphSet = new Set(
  db.prepare(`SELECT morpheme FROM morphemes WHERE lang='ru'`).all().map((m) => norm(m.morpheme)),
);

const rows = db
  .prepare(`SELECT word, chain FROM word_etymology WHERE lang='ru' AND chain LIKE '%"parts"%'`)
  .all();

const all = [];
for (const r of rows) {
  let chain;
  try {
    chain = JSON.parse(r.chain);
  } catch {
    continue;
  }
  for (const c of chain) {
    if (!Array.isArray(c.parts) || !c.parts.length) continue;
    all.push({ word: String(r.word), raw: c.parts, kind: c.kind });
    break;
  }
}

// ---- 粒度对齐筛选：每个 part 归一化后都是词素库中的合法词素，且长度 >= 2 ----
const aligned = all.filter((r) => r.raw.every((p) => norm(p).length >= 2 && morphSet.has(norm(p))));

console.log('='.repeat(84));
console.log('词源 parts 作为地面真值（修正版 · 先做粒度对齐筛选）');
console.log('='.repeat(84));
console.log(`  带 parts 的词源记录总数          : ${all.length}`);
console.log(`  粒度对齐（每个 part 都是合法词素）: ${aligned.length}`);
console.log(`  ⇒ 可用作地面真值的子集占比        : ${((aligned.length / all.length) * 100).toFixed(1)}%`);
console.log(`  （其余 ${all.length - aligned.length} 条记录是「构词基词+词缀」粒度，与词素拆解不可比，已剔除）`);
console.log('');
console.log('  未对齐记录样例（说明剔除是必要的）：');
for (const r of all.filter((x) => !aligned.includes(x)).slice(0, 8)) {
  console.log(`    ${r.word.padEnd(18)} parts=${JSON.stringify(r.raw)}  非词素的 part: ${JSON.stringify(r.raw.filter((p) => !morphSet.has(norm(p))))}`);
}

// ---- 在粒度对齐子集上比较 ----
const N = aligned.length;
let broken = 0;
let exact = 0;
let incomplete = 0; // 算法片段 ⊆ 词源记载，但少了（词根被吞 / 后缀未剥）
let falsePiece = 0; // 算法含词源记载之外的片段 ⇒ 假词根硬证据
const falseSamples = [];
const exactSamples = [];
const incompleteSamples = [];

for (const r of aligned) {
  const w = r.word;
  const parts = core.breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  broken++;
  const algoSet = new Set(parts.map((p) => norm(p.morpheme)));
  const recSet = new Set(r.raw.map(norm));
  const same = algoSet.size === recSet.size && [...algoSet].every((a) => recSet.has(a));
  const subset = [...algoSet].every((a) => recSet.has(a));
  if (same) {
    exact++;
    if (exactSamples.length < 20) exactSamples.push({ w, algo: [...algoSet], rec: r.raw });
  } else if (subset) {
    incomplete++;
    if (incompleteSamples.length < 25)
      incompleteSamples.push({ w, algo: parts.map((p) => p.morpheme), rec: r.raw });
  } else {
    falsePiece++;
    if (falseSamples.length < 25)
      falseSamples.push({ w, algo: parts.map((p) => p.morpheme), rec: r.raw, extra: [...algoSet].filter((a) => !recSet.has(a)) });
  }
}

const p = (n) => `${String(n).padStart(4)} (${((n / N) * 100).toFixed(1)}%)`;
console.log('');
console.log(`  --- 粒度对齐子集（${N} 词）---`);
console.log(`  已拆出                              : ${p(broken)}`);
console.log(`    Q2  完全一致（片段集合 == 词源）  : ${p(exact)}`);
console.log(`    Q2b 不完整（⊆ 词源，但漏了片段）  : ${p(incomplete)}`);
console.log(`    Q3  含词源外片段（**假词根硬证据**）: ${p(falsePiece)}`);
console.log('');
if (broken) {
  console.log(`  ⇒ 在「已拆出」的词里：完全一致 ${((exact / broken) * 100).toFixed(1)}% / 不完整 ${((incomplete / broken) * 100).toFixed(1)}% / 含假片段 ${((falsePiece / broken) * 100).toFixed(1)}%`);
  console.log(`     即：拆解**精确率约 ${((exact / broken) * 100).toFixed(1)}%**，`);
  console.log(`     ${(((incomplete + falsePiece) / broken) * 100).toFixed(1)}% 的「已拆解」与词库自己记载的词源不一致。`);
}

console.log('');
console.log(`  Q3 含假片段样例（算法片段不在词源记载中 —— 与 D1/D2/D4 同类）：`);
for (const s of falseSamples) {
  console.log(`    ${s.w.padEnd(16)} 算法 ${JSON.stringify(s.algo)}`);
  console.log(`    ${' '.repeat(16)} 词源 ${JSON.stringify(s.rec)}  多出 ${JSON.stringify(s.extra)}`);
}

console.log('');
console.log(`  Q2b 不完整样例（漏片段 = 词根/后缀被吞，对应 D2/D3）：`);
for (const s of incompleteSamples) {
  console.log(`    ${s.w.padEnd(16)} 算法 ${JSON.stringify(s.algo)}   词源 ${JSON.stringify(s.rec)}`);
}

console.log('');
console.log(`  Q2 完全一致样例（说明这个子集的比较是有效的 —— 确实存在对得上的词）：`);
for (const s of exactSamples) {
  console.log(`    ${s.w.padEnd(16)} 算法 ${JSON.stringify(s.algo)}   词源 ${JSON.stringify(s.rec)}`);
}

db.close();
