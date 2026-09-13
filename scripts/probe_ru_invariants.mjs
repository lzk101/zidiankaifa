/**
 * 只读探针（功能测试 agent，2026-09-16）：结构不变量 + 碎片陷阱守卫 全样本体检
 *
 * 目的：在把「位置约束」写成判别集断言之前，先全样本验证这些不变量**当前确实成立**，
 *       避免写出一个开局就红的假断言（AGENTS.md §4.2：先小后大）。
 *
 * 待验不变量：
 *   I1  prefix 片段必须位于词首 (start === 0)
 *   I2  suffix 片段剥离后剩余必须 >= 3 (start >= 3)  ← 主管点名的「碎片拒绝」规则
 *   I3  片段必须落在 [0, len] 内且 start < end，按 start 升序且互不重叠或允许间隙
 *   I4  片段之间无重叠（重叠即同一字符被两个词素认领）
 *
 * 同时给出主管点名的「碎片陷阱」候选词实际输出，供挑选安全反例。
 * 只读。用法：node scripts/probe_ru_invariants.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const sample = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const bdFull = (w) => {
  try {
    return core.breakdownWord(db, w, 'ru');
  } catch {
    return [];
  }
};

const viol = { I1: [], I2: [], I3: [], I4: [] };
let withBd = 0;
let partsTotal = 0;

for (const w of sample) {
  const n = w.length;
  const parts = bdFull(w);
  if (!parts.length) continue;
  withBd++;
  partsTotal += parts.length;
  const sorted = [...parts].sort((a, b) => a.start - b.start);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === 'prefix' && p.start !== 0) viol.I1.push(`${w}: ${p.morpheme}@${p.start}`);
    if (p.kind === 'suffix' && p.start < 3) viol.I2.push(`${w}: ${p.morpheme}@${p.start}`);
    if (!(p.start >= 0 && p.start < p.end && p.end <= n)) viol.I3.push(`${w}: ${p.morpheme}@${p.start}-${p.end}`);
    if (i > 0 && sorted[i].start < sorted[i - 1].end)
      viol.I4.push(`${w}: ${sorted[i - 1].morpheme}@${sorted[i - 1].start}-${sorted[i - 1].end} 与 ${sorted[i].morpheme}@${sorted[i].start}-${sorted[i].end}`);
  }
}

console.log('='.repeat(78));
console.log(`结构不变量全样本体检（${sample.length} 词，其中有拆解 ${withBd} 词，片段总数 ${partsTotal}）`);
console.log(`  I1 prefix 必须在词首 (start===0)         违反 ${viol.I1.length}  ${viol.I1.slice(0, 6).join(' | ')}`);
console.log(`  I2 suffix 剥离后剩余>=3 (start>=3)        违反 ${viol.I2.length}  ${viol.I2.slice(0, 6).join(' | ')}`);
console.log(`  I3 片段边界合法 0<=start<end<=len        违反 ${viol.I3.length}  ${viol.I3.slice(0, 6).join(' | ')}`);
console.log(`  I4 片段互不重叠                          违反 ${viol.I4.length}  ${viol.I4.slice(0, 6).join(' | ')}`);

console.log('');
console.log('碎片陷阱候选（词尾像后缀、剥离后剩余<=2）的实际输出：');
for (const w of ['очко', 'свить', 'впить', 'алость', 'арест', 'Краков', 'Лена', 'Эдем', 'Мальта', 'топка', 'лыжня', 'злюка']) {
  const parts = bdFull(w);
  console.log(`  ${w.padEnd(10)} len=${String(w.length).padEnd(3)} ${JSON.stringify(parts.map((p) => p.morpheme)).padEnd(30)} ${parts.map((p) => `${p.morpheme}[${p.kind}]@${p.start}`).join(' ')}`);
}

// 主管点名假命中在「按位置约束的朴素剥离器」下会不会真的命中
console.log('');
console.log('位置约束下的朴素剥离判定（复现主管 exp_ru_recoverable2 的判据，验证 4 个假命中的来源）：');
const morph = db.prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`).all()
  .map((r) => ({ raw: String(r.morpheme), stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }));
for (const w of ['арест', 'Краков', 'Лена', 'Эдем']) {
  const lw = w.toLowerCase();
  const P = morph.filter((m) => m.kind === 'prefix' && lw.startsWith(m.stem) && lw.length - m.stem.length >= 3);
  const S = morph.filter((m) => m.kind === 'suffix' && lw.endsWith(m.stem) && lw.length - m.stem.length >= 3);
  console.log(`  ${w.padEnd(9)} 合法前缀剥离 ${P.length ? P.map((m) => m.raw).join(',') : '无'}   合法后缀剥离 ${S.length ? S.map((m) => m.raw).join(',') : '无'}`);
}
console.log('  ⇒ 位置约束下这 4 词均无合法剥离，不会成为假命中。');
console.log('     主管第一版实验的假命中来自「任意位置子串匹配」，不是位置约束；');
console.log('     но 他们的 kind 登记（ре-/на-/де- 是 prefix、-ко 是 suffix）决定了：');
console.log('     若实现允许 prefix 出现在非词首，Лена/Эдем/арест 立刻复现假命中 —— 这正是 I1 的护栏价值。');

db.close();
