/**
 * ★ v0.11.0（AC-27 / AC-28② / `DEC-033`）：**匿名·本机哨兵用户**。
 *
 * 未绑定账号的生词本行一律落 `user_id = LOCAL_USER_ID`（**常量 · 可 grep · 可迁移**）；
 * 绑定账号时按 AC-28④ 把这批行**改判为新用户**（`UPDATE ... SET user_id = <new>`）。
 *
 * 为什么必须是一个常量而不是 `NULL` / 空串 / 随机值：三者都**不可 grep、不可迁移**，
 * 且 `NULL` 在 SQL 里既不等于自己也不参与 `=` 比较 ⇒ 过滤条件静默失效（漏过滤 = 跨用户可见）。
 */
export const LOCAL_USER_ID = 'local';

/**
 * book 表列定义 —— **唯一来源**。
 * 新库建表（`SCHEMA_SQL`）与老库主键迁移（`packages/core/src/db/index.ts` 的
 * `migrateBookCompositeKey`）共用本常量，避免两处结构漂移。
 *
 * ★ `user_id` **NOT NULL 且无 DEFAULT**（`DEC-033` 定案）：给 DEFAULT 会让
 *   ① 漏写 `user_id` 的 `INSERT` 静默落进 `'local'`；② 漏过滤 `SELECT` 时仍能读到行
 *   ⇒ **双向隔离在 SQL 层同时失效**且无任何报错。无 DEFAULT 时，漏写列会直接抛
 *   `NOT NULL constraint failed: book.user_id`，把缺陷暴露在写入点。
 *   ⚠ 老库 `ALTER TABLE ADD COLUMN` **不能**加 NOT NULL（无默认值），故迁移路径先加可空列、
 *   再由主键重建把值补齐（`COALESCE(NULLIF(user_id,''), 'local')`，见 `migrateBookCompositeKey`）。
 */
export const BOOK_COLUMNS_SQL = `
  user_id          TEXT NOT NULL,
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

/**
 * book 表 DDL。
 * v0.10.0：主键由 `word` 升级为 **(word, lang)** —— 同一拼写在不同语言下是两条独立记录
 * （英文 `book` 与俄文 `book` 不再互相覆盖）。
 * v0.11.0（AC-27 / `DEC-033`）：再升级为 **(user_id, word, lang)** —— 同一用户之外的
 * 另一个人写同词同语言必须能**各存一行**。★ 只 `ALTER TABLE` 加列不能满足这一点
 * （旧主键仍要求 (word, lang) 全局唯一 ⇒ 两用户写同词同语言只剩 1 行，实测已复现）。
 */
export const BOOK_TABLE_SQL = `CREATE TABLE IF NOT EXISTS book (${BOOK_COLUMNS_SQL},
  PRIMARY KEY (user_id, word, lang)
);`;

/** zidiankaifa 词库模式（与 schema.sql 保持一致，供 node:sqlite 直接执行） */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS words (
  word        TEXT PRIMARY KEY,
  phonetic    TEXT,
  definition  TEXT,
  translation TEXT,
  pos         TEXT,
  collins     INTEGER,
  oxford      INTEGER,
  tag         TEXT,
  bnc         INTEGER,
  frq         INTEGER,
  exchange    TEXT,
  audio       TEXT
);
CREATE INDEX IF NOT EXISTS idx_words_tag ON words(tag);
CREATE INDEX IF NOT EXISTS idx_words_bnc ON words(bnc);
CREATE INDEX IF NOT EXISTS idx_words_frq ON words(frq);

CREATE TABLE IF NOT EXISTS word_forms (
  word      TEXT NOT NULL,
  form      TEXT NOT NULL,
  form_type TEXT NOT NULL,
  PRIMARY KEY (word, form, form_type)
);
CREATE INDEX IF NOT EXISTS idx_forms_form ON word_forms(form);

CREATE TABLE IF NOT EXISTS word_origins (
  word          TEXT PRIMARY KEY,
  origin        TEXT,
  origin_code   TEXT,
  lineage       TEXT,
  lineage_words TEXT,
  depth         INTEGER
);

CREATE TABLE IF NOT EXISTS word_etymology (
  word        TEXT PRIMARY KEY,
  lang        TEXT NOT NULL DEFAULT 'en',
  text_en     TEXT,
  text_zh     TEXT,
  chain       TEXT,
  origin      TEXT,
  origin_code TEXT,
  source      TEXT
);

CREATE TABLE IF NOT EXISTS words_i18n (
  word        TEXT NOT NULL,
  lang        TEXT NOT NULL,
  phonetic    TEXT,
  translation TEXT,
  definition  TEXT,
  pos         TEXT,
  forms       TEXT,
  audio       TEXT,
  source      TEXT,
  PRIMARY KEY (word, lang)
);
CREATE INDEX IF NOT EXISTS idx_i18n_translation ON words_i18n(translation);

CREATE TABLE IF NOT EXISTS i18n_forms (
  form  TEXT NOT NULL,
  word  TEXT NOT NULL,
  lang  TEXT NOT NULL,
  tags  TEXT,
  PRIMARY KEY (lang, form, word)
);
CREATE INDEX IF NOT EXISTS idx_i18n_forms_form ON i18n_forms(form);

CREATE TABLE IF NOT EXISTS morphemes (
  morpheme   TEXT PRIMARY KEY,
  lang       TEXT NOT NULL DEFAULT 'en',
  kind       TEXT NOT NULL,
  meaning_zh TEXT,
  meaning_en TEXT,
  origin     TEXT,
  examples   TEXT
);

CREATE TABLE IF NOT EXISTS book (
  user_id          TEXT NOT NULL,
  word             TEXT NOT NULL,
  lang             TEXT NOT NULL DEFAULT 'en',
  added_at         INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'new',
  note             TEXT,
  tags             TEXT NOT NULL DEFAULT '[]',
  review_count     INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted          INTEGER NOT NULL DEFAULT 0,
  -- v0.10.0：生词本按 (word, lang) 分离，同一拼写在不同语言下是两条独立记录
  -- v0.11.0（AC-27）：再按 user_id 分离 —— 不同用户写同词同语言必须各存一行
  PRIMARY KEY (user_id, word, lang)
);
-- ⚠ 不得在此处为 user_id 建索引：老库表已存在 ⇒ CREATE TABLE IF NOT EXISTS 被跳过
-- ⇒ 建索引时列不存在 ⇒ 启动抛 Error: no such column: user_id
-- （AC-27⑤ / DEC-033 第 4 条，T74 已实测复现）。新列索引必须单独 try/catch 建。
CREATE INDEX IF NOT EXISTS idx_book_updated ON book(updated_at);
`;
