/**
 * probe_t42_wal_fixture3.mjs —— T42 夹具判别实验（第三版）：验证块 E 的四条子断言可成立
 *   §1 迁移后 -wal 是否仍非空（决定「备份 == 主库文件逐字节」这一性质的成立条件是否可断言）
 *   §2 只复制主库的单文件副本是否确实缺 delta（夹具有效性自证）
 *   §3 VACUUM INTO 产物与主库文件是否字节不等（负对照：证明「逐字节相等」这条有鉴别力）
 *   §4 另一连接持未结束读事务 ⇒ checkpoint busy≠0 ⇒ 放弃迁移；释放后重开 ⇒ 迁移成功且备份齐全
 *
 * 只读约束：不动 data/db/**；临时库在 scripts/_tmp/，结束即删；生产 dist 只读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, '_tmp', 't42_probe3');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const st = (f) => (fs.existsSync(f) ? fs.statSync(f).size : -1);
const closeAll = (l) => { for (const c of l) { try { c.close(); } catch { /* ignore */ } } };

const OLD_TABLE = `CREATE TABLE book (
  word TEXT PRIMARY KEY, lang TEXT NOT NULL DEFAULT 'en', added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', note TEXT, tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0)`;
const INS = `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, 'new', NULL, '[]', 0, NULL, 0)`;

function baseDb(file) {
  const c0 = new DatabaseSync(file);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_TABLE);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  ['alpha', 'beta'].forEach((w, i) => c0.prepare(INS).run(w, 'en', 1000 + i, 2000 + i));
  c0.close();
}
const rowsOf = (f) => { const r = new DatabaseSync(f, { readOnly: true }); const n = r.prepare('SELECT COUNT(1) AS n FROM book').get().n; const w = r.prepare('SELECT word FROM book ORDER BY word').all().map((x) => x.word); r.close(); return { n, w }; };
const pkOf = (f) => { const r = new DatabaseSync(f, { readOnly: true }); const c = r.prepare('PRAGMA table_info(book)').all().filter((x) => Number(x.pk) > 0).map((x) => x.name); r.close(); return c; };
const baksOf = (dir) => fs.readdirSync(dir).filter((x) => /\.db\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(x));

console.log('='.repeat(104));
console.log('§1-§3 主场景（B 保持打开 + C 写入后保持打开）');
{
  const dir = path.join(TMP, 's1'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 's1.db');
  baseDb(file);
  const conns = [];
  const B = new DatabaseSync(file); conns.push(B);
  B.prepare('SELECT COUNT(1) AS n FROM book').get();               // 连接 B 是「活」的（读过库）
  const C = new DatabaseSync(file); conns.push(C);
  C.prepare(INS).run('delta', 'ru', 3000, 4000);                    // 用户刚加的生词 → 只在 -wal
  const walBefore = st(file + '-wal');
  const visible = B.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  const visWords = B.prepare('SELECT word FROM book ORDER BY word').all().map((x) => x.word);

  // §2 只复制主库文件（= 方案0 的机制）
  const only = path.join(dir, 'mainonly.db');
  fs.copyFileSync(file, only);
  const onlyRows = rowsOf(only);

  // §3 VACUUM INTO（= 方案 B）产物
  const vac = path.join(dir, 'vacuum.db');
  const vc = new DatabaseSync(file); vc.exec(`VACUUM INTO '${vac.replace(/\\/g, '/')}'`); vc.close();
  const vacRows = rowsOf(vac);

  const db = openDatabase(file); conns.push(db);
  const bak = baksOf(dir)[0] ? path.join(dir, baksOf(dir)[0]) : null;
  const byteEq = bak ? fs.readFileSync(bak).equals(fs.readFileSync(file)) : null;
  const walAfterMig = st(file + '-wal');
  const bakRows = bak ? rowsOf(bak) : null;

  console.log(`  夹具：-wal=${walBefore} B · B 可见 ${visible} 行 ${JSON.stringify(visWords)}`);
  console.log(`  §2 主库单文件副本：${onlyRows.n} 行 ${JSON.stringify(onlyRows.w)} ⇒ 缺 delta ? ${!onlyRows.w.includes('delta')}`);
  console.log(`  §3 VACUUM INTO：${vacRows.n} 行 ${JSON.stringify(vacRows.w)} · 与主库文件逐字节相等 ? ${fs.readFileSync(vac).equals(fs.readFileSync(file))}`);
  console.log(`  迁移：备份 ${bak ? path.basename(bak) : '无'} · 备份 ${bakRows.n} 行 ${JSON.stringify(bakRows.w)}`);
  console.log(`       备份 == 主库文件逐字节 ? ${byteEq} · 迁移后 -wal=${walAfterMig} B · 主键 ${JSON.stringify(pkOf(file))}`);
  closeAll(conns);
}

console.log('\n' + '='.repeat(104));
console.log('§4 另一连接持未结束读事务 ⇒ busy≠0 ⇒ 放弃迁移；释放后重开 ⇒ 迁移成功');
{
  const dir = path.join(TMP, 's4'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 's4.db');
  baseDb(file);
  const conns = [];
  const B = new DatabaseSync(file); conns.push(B);
  B.exec('BEGIN');                                                  // ★ 未结束的读事务（持 WAL read-mark）
  B.prepare('SELECT COUNT(1) AS n FROM book').get();
  const C = new DatabaseSync(file); conns.push(C);
  C.prepare(INS).run('delta', 'ru', 3000, 4000);

  const warns = []; const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let db1 = null; try { db1 = openDatabase(file); } catch (e) { warns.push('THREW ' + e.message); } finally { console.warn = orig; }
  if (db1) conns.push(db1);
  console.log(`  第一次 openDatabase（B 持读事务）：warn=${JSON.stringify(warns)}`);
  console.log(`    备份数 ${baksOf(dir).length} · 主键 ${JSON.stringify(pkOf(file))} · B 可见 ${B.prepare('SELECT COUNT(1) AS n FROM book').get().n} 行`);

  // 释放读事务（结束 + 关闭 B），再开一次
  B.exec('COMMIT'); B.close(); conns.splice(conns.indexOf(B), 1);
  const warns2 = []; console.warn = (...a) => warns2.push(a.join(' '));
  let db2 = null; try { db2 = openDatabase(file); } catch (e) { warns2.push('THREW ' + e.message); } finally { console.warn = orig; }
  if (db2) conns.push(db2);
  const baks = baksOf(dir);
  const bak2 = baks[0] ? path.join(dir, baks[0]) : null;
  console.log(`  释放后第二次 openDatabase：warn=${JSON.stringify(warns2)}`);
  console.log(`    备份数 ${baks.length} · 主键 ${JSON.stringify(pkOf(file))} · 备份 ${bak2 ? JSON.stringify(rowsOf(bak2)) : '无'}`);
  console.log(`    备份 == 源库可见 3 行 ? ${bak2 ? rowsOf(bak2).n === 3 : false} · 逐字节相等 ? ${bak2 ? fs.readFileSync(bak2).equals(fs.readFileSync(file)) : null}`);
  closeAll(conns);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); console.log(`\n临时目录已清理：${path.relative(ROOT, TMP)}`); }
catch (e) { console.log(`\n⚠ 清理失败（不影响结论）：${e.message}`); }
