/**
 * 缺陷影响面核验（只读）：假词根是否污染「同根词 · 词族」
 *
 * плескание/xлестаться 被误拆出 лес-（森林）、зверство 被误拆出 вер-（信）、
 * 若 roots 倒排表由 breakdownWord 生成，则 лес- 词族里会出现 плескание 这类
 * 与「森林」毫无关系的词——这是**用户可见**的缺陷，不只是内部指标问题。
 *
 * 用法：node scripts/probe_ru_family_pollution.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

console.log('='.repeat(78));
console.log('假词根 → 词族污染核验（只读）');
console.log('='.repeat(78));

for (const [morpheme, suspects] of [
  ['лес-', ['плескание', 'хлестаться', 'глетчерный']],
  ['лет-', ['землетрясение', 'глетчерный', 'тлеться']],
  ['тел-', ['ателье']],
  ['вер-', ['зверство']],
  ['тоск-', ['стетоскоп', 'ректоскоп']],
]) {
  // 直接查 roots/affixes 倒排表最可靠
  const row =
    db.prepare(`SELECT words, word_count FROM roots WHERE morpheme=? AND lang='ru'`).get(morpheme) ??
    db.prepare(`SELECT words, word_count FROM affixes WHERE morpheme=? AND lang='ru'`).get(morpheme);
  const words = row ? JSON.parse(row.words) : [];
  const hit = suspects.filter((s) => words.includes(s));
  console.log(`\n${morpheme}  词族规模=${row ? row.word_count : 0}`);
  if (hit.length) {
    console.log(`  ⚠ 污染命中: ${hit.join(', ')}`);
  } else {
    console.log(`  未污染（倒排表可能未含该词，或 suspects 不在库中）`);
  }
}

// 直接统计：倒排表里 лес- 组是否含 плескание
console.log('\n--- roots 表结构抽样 ---');
const rows = db.prepare(`SELECT morpheme, word_count FROM roots WHERE lang='ru' ORDER BY word_count DESC LIMIT 12`).all();
for (const r of rows) console.log(`  ${String(r.morpheme).padEnd(12)} ${r.word_count}`);

// 反向核验：把被误拆的词单独跑一遍 relatedByMorpheme，看用户实际会看到什么
console.log('\n--- 用户可见影响：плескание 的「同根词」卡里出现 лес- 组？---');
for (const w of ['плескание', 'хлестаться', 'землетрясение', 'ателье', 'зверство']) {
  const g = core.relatedByMorpheme(db, w, 'ru');
  console.log(`  ${w.padEnd(16)} → ${g.map((x) => `${x.morpheme}[${x.kind}] ${x.words.length}词`).join(' | ') || '(无)'}`);
}

db.close();
