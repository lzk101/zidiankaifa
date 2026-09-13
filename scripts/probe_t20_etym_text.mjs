/**
 * 只读探针（功能测试 agent · T20）：把「无 chain parts」的目标词的全部词源字段原样打出，
 * 便于人工/联网判定真词根。只读、幂等。
 * 用法：node scripts/probe_t20_etym_text.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB, { readOnly: true });
const q = db.prepare(`SELECT text_en, text_zh, chain, origin, origin_code, source FROM word_etymology WHERE word = ? AND lang='ru' LIMIT 1`);

const WORDS = [
  // да- 族中无 parts 的 27 词
  'вдавлина', 'вдалбливать', 'вдалеке', 'одалживаться', 'одаренность', 'одаренный', 'одар\u0451нный',
  'сдабривать', 'сдавленный', 'сдавочный', 'сдаигаться', 'сдатчик', 'удавчик', 'удаленный',
  'удалитель', 'удал\u0451нный', 'ударенный', 'ударить', 'ударник1', 'ударник2', 'ударница',
  'ударничество', 'ударно-тепловой', 'ударопрочный', 'ударостойкий', 'ударостойкость', 'ударочувствительность',
  // суч- 族（V9-2）
  'сучок', 'сучковатый', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковый',
  'сучкорезка', 'сучкорезный', 'суч\u0451ный', 'сучить',
  // 其他关键
  '\u043e\u0434\u043d\u0430\u043a\u043e', 'сук', 'смекать', 'удачный', 'удача', 'удаться',
  'вдавить', 'сдавить', 'удавить', 'одарить', 'удалить', 'обольстить', 'больной', 'самосуд', 'термостат',
];

for (const w of WORDS) {
  const r = q.get(w);
  console.log('='.repeat(80));
  console.log(w);
  if (!r) { console.log('  **无记载**'); continue; }
  if (r.origin || r.origin_code) console.log(`  origin=${r.origin ?? 'null'} code=${r.origin_code ?? 'null'}`);
  console.log(`  src=${r.source ?? 'null'}`);
  console.log(`  [EN] ${(r.text_en ?? '').replace(/\n/g, ' | ').slice(0, 600)}`);
  console.log(`  [ZH] ${(r.text_zh ?? '').replace(/\n/g, ' | ').slice(0, 600)}`);
  if (r.chain) {
    try {
      const c = JSON.parse(r.chain);
      console.log(`  [chain] ${c.map((x) => `${x.lang}:${x.word ?? '-'}${x.parts ? '[' + x.parts.join(',') + ']' : ''}(${x.kind})`).join(' → ')}`);
    } catch { console.log('  [chain] (parse fail)'); }
  } else console.log('  [chain] null');
}

db.close();
