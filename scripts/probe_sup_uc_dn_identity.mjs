// 主管独立判别：уч- / дн- 在词素库里的身份，以及库内是否有 суч- / дн- 词根
// 只读。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'data', 'db', 'dict.db'));

console.log('=== morphemes 表结构 ===');
for (const c of db.prepare('PRAGMA table_info(morphemes)').all()) console.log(`  ${c.name} (${c.type})`);

console.log('');
console.log('=== уч / дн / суч / да 相关词素行（全 lang）===');
const like = ['уч', 'дн', 'суч', 'да'];
for (const s of like) {
  const rows = db.prepare(
    "SELECT morpheme, kind, lang, meaning_zh, meaning_en, origin, examples FROM morphemes " +
    "WHERE REPLACE(REPLACE(morpheme,'-',''),'\u0451','\u0435') = ? ORDER BY lang, kind",
  ).all(s);
  console.log(`  "${s}" → ${rows.length} 行`);
  for (const r of rows) {
    console.log(`      [${r.lang}/${r.kind}] ${r.morpheme}  zh=${r.meaning_zh ?? '-'}  en=${r.meaning_en ?? '-'}`);
    console.log(`          origin=${String(r.origin ?? '-').slice(0, 90)}`);
    console.log(`          examples=${String(r.examples ?? '-').slice(0, 110)}`);
  }
}

console.log('');
console.log('=== 单字符前缀全表（俄语）===');
for (const r of db.prepare("SELECT morpheme, meaning_zh, meaning_en FROM morphemes WHERE lang='ru' AND kind='prefix'").all()) {
  const stem = String(r.morpheme).replace(/^-+|-+$/g, '');
  if (stem.length === 1) console.log(`  ${r.morpheme}  zh=${r.meaning_zh}  en=${r.meaning_en}`);
}
db.close();
