/** 探针 7：中文词源到底存在哪里 */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db', { readOnly: true });
console.log('表清单(含 etym):', JSON.stringify(db.prepare("SELECT name, type FROM sqlite_master WHERE name LIKE '%etym%' OR name LIKE '%zh%'").all()));
const cols = db.prepare('PRAGMA table_info(word_etymology)').all().map((r) => r.name);
console.log('word_etymology 列:', JSON.stringify(cols));
// 含中文字符的行（按 lang）
for (const lang of ['en', 'ru']) {
  const r = db.prepare(
    `SELECT COUNT(1) c FROM word_etymology WHERE lang=? AND (text_en GLOB '*[一-龥]*' OR text_zh GLOB '*[一-龥]*')`
  ).get(lang);
  console.log(`  lang=${lang} 文本含中文的行 =`, r.c);
}
// 逐列扫描含中文
for (const col of cols) {
  try {
    const r = db.prepare(`SELECT COUNT(1) c FROM word_etymology WHERE ${col} GLOB '*[一-龥]*'`).get();
    console.log(`  列 ${col} 含中文行数 =`, r.c);
  } catch (e) { console.log(`  列 ${col} 跳过：${e.message.slice(0, 40)}`); }
}
console.log('样例 ru 行:', JSON.stringify(db.prepare("SELECT * FROM word_etymology WHERE lang='ru' LIMIT 2").all(), null, 1).slice(0, 700));
db.close();
