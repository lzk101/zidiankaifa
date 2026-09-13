/**
 * 只读探针（功能测试 agent，2026-09-16）：尺子 R 的分子里有多少是「同义反复式拆解」
 *
 * 起因：probe_ru_sample_hygiene.mjs 撞见 `псевдо-`（库中的前缀条目本体）实测输出 ["псевдо-"]，
 *   即「一个词素被拆解成它自己」也被 R 计为「有拆解」。同类还有 `разно-`。
 *   若这类同义反复在 244 里占比可观，则 R 的**分子**也在灌水（方向与分母污染相反），
 *   这直接支撑我对「把 related.mjs:144 下限提到 45%」的异议（见 EVIDENCE L4 层）。
 *
 * 判据：
 *   T1 同义反复：parts.length===1 且该片段覆盖整词（start===0 && end===n）
 *      —— 即「整个词就是一个已知词素」，没有发生任何**切分**。
 *   T2 退化拆解：parts.length===1 但不覆盖整词（如 водопад → ["водо-"]）
 *      —— 有切分意图但只切出 1 个片段，另一半是空洞。
 *   T3 真拆解：parts.length>=2
 *
 * 只读。用法：node scripts/probe_ru_tautology.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const sample = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const bdFull = (w) => {
  try {
    return core.breakdownWord(db, w, 'ru');
  } catch {
    return [];
  }
};

const T1 = [];
const T2 = [];
const T3 = [];
for (const w of sample) {
  const parts = bdFull(w);
  if (!parts.length) continue;
  const n = w.length;
  if (parts.length === 1) {
    const p = parts[0];
    if (p.start === 0 && p.end === n) T1.push({ w, m: p.morpheme });
    else T2.push({ w, m: p.morpheme, hole: `${p.start}-${p.end}/${n}` });
  } else {
    T3.push(w);
  }
}

const N = sample.length;
const pct = (x) => `${x} (${((x / N) * 100).toFixed(1)}%)`;
const withBd = T1.length + T2.length + T3.length;

console.log('='.repeat(80));
console.log(`尺子 R 分子结构剖析（样本 ${N} 词，有拆解 ${withBd} 词）`);
console.log('='.repeat(80));
console.log(`  T1 同义反复（整词就是一个词素，**未发生任何切分**）: ${pct(T1.length)}`);
console.log(`  T2 退化拆解（只切出 1 个片段，其余是空洞）        : ${pct(T2.length)}`);
console.log(`  T3 真拆解（>=2 个片段）                           : ${pct(T3.length)}`);
console.log('');
console.log(`  现行尺子 R（非空即算）                            : ${((withBd / N) * 100).toFixed(1)}%`);
console.log(`  剔 T1 后                                          : ${(((T2.length + T3.length) / N) * 100).toFixed(1)}%`);
console.log(`  只算 T3（要求真的切开了）                         : ${((T3.length / N) * 100).toFixed(1)}%`);
console.log('');
console.log(`  45% 目标若按「只算 T3」口径，需要 ${Math.ceil(0.45 * N)} 词，当前 ${T3.length}，缺口 ${Math.ceil(0.45 * N) - T3.length} 词（现行口径缺口 ${Math.ceil(0.45 * N) - withBd} 词）。`);

console.log('');
console.log(`  T1 全清单（共 ${T1.length} 条）—— 每一条都是「词 = 词素」，R 却计为拆解成功：`);
for (const r of T1) console.log(`    ${r.w.padEnd(14)} → ${JSON.stringify([r.m])}`);

console.log('');
console.log(`  T2 全清单（共 ${T2.length} 条）—— 只切出 1 个片段，其余为空洞：`);
for (const r of T2) console.log(`    ${r.w.padEnd(14)} → ["${r.m}"]   片段占位 ${r.hole}`);

console.log('');
console.log('  T3 样例（前 40 条，真拆解）：');
console.log('    ' + T3.slice(0, 40).join(' '));
console.log('');
console.log(`  ⚠ 若 T1 中包含「词表里本身就是词缀的条目」（如 псевдо- / разно-），`);
console.log(`     那是词表卫生问题与尺子问题的叠加：条目污染 + 尺子奖励自指。`);

db.close();
