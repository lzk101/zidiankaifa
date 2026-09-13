/**
 * 结构判别实验（只读）：尺子 R 的 791 词样本，按「首字母大写（专名代理）」与
 * 「是否有俄语词源」交叉统计，量化 45% 目标的结构天花板。
 *
 * 用法：node scripts/exp_ru_structure.mjs
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

const hasEtym = new Set(
  db.prepare(`SELECT word FROM word_etymology WHERE lang='ru'`).all().map((r) => String(r.word)),
);

const buckets = {
  hasBreakdown: [],
  noBreakdown_cap_etym: [], // 无拆解 + 首字母大写 + 有词源
  noBreakdown_cap_noetym: [],
  noBreakdown_low_etym: [], // 无拆解 + 小写 + 有词源（= 真·可提升空间的上界）
  noBreakdown_low_noetym: [],
};

for (const w of rows) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (parts.length) {
    buckets.hasBreakdown.push(w);
    continue;
  }
  const cap = /^[А-ЯЁІѢ]/.test(w);
  const et = hasEtym.has(w);
  if (cap && et) buckets.noBreakdown_cap_etym.push(w);
  else if (cap) buckets.noBreakdown_cap_noetym.push(w);
  else if (et) buckets.noBreakdown_low_etym.push(w);
  else buckets.noBreakdown_low_noetym.push(w);
}

const total = rows.length;
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
console.log('='.repeat(70));
console.log('尺子 R 样本（791 词）结构判别');
console.log('='.repeat(70));
console.log(`样本总数                    : ${total}`);
console.log('');
const show = (label, arr) => console.log(`  ${label.padEnd(34)}: ${String(arr.length).padStart(3)} (${pct(arr.length).padStart(6)})`);
show('已有拆解', buckets.hasBreakdown);
show('无拆解 · 首字母大写 · 有词源', buckets.noBreakdown_cap_etym);
show('无拆解 · 首字母大写 · 无词源', buckets.noBreakdown_cap_noetym);
show('无拆解 · 小写 · 有词源', buckets.noBreakdown_low_etym);
show('无拆解 · 小写 · 无词源', buckets.noBreakdown_low_noetym);

const noBrk = total - buckets.hasBreakdown.length;
console.log('');
console.log(`无拆解合计                  : ${noBrk} (${pct(noBrk)})`);
console.log(`  其中首字母大写（专名代理）: ${buckets.noBreakdown_cap_etym.length + buckets.noBreakdown_cap_noetym.length}`);
console.log(`  其中小写（普通词）        : ${buckets.noBreakdown_low_etym.length + buckets.noBreakdown_low_noetym.length}`);

// 乐观天花板：假设「小写 + 有词源」的词全部拆出（这是可提升空间的上界）
const optimisticHits = buckets.hasBreakdown.length + buckets.noBreakdown_low_etym.length;
console.log('');
console.log('【乐观天花板】假设「小写·有词源」的无拆解词全部成功拆出：');
console.log(`  命中 ${optimisticHits} / ${total} = ${((optimisticHits / total) * 100).toFixed(1)}%`);
console.log('  注：这只是「有词源」这个弱条件下的上界，实际还需这些词真的含可拆词素。');

// 次级乐观：再把「小写 + 无词源」也全算上
const optimistic2 = total - (buckets.noBreakdown_cap_etym.length + buckets.noBreakdown_cap_noetym.length);
console.log('');
console.log('【极乐观天花板】只排除「首字母大写的无拆解词」，其余全拆出：');
console.log(`  命中 ${optimistic2} / ${total} = ${((optimistic2 / total) * 100).toFixed(1)}%`);

console.log('');
console.log('【无拆解 · 小写 · 有词源（真·可提升空间）样例 80 个】');
console.log(buckets.noBreakdown_low_etym.slice(0, 80).join(' '));
console.log('');
console.log('【无拆解 · 首字母大写 样例 40 个】');
console.log([...buckets.noBreakdown_cap_etym, ...buckets.noBreakdown_cap_noetym].slice(0, 40).join(' '));

db.close();
