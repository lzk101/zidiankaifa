/** 探针 5：核对 docs/交接文档.md §5.1 声明的表行数（只读） */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db', { readOnly: true });
const one = (sql) => db.prepare(sql).get();
const rows = [
  ['words', "SELECT COUNT(1) c FROM words"],
  ['words_i18n(ru)', "SELECT COUNT(1) c FROM words_i18n WHERE lang='ru'"],
  ['word_etymology(en)', "SELECT COUNT(1) c FROM word_etymology WHERE lang='en'"],
  ['word_etymology(ru)', "SELECT COUNT(1) c FROM word_etymology WHERE lang='ru'"],
  ['word_etymology(zh)', "SELECT COUNT(1) c FROM word_etymology WHERE lang='zh'"],
  ['morphemes(en)', "SELECT COUNT(1) c FROM morphemes WHERE lang='en'"],
  ['morphemes(ru)', "SELECT COUNT(1) c FROM morphemes WHERE lang='ru'"],
  ['roots', 'SELECT COUNT(1) c FROM roots'],
  ['affixes', 'SELECT COUNT(1) c FROM affixes'],
  ['i18n_forms', 'SELECT COUNT(1) c FROM i18n_forms'],
  ['word_forms', 'SELECT COUNT(1) c FROM word_forms'],
  ['book', 'SELECT COUNT(1) c FROM book'],
];
for (const [label, sql] of rows) {
  try { console.log(`${label} = ${one(sql).c}`); } catch (e) { console.log(`${label} = ERR ${e.message}`); }
}
console.log('--- 备份表是否存在 ---');
for (const t of ['words_i18n_inflection_backup', 'word_etymology_origin_backup', 'i18n_forms_fix_backup', '_inflection_cleanup_log']) {
  try { console.log(`${t} = ${one(`SELECT COUNT(1) c FROM ${t}`).c}`); } catch (e) { console.log(`${t} = 不存在`); }
}
console.log('--- roots/affixes 语言分布 ---');
for (const t of ['roots', 'affixes']) {
  try { console.log(t, JSON.stringify(db.prepare(`SELECT lang, kind, COUNT(1) c FROM ${t} GROUP BY lang, kind`).all())); }
  catch (e) { console.log(t, 'ERR', e.message); }
}
db.close();
