/**
 * probe_t46_postcheck.mjs —— 独立验证主管 T45 的变更②（后置校验 + 有界重试）
 *
 * 只读探针：只在 scripts/_tmp/probe_t46/ 下造夹具；不动 packages/core/**、dist/**、package.json。
 * 目的：在把断言写进 book_lang.mjs 之前，先实测「迁移无法完成」时到底抛什么错、
 *       有界重试的**尝试次数**能否被独立计数（备份数 = 尝试次数的上界）、
 *       以及变体（VACUUM INTO → copyFileSync）补丁是否可构造。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist');
const TMP = path.join(REPO_ROOT, 'scripts', '_tmp', 'probe_t46');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const { openDatabase } = await import(pathToFileURL(path.join(DIST, 'db', 'index.js')).href);

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

function makeOld(file, { residualSql = null, words = ['alpha', 'beta'] } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(OLD_DDL);
  db.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const s = db.prepare(INS);
  words.forEach((w, i) => s.run(w, 'en', 1000 + i, 2000 + i));
  if (residualSql) db.exec(residualSql);
  db.close();
}
function pkCols(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const c = db.prepare('PRAGMA table_info(book)').all();
  db.close();
  return c.filter((x) => Number(x.pk) > 0).sort((a, b) => a.pk - b.pk).map((x) => x.name);
}
function capture(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let value = null, error = null;
  try { value = fn(); } catch (e) { error = e; } finally { console.warn = orig; }
  return { value, error, warns };
}

/* ---------- F1: 残留 book_new（普通表）⇒ 自愈 ---------- */
function f1(tag, residualSql) {
  const dir = path.join(TMP, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);
  makeOld(file, { residualSql });
  const r = capture(() => openDatabase(file));
  const info = {
    tag,
    threw: r.error ? r.error.message : null,
    warns: r.warns,
    baks: baks(file).length,
    bakPks: baks(file).map((b) => pkCols(path.join(dir, b))),
    bakRows: baks(file).map((b) => {
      const d = new DatabaseSync(path.join(dir, b), { readOnly: true });
      const n = d.prepare('SELECT COUNT(1) AS n FROM book').get().n;
      d.close();
      return Number(n);
    }),
    pk: pkCols(file),
  };
  if (r.value) r.value.close();
  return info;
}

/* ---------- F2: 只读库文件（写失败 = 磁盘/权限类真实故障） ---------- */
function f2(tag, residualSql) {
  const dir = path.join(TMP, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);
  makeOld(file, { residualSql });
  fs.chmodSync(file, 0o444);
  const r = capture(() => openDatabase(file));
  const out = {
    tag,
    threw: r.error ? r.error.message : null,
    warns: r.warns,
    baks: baks(file).length,
    pk: (() => { try { return pkCols(file); } catch (e) { return `pk探针失败:${e.message}`; } })(),
  };
  if (r.value) r.value.close();
  try { fs.chmodSync(file, 0o666); } catch { /* ignore */ }
  return out;
}

/* ---------- F3: 变体 dist（VACUUM INTO → copyFileSync） ---------- */
async function makeVariant() {
  const dst = path.join(TMP, 'dist_variant');
  fs.cpSync(DIST, dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ type: 'module' }));
  const idx = path.join(dst, 'db', 'index.js');
  const js = fs.readFileSync(idx, 'utf8');
  const RE = /db\.exec\(`VACUUM INTO '\$\{bak\.replace\(\/'\\''\/g, "''"\)\}'`\);/;
  const m = js.match(RE);
  console.log('  [变体] VACUUM INTO 正则命中 =', Boolean(m), m ? `\n    命中片段: ${m[0]}` : '');
  const patchedJs = js.replace(RE, 'fs.copyFileSync(file, bak);');
  const patched = patchedJs !== js;
  if (patched) fs.writeFileSync(idx, patchedJs);
  const mod = await import(pathToFileURL(idx).href);
  return { patched, variantsHasCopy: patchedJs.includes('fs.copyFileSync(file, bak)'), variantsHasVacuum: patchedJs.includes('VACUUM INTO'), prodHasVacuum: js.includes('VACUUM INTO'), openDatabase: mod.openDatabase };
}

console.log('='.repeat(90));
console.log('F1 残留 book_new 的形态各异的处置（普通表 / 视图 / 索引）');
const residualCases = [
  ['f1_table', 'CREATE TABLE book_new (x TEXT)'],
  ['f1_view', 'CREATE VIEW book_new AS SELECT 1 AS x'],
  ['f1_index', 'CREATE INDEX book_new ON book(word)'],
];
for (const [tag, sql] of residualCases) {
  const r = f1(tag, sql);
  console.log(`  [${tag}] sql=${sql}`);
  console.log(`      threw=${r.threw ? JSON.stringify(r.threw) : 'null'} · pk=${JSON.stringify(r.pk)} · 备份数=${r.baks} · 备份主键=${JSON.stringify(r.bakPks)} · 备份行数=${JSON.stringify(r.bakRows)}`);
  console.log(`      warns=${JSON.stringify(r.warns)}`);
}

console.log('\nF2 只读库文件（写失败）');
for (const [tag, sql] of [['f2_plain', null], ['f2_residual', 'CREATE TABLE book_new (x TEXT)']]) {
  const r = f2(tag, sql);
  console.log(`  [${tag}] threw=${r.threw ? JSON.stringify(r.threw) : 'null'} · pk=${JSON.stringify(r.pk)} · 备份数=${r.baks}`);
  console.log(`      warns=${JSON.stringify(r.warns)}`);
}

console.log('\nF3 变体 dist（删 VACUUM INTO 换 copyFileSync）');
const v = await makeVariant();
console.log(`  patched=${v.patched} · 变体含 copyFileSync=${v.variantsHasCopy} · 变体仍含 VACUUM INTO=${v.variantsHasVacuum} · 生产含 VACUUM INTO=${v.prodHasVacuum}`);

// 变体下：备份是否缺「只存在于 -wal 的行」
const vdir = path.join(TMP, 'f3_run');
fs.mkdirSync(vdir, { recursive: true });
const vfile = path.join(vdir, 'v.db');
{
  const c0 = new DatabaseSync(vfile);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_DDL);
  const s = c0.prepare(INS);
  s.run('alpha', 'en', 1000, 2000);
  s.run('beta', 'en', 1001, 2001);
  c0.close();
  const B = new DatabaseSync(vfile);
  B.prepare('SELECT COUNT(1) AS n FROM book').get();
  const C = new DatabaseSync(vfile);
  C.prepare(INS).run('waldelta', 'ru', 3000, 4000);
  const wb = fs.existsSync(vfile + '-wal') ? fs.statSync(vfile + '-wal').size : -1;
  const r = capture(() => v.openDatabase(vfile));
  const bl = baks(vfile);
  const bakWords = bl.map((b) => {
    const d = new DatabaseSync(path.join(vdir, b), { readOnly: true });
    const w = d.prepare('SELECT word FROM book ORDER BY word').all().map((x) => x.word);
    d.close();
    return w;
  });
  const byteEq = bl.map((b) => fs.readFileSync(path.join(vdir, b)).equals(fs.readFileSync(vfile)));
  console.log(`  -wal(前)=${wb} B · 备份数=${bl.length} · 备份词表=${JSON.stringify(bakWords)} · 备份==主库字节=${JSON.stringify(byteEq)}`);
  console.log(`  threw=${r.error ? JSON.stringify(r.error.message) : 'null'} · pk=${JSON.stringify(pkCols(vfile))} · warns=${JSON.stringify(r.warns)}`);
  if (r.value) r.value.close();
  C.close(); B.close();
}

console.log('\nF4 有界重试的**尝试次数**能否被独立计数（备份数 = 尝试次数上界）');
for (let i = 0; i < 5; i++) {
  const r = f1(`f4_${i}`, 'CREATE TABLE book_new (x TEXT)');
  console.log(`  run#${i}: 备份数=${r.baks} · 备份名=${JSON.stringify(baks(path.join(TMP, `f4_${i}`, `f4_${i}.db`)))} · threw=${r.threw ? JSON.stringify(r.threw) : 'null'}`);
}
console.log('='.repeat(90));
