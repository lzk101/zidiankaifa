/**
 * zidiankaifa 数据库访问层（node:sqlite，Node >= 22.13）
 * 供 Electron 主进程与同步服务共用；浏览器端不引用本模块。
 */
import { DatabaseSync } from 'node:sqlite';
import type {
  BookItem,
  BookStatus,
  BreakdownPart,
  EtymologyStep,
  I18nForm,
  I18nWord,
  LangMode,
  Morpheme,
  MorphemeGroup,
  MorphemeKind,
  OriginStep,
  SuggestItem,
  WordDetail,
  WordEntry,
  WordEtymology,
  WordForm,
  WordOrigin,
} from '../types.js';
import { isCjk, isCyrillic, I18N_LANG_NAME } from '../lang.js';
import { groupBookByMorphemeData } from '../graph.js';
import { SCHEMA_SQL } from './schema.js';

export { SCHEMA_SQL };

/* ---------------- 行类型（snake_case，来自 SQLite） ---------------- */

interface WordRow {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  collins: number | null;
  oxford: number | null;
  tag: string | null;
  bnc: number | null;
  frq: number | null;
  exchange: string | null;
  audio: string | null;
}

interface OriginRow {
  word: string;
  origin: string | null;
  origin_code: string | null;
  lineage: string | null;
  lineage_words: string | null;
  depth: number | null;
}

interface EtymologyRow {
  word: string;
  text_en: string | null;
  text_zh: string | null;
  chain: string | null;
  origin: string | null;
  origin_code: string | null;
  source: string | null;
}

interface I18nRow {
  word: string;
  lang: string;
  phonetic: string | null;
  translation: string | null;
  definition: string | null;
  pos: string | null;
  forms: string | null;
  audio: string | null;
  source: string | null;
}

interface I18nFormRow {
  form: string;
  word: string;
  tags: string | null;
}

interface FormRow {
  word: string;
  form: string;
  form_type: string;
}

interface MorphemeRow {
  morpheme: string;
  kind: string;
  meaning_zh: string | null;
  meaning_en: string | null;
  origin: string | null;
  examples: string | null;
}

interface BookRow {
  word: string;
  lang: string | null;
  added_at: number;
  updated_at: number;
  status: string;
  note: string | null;
  tags: string;
  review_count: number;
  last_reviewed_at: number | null;
  deleted: number;
}

interface SuggestRow {
  word: string;
  bnc: number | null;
  frq: number | null;
  tag: string | null;
  lang: string | null;
}

/* ---------------- 打开 ---------------- */

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  migrateBookLang(db);
  return db;
}

/** 老库迁移：book 表补 lang 列（默认 'en'） */
function migrateBookLang(db: DatabaseSync): void {
  try {
    const cols = db.prepare('PRAGMA table_info(book)').all() as unknown as {
      name: string;
    }[];
    if (cols.some((c) => c.name === 'lang')) return;
    db.exec("ALTER TABLE book ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
  } catch {
    /* 表不存在或已迁移则忽略 */
  }
}

export function countWords(db: DatabaseSync): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM words').get() as unknown as { n: number };
  return Number(r.n);
}

/* ---------------- 转换 ---------------- */

function rowToEntry(r: WordRow): WordEntry {
  return {
    word: r.word,
    phonetic: r.phonetic,
    definition: r.definition,
    translation: r.translation,
    pos: r.pos,
    collins: r.collins,
    oxford: r.oxford,
    tag: r.tag,
    bnc: r.bnc,
    frq: r.frq,
    exchange: r.exchange,
    audio: r.audio,
  };
}

function rowToOrigin(r: OriginRow): WordOrigin {
  let lineage: string[] = [];
  try {
    const p = JSON.parse(r.lineage ?? '[]');
    if (Array.isArray(p)) lineage = p.map(String);
  } catch {
    /* ignore */
  }
  let lineageWords: OriginStep[] = [];
  try {
    const p = JSON.parse(r.lineage_words ?? '[]');
    if (Array.isArray(p)) {
      lineageWords = p
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          w: String(s.w ?? ''),
          l: String(s.l ?? ''),
          lz: String(s.lz ?? s.l ?? ''),
        }));
    }
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    origin: r.origin ?? '未知',
    originCode: r.origin_code ?? '',
    lineage,
    lineageWords,
    depth: r.depth ?? 0,
  };
}

function rowToEtymology(r: EtymologyRow): WordEtymology {
  let chain: EtymologyStep[] = [];
  try {
    const p = JSON.parse(r.chain ?? '[]');
    if (Array.isArray(p)) {
      chain = p
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          lang: String(s.lang ?? ''),
          langZh: String(s.langZh ?? s.lang ?? ''),
          word: s.word ? String(s.word) : null,
          parts: Array.isArray(s.parts) ? s.parts.map(String) : undefined,
          kind: s.kind ? String(s.kind) : undefined,
        }));
    }
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    textEn: r.text_en,
    textZh: r.text_zh,
    chain,
    origin: r.origin,
    originCode: r.origin_code,
    source: r.source,
  };
}

function rowToBook(r: BookRow): BookItem {
  let tags: string[] = [];
  try {
    const p = JSON.parse(r.tags);
    if (Array.isArray(p)) tags = p.map(String);
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    lang: r.lang ?? 'en',
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    status: (r.status as BookStatus) || 'new',
    note: r.note,
    tags,
    reviewCount: r.review_count,
    lastReviewedAt: r.last_reviewed_at,
    deleted: r.deleted === 1,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function normalizeWord(w: string): string {
  return w.trim().toLowerCase();
}

/* ---------------- 查词 ---------------- */

export function listForms(db: DatabaseSync, word: string): WordForm[] {
  const rows = db
    .prepare('SELECT form, form_type FROM word_forms WHERE word = ? ORDER BY form')
    .all(word) as unknown as FormRow[];
  return rows.map((r) => ({ form: r.form, type: r.form_type as WordForm['type'] }));
}

export function getOrigin(db: DatabaseSync, word: string): WordOrigin | null {
  const r = db.prepare('SELECT * FROM word_origins WHERE word = ?').get(word) as unknown as OriginRow | undefined;
  return r ? rowToOrigin(r) : null;
}

export function getEtymology(db: DatabaseSync, word: string): WordEtymology | null {
  const r = db.prepare('SELECT * FROM word_etymology WHERE word = ?').get(word) as unknown as EtymologyRow | undefined;
  return r ? rowToEtymology(r) : null;
}

/* ---------------- 多语言词条（俄语等） ---------------- */

function rowToI18n(r: I18nRow, matchedForm: I18nWord['matchedForm']): I18nWord {
  let forms: I18nForm[] = [];
  try {
    const p = JSON.parse(r.forms ?? '[]');
    if (Array.isArray(p)) {
      forms = p
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          form: String(s.form ?? ''),
          display: String(s.display ?? s.form ?? ''),
          tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
        }));
    }
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    lang: r.lang,
    langName: I18N_LANG_NAME[r.lang] ?? r.lang,
    phonetic: r.phonetic,
    translation: r.translation,
    definition: r.definition,
    pos: r.pos,
    forms,
    audio: r.audio,
    matchedForm,
  };
}

export function getI18n(db: DatabaseSync, word: string, lang = 'ru'): I18nWord | null {
  const r = db
    .prepare('SELECT * FROM words_i18n WHERE word = ? AND lang = ?')
    .get(normalizeWord(word), lang) as unknown as I18nRow | undefined;
  return r ? rowToI18n(r, null) : null;
}

function lookupI18n(db: DatabaseSync, word: string, lang: string): WordDetail | null {
  // 优先直接词条；无词条时再词形反查（столом → стол）
  const direct = getI18n(db, word, lang);
  if (direct) return i18nToDetail(direct);
  const fr = db
    .prepare('SELECT word, tags FROM i18n_forms WHERE form = ? AND lang = ?')
    .get(word, lang) as unknown as I18nFormRow | undefined;
  if (fr) {
    const base = getI18n(db, fr.word, lang);
    if (base) {
      let tags: string[] = [];
      try {
        const p = JSON.parse(fr.tags ?? '[]');
        if (Array.isArray(p)) tags = p.map(String);
      } catch {
        /* ignore */
      }
      const withForm: I18nWord = { ...base, matchedForm: { form: word, display: word, tags } };
      return i18nToDetail(withForm);
    }
  }
  return null;
}

function i18nToDetail(i: I18nWord): WordDetail {
  return {
    word: i.word,
    phonetic: i.phonetic,
    definition: i.definition,
    translation: i.translation,
    pos: i.pos,
    collins: null,
    oxford: null,
    tag: null,
    bnc: null,
    frq: null,
    exchange: null,
    audio: i.audio,
    forms: [],
    origin: null,
    etymology: null,
    breakdown: [],
    inBook: false,
    i18n: i,
  };
}

/** 查词：lang='auto'（默认）按输入脚本自动识别；'en'/'ru' 强制指定语言 */
export function lookupWord(
  db: DatabaseSync,
  rawWord: string,
  opts?: { lang?: LangMode | string },
): WordDetail | null {
  const word = normalizeWord(rawWord);
  if (!word) return null;
  const lang = opts?.lang ?? 'auto';

  if (lang === 'ru') {
    // 强制俄语：直接词条或词形反查；未命中则放弃（不回落英语，避免混用）
    return lookupI18n(db, word, 'ru');
  }

  // 西里尔输入（auto）→ 俄语词条（先词形反查）
  if (lang !== 'en' && isCyrillic(word)) {
    const ru = lookupI18n(db, word, 'ru');
    if (ru) return ru;
  }

  let row = db.prepare('SELECT * FROM words WHERE word = ?').get(word) as unknown as WordRow | undefined;
  let matched = word;
  if (!row && isCjk(word)) {
    // 中文反查：英文释义 + 俄语释义
    const like = `%${escapeLike(word)}%`;
    const r = db
      .prepare(
        "SELECT * FROM words WHERE translation LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc LIMIT 1"
      )
      .get(like, like) as unknown as WordRow | undefined;
    if (r) {
      row = r;
      matched = r.word;
    } else {
      const ruRow = db
        .prepare("SELECT word, lang FROM words_i18n WHERE translation LIKE ? ESCAPE '\\' LIMIT 1")
        .get(like) as unknown as { word: string; lang: string } | undefined;
      if (ruRow) {
        const ru = lookupI18n(db, ruRow.word, ruRow.lang);
        if (ru) return ru;
      }
    }
  }
  if (!row) return null;
  return {
    ...rowToEntry(row),
    forms: listForms(db, matched),
    origin: getOrigin(db, matched),
    etymology: getEtymology(db, matched),
    breakdown: breakdownWord(db, matched),
    inBook: !!db.prepare('SELECT 1 FROM book WHERE word = ? AND deleted = 0').get(matched),
    i18n: null,
  };
}

export function suggest(db: DatabaseSync, rawQuery: string, limit = 20): SuggestItem[] {
  const q = normalizeWord(rawQuery);
  if (!q) return [];
  const lim = Math.min(Math.max(limit, 1), 50);
  const toItems = (rows: SuggestRow[]): SuggestItem[] =>
    rows.map((r) => ({
      word: r.word,
      bnc: r.bnc,
      frq: r.frq,
      tag: r.tag,
      lang: r.lang ?? undefined,
    }));
  // 西里尔前缀 → 俄语词条
  if (isCyrillic(q)) {
    return toItems(
      db
        .prepare(
          `SELECT word, NULL AS bnc, NULL AS frq, 'ru' AS tag, 'ru' AS lang FROM words_i18n
           WHERE word >= ? AND word < ?
           ORDER BY word LIMIT ?`
        )
        .all(q, q + 'яяя', lim) as unknown as SuggestRow[],
    );
  }
  if (isCjk(q)) {
    const like = `%${escapeLike(q)}%`;
    const en = db
      .prepare(
        "SELECT word, bnc, frq, tag, 'en' AS lang FROM words WHERE translation LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc, word LIMIT ?"
      )
      .all(like, lim) as unknown as SuggestRow[];
    const ru = db
      .prepare(
        "SELECT word, NULL AS bnc, NULL AS frq, 'ru' AS tag, 'ru' AS lang FROM words_i18n WHERE translation LIKE ? ESCAPE '\\' ORDER BY word LIMIT ?"
      )
      .all(like, lim) as unknown as SuggestRow[];
    // 英俄交错返回，保证中文反查时两种语言都可见（双语言分区）
    const mixed: SuggestRow[] = [];
    const n = Math.max(en.length, ru.length);
    for (let i = 0; i < n && mixed.length < lim; i += 1) {
      if (en[i]) mixed.push(en[i]);
      if (ru[i]) mixed.push(ru[i]);
    }
    return toItems(mixed).slice(0, lim);
  }
  return toItems(
    db
      .prepare(
        `SELECT word, bnc, frq, tag, 'en' AS lang FROM words
         WHERE word >= ? AND word < ?
         ORDER BY (word = ?) DESC, (bnc IS NULL), bnc, word LIMIT ?`
      )
      .all(q, q + 'zzzz', q, lim) as unknown as SuggestRow[],
  );
}

/* ---------------- 词根词缀拆解 ---------------- */

let morphemeCache: { prefixes: Morpheme[]; suffixes: Morpheme[]; roots: Morpheme[] } | null = null;

function loadMorphemes(db: DatabaseSync) {
  if (morphemeCache) return morphemeCache;
  const rows = db
    .prepare('SELECT morpheme, kind, meaning_zh, meaning_en, origin, examples FROM morphemes')
    .all() as unknown as MorphemeRow[];
  const list: Morpheme[] = rows.map((r) => ({
    morpheme: r.morpheme,
    kind: r.kind as MorphemeKind,
    meaningZh: r.meaning_zh ?? '',
    meaningEn: r.meaning_en,
    origin: r.origin,
    examples: safeJsonArray(r.examples),
  }));
  const byKind = (k: MorphemeKind) => list.filter((m) => m.kind === k).sort((a, b) => b.morpheme.length - a.morpheme.length);
  morphemeCache = { prefixes: byKind('prefix'), suffixes: byKind('suffix'), roots: byKind('root') };
  return morphemeCache;
}

function safeJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export function breakdownWord(db: DatabaseSync, rawWord: string): BreakdownPart[] {
  const w = normalizeWord(rawWord);
  if (w.length < 2) return [];
  const { prefixes, suffixes, roots } = loadMorphemes(db);
  // 词素原文（morpheme 字段）→ 匹配用的词干（去掉首尾连字符）
  const all = [...prefixes, ...suffixes, ...roots].map((m) => ({
    m,
    stem: m.morpheme.replace(/^-+|-+$/g, ''),
  }));

  const parts: BreakdownPart[] = [];
  const occupied: [number, number][] = [];
  let pos = 0;

  const prevEnd = (at: number): number =>
    occupied
      .filter(([, e]) => e <= at)
      .reduce((mx, [, e]) => Math.max(mx, e), 0);

  while (pos < w.length && parts.length < 8) {
    // 词头 1-字符间隙视为噪声（如 run -> r|un），跳过；
    // 词中 1-字符间隙（如 phot|o|graph 的 o）允许，避免拆解半途而废
    if (pos - prevEnd(pos) === 1 && prevEnd(pos) === 0) {
      pos += 1;
      continue;
    }
    // 当前位置取【最长】匹配词素（词根/前缀/后缀一体比较，bio 优先于 bi）
    let best: { m: Morpheme; stem: string } | null = null;
    for (const { m, stem } of all) {
      if (!stem || stem.length < 2) continue;
      if (w.startsWith(stem, pos)) {
        if (!best || stem.length > best.stem.length) best = { m, stem };
      }
    }
    if (!best) {
      pos += 1;
      continue;
    }
    const end = pos + best.stem.length;
    // 与已占用区间重叠则放弃该候选（如 telephone 的 -one 后缀与 phon 冲突）
    if (occupied.some(([s, e]) => pos < e && end > s)) {
      pos += 1;
      continue;
    }
    parts.push({
      morpheme: best.m.morpheme,
      kind: best.m.kind,
      meaningZh: best.m.meaningZh,
      origin: best.m.origin,
      start: pos,
      end,
      examples: best.m.examples?.length ? best.m.examples : undefined,
    });
    occupied.push([pos, end]);
    pos = end;
  }
  return parts.sort((a, b) => a.start - b.start);
}

/* ---------------- 生词本 ---------------- */

const BOOK_INSERT =
  'INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?)';

function upsertBook(db: DatabaseSync, it: BookItem): void {
  db.prepare(
    `${BOOK_INSERT}
     ON CONFLICT(word) DO UPDATE SET
       lang = excluded.lang,
       added_at = excluded.added_at,
       updated_at = excluded.updated_at,
       status = excluded.status,
       note = excluded.note,
       tags = excluded.tags,
       review_count = excluded.review_count,
       last_reviewed_at = excluded.last_reviewed_at,
       deleted = excluded.deleted`
  ).run(
    it.word,
    it.lang ?? 'en',
    it.addedAt,
    it.updatedAt,
    it.status,
    it.note,
    JSON.stringify(it.tags ?? []),
    it.reviewCount ?? 0,
    it.lastReviewedAt ?? null,
    it.deleted ? 1 : 0
  );
}

export function bookGet(db: DatabaseSync, word: string): BookItem | null {
  const r = db.prepare('SELECT * FROM book WHERE word = ?').get(normalizeWord(word)) as unknown as BookRow | undefined;
  return r ? rowToBook(r) : null;
}

export function bookList(db: DatabaseSync): BookItem[] {
  const rows = db
    .prepare('SELECT * FROM book WHERE deleted = 0 ORDER BY updated_at DESC')
    .all() as unknown as BookRow[];
  return rows.map(rowToBook);
}

/** 含墓碑（deleted）的全部记录，用于同步 */
export function bookListAll(db: DatabaseSync): BookItem[] {
  const rows = db.prepare('SELECT * FROM book ORDER BY updated_at DESC').all() as unknown as BookRow[];
  return rows.map(rowToBook);
}

export function bookAdd(db: DatabaseSync, word: string, tags: string[] = [], lang = 'en'): BookItem {
  const w = normalizeWord(word);
  const now = Date.now();
  upsertBook(db, {
    word: w,
    lang,
    addedAt: now,
    updatedAt: now,
    status: 'new',
    note: null,
    tags,
    reviewCount: 0,
    lastReviewedAt: null,
  });
  return bookGet(db, w)!;
}

export function bookRemove(db: DatabaseSync, word: string): void {
  const w = normalizeWord(word);
  const now = Date.now();
  const existing = bookGet(db, w);
  upsertBook(db, {
    word: w,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    status: existing?.status ?? 'new',
    note: existing?.note ?? null,
    tags: existing?.tags ?? [],
    reviewCount: existing?.reviewCount ?? 0,
    lastReviewedAt: existing?.lastReviewedAt ?? null,
    deleted: true,
  });
}

export function bookUpdate(db: DatabaseSync, item: BookItem): BookItem {
  const w = normalizeWord(item.word);
  const it: BookItem = { ...item, word: w, updatedAt: Date.now() };
  upsertBook(db, it);
  return bookGet(db, w)!;
}

/** 跨端同步合并（last-write-wins），返回合并后的全量记录（含墓碑） */
export function syncMerge(db: DatabaseSync, items: BookItem[]): { pushed: number; pulled: number; items: BookItem[] } {
  let pushed = 0;
  for (const it of items) {
    const cur = db.prepare('SELECT updated_at FROM book WHERE word = ?').get(normalizeWord(it.word)) as unknown as
      | { updated_at: number }
      | undefined;
    if (!cur || it.updatedAt > cur.updated_at) {
      upsertBook(db, it);
      pushed++;
    }
  }
  const all = bookListAll(db);
  return { pushed, pulled: all.length, items: all };
}

/* ---------------- 生词本 × 词根分组（知识图谱数据层） ---------------- */

/** 把生词按命中的词根/词缀分组（词频排序：命中词多的词素靠前） */
export function groupBookByMorpheme(db: DatabaseSync, items: BookItem[]): MorphemeGroup[] {
  return groupBookByMorphemeData(items, (w) => breakdownWord(db, w));
}

/* ---------------- 词频排行工具 ---------------- */

export function topFrequent(db: DatabaseSync, limit = 50): WordEntry[] {
  const rows = db
    .prepare('SELECT * FROM words WHERE bnc IS NOT NULL ORDER BY bnc LIMIT ?')
    .all(limit) as unknown as WordRow[];
  return rows.map(rowToEntry);
}
