/**
 * 只读探针：为 D4「退化单片段拆解中的假词根」取证（каз- / стол-）
 * 只读。用法：node .board/_tmp/probe_d4_gloss.mjs   （或任意路径）
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

console.log('=== 词素 gloss / origin（morphemes 表） ===');
for (const m of ['каз', 'стол', 'люб', 'боль', 'труд', 'врем', 'цвет', 'само', 'термо']) {
  const rows = db
    .prepare(`SELECT morpheme, kind, meaning_zh, meaning_en, origin FROM morphemes WHERE lang='ru' AND morpheme LIKE ?`)
    .all(`%${m}%`);
  for (const r of rows) {
    console.log(`  ${String(r.morpheme).padEnd(9)} [${r.kind}] zh=${r.meaning_zh} en=${r.meaning_en} origin=${r.origin}`);
  }
}

console.log('');
console.log('=== 目标词词源（word_etymology 表） ===');
const cols = db.prepare(`PRAGMA table_info(word_etymology)`).all().map((c) => c.name);
console.log(`  列：${cols.join(', ')}`);
for (const w of ['казус', 'столп', 'стол', 'больной', 'труд', 'любви', 'время', 'цвети', 'самосуд', 'термостат']) {
  const rows = db.prepare(`SELECT * FROM word_etymology WHERE word = ? AND lang='ru'`).all(w);
  if (!rows.length) {
    console.log(`  ${w.padEnd(10)} — 无词源记录 —`);
    continue;
  }
  for (const r of rows) {
    const brief = Object.entries(r)
      .filter(([k]) => !['word', 'lang'].includes(k))
      .map(([k, v]) => `${k}=${String(v).slice(0, 150)}`)
      .join(' | ');
    console.log(`  ${w.padEnd(10)} ${brief}`);
  }
}

console.log('');
console.log('=== 实测拆解 ===');
const bd = (w) => core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}[${p.kind}]@${p.start}-${p.end}`);
for (const w of ['казус', 'столп', 'больной', 'труд', 'любви', 'время', 'цвети', 'самосуд', 'термостат', 'аэроб', 'паратиф', 'ферробор', 'ветро']) {
  console.log(`  ${w.padEnd(11)} ${bd(w).join(' ')}`);
}

console.log('');
console.log('=== 同族反查污染检查（столп 会不会列出 стол 词族）===');
if (typeof core.relatedByMorpheme === 'function') {
  for (const w of ['казус', 'столп']) {
    try {
      const r = core.relatedByMorpheme(db, w, 'ru');
      console.log(`  ${w}: ${JSON.stringify(r).slice(0, 300)}`);
    } catch (e) {
      console.log(`  ${w}: <${e.message}>`);
    }
  }
} else {
  console.log('  relatedByMorpheme 未导出，跳过');
}

db.close();
