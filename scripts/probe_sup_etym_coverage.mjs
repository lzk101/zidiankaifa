// 主管独立判别：H-c（词源链核证）的可行性取决于词源库的覆盖与内容
// 只读。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'data', 'db', 'dict.db'));

console.log('=== word_etymology 表结构 ===');
for (const c of db.prepare('PRAGMA table_info(word_etymology)').all()) {
  console.log(`  ${c.name} (${c.type})`);
}

console.log('=== 行数按 lang ===');
for (const r of db.prepare('SELECT lang, COUNT(1) AS n FROM word_etymology GROUP BY lang').all()) {
  console.log(`  lang=${r.lang}  ${r.n}`);
}

console.log('=== 关键词的词源覆盖（lang=ru）===');
const probe = ['сучить', 'сучение', 'сучок', 'сучковатый', 'однако',
  'удачный', 'удача', 'смекать', 'вода',
  'столп', 'казус', 'доминировать', 'больной'];
let covered = 0;
for (const w of probe) {
  const rows = db.prepare('SELECT * FROM word_etymology WHERE word = ? AND lang = ?').all(w, 'ru');
  if (rows.length) covered++;
  console.log(`  ${w.padEnd(15)} rows=${rows.length}`);
}
console.log(`  → 覆盖 ${covered}/${probe.length}`);

console.log('');
console.log('=== 若覆盖，看 chain / text_en 的实际内容（前 8 词）===');
for (const w of probe.slice(0, 8)) {
  const rows = db.prepare('SELECT * FROM word_etymology WHERE word = ? AND lang = ?').all(w, 'ru');
  if (!rows.length) { console.log(`  ${w}: （无词源行）`); continue; }
  for (const r of rows) {
    const chain = r.chain == null ? '(null)' : String(r.chain);
    const te = r.text_en == null ? '(null)' : String(r.text_en);
    console.log(`  ${w}:`);
    console.log(`      chain   = ${chain.slice(0, 200)}`);
    console.log(`      text_en = ${te.slice(0, 200)}`);
  }
}
db.close();
