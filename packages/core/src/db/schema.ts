/**
 * book 表列定义 —— **唯一来源**。
 * 新库建表（`SCHEMA_SQL`）与老库主键迁移（`packages/core/src/db/index.ts` 的
 * `migrateBookCompositeKey`）共用本常量，避免两处结构漂移。
 */
export const BOOK_COLUMNS_SQL = `
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
 */
export const BOOK_TABLE_SQL = `CREATE TABLE IF NOT EXISTS book (${BOOK_COLUMNS_SQL},
  PRIMARY KEY (word, lang)
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
  PRIMARY KEY (word, lang)
);
CREATE INDEX IF NOT EXISTS idx_book_updated ON book(updated_at);
`;
