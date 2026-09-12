/**
 * 基线：俄语拆解覆盖率抽样（有词源的俄语词，作为「常见词」代理）
 * 用法: node _probe_ru_breakdown_rate.mjs [sampleSize]
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from './packages/core/dist/db/index.js';

const N = Number(process.argv[2] ?? 800);
const db = new DatabaseSync('data/db/dict.db');

const all = db.prepare(`
  SELECT w.word AS word FROM words_i18n w
  WHERE w.lang='ru' AND EXISTS (SELECT 1 FROM word_etymology e WHERE e.word=w.word AND e.lang='ru')
`).all().map(r => String(r.word));

// 固定种子 LCG：保证前后两次抽样完全一致，便于对比
let seed = 20260913;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pool = all.slice();
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const sample = pool.slice(0, N);

let hit = 0;
const emptyWords = [];
const kindCount = { root: 0, prefix: 0, suffix: 0 };
for (const w of sample) {
  const parts = core.breakdownWord(db, w, 'ru');
  if (parts.length) {
    hit++;
    for (const p of parts) kindCount[p.kind] = (kindCount[p.kind] ?? 0) + 1;
  } else {
    emptyWords.push(w);
  }
}

console.log(`俄语有词源词条总数: ${all.length}`);
console.log(`抽样: ${sample.length}`);
console.log(`有拆解: ${hit} (${(hit / sample.length * 100).toFixed(1)}%)`);
console.log(`无拆解: ${emptyWords.length} (${(emptyWords.length / sample.length * 100).toFixed(1)}%)`);
console.log('词素类型分布:', JSON.stringify(kindCount));
console.log('\n无拆解样例(前 40):');
console.log(emptyWords.slice(0, 40).join(' '));
db.close();
