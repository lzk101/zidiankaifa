-- zidiankaifa 词典数据库结构
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

-- 词形演变（双向：word->form 记录变形，form->word 反查原型）
CREATE TABLE IF NOT EXISTS word_forms (
  word      TEXT NOT NULL,
  form      TEXT NOT NULL,
  form_type TEXT NOT NULL,
  PRIMARY KEY (word, form, form_type)
);
CREATE INDEX IF NOT EXISTS idx_forms_form ON word_forms(form);

-- 词源分类
CREATE TABLE IF NOT EXISTS word_origins (
  word          TEXT PRIMARY KEY,
  origin        TEXT,
  origin_code   TEXT,
  lineage       TEXT,  -- JSON: ["英语","古法语","拉丁语"]（兼容旧字段）
  lineage_words TEXT,  -- JSON: [{"w":"abandon","l":"eng","lz":"英语"}, ...] 词级演变链
  depth         INTEGER
);

-- 词根词缀库
CREATE TABLE IF NOT EXISTS morphemes (
  morpheme  TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,      -- root / prefix / suffix
  meaning_zh TEXT,
  meaning_en TEXT,
  origin    TEXT,
  examples  TEXT                -- JSON: [..例词..]
);

-- 词源详解（wiktextract / Wiktionary）
CREATE TABLE IF NOT EXISTS word_etymology (
  word    TEXT PRIMARY KEY,
  text_en TEXT,        -- 英文词源原文
  text_zh TEXT,        -- 中文词源原文（zh 转储）
  chain   TEXT,        -- JSON: [{"lang":"frm","langZh":"古法语","word":"abandouner"}, ...] 结构化派生链
  origin  TEXT,        -- 最深层来源语言（中文名）
  origin_code TEXT,    -- 最深层来源语言代码
  source  TEXT         -- 'en' / 'zh' / 'en+zh'
);

-- 生词本（本地；同步服务端另有表）
CREATE TABLE IF NOT EXISTS book (
  word           TEXT PRIMARY KEY,
  added_at       INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'new',
  note           TEXT,
  tags           TEXT NOT NULL DEFAULT '[]',
  review_count   INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_book_updated ON book(updated_at);
