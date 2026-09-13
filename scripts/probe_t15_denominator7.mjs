/**
 * 只读探针（T15 补七）：主管分母 86,697 的最后一段归因（长度区间扫描）。
 * 已知：仅小写西里尔 + len4-14 = 84,701 词，D1 = 321 = 71 + 250（与主管 D1 数字逐字一致）。
 * 只读、幂等。用法：node scripts/probe_t15_denominator7.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const raw = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const uni = [...new Set(raw)];
const TARGET = 86697;
const isLowerCyr = (w) => /^[а-яё]+$/.test(w);

console.log(`  表内 lang='ru' 行数 = ${raw.length} · 去重后 = ${uni.length}`);
console.log('');
for (const [lo, hi] of [[4, 14], [4, 15], [4, 16], [3, 14], [3, 15], [5, 14], [2, 14], [4, 20]]) {
  const n = uni.filter((w) => isLowerCyr(w) && w.length >= lo && w.length <= hi).length;
  console.log(`  仅小写西里尔 + len ${lo}-${hi} = ${String(n).padStart(6)}${n === TARGET ? '   ★★★ 命中 86,697' : ''}`);
}
console.log('');
console.log('  其它候选（不限长度区间）:');
const cands = [
  ['仅小写西里尔（不限长度）', uni.filter(isLowerCyr).length],
  ['仅小写西里尔 + 无连字符', uni.filter((w) => isLowerCyr(w) && !w.includes('-')).length],
  ['含大写西里尔（不分大小写）len4-14', uni.filter((w) => /^[а-яёА-ЯЁ]+$/.test(w) && w.length >= 4 && w.length <= 14).length],
];
for (const [n2, v] of cands) console.log(`    ${n2.padEnd(34)} = ${String(v).padStart(6)}${v === TARGET ? '   ★★★ 命中' : ''}`);
db.close();
