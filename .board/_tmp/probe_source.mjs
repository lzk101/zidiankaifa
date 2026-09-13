/** 探针 8：按 source 列统计词源来源（确认「中文 14,224」口径） */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db', { readOnly: true });
console.log('source 分布:', JSON.stringify(db.prepare('SELECT source, COUNT(1) c FROM word_etymology GROUP BY source ORDER BY c DESC').all()));
console.log('lang=ru 且 source 含 zh =', db.prepare("SELECT COUNT(1) c FROM word_etymology WHERE lang='ru' AND source LIKE '%zh%'").get().c);
console.log('lang=en 且 source 含 zh =', db.prepare("SELECT COUNT(1) c FROM word_etymology WHERE lang='en' AND source LIKE '%zh%'").get().c);
console.log('text_zh 非空 =', db.prepare('SELECT COUNT(1) c FROM word_etymology WHERE text_zh IS NOT NULL').get().c);
db.close();
