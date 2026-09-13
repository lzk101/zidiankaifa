/**
 * A2 迭代 · 判别集候选词实测探针（只读；测试 agent 独占）
 *
 * 目的：在把任何期望值写进 packages/core/test/ru_morph.mjs 之前，
 *       先看**当前实现实际输出什么**。区分三态：
 *         [PASS] 当前输出 == 语言学正确       → 可写正例
 *         [DEFECT] 当前输出 != 语言学正确     → 写反例/缺陷，报主管
 *         [EMPTY] 当前输出为空                → 需判断是「本应空」还是「该拆没拆」
 *
 * 同时也把候选词是否在 words_i18n、以及涉及的词素是否在 morphemes 表里打出来，
 * 用于区分「实现缺陷」与「词素库覆盖缺口」——这两者的修复责任人不同。
 *
 * 用法：node scripts/probe_ru_discriminator.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const POS = [
  'переписать',
  'записать',
  'написать',
  'читатель',
  'домик',
  'столик',
  'лесник',
  'водный',
  'стетоскоп',
  'телескоп',
  'микроскоп',
  'картоскоп',
  'снегоход',
  'пароход',
  'самолёт',
  'землетрясение',
];

const NEG = [
  'сегодня',
  'луна',
  'небо',
  'река',
  'гора',
  'Абакан',
  'Австралия',
  'Иисусъ',
  'вода',
  'страшный',
  'ателье',
  'тельце',
  'обезьяна',
  '-ед',
  '-ец',
  '-ость',
  '-ский',
  '-ировать',
  'человек',
  'работа',
  'картина',
  'богатый',
  'дорогой',
];

// 期望涉及的词素是否存在于词素库
const WATCH = ['пис-', 'чит-', 'дом-', 'стол-', 'лес-', 'вод-', 'скоп-', 'тоск-', 'год-', '-тель', '-ник', '-ик', '-ный', '-ать', 'пере-', 'за-', 'на-'];

console.log('='.repeat(70));
console.log('A2 判别集候选词 · 当前实现实测（只读）');
console.log('='.repeat(70));

const fmt = (parts) =>
  parts.length === 0
    ? '[]'
    : '[' + parts.map((p) => `${p.morpheme}(${p.kind}@${p.start}-${p.end})`).join(' ') + ']';

function show(title, list) {
  console.log(`\n--- ${title} ---`);
  for (const w of list) {
    let parts = [];
    try {
      parts = core.breakdownWord(db, w, 'ru');
    } catch (e) {
      console.log(`  ${w.padEnd(16)} THROW ${e.message}`);
      continue;
    }
    const inDict = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND word=?`).get(w).n;
    console.log(`  ${w.padEnd(16)} ${inDict ? 'dict ' : '  -- '} ${fmt(parts)}`);
  }
}

show('候选正例（期望被正确拆解）', POS);
show('候选反例（期望空 / 不含特定词素）', NEG);

console.log('\n--- 词素库是否收录（决定「实现缺陷」vs「词素库缺口」）---');
for (const m of WATCH) {
  const row = db.prepare(`SELECT kind, meaning_zh FROM morphemes WHERE lang='ru' AND morpheme=?`).get(m);
  console.log(`  ${m.padEnd(10)} ${row ? `${row.kind.padEnd(7)} ${row.meaning_zh ?? ''}` : '—— 未收录 ——'}`);
}
for (const m of ['стето-', 'скоп-', 'зем-', 'земл-', 'тряс-', 'лет-', 'тел-']) {
  const row = db.prepare(`SELECT kind, meaning_zh FROM morphemes WHERE lang='ru' AND morpheme=?`).get(m);
  console.log(`  ${m.padEnd(10)} ${row ? `${row.kind.padEnd(7)} ${row.meaning_zh ?? ''}` : '—— 未收录 ——'}`);
}

console.log('\n--- 纯词缀条目（words_i18n 里的非词）---');
const affixRows = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND word LIKE '-%' ORDER BY length(word)`);
for (const r of affixRows.all()) {
  const parts = core.breakdownWord(db, r.word, 'ru');
  console.log(`  ${String(r.word).padEnd(14)} ${fmt(parts)}`);
}

console.log('\n--- 专名抽样（期望空）---');
const propers = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 5 AND 10 AND rowid % 811 = 0 LIMIT 40`,
  )
  .all()
  .map((r) => r.word);
for (const w of propers) {
  const parts = core.breakdownWord(db, w, 'ru');
  if (parts.length) console.log(`  ${String(w).padEnd(18)} ${fmt(parts)}`);
}

db.close();
