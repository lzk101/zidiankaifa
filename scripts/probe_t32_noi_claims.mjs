/**
 * probe_t32_noi_claims.mjs —— T32 任务 2 收尾：核对 `-ной` origin 字段的两条**库内**自述
 * 功能测试 agent · 只读
 * 字段原文：`原始斯拉夫语 *-ьnъ 的重音变体（库内已有 -ный；本地词源 chain 记 больной = ["боль","-ной"]）`
 * 待核：① 库内是否真「已有 -ный」；② 是否存在 -н- / -ой 等更细粒度条目（决定「-ной 是否为合并近似」）；
 *       ③ больной 的本地 chain 是否真是 ["боль","-ной"]。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = openDatabase(DB_PATH);

console.log('=== ① 相关词素条目是否存在（ru）===');
for (const m of ['-ный', '-ной', '-н-', '-ой', 'боль-', 'вод-']) {
  const r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE morpheme = ? AND lang = ?').get(m, 'ru');
  console.log(`${m.padEnd(7)} ${r ? `存在 kind=${r.kind} 「${r.meaning_zh}」` : '不存在'}`);
  if (r) console.log(`        origin = ${String(r.origin).slice(0, 150)}`);
}

console.log('\n=== ② 全部以 -н/-ой 结尾的 ru suffix 条目 ===');
const suf = db.prepare("SELECT morpheme, meaning_zh FROM morphemes WHERE lang='ru' AND kind='suffix' AND (morpheme LIKE '%-н%' OR morpheme LIKE '%-ой%') ORDER BY morpheme").all();
console.log(suf.map((r) => `${r.morpheme}(${r.meaning_zh})`).join('  '));

console.log('\n=== ③ больной 的本地词源 chain ===');
const e = db.prepare("SELECT word, chain, origin, origin_code, source FROM word_etymology WHERE word = ?").get('больной');
if (!e) console.log('无记录');
else {
  const chain = JSON.parse(e.chain);
  for (const c of chain) {
    console.log(`  lang=${c.lang} word=${c.word} kind=${c.kind} parts=${JSON.stringify(c.parts)}`);
  }
  console.log(`  origin=${e.origin} origin_code=${e.origin_code} source=${e.source}`);
}

console.log('\n=== ④ -ной 关联词抽样（确认 72 词皆为形容词重音变体）===');
const w = db.prepare("SELECT words FROM affixes WHERE morpheme = ?").get('-ной');
const arr = JSON.parse(w.words);
console.log(`  共 ${arr.length} 词，抽样：${arr.slice(0, 14).join(' ')}`);
