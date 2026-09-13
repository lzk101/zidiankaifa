/**
 * 只读探针（功能测试 agent · T20 §1）：为目标词逐词拉齐三类证据 ——
 *   ① 引擎当前拆解（生产 dist）
 *   ② word_etymology 的 chain / text_en / text_zh / origin
 *   ③ 被命中的词素在 morphemes 表里的条目（含 origin 字段）
 * 只读、幂等。用法：node scripts/probe_t20_etym_dump.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bd from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB, { readOnly: true });

const E = '\u0451'; // ё
const D4 = ['столп', 'казус', 'доминировать', 'больной', 'самосуд', 'термостат'];
const V92 = [
  'сучить', 'сучок', 'сучковатый', 'сучение', 'сучильный',
  'сучка', 'сучковатость', 'сучковый', 'сучкорезка', 'сучкорезный', `суч${E}ный`,
  'однако',
];
const REV = ['смекать', 'удачный', 'удаться', 'удача', 'дача', 'вода', 'воля', 'сокол', 'утро', 'облако'];

const et = db.prepare(
  `SELECT text_en, text_zh, chain, origin, origin_code, source FROM word_etymology WHERE word = ? AND lang = 'ru' LIMIT 1`,
);
const mo = db.prepare(`SELECT morpheme, kind, meaning_zh, meaning_en, origin FROM morphemes WHERE lang='ru' AND morpheme = ?`);
const show = (w) => {
  const parts = bd.breakdownWord(db, w, 'ru') ?? [];
  console.log(`\n${'='.repeat(80)}\n${w}   →  ${JSON.stringify(parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`))}`);
  const chain = parts.map((p) => p.morpheme);
  for (const m of chain) {
    const rows = mo.all(m);
    for (const r of rows) console.log(`   [词素] ${r.morpheme} (${r.kind}) 中=${r.meaning_zh} en=${r.meaning_en} | origin=${r.origin}`);
    if (!rows.length) console.log(`   [词素] ${m} —— **不在 morphemes 表**`);
  }
  const e = et.get(w);
  if (!e) {
    console.log('   [词源] **无记载**');
    return;
  }
  console.log(`   [词源] origin=${e.origin} code=${e.origin_code} src=${e.source}`);
  if (e.text_en) console.log(`   [EN] ${String(e.text_en).replace(/\s+/g, ' ').slice(0, 400)}`);
  if (e.text_zh) console.log(`   [ZH] ${String(e.text_zh).replace(/\s+/g, ' ').slice(0, 200)}`);
  try {
    const c = JSON.parse(e.chain);
    console.log(`   [chain] ${JSON.stringify(c).slice(0, 500)}`);
  } catch {
    console.log(`   [chain] (raw) ${String(e.chain).slice(0, 200)}`);
  }
};

console.log('#'.repeat(80) + '\n# D4 六词\n' + '#'.repeat(80));
for (const w of D4) show(w);
console.log('\n\n' + '#'.repeat(80) + '\n# V9-2 十二词\n' + '#'.repeat(80));
for (const w of V92) show(w);
console.log('\n\n' + '#'.repeat(80) + '\n# 反向对照候选（字母像巧合/实际真前缀）\n' + '#'.repeat(80));
for (const w of REV) show(w);

db.close();
