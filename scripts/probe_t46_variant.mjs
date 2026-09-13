/**
 * probe_t46_variant.mjs —— 造「方案0 变体 dist」（把 `VACUUM INTO` 换成 `fs.copyFileSync(主库)`）
 *
 * 用途：给 book_lang.mjs 的 E11–E14 提供**行级替换**的补丁（T46 版；旧版正则针对已删除的
 * checkpoint 代码，故失配 ⇒ 补丁失效）。同时实测：
 *   · 变体下备份是否缺「只存在于 -wal 的行」、备份与主库是否逐字节相等
 *   · `VACUUM INTO` 产物 vs `copyFileSync` 产物的 `journal_mode` 差异（可鉴别性）
 * 只读探针：只在 scripts/_tmp/probe_t46v/ 下活动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist');
const TMP = path.join(REPO_ROOT, 'scripts', '_tmp', 'probe_t46v');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const ISO = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
function baks(file) {
  const dir = path.dirname(file);
  const base = path.basename(file) + '.bak-';
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${ISO}$`);
  return fs.readdirSync(dir).filter((f) => re.test(f)).sort();
}
const OLD_DDL = `CREATE TABLE book (
  word TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'en',
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0)`;
const INS = `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, 'new', NULL, '[]', 0, NULL, 0)`;
const SNAP = 'word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted';
function snap(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  const r = d.prepare(`SELECT ${SNAP} FROM book ORDER BY word, lang`).all();
  d.close();
  return r.map((x) => [x.word, x.lang, x.added_at, x.updated_at, x.status, x.note, x.tags, x.review_count, x.last_reviewed_at, x.deleted]);
}
function jm(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  const m = d.prepare('PRAGMA journal_mode').get().journal_mode;
  d.close();
  return m;
}

/* ---------------- 行级补丁：删掉含 VACUUM INTO 的那一行，替换为 copyFileSync ---------------- */
function buildVariant() {
  const dst = path.join(TMP, 'dist_variant');
  fs.cpSync(DIST, dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ type: 'module' }));
  const idx = path.join(dst, 'db', 'index.js');
  const prod = fs.readFileSync(path.join(DIST, 'db', 'index.js'), 'utf8');
  const js = fs.readFileSync(idx, 'utf8');
  const lines = js.split('\n');
  // ⚠ 必须定位**可执行语句**行（`db.exec(\`VACUUM INTO ...\`)`），不能只找 `includes('VACUUM INTO')`
  //   —— 那段上方有整整 20 行注释在解释 `VACUUM INTO`（首次写探针就误改了注释行，
  //   结果变体里同时存在 copyFileSync 与 VACUUM INTO ⇒ 备份先被 copy 出来、VACUUM INTO 随即
  //   "output file already exists" 失败 ⇒ 反而复现了「备份失败 ⇒ 静默降级」，见 T46 发现①）。
  const hit = lines.findIndex((l) => /db\.exec\(`VACUUM INTO/.test(l));
  const patched = hit >= 0;
  if (patched) {
    const indent = lines[hit].match(/^\s*/)[0];
    lines[hit] = `${indent}fs.copyFileSync(file, bak); // T46 变体：方案0（只复制主库文件）`;
    fs.writeFileSync(idx, lines.join('\n'));
  }
  const out = fs.readFileSync(idx, 'utf8');
  return {
    dst, patched, hitLine: hit + 1, prodLine: prod.split('\n').findIndex((l) => /db\.exec\(`VACUUM INTO/.test(l)) + 1,
    prodHasVacuum: prod.includes('VACUUM INTO'),
    variantHasVacuumStmt: /db\.exec\(`VACUUM INTO/.test(out),
    variantHasCopy: out.includes('fs.copyFileSync(file, bak)'),
  };
}

/* ---------------- 夹具：非空 WAL + 保持打开的写连接 ---------------- */
function scenario(tag, openFn) {
  const dir = path.join(TMP, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);
  const c0 = new DatabaseSync(file);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_DDL);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const s = c0.prepare(INS);
  s.run('alpha', 'en', 1000, 2000);
  s.run('beta', 'en', 1001, 2001);
  c0.close();
  const B = new DatabaseSync(file);
  B.prepare('SELECT COUNT(1) AS n FROM book').get();
  const C = new DatabaseSync(file);
  C.prepare(INS).run('waldelta', 'ru', 3000, 4000);
  const walBefore = fs.existsSync(file + '-wal') ? fs.statSync(file + '-wal').size : -1;
  const before = snap(file);
  const r = openFn(file);
  const bl = baks(file);
  const bak = bl.length === 1 ? path.join(dir, bl[0]) : null;
  const res = {
    file, walBefore, beforeLen: before.length, beforeWords: before.map((x) => x[0]),
    baks: bl.length,
    bakWords: bak ? snap(bak).map((x) => x[0]) : null,
    byteEq: bak ? fs.readFileSync(bak).equals(fs.readFileSync(file)) : null,
    bakJm: bak ? jm(bak) : null,
    snapEq: bak ? JSON.stringify(snap(bak)) === JSON.stringify(before) : null,
    bakSize: bak ? fs.statSync(bak).size : -1, mainSize: fs.statSync(file).size,
    pk: (() => { const d = new DatabaseSync(file, { readOnly: true }); const c = d.prepare('PRAGMA table_info(book)').all(); d.close(); return c.filter((x) => Number(x.pk) > 0).sort((a, b) => a.pk - b.pk).map((x) => x.name); })(),
  };
  r.close(); C.close(); B.close();
  return res;
}

const prodMod = await import(pathToFileURL(path.join(DIST, 'db', 'index.js')).href);
console.log('='.repeat(92));
const v = buildVariant();
console.log(`变体补丁：patched=${v.patched}（生产 dist 第 ${v.prodLine} 行含 VACUUM INTO）· 变体行号=${v.hitLine}`);
console.log(`  生产含 VACUUM INTO 语句=${/db\.exec\(`VACUUM INTO/.test(fs.readFileSync(path.join(DIST, 'db', 'index.js'), 'utf8'))} · 变体仍含 VACUUM INTO 语句=${v.variantHasVacuumStmt} · 变体含 copyFileSync=${v.variantHasCopy}`);

const vMod = await import(pathToFileURL(path.join(v.dst, 'db', 'index.js')).href);
const p = scenario('s_prod', prodMod.openDatabase);
console.log(`\n生产：-wal(前)=${p.walBefore} B · 迁移前可见 ${p.beforeLen} 行 · 备份 ${p.baks} 份`);
console.log(`  备份词表=${JSON.stringify(p.bakWords)} · 备份逐字段==迁移前=${p.snapEq} · 备份==主库字节=${p.byteEq} · 备份 journal_mode=${p.bakJm} · 尺寸 ${p.bakSize}/${p.mainSize} · 主键=${JSON.stringify(p.pk)}`);

const q = scenario('s_variant', vMod.openDatabase);
console.log(`\n变体(方案0)：-wal(前)=${q.walBefore} B · 迁移前可见 ${q.beforeLen} 行 · 备份 ${q.baks} 份`);
console.log(`  备份词表=${JSON.stringify(q.bakWords)} · 备份逐字段==迁移前=${q.snapEq} · 备份==主库字节=${q.byteEq} · 备份 journal_mode=${q.bakJm} · 尺寸 ${q.bakSize}/${q.mainSize} · 主键=${JSON.stringify(q.pk)}`);
console.log('='.repeat(92));
