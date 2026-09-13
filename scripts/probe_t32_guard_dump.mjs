/**
 * probe_t32_guard_dump.mjs —— T32 只读探针：导出 ru_morph_v090_guard.mjs 所需的全部实测态
 * 功能测试 agent · 2026-09-13
 * 只读：仅 SELECT + 调 breakdownWord（dist）。不改任何文件、不写库。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = openDatabase(DB_PATH);

const dump = (w, lang = 'ru') => {
  const parts = breakdownWord(db, w, lang);
  return parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`);
};

const GROUPS = {
  'A. D4 六词': ['столп', 'казус', 'доминировать', 'больной', 'самосуд', 'термостат'],
  'B. V9-2 十二词（суч- 全族 11 + однако）': [
    'сучить', 'сучок', 'сучковатый', 'сучение', 'сучильный', 'сучка',
    'сучковатость', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучёный', 'однако',
  ],
  'C. 哨兵 12 词': [
    'вдаваться', 'одалживать', 'сдабривать', 'удачный', 'удаться', 'вдаться',
    'вдавить', 'ударить', 'смекать', 'вода', 'экстатический', 'петух',
  ],
  'D. loses 2 词': ['поднаковальня', 'поднакопить'],
  'E. -ной 代价 4 词': ['больной', 'внеземной', 'входной', 'выводной'],
};

for (const [title, words] of Object.entries(GROUPS)) {
  console.log(`\n--- ${title} ---`);
  for (const w of words) {
    const parts = breakdownWord(db, w, 'ru');
    console.log(
      `${w.padEnd(16)} len=${String(w.length).padStart(2)}  ${JSON.stringify(dump(w))}` +
        `  cov=${parts.reduce((s, p) => s + (p.end - p.start), 0)}/${w.length}` +
        `  firstStart=${parts.length ? parts[0].start : '-'}`,
    );
  }
}

console.log('\n--- F. 九条词素的 DB 行（origin 全文）---');
for (const m of ['суч-', 'суд-', 'домин-', '-ной', 'пад-', 'тряс-', 'столп-', 'казус-', 'однако-']) {
  const row = db.prepare('SELECT morpheme, kind, meaning_zh, origin, examples, lang FROM morphemes WHERE morpheme = ?').get(m);
  console.log(`\n[${m}] kind=${row?.kind} lang=${row?.lang} meaning_zh=${row?.meaning_zh}`);
  console.log(`  origin = ${row?.origin}`);
  console.log(`  examples = ${row?.examples}`);
  const inRoots = db.prepare('SELECT morpheme, word_count, lang FROM roots WHERE morpheme = ?').all(m);
  const inAff = db.prepare('SELECT morpheme, word_count, lang FROM affixes WHERE morpheme = ?').all(m);
  console.log(`  roots=${JSON.stringify(inRoots)} affixes=${JSON.stringify(inAff)}`);
}

console.log('\n--- G. 反向对照（真单字符前缀被匹配到位置 0）---');
for (const w of ['вбегать', 'обегать', 'обеднеть', 'вверх', 'вдаться', 'удаться', 'удачный']) {
  console.log(`${w.padEnd(14)} ${JSON.stringify(dump(w))}`);
}

console.log('\n--- H. morphemes 表规模 + ru 词素含「兜底」标记的条数 ---');
console.log('morphemes 总数 =', db.prepare('SELECT COUNT(1) AS c FROM morphemes').get().c);
console.log("ru morphemes =", db.prepare("SELECT COUNT(1) AS c FROM morphemes WHERE lang='ru'").get().c);
console.log("含'兜底' =", db.prepare("SELECT COUNT(1) AS c FROM morphemes WHERE lang='ru' AND origin LIKE '%兜底%'").get().c);
const fz = db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru' AND origin LIKE '%兜底%'").all();
console.log('兜底条目明细 =', JSON.stringify(fz));

console.log('\n--- I. 关键否证：不得存在的词素 ---');
for (const m of ['уч-', 'дн-', 'каз-', 'дом-', 'лет-', 'лес-', 'тел-', 'мал-', 'вер-', 'да-', 'стат-']) {
  const r = db.prepare('SELECT morpheme, kind, meaning_zh FROM morphemes WHERE morpheme = ? AND lang = ?').get(m, 'ru');
  console.log(`${m.padEnd(8)} ${r ? `存在 kind=${r.kind} ${r.meaning_zh}` : '不存在'}`);
}

console.log('\n--- J. 分布核对：суч- 词素关联词数 / -ной 关联词数 ---');
for (const m of ['суч-', '-ной']) {
  const r = db.prepare('SELECT morpheme, word_count FROM roots WHERE morpheme = ?').all(m);
  const a = db.prepare('SELECT morpheme, word_count FROM affixes WHERE morpheme = ?').all(m);
  console.log(`${m}: roots=${JSON.stringify(r)} affixes=${JSON.stringify(a)}`);
}
