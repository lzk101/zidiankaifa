/**
 * 只读探针（功能测试 agent · T15 补二）：主管分母 86,697 的最后一段归因。
 * 已确认「纯西里尔（ё→е 后）」得 у32 ✓；总量 93,511，还差 6,814。
 * 只读、幂等。用法：node scripts/probe_t15_denominator2.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const TARGET = 86697;

console.log('=== 候选表与列 ===');
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((r) => String(r.name));
console.log(`  全部表: ${tables.join(' ')}`);
if (tables.includes('words')) {
  const cols = db.prepare(`PRAGMA table_info(words)`).all().map((c) => String(c.name));
  console.log(`  words 表列: ${cols.join(' ')}`);
  if (cols.includes('lang')) {
    for (const l of ['ru', 'en']) {
      const n = db.prepare(`SELECT COUNT(1) AS n FROM words WHERE lang=?`).get(l).n;
      console.log(`    words WHERE lang='${l}' = ${n}`);
    }
  }
  const nAll = db.prepare(`SELECT COUNT(1) AS n FROM words`).get().n;
  console.log(`    words 全表 = ${nAll}${nAll === TARGET ? '   ★★★ 命中 86,697' : ''}`);
}

console.log('');
console.log('=== 纯西里尔（ё→е）集合上再叠加过滤 ===');
const words = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const cyr = [...new Set(words.map((w) => w.replace(/ё/g, 'е')).filter((w) => /^[а-я]+$/.test(w)))];
console.log(`  基线（纯西里尔 + ё→е + 去重） = ${cyr.length}`);

const tests = [
  ['length >= 3', (w) => w.length >= 3],
  ['length >= 4', (w) => w.length >= 4],
  ['length >= 5', (w) => w.length >= 5],
  ['length >= 6', (w) => w.length >= 6],
  ['length <= 12', (w) => w.length <= 12],
  ['length 4..12', (w) => w.length >= 4 && w.length <= 12],
  ['在 word_etymology 中有词源', (w) => db.prepare(`SELECT COUNT(1) AS n FROM word_etymology WHERE word=? AND lang='ru'`).get(w).n > 0],
  ['不在根/词缀倒排表', (w) => db.prepare(`SELECT COUNT(1) AS n FROM affixes WHERE word=?`).get(w).n === 0],
];
for (const [name, fn] of tests) {
  let n = 0;
  for (const w of cyr) if (fn(w)) n++;
  const mark = n === TARGET ? '   ★★★ 命中 86,697' : '';
  console.log(`  ${name.padEnd(28)} = ${String(n).padStart(7)}${mark}`);
}

console.log('');
console.log('=== у 组在各过滤下的词数（主管 32）===');
const { breakdownWord } = await import('../packages/core/dist/db/index.js');
const passU = [];
for (const w of words) {
  let p;
  try {
    p = breakdownWord(db, w, 'ru');
  } catch {
    p = [];
  }
  if (p.length >= 2 && p[0].start === 1 && w[0] === 'у') passU.push(w.replace(/ё/g, 'е'));
}
for (const [name, fn] of [['原样', () => true], ['纯西里尔', (w) => /^[а-я]+$/.test(w)]]) {
  console.log(`  ${name.padEnd(12)} = ${new Set(passU.filter(fn)).size}`);
}
console.log(`  ⇒ 「纯西里尔」即得 32（= 主管 у32）✓  被过滤掉的 4 个含非西里尔字符：`);
for (const w of passU) if (!/^[а-я]+$/.test(w)) console.log(`      ${w}`);

db.close();
