// scripts/probe_t74_user_scope.mjs —— T74 实验 B：用户维度改造「最小面」判别探针（只读 + 临时库）
//
// 全部在 .tmp/t74_userscope/ 下的临时库上做，**不碰 data/**。
//   §1 复现：现主键 (word, lang) 在「多用户同词同语言」下会互相覆盖（⇒ 主键必须含 user_id 的证据）
//   §2 复现 AGENTS.md 铁律陷阱：把使用**新列**的 CREATE INDEX 写进 SCHEMA_SQL ⇒ 老库启动崩
//   §3 候选迁移实测：ALTER 加列 + 复合主键重建（PK = user_id, word, lang）全链路可跑
//   §4 对照：只 ALTER 加列、不改主键 ⇒ 不满足多用户（实测冲突）
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.tmp', 't74_userscope');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const line = (s = '') => console.log(s);
const head = (s) => { line(); line('='.repeat(96)); line(s); line('='.repeat(96)); };
const ok = (s) => line(`  ✔ ${s}`);
const bad = (s) => line(`  ✘ ${s}`);
const info = (s) => line(`  ⓘ ${s}`);
const show = (label, v) => line(`  · ${label} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);

/** 与 packages/core/src/db/schema.ts 的 BOOK_COLUMNS_SQL 同构（此处**故意复制**，探针不依赖 dist） */
const COLS_V10 = `
  word             TEXT NOT NULL,
  lang             TEXT NOT NULL DEFAULT 'en',
  added_at         INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'new',
  note             TEXT,
  tags             TEXT NOT NULL DEFAULT '[]',
  review_count     INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted          INTEGER NOT NULL DEFAULT 0`;
const COLS_V11 = `user_id TEXT NOT NULL DEFAULT 'local',${COLS_V10}`;

const pkCols = (db, table = 'book') =>
  db.prepare(`PRAGMA table_info(${table})`).all()
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => c.name);

function makeDb(name, ddl) {
  const p = path.join(TMP, name);
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode = wal');
  if (ddl) db.exec(ddl);
  return { db, p };
}

/* ------------------------------------------------------------------ *
 * §1 现结构在多用户下的失效（= 主键必须含 user_id 的证据）
 * ------------------------------------------------------------------ */
head('§1 现主键 (word, lang) 在多用户场景下的实测行为');
{
  const { db } = makeDb('v10.db', `CREATE TABLE IF NOT EXISTS book (${COLS_V10}, PRIMARY KEY (word, lang));`);
  const ins = db.prepare(
    'INSERT INTO book (word, lang, added_at, updated_at, status, deleted) VALUES (?,?,?,?,?,0) ' +
    'ON CONFLICT(word, lang) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at',
  );
  ins.run('apple', 'en', 1, 1, 'new');       // 用户 A
  ins.run('apple', 'en', 2, 2, 'mastered');  // 用户 B（同词同语言）
  const rows = db.prepare('SELECT word, lang, status FROM book').all();
  show('插入两个用户后 book 表行数', rows.length);
  show('内容', rows);
  if (rows.length === 1) ok('实测确认：用户 B 的写入**覆盖**了用户 A（(word, lang) 只能存一条）⇒ 主键必须含用户维度');
  else bad('预期为 1 行（覆盖），实得 ' + rows.length);
  db.close();
}

/* ------------------------------------------------------------------ *
 * §2 AGENTS.md 铁律陷阱复现：新列的 CREATE INDEX 写进 SCHEMA_SQL
 * ------------------------------------------------------------------ */
head('§2 铁律陷阱复现：给**新列** user_id 在 SCHEMA_SQL 里写 CREATE INDEX');
{
  // 老库：无 user_id 列
  const { db } = makeDb('old_for_index.db', `CREATE TABLE IF NOT EXISTS book (${COLS_V10}, PRIMARY KEY (word, lang));`);
  db.close();
  // 模拟 openDatabase()：db.exec(SCHEMA_SQL) —— SCHEMA_SQL 里含 user_id 的建索引语句
  const db2 = new DatabaseSync(path.join(TMP, 'old_for_index.db'));
  try {
    db2.exec(`
CREATE TABLE IF NOT EXISTS book (${COLS_V11}, PRIMARY KEY (user_id, word, lang));
CREATE INDEX IF NOT EXISTS idx_book_user ON book(user_id);
`);
    bad('未抛错（预期应抛）—— 与铁律描述不符，需复核');
  } catch (e) {
    ok(`如铁律所述抛错：${e?.constructor?.name}: ${e.message}`);
    info('机制：表已存在 ⇒ `CREATE TABLE IF NOT EXISTS` 跳过（老表没有 user_id 列）⇒ 随后建索引时列不存在');
  } finally {
    db2.close();
  }
  // 对照：索引单独 try/catch 建（推荐形态）
  const db3 = new DatabaseSync(path.join(TMP, 'old_for_index.db'));
  let warned = null;
  try { db3.exec('CREATE INDEX IF NOT EXISTS idx_book_user ON book(user_id);'); } catch (e) { warned = e.message; }
  show('索引单独 try/catch 建的结果', warned ? `捕获并降级：${warned}` : '成功（列已存在）');
  db3.close();
}

/* ------------------------------------------------------------------ *
 * §3 候选迁移实测：ALTER 加列 + 复合主键重建（PK = user_id, word, lang）
 * ------------------------------------------------------------------ */
head('§3 候选迁移实测（PK = user_id, word, lang）');
{
  // 3a 老库（v0.9 之前：PK = word）
  const { db, p } = makeDb('legacy.db', `CREATE TABLE IF NOT EXISTS book (${COLS_V10}, PRIMARY KEY (word));`);
  db.prepare('INSERT INTO book (word, lang, added_at, updated_at, status, deleted) VALUES (?,?,?,?,?,0)')
    .run('apple', 'en', 1, 1, 'new');
  db.prepare('INSERT INTO book (word, lang, added_at, updated_at, status, deleted) VALUES (?,?,?,?,?,1)')
    .run('яблоко', 'ru', 2, 2, 'learning');
  show('迁移前主键', pkCols(db));
  show('迁移前行数', db.prepare('SELECT COUNT(1) AS n FROM book').get().n);

  // 3b 第一步 ALTER 加列（先例：migrateAddColumn / migrateBookLang）
  db.exec("ALTER TABLE book ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'");
  ok('ALTER TABLE book ADD COLUMN user_id TEXT NOT NULL DEFAULT \'local\' 成功（老行自动归 local）');
  show('加列后主键（仍是 (word, lang)）', pkCols(db));
  show('加列后 user_id 取值', db.prepare('SELECT DISTINCT user_id FROM book').all());

  // 3c 第二步 复合主键重建（先例：migrateBookCompositeKey 的四步）
  const before = db.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE book_new (${COLS_V11}, PRIMARY KEY (user_id, word, lang));`);
    db.exec(`INSERT OR REPLACE INTO book_new
      (user_id, word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
      SELECT COALESCE(NULLIF(user_id,''),'local'), word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted
      FROM book`);
    const after = db.prepare('SELECT COUNT(1) AS n FROM book_new').get().n;
    if (after !== before) throw new Error(`行数不一致：${before} → ${after}`);
    db.exec('DROP TABLE book');
    db.exec('ALTER TABLE book_new RENAME TO book');
    db.exec('CREATE INDEX IF NOT EXISTS idx_book_updated ON book(updated_at)');
    db.exec('COMMIT');
    ok(`主键重建成功（行数保真 ${before} → ${after}）`);
  } catch (e) {
    db.exec('ROLLBACK');
    bad(`迁移失败并已回滚：${e.message}`);
  }
  show('迁移后主键', pkCols(db));
  show('迁移后行数', db.prepare('SELECT COUNT(1) AS n FROM book').get().n);
  show('迁移后内容', db.prepare('SELECT user_id, word, lang, status, deleted FROM book ORDER BY word').all());

  // 3d 多用户共存验证
  const upsert = db.prepare(
    'INSERT INTO book (user_id, word, lang, added_at, updated_at, status, deleted) VALUES (?,?,?,?,?,?,0) ' +
    'ON CONFLICT(user_id, word, lang) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at',
  );
  upsert.run('alice', 'apple', 'en', 10, 10, 'new');
  upsert.run('bob', 'apple', 'en', 11, 11, 'mastered');
  upsert.run('alice', 'apple', 'en', 12, 12, 'learning'); // 同用户同词再写 ⇒ 应更新而非新增
  const rows = db.prepare("SELECT user_id, word, lang, status FROM book WHERE word = 'apple' ORDER BY user_id").all();
  show('apple 的全部行（含迁移带入的 local 行）', rows);
  // ★ 判据只针对 alice/bob 两行（迁移带入的 `local` 行是既有数据，不参与本断言）
  const ab = rows.filter((r) => r.user_id === 'alice' || r.user_id === 'bob');
  show('其中 alice/bob 两用户', ab);
  if (
    ab.length === 2 &&
    ab.find((r) => r.user_id === 'alice')?.status === 'learning' &&
    ab.find((r) => r.user_id === 'bob')?.status === 'mastered'
  ) {
    ok('多用户共存 ✔（alice/bob 各一行）且同用户重复写为「更新」而非新增 ✔ ⇒ **主键必须 = (user_id, word, lang)**');
  } else {
    bad('多用户验证不通过');
  }

  // 3e 用户维度过滤（每条读取都要带 user_id）
  const aOnly = db.prepare('SELECT COUNT(1) AS n FROM book WHERE user_id = ? AND deleted = 0').get('alice').n;
  const all = db.prepare('SELECT COUNT(1) AS n FROM book WHERE deleted = 0').get().n;
  show('user_id 过滤后 alice 可见条数', aOnly);
  show('不加过滤可见条数（= 现网 /api/v1/book 的行为）', all);
  if (all > aOnly) ok('实测确认：不加 user_id 过滤就会跨用户泄露 ⇒ 每条 book 读取都必须带 user_id');
  db.close();
  info(`临时库：${path.relative(ROOT, p)}`);
}

/* ------------------------------------------------------------------ *
 * §4 对照：只 ALTER 加列、不改主键
 * ------------------------------------------------------------------ */
head('§4 对照实验：只 ALTER 加 user_id、**不**改主键');
{
  const { db } = makeDb('alter_only.db', `CREATE TABLE IF NOT EXISTS book (${COLS_V10}, PRIMARY KEY (word, lang));`);
  db.exec("ALTER TABLE book ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'");
  const up = db.prepare(
    'INSERT INTO book (user_id, word, lang, added_at, updated_at, status, deleted) VALUES (?,?,?,?,?,?,0) ' +
    'ON CONFLICT(word, lang) DO UPDATE SET status = excluded.status',
  );
  up.run('alice', 'apple', 'en', 1, 1, 'new');
  up.run('bob', 'apple', 'en', 2, 2, 'mastered');
  const rows = db.prepare('SELECT user_id, word, lang, status FROM book').all();
  show('结果行数', rows.length);
  show('内容', rows);
  if (rows.length === 1) bad('实测：只加列**无法**支持多用户（(word,lang) 仍冲突，用户数据互相覆盖）⇒ 必须重建主键');
  else ok('意外：未冲突，需复核');
  db.close();
}

head('结论（本探针实测）');
line('  · 主键必须含 user_id：PK = (user_id, word, lang)');
line('  · 迁移形态 = 「ALTER 加列（归 local）」+「复合主键重建」两步，与既有 migrateAddColumn / migrateBookCompositeKey 先例同构');
line('  · 新列索引**不得**写进 SCHEMA_SQL（§2 已复现 `no such column: user_id`）');
line(`  · 临时目录：${path.relative(ROOT, TMP)}（可随时删除；未触碰 data/**）`);
