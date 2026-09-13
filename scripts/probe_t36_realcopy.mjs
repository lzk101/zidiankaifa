/**
 * probe_t36_realcopy.mjs —— T36 补充取证：**真实库形态**下的迁移保真与备份充分性（只读为主）
 *
 * 背景（主管 T36 补充情报第 2 条）：需求 agent 指出「只用手工夹具 ⇒ `lang='ru'` 含拉丁的既有数据不被覆盖」
 * 是已知盲区，建议用**真实 `dict.db` 副本**做一次迁移保真测试。
 *
 * 本探针实测四件事：
 *   §1 源库（`data/db/dict.db`）只读态：mtime/size · journal_mode · `-wal` 大小 · `book` 主键列 · 行数
 *   §2 真实**老结构**候选：`data/db/dict.db.bak-v02pipe`（2026-09-09，272 MB）里的 `book` 表结构
 *   §3 ★ 决定性证据：`fs.copyFileSync(主库文件)` 式备份（= 迁移的备份实现）**是否是可用的回退副本**
 *        —— 只复制主库、不复制 `-wal`，在 WAL 库上可能丢掉已提交事务
 *   §4 若 §2 存在真实老结构 `book`：把该真实库**整体**复制到临时目录后跑 `openDatabase()`
 *        ⇒ 真实数据上的迁移保真 + 备份 + 幂等 + `words_i18n` 未被波及
 *
 * 红线：**只读** `data/db/**`（不写、不改名、不删）；临时副本写在 `scripts/_tmp/`，结束即删。
 * 证据可得性（DEC-022）：本文件在**正式路径** `scripts/probe_*.mjs`（非 `_tmp`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, bookListAll } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'db', 'dict.db');
const OLDBAK = path.join(ROOT, 'data', 'db', 'dict.db.bak-v02pipe');
const TMP = path.join(__dirname, '_tmp', 't36_realcopy');
fs.mkdirSync(TMP, { recursive: true });

const ro = (file) => new DatabaseSync(file, { readOnly: true });
const q = (db, sql, ...a) => db.prepare(sql).all(...a);
const one = (db, sql, ...a) => db.prepare(sql).get(...a);
const pkOf = (db) =>
  q(db, 'PRAGMA table_info(book)')
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => c.name);
const BOOKCOLS =
  'word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted';
const snapBook = (db) =>
  q(db, `SELECT ${BOOKCOLS} FROM book ORDER BY word, lang`).map((r) => [
    r.word, r.lang, r.added_at, r.updated_at, r.status, r.note, r.tags, r.review_count,
    r.last_reviewed_at, r.deleted,
  ]);
const st = (f) => (fs.existsSync(f) ? { size: fs.statSync(f).size, mtime: fs.statSync(f).mtime.toISOString() } : null);

console.log('='.repeat(96));
console.log('§1 源库只读态 data/db/dict.db');
const srcMain = st(SRC);
const srcWal = st(SRC + '-wal');
console.log(`  dict.db        size=${srcMain.size} mtime=${srcMain.mtime}`);
console.log(`  dict.db-wal    size=${srcWal ? srcWal.size : '-'} mtime=${srcWal ? srcWal.mtime : '-'}`);
console.log(`  dict.db.bak-*  同目录备份文件：${fs.readdirSync(path.dirname(SRC)).filter((f) => /^dict\.db\.bak-\d/.test(f)).length} 个`);
const s1 = ro(SRC);
console.log(`  journal_mode=${one(s1, 'PRAGMA journal_mode').journal_mode}`);
const srcPk = pkOf(s1);
console.log(`  book 主键列 = ${JSON.stringify(srcPk)} · 行数 = ${one(s1, 'SELECT COUNT(1) AS n FROM book').n}`);
console.log(`  book 行：${JSON.stringify(snapBook(s1))}`);
const ruLatin = q(
  s1,
  "SELECT word FROM words_i18n WHERE lang = 'ru' AND word GLOB '*[A-Za-z]*' ORDER BY word",
);
console.log(`  words_i18n(ru) 含拉丁字符行数 = ${ruLatin.length}：${JSON.stringify(ruLatin.map((r) => r.word))}`);
console.log(`  words_i18n(ru) 总行数 = ${one(s1, "SELECT COUNT(1) AS n FROM words_i18n WHERE lang = 'ru'").n}`);
const srcBook = snapBook(s1);
s1.close();

console.log('\n' + '='.repeat(96));
console.log('§2 真实老结构候选 data/db/dict.db.bak-v02pipe');
let oldHasBook = false;
let oldPk = null;
let oldRows = 0;
if (!fs.existsSync(OLDBAK)) {
  console.log('  文件不存在 ⇒ 跳过');
} else {
  const ob = ro(OLDBAK);
  const has = q(ob, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book'").length;
  console.log(`  size=${st(OLDBAK).size} mtime=${st(OLDBAK).mtime} · 有 book 表 = ${has > 0}`);
  if (has > 0) {
    oldPk = pkOf(ob);
    oldRows = one(ob, 'SELECT COUNT(1) AS n FROM book').n;
    console.log(`  book 主键列 = ${JSON.stringify(oldPk)} · 行数 = ${oldRows}`);
    console.log(`  journal_mode=${one(ob, 'PRAGMA journal_mode').journal_mode}`);
    oldHasBook = true;
  }
  ob.close();
}

console.log('\n' + '='.repeat(96));
console.log('§3 ★ 决定性证据：只复制主库文件 ≠ 可用回退副本');
const copyMain = path.join(TMP, 'mainonly.db');
fs.copyFileSync(SRC, copyMain); // 与迁移备份实现（fs.copyFileSync(主库文件)）完全同构
console.log(`  已复制主库文件 → ${path.relative(ROOT, copyMain)}（${fs.statSync(copyMain).size} B；未复制 -wal/-shm）`);
const c1 = ro(copyMain);
const copyPk = pkOf(c1);
const copyRows = one(c1, 'SELECT COUNT(1) AS n FROM book').n;
const copyBook = snapBook(c1);
const copyRuLatin = q(
  c1,
  "SELECT word FROM words_i18n WHERE lang = 'ru' AND word GLOB '*[A-Za-z]*' ORDER BY word",
).length;
console.log(`  副本 book 主键列 = ${JSON.stringify(copyPk)}（源库 ${JSON.stringify(srcPk)}）`);
console.log(`  副本 book 行数 = ${copyRows}（源库 ${srcBook.length}）`);
console.log(`  副本 book 行 == 源库 book 行 ? ${JSON.stringify(copyBook) === JSON.stringify(srcBook)}`);
console.log(`  副本 words_i18n(ru) 含拉丁行数 = ${copyRuLatin}（源库 ${ruLatin.length}）`);
c1.close();
const divergence =
  JSON.stringify(copyPk) !== JSON.stringify(srcPk) ||
  JSON.stringify(copyBook) !== JSON.stringify(srcBook) ||
  copyRuLatin !== ruLatin.length;
console.log(
  `  ⇒ ${divergence ? '⚠ **副本与源库不一致**：只复制主库文件得到的「备份」不是源库的忠实回退点' : '副本与源库一致（本次未复现分歧）'}`,
);
// 主库文件自身被 checkpoint 覆盖到什么程度（对照：副本 vs 源库去掉 WAL 后的视图）
const c1b = ro(copyMain);
console.log(`  副本自身 journal_mode 头 = ${one(c1b, 'PRAGMA journal_mode').journal_mode}（WAL 是持久化的库属性）`);
c1b.close();

console.log('\n' + '='.repeat(96));
console.log('§3b ★ 受控实验：真实库上「用户刚写入的一条」是否在只复制主库的备份里（决定性）');
{
  const live = path.join(TMP, 'wal_live.db');
  for (const suf of ['', '-wal', '-shm']) {
    if (fs.existsSync(SRC + suf)) fs.copyFileSync(SRC + suf, live + suf);
  }
  const db = openDatabase(live); // 见 WAL 中的迁移 ⇒ 复合主键
  const beforeAdd = one(db, 'SELECT COUNT(1) AS n FROM book').n;
  db.prepare(
    `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
     VALUES ('walprobe-new', 'ru', 1, 1, 'new', null, '[]', 0, null, 0)`,
  ).run();
  const afterAdd = one(db, 'SELECT COUNT(1) AS n FROM book').n;
  const walNow = fs.existsSync(live + '-wal') ? fs.statSync(live + '-wal').size : -1;
  console.log(`  在真实库副本上写入 1 条 ru 生词：book 行数 ${beforeAdd} ⇒ ${afterAdd}（WAL 大小 ${walNow} B，未 checkpoint）`);
  // 与迁移备份实现同构：只复制主库文件
  const liveMain = path.join(TMP, 'wal_live_mainonly.db');
  fs.copyFileSync(live, liveMain);
  const cl = ro(liveMain);
  const copyN = one(cl, 'SELECT COUNT(1) AS n FROM book').n;
  const copyPk2 = pkOf(cl);
  const hasNew = one(cl, "SELECT COUNT(1) AS n FROM book WHERE word = 'walprobe-new'").n;
  console.log(`  主库单文件副本：book 行数 = ${copyN}（**当前态 ${afterAdd}**）· 含新写入行 = ${hasNew} · 主键列 = ${JSON.stringify(copyPk2)}`);
  console.log(`  ⇒ ${copyN !== afterAdd || hasNew === 0 ? '❌ **备份丢失已提交事务**（用户刚加的生词不在备份里）' : '✓ 本次未复现丢失'}`);
  cl.close();
  db.close();
}


console.log('\n' + '='.repeat(96));
console.log('§4 真实库上的迁移（需 §2 有真实老结构 book）');
let realMigrated = null;
if (!oldHasBook || oldRows === 0) {
  console.log(`  ⚠ 退化：dict.db.bak-v02pipe 无 book 表或为空 ⇒ **无法**在真实库上跑迁移路径（如实声明，不宣称覆盖）`);
  console.log('  原因：现行 data/db/dict.db 的 book 表**已是复合主键**（本迭代开发期已迁移，见 §1），');
  console.log('        且该次迁移**未留下备份**（当时代码「备份失败仍继续迁移」）⇒ 真实老结构副本不存在。');
} else {
  const realCopy = path.join(TMP, 'real_old.db');
  fs.copyFileSync(OLDBAK, realCopy);
  const b4 = ro(realCopy);
  const before = snapBook(b4);
  const beforeI18n = one(b4, "SELECT COUNT(1) AS n FROM words_i18n WHERE lang = 'ru'").n;
  const beforeLatin = q(
    b4,
    "SELECT word FROM words_i18n WHERE lang = 'ru' AND word GLOB '*[A-Za-z]*' ORDER BY word",
  ).length;
  b4.close();
  const db = openDatabase(realCopy);
  const after = snapBook(db);
  const afterI18n = one(db, "SELECT COUNT(1) AS n FROM words_i18n WHERE lang = 'ru'").n;
  const afterLatin = q(
    db,
    "SELECT word FROM words_i18n WHERE lang = 'ru' AND word GLOB '*[A-Za-z]*' ORDER BY word",
  ).length;
  const baks = fs.readdirSync(TMP).filter((f) => /^real_old\.db\.bak-\d/.test(f));
  console.log(`  真实老库主键列迁移前 = ${JSON.stringify(oldPk)} ⇒ 迁移后 = ${JSON.stringify(pkOf(db))}`);
  console.log(`  行数 ${before.length} ⇒ ${after.length} · 逐字段相等 = ${JSON.stringify(before) === JSON.stringify(after)}`);
  console.log(`  墓碑（deleted=1）行数 = ${after.filter((r) => r[9] === 1).length}`);
  console.log(`  lang 分布 = ${JSON.stringify(after.reduce((m, r) => ((m[r[1]] = (m[r[1]] || 0) + 1), m), {}))}`);
  console.log(`  words_i18n(ru) 行数 ${beforeI18n} ⇒ ${afterI18n} · 含拉丁行 ${beforeLatin} ⇒ ${afterLatin}（**book 迁移不触及该表**）`);
  console.log(`  迁移备份文件数 = ${baks.length}（${baks.join(', ') || '无'}）`);
  const o2 = openDatabase(realCopy); // 幂等重跑
  console.log(`  幂等重跑后：主键列 = ${JSON.stringify(pkOf(o2))} · 行数 = ${snapBook(o2).length} · 备份数 = ${fs.readdirSync(TMP).filter((f) => /^real_old\.db\.bak-\d/.test(f)).length}`);
  o2.close();
  db.close();
  realMigrated = { rows: after.length, faithful: JSON.stringify(before) === JSON.stringify(after) };
}

console.log('\n' + '='.repeat(96));
console.log(`小结：源库 book 主键列 ${JSON.stringify(srcPk)} · 真实老结构迁移 ${realMigrated ? JSON.stringify(realMigrated) : '未覆盖'} · 主库单文件副本忠实性 ${divergence ? '❌ 不忠实' : '✓ 忠实'}`);
for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true });
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`临时副本已清理（${path.relative(ROOT, TMP)}）`);
console.log('⚠ 原库 data/db/** 全程只读（未写入、未改名、未删除）');
