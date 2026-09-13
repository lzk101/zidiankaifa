/**
 * T19 侦察：V9-1/V9-2 机制判别实验 —— 词源数据可用性勘察（只读）
 *
 * 目的：判定 H-c（词源链交叉核证）是否有可用信号。
 * 重点看 word_etymology.chain 里的 `parts` 字段 —— 它可能是**词源数据自带的真实切分标注**。
 *
 * 用法：node scripts/exp_v9_mechanism_recon.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

console.log('='.repeat(78));
console.log('① word_etymology 表结构');
console.log('='.repeat(78));
for (const c of db.prepare(`PRAGMA table_info(word_etymology)`).all()) {
  console.log(`  ${String(c.name).padEnd(12)} ${String(c.type).padEnd(10)} notnull=${c.notnull} pk=${c.pk}`);
}

const cnt = (sql, ...a) => db.prepare(sql).get(...a).n;
console.log('\n  行数统计：');
console.log(`  word_etymology 总行数        : ${cnt('SELECT COUNT(1) AS n FROM word_etymology')}`);
console.log(`  ├ lang='ru'                  : ${cnt("SELECT COUNT(1) AS n FROM word_etymology WHERE lang='ru'")}`);
console.log(`  └ lang='en'                  : ${cnt("SELECT COUNT(1) AS n FROM word_etymology WHERE lang='en'")}`);
console.log(`  words_i18n ru 总词条         : ${cnt("SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'")}`);

/* ===================== 20 个红灯词 ===================== */
const V92_UC = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный'];
const V92_DN = ['однако'];
const D4 = ['столп', 'казус', 'доминировать', 'больной', 'самосуд', 'термостат'];
const D2 = ['землетрясение', 'водопад'];
const RED_WORDS = [...V92_UC, ...V92_DN, ...D4, ...D2];

console.log('\n' + '='.repeat(78));
console.log(`② 20 个红灯词的 word_etymology（lang='ru'）实况 —— ★ 重点看 chain.parts`);
console.log('='.repeat(78));
const q = db.prepare(`SELECT * FROM word_etymology WHERE word = ? AND lang = 'ru'`);
let withRow = 0, withParts = 0;
for (const w of RED_WORDS) {
  const r = q.get(w);
  if (!r) { console.log(`\n  ✗ ${w}  —— **无 lang='ru' 词源行**`); continue; }
  withRow++;
  let chain = [];
  try { chain = JSON.parse(r.chain ?? '[]'); } catch { /* ignore */ }
  const partSteps = chain.filter((s) => Array.isArray(s.parts) && s.parts.length);
  if (partSteps.length) withParts++;
  console.log(`\n  ── ${w}`);
  console.log(`     origin=${JSON.stringify(r.origin)} code=${JSON.stringify(r.origin_code)} source=${JSON.stringify(r.source)}`);
  console.log(`     chain 步数=${chain.length}  含 parts 的步数=${partSteps.length}`);
  for (const s of chain) {
    console.log(`       · lang=${s.lang} word=${JSON.stringify(s.word ?? null)} kind=${JSON.stringify(s.kind ?? null)} parts=${JSON.stringify(s.parts ?? null)}`);
  }
  const tz = (r.text_zh ?? '').replace(/\s+/g, ' ').slice(0, 150);
  const te = (r.text_en ?? '').replace(/\s+/g, ' ').slice(0, 150);
  if (tz) console.log(`     text_zh: ${tz}`);
  if (te) console.log(`     text_en: ${te}`);
}
console.log(`\n  ⇒ 20 词中有 lang='ru' 词源行 ${withRow}/20；其中 chain 含 parts 的 ${withParts}/20`);

/* ===================== 全库 parts 可用性 ===================== */
console.log('\n' + '='.repeat(78));
console.log('③ 全库 RU：chain.parts 可用性普查（决定 H-c 的覆盖面）');
console.log('='.repeat(78));
const ruRows = db.prepare(`SELECT word, chain FROM word_etymology WHERE lang='ru'`).all();
let chainOk = 0, withP = 0, partTotal = 0, multiPart = 0;
const partShapes = new Map();
for (const r of ruRows) {
  let ch = [];
  try { ch = JSON.parse(r.chain ?? '[]'); } catch { continue; }
  chainOk++;
  const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length);
  if (!steps.length) continue;
  withP++;
  const longest = steps.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), steps[0]);
  partTotal += longest.parts.length;
  if (longest.parts.length >= 2) multiPart++;
  const key = longest.parts.length;
  partShapes.set(key, (partShapes.get(key) ?? 0) + 1);
}
console.log(`  lang='ru' 词源行           : ${ruRows.length}`);
console.log(`  chain 可解析               : ${chainOk}`);
console.log(`  ★ chain 至少一步含 parts   : ${withP}  (${((withP / ruRows.length) * 100).toFixed(1)}%)`);
console.log(`  ★ 其中 parts 长度 ≥2（真正可当切分用）: ${multiPart}  (${((multiPart / ruRows.length) * 100).toFixed(1)}%)`);
console.log(`  parts 长度分布             : ${JSON.stringify([...partShapes.entries()].sort((a, b) => a[0] - b[0]))}`);

/* parts 样例 */
console.log('\n  ★ parts 长度 ≥2 的样例（前 20）：');
let shown = 0;
for (const r of ruRows) {
  let ch = [];
  try { ch = JSON.parse(r.chain ?? '[]'); } catch { continue; }
  const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length >= 2);
  if (!steps.length) continue;
  const s = steps[0];
  console.log(`    ${String(r.word).padEnd(20)} lang=${String(s.lang).padEnd(6)} parts=${JSON.stringify(s.parts)}`);
  if (++shown >= 20) break;
}

/* ===================== 尺子 R 的 parts 覆盖率 ===================== */
console.log('\n' + '='.repeat(78));
console.log('④ 尺子 R（791 词）中：有多少词带 chain.parts（H-c 的作用域上界）');
console.log('='.repeat(78));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
const etymStmt = db.prepare(`SELECT chain FROM word_etymology WHERE word = ? AND lang='ru'`);
let rHasEtym = 0, rHasParts = 0, rHasMulti = 0;
const multiWords = [];
for (const w of R) {
  const e = etymStmt.get(w);
  if (!e) continue;
  rHasEtym++;
  let ch = [];
  try { ch = JSON.parse(e.chain ?? '[]'); } catch { continue; }
  const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length);
  if (!steps.length) continue;
  rHasParts++;
  const longest = steps.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), steps[0]);
  if (longest.parts.length >= 2) { rHasMulti++; multiWords.push(`${w}=${JSON.stringify(longest.parts)}`); }
}
console.log(`  尺子 R 分母                : ${R.length}`);
console.log(`  有 lang='ru' 词源行        : ${rHasEtym}  (${((rHasEtym / R.length) * 100).toFixed(1)}%)`);
console.log(`  ★ chain 含 parts           : ${rHasParts}  (${((rHasParts / R.length) * 100).toFixed(1)}%)`);
console.log(`  ★ chain parts 长度 ≥2      : ${rHasMulti}  (${((rHasMulti / R.length) * 100).toFixed(1)}%)`);
console.log(`  样例（前 25）: ${multiWords.slice(0, 25).join('  ')}`);

db.close();
