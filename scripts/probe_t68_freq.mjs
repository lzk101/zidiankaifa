// scripts/probe_t68_freq.mjs —— T68 §1 词频判据与偏误（只读）
// 已知：`words`(en, 770,611) 有 bnc/frq；`words_i18n`(ru, 101,512) 无任何词频列
// 本探针：① 英文真词频的方向与分带样本 ② 俄语代理判据清单及各自偏误
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const s0 = fs.statSync(DB);
const db = new DatabaseSync(DB, { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const g = (sql, ...a) => db.prepare(sql).get(...a);

console.log('§1 英文 `words.bnc` 方向确认（已知高频词应占小 bnc）');
const KNOWN = ['the', 'of', 'and', 'time', 'water', 'fire', 'love', 'run', 'python', 'zygote'];
for (const w of KNOWN) {
  const r = g('SELECT word, bnc, frq, collins, oxford, tag FROM words WHERE word = ?', w);
  console.log(`  · ${w.padEnd(8)} → ${r ? JSON.stringify(r) : '（不在 words 表）'}`);
}
console.log('\n§2 bnc/frq 分带规模（bnc=0 = 未入 BNC 榜）');
for (const [name, cond] of [
  ['bnc = 0（未上榜）', 'bnc = 0'],
  ['bnc 1–1000', 'bnc BETWEEN 1 AND 1000'],
  ['bnc 1001–5000', 'bnc BETWEEN 1001 AND 5000'],
  ['bnc 5001–10000', 'bnc BETWEEN 5001 AND 10000'],
  ['bnc 10001–20000', 'bnc BETWEEN 10001 AND 20000'],
  ['bnc 20001–50000', 'bnc BETWEEN 20001 AND 50000'],
]) {
  console.log(`  · ${name}: ${g(`SELECT COUNT(1) AS n FROM words WHERE ${cond}`).n}`);
}
console.log('  各带样本（每带 8 词）：');
for (const [name, cond] of [
  ['bnc 1–1000', 'bnc BETWEEN 1 AND 1000'],
  ['bnc 1001–5000', 'bnc BETWEEN 1001 AND 5000'],
  ['bnc 5001–10000', 'bnc BETWEEN 5001 AND 10000'],
  ['bnc 20001–50000', 'bnc BETWEEN 20001 AND 50000'],
]) {
  const rows = q(`SELECT word, bnc FROM words WHERE ${cond} ORDER BY bnc LIMIT 8`);
  console.log(`    ${name}: ${rows.map((r) => `${r.word}(${r.bnc})`).join(' ')}`);
}
console.log('  · frq 极值方向：先看 frq 最小 5 个');
for (const r of q('SELECT word, bnc, frq FROM words ORDER BY frq ASC LIMIT 5')) console.log(`      ${JSON.stringify(r)}`);

console.log('\n§3 「短词 = 高频」偏误（英文）');
{
  const top = q('SELECT word, bnc FROM words WHERE bnc BETWEEN 1 AND 5000');
  const all = q('SELECT word FROM words');
  const avg = (a) => a.reduce((s, x) => s + x.length, 0) / a.length;
  console.log(`  · 前 5000 高频词平均长度 = ${avg(top.map((r) => r.word)).toFixed(2)} · 全表平均 = ${avg(all.map((r) => r.word)).toFixed(2)}`);
  const shortest = q('SELECT word, bnc FROM words ORDER BY length(word), word LIMIT 25');
  console.log('  · 全表最短 25 词（若按长度取高频，这些会全部入选）：');
  console.log(`      ${shortest.map((r) => `${r.word}[${r.bnc}]`).join(' ')}`);
  const junk = q("SELECT COUNT(1) AS n FROM words WHERE bnc BETWEEN 1 AND 5000 AND (word LIKE '% %' OR word LIKE '%''%' OR word LIKE '%-%' OR length(word) <= 2)").n;
  console.log(`  · 前 5000 里的「碎片/短语/≤2 字符」= ${junk}（${((junk / 5000) * 100).toFixed(1)}%）`);
}

console.log('\n§4 俄语侧：库内**无词频**，代理判据清单');
const RU = q(`SELECT word FROM words_i18n WHERE lang='ru'`).map((r) => String(r.word));
const RSET = new Set(RU);
const RULER = q(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).map((r) => String(r.word));
console.log(`  · 分母：ru = ${RU.length} · 尺子 R = ${RULER.length}`);
const etyRu = new Set(q(`SELECT DISTINCT word FROM word_etymology WHERE lang='ru'`).map((r) => String(r.word)));
const formsRu = new Set(q(`SELECT DISTINCT word FROM i18n_forms WHERE lang='ru'`).map((r) => String(r.word)));
const rootWords = new Set();
for (const r of q(`SELECT words FROM roots WHERE lang='ru'`)) {
  try { for (const w of JSON.parse(r.words)) rootWords.add(String(w)); } catch {}
}
for (const r of q(`SELECT words FROM affixes WHERE lang='ru'`)) {
  try { for (const w of JSON.parse(r.words)) rootWords.add(String(w)); } catch {}
}
const proxies = [
  ['P1 词长（短词优先）', (n) => [...RU].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, n)],
  ['P2 有词源（word_etymology）', (n) => [...etyRu].filter((w) => RSET.has(w)).slice(0, n)],
  ['P3 有屈折形（i18n_forms）', (n) => [...formsRu].filter((w) => RSET.has(w)).slice(0, n)],
  ['P4 可被词根/词缀倒排覆盖', (n) => [...rootWords].filter((w) => RSET.has(w)).slice(0, n)],
];
console.log('\n  代理判据的**上限**与**在 R 上的可得率**：');
for (const [name, fn] of proxies) {
  const pool = fn(Number.MAX_SAFE_INTEGER);
  const inR = pool.filter((w) => RULER.includes(w)).length;
  console.log(`    ${name}: 池 = ${pool.length}（占全库 ${((pool.length / RU.length) * 100).toFixed(1)}%）· 池∩R = ${inR}/${RULER.length} = ${((inR / RULER.length) * 100).toFixed(1)}%`);
}
console.log('\n  P1（短词）前 20 词 —— 看混入什么：');
console.log(`    ${[...RU].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 20).join(' ')}`);
console.log('  P2（有词源）前 20 词：');
console.log(`    ${[...etyRu].slice(0, 20).join(' ')}`);
console.log('  P4（倒排覆盖）前 20 词：');
console.log(`    ${[...rootWords].slice(0, 20).join(' ')}`);
console.log('\n§5 俄语 4 个代理的**交叉**（同一批词是否同时满足）');
{
  const n = 5000;
  for (const [name, fn] of proxies) {
    const s = new Set(fn(n));
    const a = [...s].filter((w) => etyRu.has(w)).length;
    const b = [...s].filter((w) => formsRu.has(w)).length;
    const c = [...s].filter((w) => rootWords.has(w)).length;
    console.log(`  · ${name} 前 ${n}：∩有词源 ${a} · ∩有屈折形 ${b} · ∩倒排覆盖 ${c}`);
  }
}
console.log('\n§6 `words_i18n.source` 分布（看是否有语料来源可作频率代理）');
for (const r of q(`SELECT source, COUNT(1) AS n FROM words_i18n WHERE lang='ru' GROUP BY source ORDER BY n DESC LIMIT 10`)) {
  console.log(`  · ${JSON.stringify(r.source)} → ${r.n}`);
}
db.close();
const s1 = fs.statSync(DB);
console.log(`\n§7 只读自证：size 相等=${s0.size === s1.size} · mtime 相等=${s0.mtime.toISOString() === s1.mtime.toISOString()}`);
