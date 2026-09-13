/**
 * probe_t42_wal_fixture.mjs —— T42 前置判别实验：为「块 E：备份一致性」设计**有效夹具**
 *
 * 目的（在把观察项升级为红断言之前，先把夹具本身证伪）：
 *   Q1 夹具能否造出「主库缺行、`-wal` 含已提交事务」且**保持一个写连接打开**的现场？
 *      （关键风险：copy 前 close 会触发 clean-shutdown checkpoint ⇒ 现场被抹平 ⇒ 假绿）
 *   Q2 在「有另一个连接打开」的前提下，`PRAGMA wal_checkpoint(TRUNCATE)` 是否 busy=0？
 *      —— 若恒 busy，则主管的方案 A 会在多连接场景**静默放弃迁移**（= 需要上报的独立发现）
 *   Q3 若那个连接**读过库**（持 WAL read-mark），checkpoint 是否变成 busy=1？
 *   Q4 变体 dist（删掉 checkpoint 4 行）跑同一夹具，备份**是否确实缺行**（= 新断言的鉴别力自证）
 *
 * 只读约束：不动 `data/db/**`（一次都不打开）；临时库在 `scripts/_tmp/t42_probe/`，结束即删。
 * 生产 `packages/core/dist/**` **只读**（变体是**副本**，仅在副本里改）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, '_tmp', 't42_probe');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const OLD_TABLE = `CREATE TABLE book (
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

const st = (f) => (fs.existsSync(f) ? fs.statSync(f).size : -1);
const log = (...a) => console.log(...a);

/**
 * 造夹具：主库已有 base 行（已 checkpoint 进主库），`-wal` 里只有「第二条连接刚提交的 delta」。
 * B = **保持打开**的连接（防止第二个连接 close 时把 WAL 并回主库）。
 */
function mkFixture(tag, { bReads = false } = {}) {
  const dir = path.join(TMP, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);
  const baseRows = ['alpha', 'beta'];

  // 1) 建老结构 + base 行（最后一个连接 close ⇒ clean shutdown checkpoint ⇒ 主库自带 base）
  const c0 = new DatabaseSync(file);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_TABLE);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  baseRows.forEach((w, i) => c0.prepare(INS).run(w, 'en', 1000 + i, 2000 + i));
  c0.close();
  const afterClose = { main: st(file), wal: st(file + '-wal') };

  // 2) 持有打开的连接 B（写连接，不 close）
  const B = new DatabaseSync(file);
  const bReadRows = bReads ? B.prepare('SELECT COUNT(1) AS n FROM book').get().n : null;

  // 3) 第二条连接 C 写入「用户刚加的生词」⇒ 只存在于 -wal
  const C = new DatabaseSync(file);
  C.prepare(INS).run('delta', 'ru', 3000, 4000);
  C.close();

  const walSize = st(file + '-wal');
  const mainSize = st(file);
  // 4) 独立只读连接数「迁移前源库可见行数」（读连接能否抹平现场？）
  const ro = new DatabaseSync(file, { readOnly: true });
  const visible = ro.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  const visWords = ro
    .prepare('SELECT word FROM book ORDER BY word')
    .all()
    .map((r) => r.word);
  ro.close();
  const walAfterRo = st(file + '-wal');

  return { dir, file, B, baseRows, newWord: 'delta', afterClose, walSize, mainSize, bReadRows, visible, visWords, walAfterRo };
}

/* ---------------- Q1：夹具现场 ---------------- */
log('='.repeat(100));
log('Q1 夹具现场（主库 base 已 checkpoint / 新行只在 -wal / 连接 B 保持打开）');
const f1 = mkFixture('q1');
log(`  建库后 close：main=${f1.afterClose.main} B  -wal=${f1.afterClose.wal} B（-1 = 文件不存在 = 已并回并删除）`);
log(`  写入 delta + 关闭 C 后：main=${f1.mainSize} B  -wal=${f1.walSize} B`);
log(`  独立只读连接数「迁移前可见行」= ${f1.visible}（${JSON.stringify(f1.visWords)}）· 读后 -wal=${f1.walAfterRo} B`);
log(`  Q1 结论：现场 ${f1.walSize > 0 && f1.visible === 3 ? '✔ 有效（-wal 非空 ⇒ 主库缺 delta）' : '✘ 无效'}`);

/* ---------------- Q2/Q3：checkpoint 行为 ---------------- */
function probeCheckpoint(tag, opts) {
  const f = mkFixture(tag, opts);
  const M = new DatabaseSync(f.file);
  const cp = M.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const cp2 = M.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  M.close();
  log(`  [${tag}] B ${opts.bReads ? '读过库' : '未读库'} ⇒ 第1次 checkpoint ${JSON.stringify({ ...cp })} · 第2次 ${JSON.stringify({ ...cp2 })} · -wal 现 ${st(f.file + '-wal')} B`);
  f.B.close();
  return cp;
}
log('\n' + '='.repeat(100));
log('Q2/Q3 另一个连接打开时 wal_checkpoint(TRUNCATE) 的 busy（B 空闲 vs B 持 read-mark）');
const cpIdle = probeCheckpoint('q2_idle', { bReads: false });
const cpRead = probeCheckpoint('q3_read', { bReads: true });
log(`  Q2 结论：B 空闲 ⇒ busy=${cpIdle.busy} ${cpIdle.busy === 0 ? '✔ 不阻塞' : '⚠ **阻塞**（方案 A 会在多连接场景放弃迁移）'}`);
log(`  Q3 结论：B 持 read-mark ⇒ busy=${cpRead.busy} ${cpRead.busy === 0 ? '✔ 不阻塞' : '⚠ 阻塞'}`);

/* ---------------- 生产 dist 的真实迁移（Q4 的对照组） ---------------- */
function runMigration(tag, openFn) {
  const f = mkFixture(tag, { bReads: false });
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let db = null;
  let threw = null;
  try {
    db = openFn(f.file);
  } catch (e) {
    threw = e;
  } finally {
    console.warn = orig;
  }
  const baks = fs.readdirSync(f.dir).filter((x) => /\.db\.bak-\d/.test(x));
  const bak = baks.length ? path.join(f.dir, baks[0]) : null;
  let bakRows = null;
  let bakWords = null;
  let byteEqual = null;
  if (bak) {
    const r = new DatabaseSync(bak, { readOnly: true });
    bakRows = r.prepare('SELECT COUNT(1) AS n FROM book').get().n;
    bakWords = r.prepare('SELECT word FROM book ORDER BY word').all().map((x) => x.word);
    r.close();
    byteEqual = fs.readFileSync(bak).equals(fs.readFileSync(f.file));
  }
  const pk = db
    ? db.prepare('PRAGMA table_info(book)').all().filter((c) => Number(c.pk) > 0).map((c) => c.name)
    : null;
  if (db) db.close();
  const roB = new DatabaseSync(f.file, { readOnly: true });
  const mainRows = roB.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  roB.close();
  f.B.close();
  log(
    `  [${tag}] 夹具前置：可见 ${f.visible} 行 / -wal ${f.walSize} B ｜ 备份数 ${baks.length} ｜ 备份行数 ${bakRows} ｜ 备份词 ${JSON.stringify(bakWords)} ｜ 迁移后主库 ${mainRows} 行 ｜ 主键 ${JSON.stringify(pk)} ｜ 备份与主库逐字节相等 ${byteEqual}`,
  );
  if (warns.length) log(`        warn: ${JSON.stringify(warns)}`);
  if (threw) log(`        抛出：${threw.message}`);
  return { bakRows, bakWords, visible: f.visible, mainRows, pk, byteEqual, throws: !!threw, warns };
}

log('\n' + '='.repeat(100));
log('Q4 生产 dist 跑夹具（期望：备份 3 行含 delta，且与主库逐字节相等）');
const prod = runMigration('q4_prod', openDatabase);

/* ---------------- 变体 dist（删掉 checkpoint） ---------------- */
log('\n' + '='.repeat(100));
log('Q4b 变体 dist（副本内删掉 4 行 checkpoint 逻辑）跑同一夹具（期望：备份缺 delta）');
const VAR_DIR = path.join(TMP, 'dist_variant');
fs.cpSync(path.join(ROOT, 'packages', 'core', 'dist'), VAR_DIR, { recursive: true });
fs.writeFileSync(path.join(VAR_DIR, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
const VAR_IDX = path.join(VAR_DIR, 'db', 'index.js');
const origJs = fs.readFileSync(VAR_IDX, 'utf8');
const CP_RE =
  /const cp = db\.prepare\('PRAGMA wal_checkpoint\(TRUNCATE\)'\)\.get\(\);\s*\n\s*if \(cp\.busy !== 0\) \{[\s\S]*?\n\s*\}\n/;
const patched = origJs.replace(CP_RE, '');
log(`  变体补丁生效 = ${patched !== origJs}（删除 ${origJs.length - patched.length} 字符）`);
fs.writeFileSync(VAR_IDX, patched);
const varMod = await import(pathToFileURL(VAR_IDX).href);
const variant = runMigration('q4b_variant', varMod.openDatabase);

/* ---------------- 小结 ---------------- */
log('\n' + '='.repeat(100));
log('小结');
log(`  生产 dist：备份行数 ${prod.bakRows} == 迁移前可见 ${prod.visible} ? ${prod.bakRows === prod.visible} · 含 delta ? ${prod.bakWords?.includes('delta')} · 逐字节相等 ? ${prod.byteEqual}`);
log(`  变体 dist：备份行数 ${variant.bakRows} == 迁移前可见 ${variant.visible} ? ${variant.bakRows === variant.visible} · 含 delta ? ${variant.bakWords?.includes('delta')}`);
log(`  ⇒ 鉴别力自证：生产 ${prod.bakRows === prod.visible ? '过' : '红'} / 变体 ${variant.bakRows === variant.visible ? '过（✘ 无鉴别力）' : '红（✔ 有鉴别力）'}`);
log(`  Q2/Q3：B 空闲 busy=${cpIdle.busy} · B 持 read-mark busy=${cpRead.busy}`);

fs.rmSync(TMP, { recursive: true, force: true });
log(`临时目录已清理：${path.relative(ROOT, TMP)} · 生产 dist 未被改动`);
