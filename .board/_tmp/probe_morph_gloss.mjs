import { DatabaseSync } from 'node:sqlite';
const d = new DatabaseSync('data/db/dict.db', { readOnly: true });
const q = d.prepare("SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang='ru' AND morpheme = ?");
for (const m of ['лес-', 'вер-', 'мал-', 'да-', 'лет-', 'тел-', 'зем-']) {
  const r = q.get(m);
  console.log(m.padEnd(8), r ? `${r.kind} | ${r.meaning_zh} | ${r.origin}` : '未收录');
}
console.log('\n--- 相关词条是否在库 ---');
for (const w of ['плескание', 'хлестаться', 'зверство', 'глетчерный', 'ателье', 'эмальерный', 'удачный', 'тлеться', 'водопад', 'землетрясение']) {
  const n = d.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND word = ?").get(w).n;
  console.log(w.padEnd(16), n ? 'in words_i18n' : '不在词库');
}
console.log('\n--- 词源表里有没有 удача / эмаль 的词源（辅助判断）---');
for (const w of ['удача', 'удачный', 'эмаль', 'плеск', 'зверь', 'хлест']) {
  const r = d.prepare("SELECT origin FROM word_etymology WHERE lang='ru' AND word = ?").get(w);
  console.log(w.padEnd(10), r ? r.origin : '(无词源)');
}
d.close();
