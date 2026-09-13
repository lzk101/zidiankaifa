/**
 * A2 判别实验 · 侦察脚本（只读）
 * 目的：先看清尺子 R 的 791 词样本里「无拆解」那部分的构成，再决定分类口径。
 * 用法：node scripts/exp_ru_ceiling_recon.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db');
const R = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

console.log(`R 样本规模: ${R.length}`);

const hits = [];
const miss = [];
for (const w of R) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  (p.length ? hits : miss).push(w);
}
console.log(`有拆解 ${hits.length} / 无拆解 ${miss.length} / 覆盖率 ${(hits.length / R.length * 100).toFixed(1)}%`);

const isCap = (w) => {
  const c = w[0];
  return c !== c.toLowerCase() && c === c.toUpperCase();
};
const OLD = /[іѣѳѵ]/;
const capWords = miss.filter(isCap);
const oldWords = miss.filter((w) => OLD.test(w));
const dashWords = miss.filter((w) => w.startsWith('-') || w.endsWith('-'));
console.log(`无拆解中：首字母大写 ${capWords.length} / 旧正字法字符 ${oldWords.length} / 带连字符 ${dashWords.length}`);

// 全样本口径
console.log(`全样本：首字母大写 ${R.filter(isCap).length} / 旧正字法 ${R.filter((w) => OLD.test(w)).length} / 带连字符 ${R.filter((w) => w.startsWith('-') || w.endsWith('-')).length}`);

console.log('\n--- 无拆解 · 首字母大写（前 60）---');
console.log(capWords.slice(0, 60).join(' '));
console.log('\n--- 无拆解 · 旧正字法（前 60）---');
console.log(oldWords.slice(0, 60).join(' '));
console.log('\n--- 无拆解 · 带连字符 ---');
console.log(dashWords.join(' '));
console.log('\n--- 无拆解 · 全量前 200 ---');
console.log(miss.slice(0, 200).join(' '));

// 词素库现状
const ms = db.prepare(`SELECT kind, morpheme FROM morphemes WHERE lang='ru'`).all();
console.log(`\n词素库 ru: ${ms.length}`);
for (const k of ['prefix', 'root', 'suffix']) {
  const arr = ms.filter((m) => m.kind === k).map((m) => String(m.morpheme));
  console.log(`  ${k} (${arr.length}): ${arr.join(' ')}`);
}
db.close();
