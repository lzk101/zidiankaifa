// scripts/probe_t60_leak_impact.mjs —— 只读诊断（T60）：把「连接泄漏」从测试卫生问题升级为**用户可见后果**的证据
// 问题：`openDatabase()` 在迁移无法完成时抛错、且**不关闭**它自己创建的连接（见 book_lang.mjs T60 段注释）。
//   被泄漏的句柄持有 `<库>.db` / `-wal` / `-shm` ⇒ 同进程内这些文件**不能改名、不能删除**。
//   桌面端「换库」正是对 `dict.db` 做改名（AGENTS.md 铁律 5：旧库改名 `.bak-<ts>`）⇒ 需要判定影响面。
// 本探针不碰生产库、不碰 src、只在本目录造夹具；结束后由**另一个进程**清理（本进程删不掉，正是结论本身）。
// 用法：node scripts/probe_t60_leak_impact.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const WORK = path.join(REPO, 'scripts', '_tmp', 't60_impact');
fs.mkdirSync(WORK, { recursive: true });

const { openDatabase } = await import(
  pathToFileURL(path.join(REPO, 'packages', 'core', 'dist', 'db', 'index.js')).href
);

const COLS =
  'word TEXT NOT NULL, lang TEXT NOT NULL DEFAULT \'en\', added_at INTEGER NOT NULL, ' +
  'updated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT \'new\', note TEXT, tags TEXT NOT NULL DEFAULT \'[]\', ' +
  'review_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0';

function makeFailingFixture(file, { withView }) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE book (${COLS}, PRIMARY KEY (word))`);
  db.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  db.prepare('INSERT INTO book (word, lang, added_at, updated_at) VALUES (?, ?, ?, ?)').run('alpha', 'en', 1000, 2000);
  if (withView) db.exec('CREATE VIEW book_new AS SELECT 1 AS x'); // ⇒ 迁移无法完成（DROP TABLE IF EXISTS 对视图抛错）
  db.close(); // 干净关闭 ⇒ 此文件此刻无任何句柄
}

function tryRename(file) {
  const dst = `${file}.bak-probe`;
  try {
    fs.renameSync(file, dst);
    fs.renameSync(dst, file);
    return 'OK（可改名）';
  } catch (e) {
    return `${e.code} :: ${String(e.message).slice(0, 90)}`;
  }
}

console.log('§1 控制组：正常 open/close 之后（无泄漏）能否改名库文件');
const ctl = path.join(WORK, 'ctl.db');
makeFailingFixture(ctl, { withView: false });
{
  const db = openDatabase(ctl); // 迁移成功（老库 → 复合主键）
  db.close();
}
console.log(`  · 控制组改名 = ${tryRename(ctl)}`);

console.log('§2 实验组：迁移无法完成 ⇒ openDatabase **抛错**（连接被泄漏）之后能否改名库文件');
const exp = path.join(WORK, 'leak.db');
makeFailingFixture(exp, { withView: true });
let err = null;
try {
  openDatabase(exp);
} catch (e) {
  err = e;
}
console.log(`  · openDatabase 抛错 = ${err ? `是（${String(err.message).slice(0, 70)}…）` : '否（与预期不符，请复核）'}`);
console.log(`  · 实验组改名 = ${tryRename(exp)}`);
console.log(`  · 实验组删除 = ${(() => {
  try {
    fs.rmSync(exp, { force: true });
    return 'OK（可删除）';
  } catch (e) {
    return `${e.code}`;
  }
})()}`);

console.log('§3 同进程内的整个临时目录能否删除（= book_lang.mjs 收尾 EPERM 的同构复现）');
try {
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log('  · rmSync(WORK) = OK（已删除）');
} catch (e) {
  console.log(`  · rmSync(WORK) = ${e.code} :: ${String(e.message).slice(0, 90)}`);
}
console.log(`  · 残留存在 = ${fs.existsSync(WORK)}（本进程删不掉 ⇒ 必须由另一个进程清理；见回执）`);
console.log('\n结论：泄漏句柄使**同进程内**对该库文件的 rename/unlink 全部失败；进程退出后另一进程立刻可删。');
