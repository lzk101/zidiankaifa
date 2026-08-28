/**
 * zidiankaifa 数据库访问层（node:sqlite，Node >= 22.13）
 * 供 Electron 主进程与同步服务共用；浏览器端不引用本模块。
 */
import { DatabaseSync } from 'node:sqlite';
import type {
  BookItem,
  BookStatus,
  BreakdownPart,
  Morpheme,
  MorphemeKind,
  SuggestItem,
  WordDetail,
  WordEntry,
  WordForm,
  WordOrigin,
} from '../types.js';
import { isCjk } from '../lang.js';
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
  depth: number | null;
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
}

/* ---------------- 打开 ---------------- */

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  return db;
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
  return {
    word: r.word,
    origin: r.origin ?? '未知',
    originCode: r.origin_code ?? '',
    lineage,
    depth: r.depth ?? 0,
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

export function lookupWord(db: DatabaseSync, rawWord: string): WordDetail | null {
  const word = normalizeWord(rawWord);
  if (!word) return null;
  let row = db.prepare('SELECT * FROM words WHERE word = ?').get(word) as unknown as WordRow | undefined;
  let matched = word;
  if (!row && isCjk(word)) {
    // 中文反查：取释义包含该词的第一个词条
    const like = `%${escapeLike(word)}%`;
    const r = db
      .prepare(
        "SELECT * FROM words WHERE translation LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc LIMIT 1"
      )
      .get(like, like) as unknown as WordRow | undefined;
    if (r) {
      row = r;
      matched = r.word;
    }
  }
  if (!row) return null;
  return {
    ...rowToEntry(row),
    forms: listForms(db, matched),
    origin: getOrigin(db, matched),
    breakdown: breakdownWord(db, matched),
    inBook: !!db.prepare('SELECT 1 FROM book WHERE word = ? AND deleted = 0').get(matched),
  };
}

export function suggest(db: DatabaseSync, rawQuery: string, limit = 20): SuggestItem[] {
  const q = normalizeWord(rawQuery);
  if (!q) return [];
  const lim = Math.min(Math.max(limit, 1), 50);
  if (isCjk(q)) {
    const like = `%${escapeLike(q)}%`;
    return db
      .prepare(
        "SELECT word, bnc, frq, tag FROM words WHERE translation LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc, word LIMIT ?"
      )
      .all(like, lim) as unknown as SuggestRow[];
  }
  return db
    .prepare(
      `SELECT word, bnc, frq, tag FROM words
       WHERE word >= ? AND word < ?
       ORDER BY (word = ?) DESC, (bnc IS NULL), bnc, word LIMIT ?`
    )
    .all(q, q + 'zzzz', q, lim) as unknown as SuggestRow[];
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
  const parts: BreakdownPart[] = [];
  const occupied: [number, number][] = [];
  const overlaps = (a: number, b: number) => occupied.some(([s, e]) => a < e && b > s);

  // 前缀：最长匹配在词首
  for (const p of prefixes) {
    const stem = p.morpheme.replace(/-+$/, '');
    if (stem && w.startsWith(stem)) {
      parts.push({ morpheme: p.morpheme, kind: 'prefix', meaningZh: p.meaningZh, origin: p.origin, start: 0, end: stem.length });
      occupied.push([0, stem.length]);
      break;
    }
  }
  // 后缀：最长匹配在词尾
  let suffixStart = w.length;
  for (const s of suffixes) {
    const stem = s.morpheme.replace(/^-+/, '');
    if (stem && w.endsWith(stem) && w.length - stem.length >= 2) {
      const start = w.length - stem.length;
      parts.push({ morpheme: s.morpheme, kind: 'suffix', meaningZh: s.meaningZh, origin: s.origin, start, end: w.length });
      occupied.push([start, w.length]);
      suffixStart = start;
      break;
    }
  }
  // 词根：中间段最长优先、不重叠
  for (const r of roots) {
    const stem = r.morpheme.replace(/^-+|-+$/g, '');
    if (!stem || stem.length < 2) continue;
    let idx = 0;
    while (idx <= w.length - stem.length) {
      const at = w.indexOf(stem, idx);
      if (at < 0) break;
      const start = at;
      const end = at + stem.length;
      // 左侧未覆盖段恰为 1 个字符时视为噪声（如 run -> r|un），跳过
      const prevEnd = occupied
        .filter(([, e]) => e <= start)
        .sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0;
      if (start - prevEnd === 1) {
        idx = at + 1;
        continue;
      }
      if (end <= suffixStart && !overlaps(start, end)) {
        parts.push({ morpheme: r.morpheme, kind: 'root', meaningZh: r.meaningZh, origin: r.origin, start, end });
        occupied.push([start, end]);
        break;
      }
      idx = at + 1;
    }
    if (parts.length >= 6) break;
  }
  return parts.sort((a, b) => a.start - b.start);
}

/* ---------------- 生词本 ---------------- */

const BOOK_INSERT =
  'INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted) VALUES (?,?,?,?,?,?,?,?,?)';

function upsertBook(db: DatabaseSync, it: BookItem): void {
  db.prepare(
    `${BOOK_INSERT}
     ON CONFLICT(word) DO UPDATE SET
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

export function bookAdd(db: DatabaseSync, word: string, tags: string[] = []): BookItem {
  const w = normalizeWord(word);
  const now = Date.now();
  upsertBook(db, {
    word: w,
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

/* ---------------- 词频排行工具 ---------------- */

export function topFrequent(db: DatabaseSync, limit = 50): WordEntry[] {
  const rows = db
    .prepare('SELECT * FROM words WHERE bnc IS NOT NULL ORDER BY bnc LIMIT ?')
    .all(limit) as unknown as WordRow[];
  return rows.map(rowToEntry);
}
