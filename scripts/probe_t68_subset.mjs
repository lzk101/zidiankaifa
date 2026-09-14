// scripts/probe_t68_subset.mjs —— T68 §2 体积-覆盖率曲线（核心交付）
// 方法：
//   · 冻结库 **只读**（主连接 readOnly:true）；子集库在 scripts/_tmp 下新建，用 ATTACH 从冻结库 **只 SELECT** 取数
//   · 体积 = 真实 `VACUUM INTO` 产物字节数（非估算）
//   · 覆盖率三口径：尺子 R（权威 SQL，791）· 口径 A（ru 101,512）· 英语（words 770,611；另有「有排名池 45,443」）
//   · ★ 另测「子集上能否复现 791 这把尺子」（rowid 依赖）+「整库按 rowid 原序重建能否复现」
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const TMP = path.join(REPO, 'scripts', '_tmp', 't68');
fs.mkdirSync(TMP, { recursive: true });
const src0 = fs.statSync(DB);

const src = new DatabaseSync(DB, { readOnly: true });
const q = (sql, ...a) => src.prepare(sql).all(...a);
const A_RU = q(`SELECT word FROM words_i18n WHERE lang='ru'`).map((r) => String(r.word));
const RULER = q(
  `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
).map((r) => String(r.word));
const EN_TOTAL = src.prepare('SELECT COUNT(1) AS n FROM words').get().n;
const EN_RANKED = src.prepare('SELECT COUNT(1) AS n FROM words WHERE bnc >= 1').get().n;
const RU_FORMS = new Set(q(`SELECT DISTINCT word FROM i18n_forms WHERE lang='ru'`).map((r) => String(r.word)));
const RU_ETY = new Set(q(`SELECT DISTINCT word FROM word_etymology WHERE lang='ru'`).map((r) => String(r.word)));
console.log(`冻结库 size=${src0.size} B · ru=${A_RU.length} · R=${RULER.length} · words(en)=${EN_TOTAL}（有排名 ${EN_RANKED}）`);

/** 子集判据（俄语侧）：返回按序的词表 */
function ruPool(kind) {
  if (kind === 'P1') return [...A_RU].sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (kind === 'P2') return [...A_RU].filter((w) => RU_ETY.has(w));
  if (kind === 'P3') return [...A_RU].filter((w) => RU_FORMS.has(w));
  if (kind === 'P23') return [...A_RU].filter((w) => RU_ETY.has(w) || RU_FORMS.has(w)); // 并集
  throw new Error(kind);
}

// 取 DDL
const ddl = (name) => src.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name)?.sql;
const TABLES = ['words', 'words_i18n', 'morphemes', 'roots', 'affixes', 'word_etymology', 'word_origins', 'word_forms', 'i18n_forms', 'book'];
const IDX = ['idx_words_bnc', 'idx_words_frq', 'idx_words_tag', 'idx_morphemes_lang', 'idx_etymology_lang', 'idx_forms_form', 'idx_i18n_forms_form', 'idx_i18n_translation', 'idx_book_updated'];
const esc = (p) => p.replace(/\\/g, '/').replace(/'/g, "''");

/** 构造一个子集库（含 en 侧 N_en 词、ru 侧按 kind 取 N_ru 词），返回 {bytes, 统计} */
function build(kind, N, tag) {
  const raw = path.join(TMP, `${tag}.raw.db`);
  const out = path.join(TMP, `${tag}.subset.db`);
  for (const f of [raw, out, `${raw}-wal`, `${raw}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  const m = new DatabaseSync(raw);
  m.exec(`ATTACH DATABASE '${esc(DB)}' AS src`);
  for (const t of TABLES) {
    const s = ddl(t);
    if (!s) continue;
    m.exec(s);
  }
  // en 侧：按 bnc 排名取前 N；不足则用 bnc=0 按 word 补（并记录补了多少）
  m.exec(`INSERT INTO words SELECT * FROM (SELECT * FROM src.words WHERE bnc >= 1 ORDER BY bnc LIMIT ${N})`);
  const enGot = m.prepare('SELECT COUNT(1) AS n FROM words').get().n;
  const fill = N - enGot;
  if (fill > 0) {
    m.exec(`INSERT INTO words SELECT * FROM (SELECT * FROM src.words WHERE bnc = 0 ORDER BY word LIMIT ${fill})`);
  }
  // ru 侧：按判据词表
  const pool = ruPool(kind);
  const ruSel = pool.slice(0, N);
  const ruTmp = path.join(TMP, `${tag}.ruwords.txt`);
  fs.writeFileSync(ruTmp, ruSel.join('\n'), 'utf8');
  m.exec(`CREATE TEMP TABLE pick_ru(word TEXT PRIMARY KEY)`);
  {
    const ins = m.prepare('INSERT OR IGNORE INTO pick_ru(word) VALUES (?)');
    m.exec('BEGIN');
    for (const w of ruSel) ins.run(w);
    m.exec('COMMIT');
  }
  m.exec(`INSERT INTO words_i18n SELECT * FROM src.words_i18n WHERE lang='ru' AND word IN (SELECT word FROM pick_ru)`);
  // 附属表
  m.exec(`INSERT INTO morphemes SELECT * FROM src.morphemes`);
  m.exec(`INSERT INTO roots SELECT * FROM src.roots`);
  m.exec(`INSERT INTO affixes SELECT * FROM src.affixes`);
  m.exec(
    `INSERT INTO word_etymology SELECT * FROM src.word_etymology WHERE word IN (SELECT word FROM words) OR word IN (SELECT word FROM words_i18n)`,
  );
  m.exec(
    `INSERT INTO word_origins SELECT * FROM src.word_origins WHERE word IN (SELECT word FROM words) OR word IN (SELECT word FROM words_i18n)`,
  );
  m.exec(`INSERT INTO word_forms SELECT * FROM src.word_forms WHERE word IN (SELECT word FROM words)`);
  m.exec(`INSERT INTO i18n_forms SELECT * FROM src.i18n_forms WHERE lang='ru' AND word IN (SELECT word FROM words_i18n)`);
  // 索引（尽力而为：源库缺则该索引本来就不存在）
  for (const i of IDX) {
    const s = src.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(i)?.sql;
    if (s) {
      try { m.exec(s); } catch (e) { console.log(`    ! 索引 ${i} 建失败：${e.message}`); }
    }
  }
  const stats = {
    enWords: m.prepare('SELECT COUNT(1) AS n FROM words').get().n,
    ruWords: m.prepare('SELECT COUNT(1) AS n FROM words_i18n').get().n,
    etym: m.prepare('SELECT COUNT(1) AS n FROM word_etymology').get().n,
    origins: m.prepare('SELECT COUNT(1) AS n FROM word_origins').get().n,
    forms: m.prepare('SELECT COUNT(1) AS n FROM word_forms').get().n,
    i18n: m.prepare('SELECT COUNT(1) AS n FROM i18n_forms').get().n,
    morphemes: m.prepare('SELECT COUNT(1) AS n FROM morphemes').get().n,
    roots: m.prepare('SELECT COUNT(1) AS n FROM roots').get().n,
    affixes: m.prepare('SELECT COUNT(1) AS n FROM affixes').get().n,
  };
  m.exec(`VACUUM INTO '${esc(out)}'`);
  m.close();
  fs.rmSync(raw, { force: true });
  fs.rmSync(ruTmp, { force: true });
  const bytes = fs.statSync(out).size;
  // 覆盖率（在子集文件上只读统计）
  const s = new DatabaseSync(out, { readOnly: true });
  const ruSet = new Set(s.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word)));
  const covR = RULER.filter((w) => ruSet.has(w)).length;
  const covA = ruSet.size;
  const covEn = s.prepare('SELECT COUNT(1) AS n FROM words').get().n;
  const covEnRanked = s.prepare('SELECT COUNT(1) AS n FROM words WHERE bnc >= 1').get().n;
  // ★ 尺子 R 在子集上按同一条 SQL 复现（rowid 已变）
  const rulerOnSubset = s
    .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
    .all().length;
  s.close();
  fs.rmSync(out, { force: true });
  return { bytes, stats, covR, covA, covEn, covEnRanked, rulerOnSubset, enFill: fill, ruPool: pool.length };
}

const rows = [];
const CFG = [
  ['P23', ['5k', 5000], ['10k', 10000], ['20k', 20000], ['50k', 50000]],
  ['P2', ['5k', 5000], ['20k', 20000]],
  ['P1', ['5k', 5000], ['20k', 20000]],
];
for (const [kind, ...ns] of CFG) {
  for (const [tag, N] of ns) {
    const t0 = Date.now();
    const r = build(kind, N, `${kind}_${tag}`);
    const ms = Date.now() - t0;
    rows.push({ kind, tag, N, ...r, ms });
    console.log(
      `  · ${kind} N=${tag}: 体积 ${(r.bytes / 1048576).toFixed(2)} MiB (${r.bytes} B) · ` +
        `ru=${r.covA}(${((r.covA / A_RU.length) * 100).toFixed(1)}%) · R=${r.covR}/791(${((r.covR / RULER.length) * 100).toFixed(1)}%) · ` +
        `en=${r.covEn}(${((r.covEn / EN_TOTAL) * 100).toFixed(2)}%) · 子集上 R 复现=${r.rulerOnSubset} · 池=${r.ruPool} · 耗时 ${ms} ms`,
    );
  }
}

console.log('\n§★ 整库按 rowid 原序重建：尺子 R 能否复现');
{
  const raw = path.join(TMP, 'full.raw.db');
  const out = path.join(TMP, 'full.subset.db');
  for (const f of [raw, out]) if (fs.existsSync(f)) fs.rmSync(f);
  const m = new DatabaseSync(raw);
  m.exec(`ATTACH DATABASE '${esc(DB)}' AS src`);
  m.exec(ddl('words_i18n'));
  m.exec(`INSERT INTO words_i18n SELECT * FROM src.words_i18n WHERE lang='ru' ORDER BY rowid`);
  m.exec(`VACUUM INTO '${esc(out)}'`);
  m.close();
  fs.rmSync(raw, { force: true });
  const s = new DatabaseSync(out, { readOnly: true });
  const n = s.prepare('SELECT COUNT(1) AS n FROM words_i18n').get().n;
  const rOn = s.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
  const same = JSON.stringify(rOn) === JSON.stringify(RULER);
  const bytes = fs.statSync(out).size;
  s.close();
  fs.rmSync(out, { force: true });
  console.log(`  · 重建行数=${n} · 体积=${(bytes / 1048576).toFixed(2)} MiB · R 复现=${rOn.length}（与冻结库逐词相同=${same}）`);
}

console.log('\n§汇总表（供 EVIDENCE）');
console.log('| 判据 | N | 体积 MiB | R 覆盖率 | A 覆盖率 | 英语覆盖率 |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.kind} | ${r.tag} | ${(r.bytes / 1048576).toFixed(2)} | ${r.covR}/791 = ${((r.covR / RULER.length) * 100).toFixed(1)}% | ${r.covA} = ${((r.covA / A_RU.length) * 100).toFixed(1)}% | ${r.covEn} = ${((r.covEn / EN_TOTAL) * 100).toFixed(2)}% |`,
  );
}
src.close();
fs.rmSync(TMP, { recursive: true, force: true });
const src1 = fs.statSync(DB);
console.log(`\n§只读自证：size 相等=${src0.size === src1.size} · mtime 相等=${src0.mtime.toISOString() === src1.mtime.toISOString()} · _tmp/t68 已清 = ${!fs.existsSync(TMP)}`);
