/**
 * dbmigrate 单测：造一个「旧库」→ 跑升级 → 断言换库成功且生词本保留。
 * 用小库（非 500MB 真库），秒级完成。
 *
 * 运行：node apps/desktop/test/dbmigrate.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureUserDb, stampOf, readStamp, STAMP_SUFFIX } from '../src/dbmigrate.mjs';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const eq = (name, actual, expected) => ok(name, JSON.stringify(actual) === JSON.stringify(expected), `\n      实际=${JSON.stringify(actual)}\n      期望=${JSON.stringify(expected)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zidian-migrate-'));

/** 造一个最小可用的库；marker 用于区分「新库/旧库」 */
function makeDb(file, marker) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS book (word TEXT PRIMARY KEY, added_at INTEGER, updated_at INTEGER, status TEXT, note TEXT, tags TEXT, review_count INTEGER, last_reviewed_at INTEGER, deleted INTEGER DEFAULT 0, lang TEXT DEFAULT \'en\')');
  db.exec('CREATE TABLE IF NOT EXISTS meta_marker (k TEXT PRIMARY KEY, v TEXT)');
  db.prepare('INSERT OR REPLACE INTO meta_marker (k, v) VALUES (?, ?)').run('marker', marker);
  db.close();
}

function marker(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare("SELECT v FROM meta_marker WHERE k = 'marker'").get();
  db.close();
  return row?.v ?? null;
}

function bookRows(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare('SELECT word, status, deleted FROM book ORDER BY word').all();
  db.close();
  return rows.map((r) => `${r.word}:${r.status}:${r.deleted}`);
}

const log = () => {};

// ---------------------------------------------------------------- 场景 1：首次运行
console.log('\n[场景 1] 首次运行（userData 无副本）');
{
  const bundled = path.join(tmp, 'bundled1.db');
  const userData = path.join(tmp, 'user1', 'dict.db');
  makeDb(bundled, 'v070');
  const res = ensureUserDb({ bundled, userData, log });
  eq('action = created', res.action, 'created');
  ok('副本已生成', fs.existsSync(userData));
  eq('副本内容 = 内置库', marker(userData), 'v070');
  eq('stamp 已写入', readStamp(`${userData}${STAMP_SUFFIX}`), stampOf(bundled));

  const again = ensureUserDb({ bundled, userData, log });
  eq('再次调用 action = kept', again.action, 'kept');
}

// ---------------------------------------------------------------- 场景 2：核心 —— 升级且保留生词本
console.log('\n[场景 2] 升级：旧库（含生词本）→ 新内置库');
{
  const bundled = path.join(tmp, 'bundled2.db');
  const userData = path.join(tmp, 'user2', 'dict.db');
  fs.mkdirSync(path.dirname(userData), { recursive: true });

  // 新内置库
  makeDb(bundled, 'v071');
  // 旧 userData 副本（模拟 v0.2.x 的 509MB 旧库）
  makeDb(userData, 'v020');
  const old = new DatabaseSync(userData);
  const now = Date.now();
  old.prepare('INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted, lang) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('international', now - 5000, now - 5000, 'learning', '', '[]', 3, now - 5000, 0, 'en');
  old.prepare('INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted, lang) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('тоска', now - 4000, now - 4000, 'new', '忧愁', '["lit"]', 0, null, 0, 'ru');
  // 墓碑记录（已删除的生词）也必须带过去，否则同步会把它复活
  old.prepare('INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted, lang) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('obsolete', now - 3000, now - 3000, 'new', '', '[]', 0, null, 1, 'en');
  old.close();

  eq('升级前：旧库标记 = v020', marker(userData), 'v020');
  eq('升级前：生词本 3 条（含 1 条墓碑）', bookRows(userData), ['international:learning:0', 'obsolete:new:1', 'тоска:new:0']);

  const res = ensureUserDb({ bundled, userData, log });

  eq('action = upgraded', res.action, 'upgraded');
  eq('迁移条数 = 3', res.carried, 3);
  eq('副本内容已换成新库', marker(userData), 'v071');
  eq('stamp 已更新为新内置库', readStamp(`${userData}${STAMP_SUFFIX}`), stampOf(bundled));
  eq('生词本完整迁移（含墓碑与状态）', bookRows(userData), ['international:learning:0', 'obsolete:new:1', 'тоска:new:0']);
  ok('旧库已备份（非删除）', !!res.backup && fs.existsSync(res.backup), ` backup=${res.backup}`);
  if (res.backup) eq('备份内容仍是旧库', marker(res.backup), 'v020');

  const repeat = ensureUserDb({ bundled, userData, log });
  eq('升级后再次调用 action = kept（不重复换库）', repeat.action, 'kept');
}

// ---------------------------------------------------------------- 场景 3：内置库变更（新版本发布）
console.log('\n[场景 3] 连续升级：内置库再次变更');
{
  const bundled = path.join(tmp, 'bundled3.db');
  const userData = path.join(tmp, 'user3', 'dict.db');
  makeDb(bundled, 'vA');
  ensureUserDb({ bundled, userData, log });
  eq('第一次 = created', marker(userData), 'vA');

  // 模拟发布新版本：改内置库内容与 mtime
  makeDb(bundled, 'vB');
  fs.utimesSync(bundled, new Date(), new Date(Date.now() + 2000));
  const res = ensureUserDb({ bundled, userData, log });
  eq('检测到变化 → upgraded', res.action, 'upgraded');
  eq('副本已更新', marker(userData), 'vB');
}

// ---------------------------------------------------------------- 场景 4：无内置库
console.log('\n[场景 4] 内置库缺失');
{
  const res = ensureUserDb({ bundled: path.join(tmp, 'nope.db'), userData: path.join(tmp, 'u4', 'dict.db'), log });
  eq('action = no-bundled', res.action, 'no-bundled');
}

// ---------------------------------------------------------------- 场景 5：损坏的旧库不应阻断升级
console.log('\n[场景 5] 旧库损坏（读不出生词本）仍须完成换库');
{
  const bundled = path.join(tmp, 'bundled5.db');
  const userData = path.join(tmp, 'user5', 'dict.db');
  fs.mkdirSync(path.dirname(userData), { recursive: true });
  makeDb(bundled, 'vNew');
  fs.writeFileSync(userData, 'not a sqlite file at all'); // 损坏
  const res = ensureUserDb({ bundled, userData, log });
  eq('仍然 upgraded', res.action, 'upgraded');
  eq('副本已是可用新库', marker(userData), 'vNew');
  eq('生词本迁移 0 条', res.carried, 0);
}

console.log(`\n===== dbmigrate: ${pass} 通过 / ${fail} 失败 =====`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail === 0 ? 0 : 1);
