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
  lang      TEXT NOT NULL DEFAULT 'en',  -- en / ru（词素所属语言）
  kind      TEXT NOT NULL,      -- root / prefix / suffix
  meaning_zh TEXT,
  meaning_en TEXT,
  origin    TEXT,
  examples  TEXT                -- JSON: [..例词..]
);

-- 词源详解（wiktextract / Wiktionary）
CREATE TABLE IF NOT EXISTS word_etymology (
  word    TEXT PRIMARY KEY,
  lang    TEXT NOT NULL DEFAULT 'en',  -- en / ru（词源所属语言）
  text_en TEXT,        -- 英文词源原文
  text_zh TEXT,        -- 中文词源原文（zh 转储）
  chain   TEXT,        -- JSON: [{"lang":"frm","langZh":"古法语","word":"abandouner"}, ...] 结构化派生链
  origin  TEXT,        -- 最深层来源语言（中文名）
  origin_code TEXT,    -- 最深层来源语言代码
  source  TEXT         -- 'en' / 'zh' / 'en+zh'
);

-- 多语言词条（俄语等，lang 代码见 i18n_langs）
CREATE TABLE IF NOT EXISTS words_i18n (
  word        TEXT NOT NULL,
  lang        TEXT NOT NULL,       -- 'ru' 等
  phonetic    TEXT,                -- IPA
  translation TEXT,                -- 中文释义（繁体已转简体）
  definition  TEXT,                -- 其他语言释义（可选）
  pos         TEXT,
  forms       TEXT,                -- JSON: [{"form":"вода́","tags":["genitive"]}, ...]
  audio       TEXT,                -- mp3_url
  source      TEXT,                -- 'zh' / 'ru' 等
  PRIMARY KEY (word, lang)
);
CREATE INDEX IF NOT EXISTS idx_i18n_translation ON words_i18n(translation);

-- 多语言词形索引（变格/变位反查：输入词形 → 原型）
CREATE TABLE IF NOT EXISTS i18n_forms (
  form  TEXT NOT NULL,
  word  TEXT NOT NULL,
  lang  TEXT NOT NULL,
  tags  TEXT,                      -- JSON 标签数组
  PRIMARY KEY (lang, form, word)
);
CREATE INDEX IF NOT EXISTS idx_i18n_forms_form ON i18n_forms(form);

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
