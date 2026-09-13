/**
 * probe_t42_wal_fixture2.mjs —— T42 夹具拓扑判别实验（第二版）
 *
 * 第一版（probe_t42_wal_fixture.mjs）实测：**第二个连接 close 时就把 WAL 并回主库并删除了 -wal**
 * （B 打开但从未使用 ⇒ 未持任何锁 ⇒ C 的 close 拿到了独占锁做了 clean-shutdown checkpoint）
 * ⇒ 现场被抹平，夹具无效（假绿）。本版穷举连接拓扑，找出**能留下非空 -wal** 的最小拓扑，
 * 并同时测量「此时 `wal_checkpoint(TRUNCATE)` 是否 busy」（决定主管方案 A 能否真正执行）。
 *
 * 只读约束：不动 data/db/**；临时库在 scripts/_tmp/，结束即删；生产 dist 只读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync, constants } from 'node:sqlite';
import { openDatabase } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, '_tmp', 't42_probe2');
const closeAll = (list) => { for (const c of list) { try { c.close(); } catch { /* ignore */ } } };
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const OLD_TABLE = `CREATE TABLE book (
  word TEXT PRIMARY KEY, lang TEXT NOT NULL DEFAULT 'en', added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', note TEXT, tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0)`;
const INS = `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, 'new', NULL, '[]', 0, NULL, 0)`;
const st = (f) => (fs.existsSync(f) ? fs.statSync(f).size : -1);

/** 建老结构库 + base 行（最后一个连接 close ⇒ 主库自带 base，无 -wal） */
function baseDb(file) {
  const c0 = new DatabaseSync(file);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_TABLE);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  ['alpha', 'beta'].forEach((w, i) => c0.prepare(INS).run(w, 'en', 1000 + i, 2000 + i));
  c0.close();
}

/**
 * 拓扑变体 ⇒ { wal, mainHasDelta, cpBusy, cpLog, visible }
 *  · bUse: B（保持打开的写连接）如何使用：none | query | write | readtxn
 *  · cClose: 第二个连接写完是否 close
 */
function topology(tag, { bUse, cClose }) {
  const dir = path.join(TMP, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);
  baseDb(file);
  const conns = [];

  const B = new DatabaseSync(file);
  conns.push(B);
  if (bUse === 'query') B.prepare('SELECT COUNT(1) AS n FROM book').get();
  if (bUse === 'write') B.prepare(INS).run('bwrite', 'en', 2500, 2500);
  if (bUse === 'readtxn') { B.exec('BEGIN'); B.prepare('SELECT COUNT(1) AS n FROM book').get(); }

  const C = new DatabaseSync(file);
  conns.push(C);
  C.prepare(INS).run('delta', 'ru', 3000, 4000);
  if (cClose) { C.close(); conns.splice(conns.indexOf(C), 1); }

  const wal = st(file + '-wal');
  // 只读连接：主库单文件视图是否含 delta（= 只复制主库会漏）
  const mainHasDelta = (() => {
    const r = new DatabaseSync(file, { readOnly: true });
    const n = r.prepare("SELECT COUNT(1) AS n FROM book WHERE word = 'delta'").get().n;
    r.close();
    return Number(n) > 0;
  })();
  // M 连接做 checkpoint（= 迁移里的那一步）
  const M = new DatabaseSync(file);
  conns.push(M);
  const cp = M.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  cp.M = M;
  const visible = M.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  closeAll(conns);
  return { wal, mainHasDelta, cpBusy: cp.busy, cpLog: cp.log, cpCheckpointed: cp.checkpointed, visible };
}

const TOPOS = [
  ['v1_cClose_bNone', { bUse: 'none', cClose: true }],
  ['v2_cOpen_bNone', { bUse: 'none', cClose: false }],
  ['v3_cOpen_bWrite', { bUse: 'write', cClose: false }],
  ['v4_cClose_bWrite', { bUse: 'write', cClose: true }],
  ['v5_cOpen_bQuery', { bUse: 'query', cClose: false }],
  ['v6_cOpen_bReadTxn', { bUse: 'readtxn', cClose: false }],
  ['v7_cClose_bQuery', { bUse: 'query', cClose: true }],
];

console.log('='.repeat(110));
console.log('拓扑穷举：B = 保持打开的连接（none=打开未使用 / query / write / readtxn=持未结束读事务）· C = 第二连接（写 delta）');
console.log('-'.repeat(110));
console.log('拓扑                     -wal(B)  主库单文件含delta   checkpoint(busy/log/ckpt)   可见行数');
for (const [tag, opts] of TOPOS) {
  const r = topology(tag, opts);
  console.log(
    `${tag.padEnd(24)} ${String(r.wal).padStart(6)}  ${String(r.mainHasDelta).padStart(17)}   ${String(r.cpBusy).padStart(3)} / ${String(r.cpLog).padStart(3)} / ${String(r.cpCheckpointed).padStart(6)}     ${r.visible}`,
  );
}

/* ---- 候选拓扑上跑真实迁移 + 变体迁移 ---- */
function migration(tag, openFn, opts) {
  const dir = path.join(TMP, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);
  baseDb(file);
  const conns = [];
  const B = new DatabaseSync(file);
  conns.push(B);
  if (opts.bUse === 'query') B.prepare('SELECT COUNT(1) AS n FROM book').get();
  if (opts.bUse === 'write') B.prepare(INS).run('bwrite', 'en', 2500, 2500);
  const C = new DatabaseSync(file);
  conns.push(C);
  C.prepare(INS).run('delta', 'ru', 3000, 4000);
  if (opts.cClose) { C.close(); conns.splice(conns.indexOf(C), 1); }
  const walBefore = st(file + '-wal');
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let db = null;
  try { db = openFn(file); } catch (e) { warns.push('THREW ' + e.message); } finally { console.warn = orig; }
  if (db) conns.push(db);
  const baks = fs.readdirSync(dir).filter((x) => /\.db\.bak-\d/.test(x));
  let bakRows = null, bakWords = null, byteEq = null;
  if (baks.length) {
    const bak = path.join(dir, baks[0]);
    const r = new DatabaseSync(bak, { readOnly: true });
    bakRows = r.prepare('SELECT COUNT(1) AS n FROM book').get().n;
    bakWords = r.prepare('SELECT word FROM book ORDER BY word').all().map((x) => x.word);
    r.close();
    byteEq = fs.readFileSync(bak).equals(fs.readFileSync(file));
  }
  const ro = new DatabaseSync(file, { readOnly: true });
  const mainRows = ro.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  ro.close();
  closeAll(conns);
  console.log(`  [${tag}] -wal 前置 ${walBefore} B · 备份 ${baks.length} 个 · 备份 ${bakRows} 行 ${JSON.stringify(bakWords)} · 迁移后主库 ${mainRows} 行 · 逐字节等于主库 ${byteEq}${warns.length ? ' · warn=' + JSON.stringify(warns) : ''}`);
  return { bakRows, bakWords, walBefore, byteEq, warns };
}

/* 变体 dist（只改副本） */
const VAR_DIR = path.join(TMP, 'dist_variant');
fs.cpSync(path.join(ROOT, 'packages', 'core', 'dist'), VAR_DIR, { recursive: true });
fs.writeFileSync(path.join(VAR_DIR, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
const VAR_IDX = path.join(VAR_DIR, 'db', 'index.js');
const origJs = fs.readFileSync(VAR_IDX, 'utf8');
const CP_RE = /const cp = db\.prepare\('PRAGMA wal_checkpoint\(TRUNCATE\)'\)\.get\(\);\s*\n\s*if \(cp\.busy !== 0\) \{[\s\S]*?\n\s*\}\n/;
const patched = origJs.replace(CP_RE, '');
console.log('\n' + '='.repeat(110));
console.log(`变体 dist 补丁生效 = ${patched !== origJs}`);
fs.writeFileSync(VAR_IDX, patched);
const variantOpen = (await import(pathToFileURL(VAR_IDX).href)).openDatabase;

console.log('\n' + '='.repeat(110));
console.log('真实迁移（生产 dist）vs 变体 dist');
for (const [tag, opts] of [['m_prod', { bUse: 'none', cClose: false }], ['m_var', { bUse: 'none', cClose: false }]]) {
  const fn = tag === 'm_prod' ? openDatabase : variantOpen;
  migration(tag, fn, opts);
}

closeAll([]);
process.exitCode = 0;
try { fs.rmSync(TMP, { recursive: true, force: true }); console.log(`\n临时目录已清理：${path.relative(ROOT, TMP)}`); }
catch (e) { console.log(`\n⚠ 临时目录清理失败（不影响结论）：${e.message}`); }
