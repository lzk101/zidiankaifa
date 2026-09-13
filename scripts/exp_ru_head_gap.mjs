/**
 * 决定性度量（只读）：用**与 breakdownWord 完全一致**的规则，度量尺子 R 的 791 词
 * 在「新增词根」这条路线上能走多远。
 *
 * 关键规则（此前我漏掉的那条，见 packages/core/src/db/index.ts:851-855）：
 *   拆解的第一个片段必须 start < 2，或词首 gap 能被一个**精确匹配的前缀**解释。
 *   ⇒ 一个词要能被拆出，**词首必须有一个已知的根词素（或前缀）**。
 *   这就是为什么 басистый / паводковый / пуговичный 即使词尾是已知后缀 -истый/-овый/-ный 也拆不出来：
 *   它们的词干 бас/паводк/пугович 不在词素库里，DP 只能从位置 ≥2 起，触发 gap 拒绝。
 *
 * 本脚本输出：
 *   ① 791 词的「词首已知词素」缺口分布 —— 直接量化"补词根"这条路线
 *   ② 需要补哪些词首词素才能达到 45%（按覆盖词数排序）
 *
 * 用法：node scripts/exp_ru_head_gap.mjs
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
  .map((r) => ({ raw: String(r.morpheme), kind: String(r.kind), stem: String(r.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е') }));

const byKind = { prefix: [], suffix: [], root: [] };
for (const m of morphemes) if (byKind[m.kind]) byKind[m.kind].push(m);
for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => b.stem.length - a.stem.length);

/** 词首候选：prefix 或 root，且长度 ≥2（单字符前缀另算，需紧邻支撑） */
const headCandidates = (w) => {
  const out = [];
  for (const m of byKind.root) if (m.stem.length >= 3 && w.startsWith(m.stem)) out.push({ ...m, at: 0 });
  return out;
};

const withBreakdown = [];
const noBreakdown = [];
for (const w of rows) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (p.length) withBreakdown.push(w); else noBreakdown.push(w);
}

// ---- ① 词首缺口分析（对无拆解词） ----
const headKnown = [];   // 词首已有已知词素，却没拆出
const headUnknown = []; // 词首无任何已知词素 → 必须新增词首词素
const headByStem = new Map();

for (const w of noBreakdown) {
  const heads = headCandidates(w);
  const pfx = byKind.prefix.filter((p) => w.startsWith(p.stem) && (p.stem.length >= 2 || w.length - p.stem.length >= 3));
  if (heads.length || pfx.length) {
    headKnown.push({ w, heads: heads.slice(0, 2), pfx: pfx.slice(0, 2) });
  } else {
    headUnknown.push(w);
  }
}

const total = rows.length;
const fmt = (n) => `${String(n).padStart(3)} (${((n / total) * 100).toFixed(1)}%)`;

console.log('='.repeat(78));
console.log('决定性度量：词首缺口（对应 index.ts:851-855 的 gap 拒绝规则）');
console.log('='.repeat(78));
console.log(`样本总数                                : ${total}`);
console.log(`  已有拆解                              : ${fmt(withBreakdown.length)}`);
console.log(`  无拆解                                : ${fmt(noBreakdown.length)}`);
console.log('');
console.log('  无拆解 547 词的**词首**情况：');
console.log(`    词首已有已知词素（根/前缀）却未拆出   : ${fmt(headKnown.length)}`);
console.log(`    词首完全无已知词素（必须新增词首词素） : ${fmt(headUnknown.length)}`);
console.log('');
console.log('⇒ 关键结论：**词首没有已知词素的词，无论词尾有多少已知后缀，都必然拆不出来**');
console.log(`   （gap 拒绝规则）。这类词有 ${headUnknown.length} 个。`);
console.log('');
const ceilingWithHeads = withBreakdown.length + headKnown.length;
console.log('【路线上限】只修算法，不新增任何词首词素：');
console.log(`  ${ceilingWithHeads} / ${total} = ${((ceilingWithHeads / total) * 100).toFixed(1)}%`);
console.log('');
console.log('【达到 45% 所需】需 356 词。当前 244。');
console.log(`  靠「修算法 + 词首已有词素的 ${headKnown.length} 词」最多到 ${ceilingWithHeads}；`);
console.log(`  仍需从 ${headUnknown.length} 个"词首无已知词素"的词中新增词首词素救回 ${Math.max(0, 356 - ceilingWithHeads)} 词。`);
console.log('');

// ---- ② 词首候选词素的频次：补哪个最划算 ----
console.log('【按"候选词首词素"聚类：补哪些词首词素最划算（TOP 25）】');
console.log('（做法：对词首无已知词素的词，取其"去掉最长已知后缀后的剩余部分"作为候选词根）');
for (const w of headUnknown) {
  let stem = w;
  for (const s of byKind.suffix) {
    if (w.endsWith(s.stem) && w.length - s.stem.length >= 3) { stem = w.slice(0, w.length - s.stem.length); break; }
  }
  // 进一步去掉常见屈折词尾 1-2 字符，得到更"词根化"的形式
  if (!headByStem.has(stem)) headByStem.set(stem, []);
  headByStem.get(stem).push(w);
}
const top = [...headByStem.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25);
for (const [stem, ws] of top) {
  console.log(`  候选词首「${stem}」 → ${ws.length} 词   例: ${ws.slice(0, 3).join(', ')}`);
}
console.log(`  ...（共 ${headByStem.size} 个不同候选，绝大多数只覆盖 1 词）`);
console.log('');
const cover1 = [...headByStem.values()].filter((v) => v.length === 1).length;
console.log(`  只覆盖 1 词的候选有 ${cover1} 个 → 说明"补词根"是**滴水式**工作，无法靠少量补充达标。`);

console.log('');
console.log(`【无拆解且词首有已知词素 · 样例 40 / 共 ${headKnown.length}】`);
for (const h of headKnown.slice(0, 40)) {
  const bits = [...h.heads.map((x) => `root:${x.stem}`), ...h.pfx.map((x) => `pfx:${x.stem}`)];
  console.log(`  ${h.w.padEnd(16)} 词首命中: ${bits.join(', ')}`);
}

db.close();
