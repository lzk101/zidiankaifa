/**
 * 关键判别实验（只读）：尺子 R 样本中「无拆解」的 547 词里，有多少其实
 * **含有当前词素库中已存在的词素**（即真·可提升空间），有多少是单词根词。
 *
 * 做法：对每个无拆解词，暴力扫描所有可能子串位置 × 所有已知俄语词素（stem 精确匹配），
 * 判断是否存在任何位置能命中任一已收录词素。命中即说明「不是没有词素，而是没被拆出」。
 *
 * 用法：node scripts/exp_ru_recoverable.mjs
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

// 词素库：取 stem（去连字符）
const morphemes = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }))
  .filter((m) => m.stem.length >= 2);

// 按长度降序，便于优先匹配长词素
morphemes.sort((a, b) => b.stem.length - a.stem.length);

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

// 对每个无拆解词做「任意位置子串是否命中已知词素」
const recoverable = []; // 命中，但没被拆出 → 真·可提升空间
const noMorphemeAtAll = []; // 一个已知词素都命中不了 → 单词根词/外来词
const hitDetail = [];

for (const w of noBreakdown) {
  const hits = [];
  for (const m of morphemes) {
    let idx = w.indexOf(m.stem);
    while (idx !== -1) {
      hits.push({ morpheme: w.slice(idx, idx + m.stem.length), kind: m.kind, at: idx });
      idx = w.indexOf(m.stem, idx + 1);
    }
    if (hits.length > 40) break; // 防爆
  }
  // 去重
  const uniq = [...new Map(hits.map((h) => [`${h.at}:${h.morpheme}`, h])).values()];
  if (uniq.length) {
    recoverable.push(w);
    hitDetail.push({ word: w, hits: uniq.slice(0, 4) });
  } else {
    noMorphemeAtAll.push(w);
  }
}

const total = rows.length;
const fmt = (n) => `${String(n).padStart(3)} (${((n / total) * 100).toFixed(1)}%)`;

console.log('='.repeat(72));
console.log('关键判别：无拆解的 547 词，有多少含「已收录词素」？');
console.log('='.repeat(72));
console.log(`样本总数                         : ${total}`);
console.log(`  有拆解                         : ${fmt(withBreakdown.length)}`);
console.log(`  无拆解                         : ${fmt(noBreakdown.length)}`);
console.log('');
console.log('  无拆解中：');
console.log(`    含已收录词素（真·可提升）      : ${fmt(recoverable.length)}`);
console.log(`    完全无已收录词素（单词根/外来）: ${fmt(noMorphemeAtAll.length)}`);
console.log('');
const best = withBreakdown.length + recoverable.length;
console.log('【真实天花板】把「含已收录词素的词」全部拆出（不新增任何词素）:');
console.log(`  ${best} / ${total} = ${((best / total) * 100).toFixed(1)}%`);
console.log('');
console.log('⇒ 45% 目标需要 356/791 命中；');
console.log(`   仅靠现有词素库最多到 ${best}（${((best / total) * 100).toFixed(1)}%），缺口 ${356 - best} 词。`);
console.log('');
console.log('【含已收录词素但未被拆出 · 样例 60（词 → 命中词素@位置）】');
for (const h of hitDetail.slice(0, 60)) {
  console.log(`  ${h.word.padEnd(16)} ← ${h.hits.map((x) => `${x.morpheme}(${x.kind})@${x.at}`).join(', ')}`);
}
console.log('');
console.log(`【完全无已收录词素 · 样例 60 / 共 ${noMorphemeAtAll.length}】`);
console.log(noMorphemeAtAll.slice(0, 60).join(' '));

db.close();
