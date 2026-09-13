#!/usr/bin/env node
/**
 * 主管探针 probe_sup_t48_assert_coverage.mjs
 *
 * 目的（回答 T54 需求 agent 提请的第 2 项）：
 *   发布说明 `docs/release-v0.10.0.md` §四.1 注 1 声称
 *     「『备份失败』路径会绕过 T45 后置校验」
 *   该表述是 **T48 之前**的事实。T48 把校验上移到 `openDatabase()` 出口
 *   （`packages/core/src/db/index.ts:144 assertBookCompositeOrThrow(db)`）。
 *   本探针**实测**该早期 `return` 路径现在是否会被兜住。
 *
 * 目标路径（真正可达的那条）：
 *   `migrateBookCompositeKey`:310 `if (!ensurePreMigrationBackup(db, st, isRetry)) return;`
 *   ⇒ 早期 return，**跳过该函数末尾 `:371` 的旧位置校验**
 *   `ensurePreMigrationBackup` 有两个 false 出口：
 *     ① `:244` `!file`（PRAGMA database_list 取不到 main 文件路径）
 *     ② `:279` `VACUUM INTO` 失败（磁盘满 / 只读 / 路径冲突）
 *   本探针测 ② —— 它是**生产可达**的那条（① 需文件型库且 fs.existsSync 为假，实际不可达）。
 *
 * ⚠ 前提校正（第一版探针的错误，已记录）：
 *   曾用 `:memory:` 测 ①，得「未抛错 ⇒ 静默降级」，**结论无效** ——
 *   `:memory:` 库先经 `SCHEMA_SQL` 直建复合主键 ⇒ 在 `:302 if (isComposite) return` 就返回，
 *   **根本没进备份段**、也没走早期 return；断言测的是别的东西。
 *
 * 触发手法（确定性、不碰 `data/db/dict.db`）：
 *   ① **冻结时钟**：覆写 `Date.now()` 与 `Date.prototype.toISOString()` 为固定值
 *      ⇒ 备份名可预测：`<db>.bak-<固定 ISO>`；
 *   ② **占位**：在该确切路径上预建**非空目录** ⇒ `VACUUM INTO` 无法写入（不能覆盖目录）
 *      ⇒ 走 `:279` ⇒ return false ⇒ `:310` 早期 return；
 *   ③ 完成后**逐项还原** `Date`。
 *   ⚠ 第一版曾试「预建同名 `book` 目录」，**失败** —— `book` 是**表名**，
 *     而备份文件名是 `<db>.bak-<ISO>`，两者不相干（实测迁移照常成功、还落了 2 份备份）。
 *
 * 判定：`openDatabase()` 必须**抛错**且消息含「复合主键」。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../packages/core/dist/db/index.js';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const WORK = path.join(ROOT, '.probe_t48_assert');
const FROZEN = '2020-01-01T00:00:00.000Z';
const pass = [];
const fail = [];
const ok = (c, label, detail = '') => (c ? pass : fail).push(`${label}${detail ? '  —— ' + detail : ''}`);

function fresh() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
}

/** 建一个**老结构**（book 单主键）库，book 里放 2 行（含 1 墓碑） */
function makeOldDb(p) {
  const d = new DatabaseSync(p);
  d.exec(`CREATE TABLE book (
    word TEXT PRIMARY KEY,
    lang TEXT NOT NULL DEFAULT 'en',
    added_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    review_count INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_book_updated ON book(updated_at);
  INSERT INTO book (word, lang, added_at, updated_at, deleted) VALUES
    ('alpha','en',10,10,0),
    ('beta','en',20,20,1);`);
  d.close();
}

/* ---------------- §0 前提：手法有效性自证 ---------------- */
console.log('§0 monkey-patch 手法有效性自证（先证「能造出失败」，再拿它测产品）');
{
  // 验证 node:fs 的默认导出是否可被覆写（若冻结则本手法无效，须改法）
  const orig = fs.existsSync;
  let patchable = false;
  try {
    fs.existsSync = (p) => (String(p).includes('__never__') ? false : orig(p));
    patchable = fs.existsSync('__never__') === false;
  } catch (e) {
    patchable = false;
  } finally {
    fs.existsSync = orig;
  }
  ok(patchable, 'node:fs 默认导出的 existsSync 可被覆写（patch 手法有效）', patchable ? '' : '不可覆写 ⇒ 该手法作废');
}

/* ---------------- §1 目标路径：备份失败 ⇒ 早期 return ---------------- */
console.log('');
console.log('§1 备份失败（冻结时钟 + 在确切备份名上预建非空目录）⇒ 早期 return 是否被兜住');
{
  fresh();
  const db = path.join(WORK, 'old.db');
  makeOldDb(db);

  // 冻结时钟 ⇒ 备份名可预测
  const realNow = Date.now;
  const realIso = Date.prototype.toISOString;
  const bakPath = `${db}.bak-${FROZEN.replace(/[:.]/g, '-')}`;
  Date.now = () => 0;
  Date.prototype.toISOString = function () {
    return FROZEN;
  };
  // 在该确切路径上占位（非空目录 ⇒ VACUUM INTO 不能覆盖）
  fs.mkdirSync(path.join(bakPath, 'occupied'), { recursive: true });

  let threw = null;
  let returned = null;
  const warns = [];
  const ow = console.warn;
  const ol = console.log;
  console.warn = (...a) => warns.push(String(a[0]));
  console.log = () => {};
  try {
    returned = openDatabase(db);
  } catch (e) {
    threw = e;
  } finally {
    console.warn = ow;
    console.log = ol;
    Date.now = realNow;
    Date.prototype.toISOString = realIso;
    try {
      returned?.close?.();
    } catch {
      /* ignore */
    }
  }

  const abandon = warns.filter((w) => w.includes('放弃迁移'));
  console.log(`  ⓘ 「放弃迁移」警告 ${abandon.length} 条：${abandon[0] ? abandon[0].slice(0, 96) : '（无）'}`);
  ok(
    abandon.length >= 1,
    '★ 前置条件成立：确实走进「备份失败 ⇒ 放弃迁移」分支',
    abandon[0] ? abandon[0].slice(0, 70) : '未触发 ⇒ 以下断言无意义'
  );
  ok(threw !== null, 'openDatabase() 抛错（响亮失败）', threw ? String(threw.message).slice(0, 80) : '未抛错 ⇒ 静默降级');
  ok(
    threw !== null && /复合主键/.test(String(threw.message)),
    '抛错消息含「复合主键」',
    threw ? String(threw.message).slice(0, 80) : '—'
  );
  ok(returned === null, '未返回可用连接', returned ? '返回了连接 ⇒ 静默降级' : '—');

  // ⚠ 判别力守卫：同一夹具去掉占位（并解冻时钟）后必须**不抛错**且迁移成功
  fs.rmSync(bakPath, { recursive: true, force: true });
  const db2 = path.join(WORK, 'old2.db');
  makeOldDb(db2);
  let threw2 = null;
  let ret2 = null;
  const ow2 = console.warn;
  const ol2 = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    ret2 = openDatabase(db2);
  } catch (e) {
    threw2 = e;
  } finally {
    console.warn = ow2;
    console.log = ol2;
  }
  let pk2 = null;
  try {
    pk2 = ret2
      .prepare('PRAGMA table_info(book)')
      .all()
      .filter((r) => Number(r.pk) > 0)
      .map((r) => r.name)
      .sort();
    ret2.close();
  } catch {
    /* ignore */
  }
  ok(
    threw2 === null,
    '★ 判别力守卫：无干扰时同一夹具**不抛错**（证明 §1 抛错确由备份失败引起）',
    threw2 ? String(threw2.message).slice(0, 70) : '正常完成'
  );
  ok(
    JSON.stringify(pk2) === JSON.stringify(['lang', 'word']),
    '★ 对照：无干扰时迁移**成功**且主键为复合',
    JSON.stringify(pk2)
  );

  const baks = fs.readdirSync(WORK).filter((f) => /\.bak-/.test(f));
  console.log(`  ⓘ 目录内备份文件 ${baks.length} 个（占位目录已删，成功迁移那份应留下）`);
}

console.log('');
console.log('§2 结论');
console.log(
  fail.length === 0
    ? '  ⇒ 早期 return（备份失败）**已被 openDatabase 出口的校验兜住** ⇒ 发布说明 §四.1 注 1 为**过期表述**。'
    : '  ⇒ 该路径仍可静默降级 ⇒ 发布说明 §四.1 注 1 **仍然成立**，须作为未闭环缺陷登记。'
);
for (const p of pass) console.log(`  ✓ ${p}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log('');
console.log(`结果：${pass.length} 通过 / ${fail.length} 失败（共 ${pass.length + fail.length} 条断言）`);

// 清理放在**打印之后**且容错：并发/持有句柄时 rmSync 可能报
//   EPERM, Permission denied（本项目已第二次踩：测试 agent 也报过 book_lang.mjs 清理分支 EPERM）
try {
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log('（临时目录已清理）');
} catch (e) {
  console.log(`（⚠ 临时目录清理失败，需人工删除：${WORK} —— ${String(e.message).slice(0, 60)}）`);
}

process.exit(fail.length === 0 ? 0 : 1);
