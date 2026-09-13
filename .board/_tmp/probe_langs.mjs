/** 探针 6：词源 lang 分布 + roots 语言分布（对账用） */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db', { readOnly: true });
console.log('word_etymology lang 分布:', JSON.stringify(db.prepare('SELECT lang, COUNT(1) c FROM word_etymology GROUP BY lang ORDER BY c DESC').all()));
console.log('roots 列:', JSON.stringify(db.prepare('PRAGMA table_info(roots)').all().map((r) => r.name)));
console.log('roots lang 分布:', JSON.stringify(db.prepare('SELECT lang, COUNT(1) c FROM roots GROUP BY lang').all()));
console.log('affixes 列:', JSON.stringify(db.prepare('PRAGMA table_info(affixes)').all().map((r) => r.name)));
console.log('morphemes lang 分布:', JSON.stringify(db.prepare('SELECT lang, COUNT(1) c FROM morphemes GROUP BY lang').all()));
console.log('words_i18n lang 分布:', JSON.stringify(db.prepare('SELECT lang, COUNT(1) c FROM words_i18n GROUP BY lang').all()));
console.log('i18n_forms lang 分布:', JSON.stringify(db.prepare('SELECT lang, COUNT(1) c FROM i18n_forms GROUP BY lang').all()));
db.close();
