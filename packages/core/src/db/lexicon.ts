/**
 * 词根表 / 词缀表 / 词表 查询层
 *
 * 对应需求：「将单词表分成英语的和俄语的，填加词根表和词缀表」
 *   - roots   词根表（英语 / 俄语分表查询）
 *   - affixes 词缀表（前缀 / 后缀）
 *   - words_en / words_ru 视图：单词表按语言分离
 *
 * 数据由 packages/data-pipeline/build_roots_tables.mjs 生成（基于真实拆解建立的关联词）。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { LexiconEntry, LexiconKind, LexiconPage, LexiconQueryOptions, MorphemeKind, WordListPage } from '../types.js';

interface Row {
  morpheme: string;
  lang: string;
  kind?: string;
  meaning_zh: string | null;
  meaning_en: string | null;
  origin: string | null;
  examples: string | null;
  word_count: number;
  words: string | null;
}

function safeArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

function toEntry(r: Row, fallbackKind: MorphemeKind): LexiconEntry {
  return {
    morpheme: r.morpheme,
    kind: (r.kind as MorphemeKind) ?? fallbackKind,
    lang: r.lang,
    meaningZh: r.meaning_zh ?? '',
    meaningEn: r.meaning_en ?? undefined,
    origin: r.origin ?? undefined,
    examples: safeArray(r.examples),
    wordCount: Number(r.word_count) || 0,
    words: safeArray(r.words),
  };
}

/** 语言模式：'auto' 时按查询串脚本判定（西里尔→ru，其余→en） */
function resolveLang(query: string | undefined, lang: string): string {
  if (lang === 'ru' || lang === 'en') return lang;
  if (query && /[\u0400-\u04FF]/.test(query)) return 'ru';
  return 'en';
}

export interface LexiconQuery extends LexiconQueryOptions {}

/**
 * 词根表 / 词缀表 列表查询。
 * kind='root' 查 roots 表；'prefix' / 'suffix' / 'all' 查 affixes 表（all = affixes 全量）。
 */
export function listLexicon(db: DatabaseSync, opts: LexiconQuery = {}): LexiconPage {
  const kind: LexiconKind = opts.kind ?? 'root';
  const lang = resolveLang(opts.query, opts.lang ?? 'en');
  const limit = Math.max(1, Math.min(500, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  const sort = opts.sort ?? 'words';
  const onlyLinked = opts.onlyLinked !== false;

  const isRoot = kind === 'root';
  const table = isRoot ? 'roots' : 'affixes';
  const where: string[] = ['lang = ?'];
  const args: (string | number)[] = [lang];
  if (!isRoot && kind !== 'all') {
    where.push('kind = ?');
    args.push(kind);
  }
  if (opts.query) {
    where.push('(morpheme LIKE ? OR meaning_zh LIKE ? OR meaning_en LIKE ?)');
    const like = `%${opts.query}%`;
    args.push(like, like, like);
  }
  if (onlyLinked) where.push('word_count > 0');
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const orderSql = sort === 'alpha' ? 'ORDER BY morpheme ASC' : 'ORDER BY word_count DESC, LENGTH(morpheme) ASC, morpheme ASC';
  const total = Number((db.prepare(`SELECT COUNT(1) AS c FROM ${table} ${whereSql}`).get(...args) as { c: number }).c);
  const rows = db.prepare(`SELECT * FROM ${table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as Row[];
  return { total, lang, kind, items: rows.map((r) => toEntry(r, isRoot ? 'root' : 'prefix')) };
}

/** 单个词素详情（含全部关联词） */
export function getLexiconEntry(db: DatabaseSync, morpheme: string, lang = 'en'): LexiconEntry | null {
  const bare = morpheme.replace(/^[-*]+|[-*]+$/g, '');
  const rows = db
    .prepare('SELECT * FROM roots WHERE lang = ? AND (morpheme = ? OR LOWER(morpheme) = LOWER(?))')
    .all(lang, morpheme, morpheme) as unknown as Row[];
  const root = rows[0];
  if (root) return toEntry(root, 'root');
  const affixRows = db
    .prepare('SELECT * FROM affixes WHERE lang = ? AND (morpheme = ? OR morpheme = ? OR morpheme = ? OR morpheme = ?)')
    .all(lang, morpheme, `${bare}-`, `-${bare}`, `${bare}`) as unknown as Row[];
  const affix = affixRows[0];
  return affix ? toEntry(affix, 'suffix') : null;
}

/** 词素总览统计（词根/前缀/后缀 各多少、关联词总量） */
export function lexiconStats(db: DatabaseSync): {
  roots: Record<string, { count: number; words: number }>;
  affixes: Record<string, { count: number; words: number }>;
} {
  const out = { roots: {} as Record<string, { count: number; words: number }>, affixes: {} as Record<string, { count: number; words: number }> };
  for (const lang of ['en', 'ru']) {
    const r = db.prepare('SELECT COUNT(1) AS c, SUM(word_count) AS w FROM roots WHERE lang = ?').get(lang) as { c: number; w: number | null };
    out.roots[lang] = { count: Number(r.c) || 0, words: Number(r.w) || 0 };
    for (const kind of ['prefix', 'suffix']) {
      const a = db.prepare('SELECT COUNT(1) AS c, SUM(word_count) AS w FROM affixes WHERE lang = ? AND kind = ?').get(lang, kind) as { c: number; w: number | null };
      out.affixes[`${lang}:${kind}`] = { count: Number(a.c) || 0, words: Number(a.w) || 0 };
    }
  }
  return out;
}

/** 单词表（按语言分离：en 走 words 表，ru 走 words_i18n） */
export function listWords(db: DatabaseSync, lang: string, opts: { query?: string; limit?: number; offset?: number } = {}): WordListPage {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  if (lang === 'ru') {
    const where = opts.query ? 'WHERE lang = ? AND word LIKE ?' : 'WHERE lang = ?';
    const args: (string | number)[] = opts.query ? ['ru', `${opts.query}%`] : ['ru'];
    const total = Number((db.prepare(`SELECT COUNT(1) AS c FROM words_i18n ${where}`).get(...args) as { c: number }).c);
    const rows = db.prepare(`SELECT word, phonetic, translation AS gloss, pos FROM words_i18n ${where} ORDER BY word LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as { word: string; phonetic: string | null; gloss: string | null; pos: string | null }[];
    return { total, lang, items: rows.map((r) => ({ word: r.word, phonetic: r.phonetic ?? undefined, gloss: r.gloss ?? undefined, pos: r.pos ?? undefined })) };
  }
  const where = opts.query ? 'WHERE word LIKE ?' : '';
  const args: (string | number)[] = opts.query ? [`${opts.query}%`] : [];
  const total = Number((db.prepare(`SELECT COUNT(1) AS c FROM words ${where}`).get(...args) as { c: number }).c);
  const rows = db.prepare(`SELECT word, phonetic, translation AS gloss, pos FROM words ${where} ORDER BY word LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as { word: string; phonetic: string | null; gloss: string | null; pos: string | null }[];
  return { total, lang, items: rows.map((r) => ({ word: r.word, phonetic: r.phonetic ?? undefined, gloss: r.gloss ?? undefined, pos: r.pos ?? undefined })) };
}

/** 反查：哪些词素能拆出这个词（词 → 词根词缀）—— 查词页「词素可点击」的数据来源 */
export function morphemesOf(db: DatabaseSync, word: string, lang = 'en'): LexiconEntry[] {
  const lower = word.toLowerCase();
  const out: LexiconEntry[] = [];
  for (const table of ['roots', 'affixes']) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE lang = ? AND words LIKE ? LIMIT 20`).all(lang, `%"${word}"%`) as unknown as Row[];
    for (const r of rows) out.push(toEntry(r, table === 'roots' ? 'root' : 'suffix'));
    void lower;
  }
  return out;
}
