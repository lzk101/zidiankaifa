// scripts/probe_t68_schema.mjs —— T68 §1 侦察（只读）：库结构与词频字段
// 只读打开冻结库；不调用 openDatabase()（避免迁移写库）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..'); // ★ 只退一级（AGENTS.md 铁律 6 的 cwd 纪律）
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const s0 = fs.statSync(DB);
const db = new DatabaseSync(DB, { readOnly: true });

console.log(`DB = ${DB}`);
console.log(`size = ${s0.size} B (${(s0.size / 1048576).toFixed(1)} MiB) · mtime = ${s0.mtime.toISOString()}\n`);

console.log('§1 全部表 + 列 + 行数');
const tables = db
  .prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  .all();
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
  let n = 'n/a';
  try {
    n = db.prepare(`SELECT COUNT(1) AS n FROM "${t.name}"`).get().n;
  } catch (e) {
    n = `ERR ${e.code ?? e.message}`;
  }
  console.log(`  · ${t.name} [${t.type}] rows=${n}`);
  console.log(`      列: ${cols.map((c) => c.name).join(', ')}`);
}

console.log('\n§2 索引');
for (const i of db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name`).all()) {
  console.log(`  · ${i.tbl_name} :: ${i.name}${i.sql ? '' : '（隐式/自动）'}`);
}

console.log('\n§3 词频候选字段探查');
const colOf = (t) => db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
for (const t of ['words', 'words_i18n', 'word_forms', 'word_etymology', 'morphemes', 'roots', 'affixes']) {
  if (!tables.some((x) => x.name === t)) continue;
  const cs = colOf(t);
  const freqish = cs.filter((c) => /bnc|frq|freq|rank|count|popular|common/i.test(c));
  console.log(`  · ${t}: 词频相关列 = ${freqish.length ? freqish.join(', ') : '（无）'}`);
}

console.log('\n§4 `words` 表（英文侧？）分布');
{
  const tot = db.prepare('SELECT COUNT(1) AS n FROM words').get().n;
  console.log(`  · 总行数 = ${tot}`);
  for (const c of ['bnc', 'frq']) {
    try {
      const r = db.prepare(`SELECT COUNT(1) AS n, MIN(${c}) AS mn, MAX(${c}) AS mx FROM words WHERE ${c} IS NOT NULL`).get();
      console.log(`  · ${c} NOT NULL = ${r.n}（${((r.n / tot) * 100).toFixed(1)}%）· min=${r.mn} · max=${r.mx}`);
    } catch (e) {
      console.log(`  · ${c} 查询失败：${e.message}`);
    }
  }
  try {
    const r = db.prepare('SELECT COUNT(1) AS n FROM words WHERE bnc IS NOT NULL AND frq IS NOT NULL').get();
    console.log(`  · bnc 与 frq 均非空 = ${r.n}`);
  } catch {}
  console.log('  · 前 5 行（按 bnc 升序）：');
  try {
    for (const r of db.prepare('SELECT word, bnc, frq FROM words WHERE bnc IS NOT NULL ORDER BY bnc ASC LIMIT 5').all()) {
      console.log(`      ${JSON.stringify(r)}`);
    }
    console.log('  · 前 5 行（按 frq 降序）：');
    for (const r of db.prepare('SELECT word, bnc, frq FROM words WHERE frq IS NOT NULL ORDER BY frq DESC LIMIT 5').all()) {
      console.log(`      ${JSON.stringify(r)}`);
    }
  } catch (e) {
    console.log(`      ${e.message}`);
  }
}

console.log('\n§5 `words_i18n` 语言分布 + 与 `words` 的交集');
{
  for (const r of db.prepare('SELECT lang, COUNT(1) AS n FROM words_i18n GROUP BY lang ORDER BY n DESC').all()) {
    console.log(`  · lang=${JSON.stringify(r.lang)} → ${r.n}`);
  }
  const ru = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'`).get().n;
  const inter = db
    .prepare(`SELECT COUNT(1) AS n FROM words_i18n i JOIN words w ON w.word = i.word WHERE i.lang='ru'`)
    .get().n;
  console.log(`  · ru 词条 = ${ru} · 其中同时存在于 words 表 = ${inter}（${((inter / ru) * 100).toFixed(1)}%）`);
}

console.log('\n§6 尺子 R（权威定义 related.mjs:144）在冻结库上的值');
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
console.log(`  · R = ${R.length} 词`);

console.log('\n§7 口径 A / 英语口径 的分母候选');
console.log(`  · words_i18n ru = ${db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'`).get().n}`);
console.log(`  · words_i18n en = ${db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='en'`).get().n}`);
console.log(`  · words 表 = ${db.prepare('SELECT COUNT(1) AS n FROM words').get().n}`);
try {
  console.log(
    `  · words 中纯 ASCII 词 = ${db.prepare(`SELECT COUNT(1) AS n FROM words WHERE word GLOB '[a-zA-Z]*'`).get().n}`,
  );
  console.log(
    `  · words 中含西里尔 = ${db.prepare(`SELECT COUNT(1) AS n FROM words WHERE word GLOB '*[\u0430-\u044f\u0410-\u042f]*'`).get().n}`,
  );
} catch (e) {
  console.log(`  · GLOB 统计失败：${e.message}`);
}
for (const t of ['word_forms', 'word_etymology']) {
  try {
    for (const r of db.prepare(`SELECT lang, COUNT(1) AS n FROM ${t} GROUP BY lang ORDER BY n DESC LIMIT 5`).all()) {
      console.log(`  · ${t} lang=${JSON.stringify(r.lang)} → ${r.n}`);
    }
  } catch (e) {
    console.log(`  · ${t}: ${e.message}`);
  }
}
db.close();
const s1 = fs.statSync(DB);
console.log(`\n§8 只读自证：size ${s0.size} → ${s1.size}（相等=${s0.size === s1.size}）· mtime 相等=${s0.mtime.toISOString() === s1.mtime.toISOString()}`);
