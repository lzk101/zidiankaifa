#!/usr/bin/env node
/**
 * v0.10.0 探针：生词本语言分离（REQ-V10-001 AC-12 / AC-13 / AC-14）
 *
 * 用途：**开发侧自验**（先于测试 agent 的 `packages/core/test/book_lang.mjs` 落地）。
 *   判定对象 = **构建产物** `packages/core/dist/db/index.js`（改 src 后必须先 build！铁律 3）。
 *   不依赖 `data/db/dict.db`（全程用临时库），故与 cwd 无关。
 *
 * 覆盖：
 *   块 A AC-12 复合主键迁移（老结构有/无 lang 两变体 · 保数据 · 墓碑 · 幂等 · 备份只发生一次 · 备份失败即放弃）
 *   块 B AC-13 跨语言隔离（同 word 不同 lang 互不影响 · 缺省语义不对称）
 *   块 C AC-14 同步合并键 = (word, lang)
 *
 * 用法：`node scripts/probe_v10_book_lang.mjs`（任意 cwd）→ 末行总计数，失败 exit 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
  bookAdd,
  bookGet,
  bookList,
  bookListAll,
  bookRemove,
  bookUpdate,
  syncMerge,
  SCHEMA_SQL,
} from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zidian-v10-probe-'));

let pass = 0;
let fail = 0;
const problems = [];

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    problems.push(`${label}${detail ? ` —— ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
  }
}
const eq = (label, actual, expected) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `实得 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);

const OLD_SCHEMA_WITH_LANG = `CREATE TABLE book (
  word TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'en',
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_book_updated ON book(updated_at);`;

/** 老结构（无 lang 列，v0.9.0 之前） */
const OLD_SCHEMA_NO_LANG = `CREATE TABLE book (
  word TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);`;

const pkCols = (db) =>
  db
    .prepare('PRAGMA table_info(book)')
    .all()
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => c.name);

const backupsOf = (file) =>
  fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.bak-`));

console.log(`临时目录：${TMP}\n`);
console.log('== 块 A · AC-12 复合主键迁移 ==');

/* A1：老结构（有 lang 列 + 1 正常 + 1 墓碑） */
{
  const p = path.join(TMP, 'old-with-lang.db');
  const raw = new DatabaseSync(p);
  raw.exec(OLD_SCHEMA_WITH_LANG);
  raw
    .prepare('INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('alpha', 'en', 1000, 2000, 'learning', 'note-α', '["t1"]', 3, 1500, 0);
  raw
    .prepare('INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('бета', 'ru', 3000, 4000, 'mastered', null, '[]', 0, null, 1);
  raw.close();

  const db = openDatabase(p);
  eq('A1.1 迁移后主键 = (word, lang)', pkCols(db), ['word', 'lang']);
  const rows = db.prepare('SELECT * FROM book ORDER BY word').all();
  eq('A1.2 行数不变（2）', rows.length, 2);
  const alpha = db.prepare('SELECT * FROM book WHERE word = ?').get('alpha');
  ok(
    'A1.3 正常行逐字段保真',
    alpha.lang === 'en' &&
      alpha.added_at === 1000 &&
      alpha.updated_at === 2000 &&
      alpha.status === 'learning' &&
      alpha.note === 'note-α' &&
      alpha.tags === '["t1"]' &&
      alpha.review_count === 3 &&
      alpha.last_reviewed_at === 1500 &&
      alpha.deleted === 0,
    JSON.stringify(alpha),
  );
  const beta = db.prepare('SELECT * FROM book WHERE word = ?').get('бета');
  ok('A1.4 墓碑保留（deleted=1）且语言仍是 ru', beta.deleted === 1 && beta.lang === 'ru', JSON.stringify(beta));
  const baks1 = backupsOf(p);
  eq('A1.5 迁移前落下 1 个 .bak-<ISO> 备份', baks1.length, 1);
  ok('A1.6 备份文件名含 ISO 时间戳', /\.bak-\d{4}-\d{2}-\d{2}T/.test(baks1[0] ?? ''), baks1[0] ?? '(无)');
  const bakDb = new DatabaseSync(path.join(TMP, baks1[0]));
  eq('A1.7 备份内容 = 迁移前老结构（word 单主键）', pkCols(bakDb), ['word']);
  bakDb.close();
  ok('A1.8 idx_book_updated 迁移后仍存在', db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_book_updated'").get() !== undefined);
  db.close();

  // 幂等重跑两次
  const db2 = openDatabase(p);
  eq('A1.9 第二次 openDatabase 主键仍为 (word, lang)', pkCols(db2), ['word', 'lang']);
  eq('A1.10 幂等重跑不产生第二个备份', backupsOf(p).length, 1);
  eq('A1.11 重跑后行数仍为 2', db2.prepare('SELECT COUNT(1) AS n FROM book').get().n, 2);
  db2.close();
  const db3 = openDatabase(p);
  eq('A1.12 第三次 openDatabase 仍不新增备份', backupsOf(p).length, 1);
  db3.close();
}

/* A2：老结构（**无 lang 列**）→ ADD COLUMN 后再迁移，lang 补 'en' */
{
  const p = path.join(TMP, 'old-no-lang.db');
  const raw = new DatabaseSync(p);
  raw.exec(OLD_SCHEMA_NO_LANG);
  raw
    .prepare('INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('gamma', 10, 20, 'new', null, '[]', 0, null, 0);
  raw.close();

  const db = openDatabase(p);
  eq('A2.1 无 lang 列的老库迁移后主键 = (word, lang)', pkCols(db), ['word', 'lang']);
  const g = db.prepare('SELECT * FROM book WHERE word = ?').get('gamma');
  ok('A2.2 缺失的 lang 补为 en', g.lang === 'en' && g.added_at === 10 && g.deleted === 0, JSON.stringify(g));
  eq('A2.3 无 lang 列的老库同样只备份一次', backupsOf(p).length, 1);
  db.close();
}

/* A3：新库（空路径）建表即复合主键，且**不产生备份** */
{
  const p = path.join(TMP, 'fresh.db');
  const db = openDatabase(p);
  eq('A3.1 新库建表即 (word, lang) 复合主键', pkCols(db), ['word', 'lang']);
  eq('A3.2 新库不产生 .bak 备份（未发生迁移）', backupsOf(p).length, 0);
  ok('A3.3 SCHEMA_SQL 可直接重复执行（幂等）', (() => { db.exec(SCHEMA_SQL); return true; })());
  db.close();
}
console.log('');

console.log('== 块 B · AC-13 跨语言隔离 ==');
{
  const p = path.join(TMP, 'isolation.db');
  const db = openDatabase(p);
  bookAdd(db, 'test', ['en-tag'], 'en');
  bookAdd(db, 'test', ['ru-tag'], 'ru');

  eq('B1 同拼写两条并存（bookListAll=2）', bookListAll(db).length, 2);
  eq('B2 两条语言各为 en/ru', bookListAll(db).map((b) => b.lang).sort(), ['en', 'ru']);
  eq('B3 bookList(db,"ru") 只含 ru 条', bookList(db, 'ru').map((b) => b.word), ['test']);
  eq('B4 bookList(db) 缺省不过滤（全部语言）', bookList(db).length, 2);
  eq('B5 bookGet 缺省 = en 条', bookGet(db, 'test')?.lang, 'en');
  eq('B6 bookGet(db,"test","ru") = ru 条', bookGet(db, 'test', 'ru')?.lang, 'ru');
  eq('B7 各自 tags 独立', [bookGet(db, 'test', 'en')?.tags, bookGet(db, 'test', 'ru')?.tags], [['en-tag'], ['ru-tag']]);

  const enBefore = bookGet(db, 'test', 'en');
  bookRemove(db, 'test', 'ru');
  const enAfter = bookGet(db, 'test', 'en');
  const ruAfter = bookGet(db, 'test', 'ru');
  const ruRaw = db.prepare('SELECT deleted, lang FROM book WHERE word = ? AND lang = ?').get('test', 'ru');
  ok('B8 删 ru ⇒ ru 墓碑 deleted=1（SQL 层）', ruRaw?.deleted === 1, JSON.stringify(ruRaw));
  ok('B8b 删 ru ⇒ ru 条目 deleted=true（BookItem 层）', ruAfter?.deleted === true, JSON.stringify(ruAfter));
  ok('B9 删 ru ⇒ en 条全部字段不变（含 updatedAt）', JSON.stringify(enBefore) === JSON.stringify(enAfter), `${JSON.stringify(enBefore)} vs ${JSON.stringify(enAfter)}`);
  eq('B10 ★ 墓碑不得改语言：ru 墓碑 lang 仍为 ru', ruAfter?.lang, 'ru');
  eq('B11 墓碑的 tags 保留', ruAfter?.tags, ['ru-tag']);

  const ruUpdatedBefore = ruAfter?.updatedAt;
  bookUpdate(db, { word: 'test', lang: 'ru', note: 'x' });
  eq('B12 更新 ru ⇒ en 条 note 不变', bookGet(db, 'test', 'en')?.note, null);
  ok('B13 更新 ru ⇒ en 条 updatedAt 不变', bookGet(db, 'test', 'en')?.updatedAt === enAfter?.updatedAt);
  ok('B14 更新 ru ⇒ ru 条 note 生效', bookGet(db, 'test', 'ru')?.note === 'x');
  ok('B15 更新 ru ⇒ ru 桥 updatedAt 前进', (bookGet(db, 'test', 'ru')?.updatedAt ?? 0) >= (ruUpdatedBefore ?? 0));

  // 反向：删 en 不动 ru
  const ruBefore2 = bookGet(db, 'test', 'ru');
  bookRemove(db, 'test', 'en');
  const enRaw = db.prepare('SELECT deleted, lang FROM book WHERE word = ? AND lang = ?').get('test', 'en');
  eq('B16 删 en ⇒ en 墓碑 deleted=1（SQL 层）', enRaw?.deleted, 1);
  ok('B17 删 en ⇒ ru 条不变', JSON.stringify(ruBefore2) === JSON.stringify(bookGet(db, 'test', 'ru')));

  // 未传 lang 的 bookRemove（老调用点）应沿用既有语言，不得静默写 en
  bookAdd(db, 'один', [], 'ru');
  bookRemove(db, 'один');
  eq('B18 老调用点 bookRemove(word) 沿用既有语言 ru', bookGet(db, 'один', 'ru')?.lang, 'ru');
  eq('B19 老调用点不产生多余的 en 条', bookGet(db, 'один', 'en'), null);
  db.close();
}
console.log('');

console.log('== 块 C · AC-14 同步合并键 = (word, lang) ==');
{
  const p = path.join(TMP, 'sync.db');
  const db = openDatabase(p);
  const T1 = 5_000_000;

  const mk = (lang, updatedAt, note = null, deleted = false) => ({
    word: 'test',
    lang,
    addedAt: 1,
    updatedAt,
    status: 'new',
    note,
    tags: [],
    reviewCount: 0,
    lastReviewedAt: null,
    deleted,
  });

  const r1 = syncMerge(db, [mk('en', T1)]);
  eq('C1 首次推 en ⇒ pushed=1', r1.pushed, 1);
  const r2 = syncMerge(db, [mk('ru', T1 - 100)]);
  eq('C2 ★ 推 ru（updatedAt 更旧）仍被写入 ⇒ pushed=1', r2.pushed, 1);
  eq('C3 en 与 ru 两条并存', bookListAll(db).length, 2);
  ok('C4 en 条未被 ru 覆盖（updatedAt 仍为 T1）', bookGet(db, 'test', 'en')?.updatedAt === T1);

  const r3 = syncMerge(db, [mk('en', T1 - 50)]);
  eq('C5 同 (word,lang) 且更旧 ⇒ 不推（last-write-wins 不变）', r3.pushed, 0);

  const ruBefore = bookGet(db, 'test', 'ru')?.updatedAt;
  bookUpdate(db, { word: 'test', lang: 'en', note: 'changed' });
  ok('C6 ★ 更新 en ⇒ ru 的 updated_at 不受影响', bookGet(db, 'test', 'ru')?.updatedAt === ruBefore, `${bookGet(db, 'test', 'ru')?.updatedAt} vs ${ruBefore}`);

  syncMerge(db, [mk('ru', T1 + 999, null, true)]);
  eq('C7 bookListAll 含墓碑（同步语义不变）', bookListAll(db).filter((b) => b.deleted).length, 1);
  eq('C8 bookList("ru") 不含墓碑', bookList(db, 'ru').length, 0);
  db.close();
}
console.log('');

const total = pass + fail;
console.log(`===== probe_v10_book_lang：${pass} 通过 / ${fail} 失败（共 ${total} 条断言）=====`);
if (fail) {
  console.log('\n失败项：');
  for (const x of problems) console.log(`  - ${x}`);
}
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch {
  /* 忽略清理失败 */
}
process.exit(fail ? 1 : 0);
