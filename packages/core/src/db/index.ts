/**
 * zidiankaifa 数据库访问层（node:sqlite，Node >= 22.13）
 * 供 Electron 主进程与同步服务共用；浏览器端不引用本模块。
 */
export * from './lexicon.js';

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
  migrateAddColumn(db, 'word_etymology', 'lang', "ALTER TABLE word_etymology ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
  migrateAddColumn(db, 'morphemes', 'lang', "ALTER TABLE morphemes ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
  return db;
}

/** 老库迁移：book 表补 lang 列（默认 'en'） */
function migrateBookLang(db: DatabaseSync): void {
  migrateAddColumn(db, 'book', 'lang', "ALTER TABLE book ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
}

/** 通用列迁移：列不存在则 ALTER TABLE ADD COLUMN */
function migrateAddColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name: string;
    }[];
    if (cols.some((c) => c.name === column)) return;
    db.exec(ddl);
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

/**
 * 大小写宽容候选：原词形优先 → 全小写 → 首字母大写。
 * 俄语专名（Китай/Москва）在词源表里按原词形存储，而查询侧常被小写化；
 * SQLite 的 COLLATE NOCASE 只折叠 ASCII，对西里尔字母无效，故在查询层手工兜底。
 */
function caseVariants(word: string): string[] {
  const w = word.trim();
  if (!w) return [];
  const out = [w];
  const lower = w.toLowerCase();
  if (!out.includes(lower)) out.push(lower);
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (!out.includes(cap)) out.push(cap);
  return out;
}

/** 按候选词形依次查一行；命中即返回 */
function getByVariants<T>(
  db: DatabaseSync,
  sql: string,
  word: string,
  rest: (string | number)[] = [],
): T | undefined {
  const stmt = db.prepare(sql);
  for (const v of caseVariants(word)) {
    const r = stmt.get(v, ...rest) as unknown as T | undefined;
    if (r) return r;
  }
  return undefined;
}

/* ---------------- 查词 ---------------- */

export function listForms(db: DatabaseSync, word: string): WordForm[] {
  const rows = db
    .prepare('SELECT form, form_type FROM word_forms WHERE word = ? ORDER BY form')
    .all(word) as unknown as FormRow[];
  return rows.map((r) => ({ form: r.form, type: r.form_type as WordForm['type'] }));
}

export function getOrigin(db: DatabaseSync, word: string): WordOrigin | null {
  const r = getByVariants<OriginRow>(db, 'SELECT * FROM word_origins WHERE word = ?', word);
  return r ? rowToOrigin(r) : null;
}

export function getEtymology(db: DatabaseSync, word: string, lang = 'en'): WordEtymology | null {
  const r = getByVariants<EtymologyRow>(
    db,
    'SELECT * FROM word_etymology WHERE word = ? AND lang = ?',
    word,
    [lang],
  );
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

/**
 * 是否为「纯屈折说明」释义：zh 转储给变格形也建了词条，其释义只是「X 的属格单数」这类说明。
 * 「在家；дом (dom) 的属格单数」不算（含实质释义），「фра́нций (fráncij) 的属格单数」算。
 */
function isInflectionOnlyGloss(text: string | null): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const parts = t.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /的[^，。；]{0,8}(格|数|时|式|体)/.test(p));
}

export function getI18n(db: DatabaseSync, word: string, lang = 'ru'): I18nWord | null {
  const stmt = db.prepare('SELECT * FROM words_i18n WHERE word = ? AND lang = ?');
  const rows: I18nRow[] = [];
  for (const v of caseVariants(word)) {
    const r = stmt.get(v, lang) as unknown as I18nRow | undefined;
    if (r) rows.push(r);
  }
  if (!rows.length) return null;
  // 大小写变体同时存在时优先取有实质释义的词条（Франция「法国」优于 франция「франций 的属格单数」）
  const pick = rows.find((r) => !isInflectionOnlyGloss(r.translation)) ?? rows[0];
  return rowToI18n(pick, null);
}

function lookupI18n(db: DatabaseSync, word: string, lang: string): WordDetail | null {
  const direct = getI18n(db, word, lang);
  // 1) 词形反查优先：命中即返回主词条（含完整变格表）+ 词形标注（столом → стол[instrumental,singular]）。
  //    zh 转储会把变格形也建成独立词条（столом 有词条，甚至带 forms，但那是屈折形而非主词条），
  //    直接命中会掩盖反查、丢失「这是 стол 的哪个格」的教学信息，故反查在前。
  //    例外：输入本身是独立词条时（франция「法国」 vs франций「钫」的属格形 франция），
  //    反查会把它误判成屈折形并劫持到无关词条，故当自身有词源而反查主词条没有时，认定输入是独立词条。
  const fr = getByVariants<I18nFormRow>(
    db,
    'SELECT word, tags FROM i18n_forms WHERE form = ? AND lang = ?',
    word,
    [lang],
  );
  if (fr) {
    const base = getI18n(db, fr.word, lang);
    if (base && base.word !== direct?.word) {
      // 输入自身有实质释义（дома「在家」、яма「坑，洞」）→ 它是独立词条而非屈折形，不劫持到反查主词条；
      // 纯屈折说明（столом「стол 的工具格单数」）或「自身有词源而主词条无」（франция「法国」）不适用。
      const selfIsReal = direct
        ? !isInflectionOnlyGloss(direct.translation) ||
          (!!getEtymology(db, direct.word, lang) && !getEtymology(db, base.word, lang))
        : false;
      if (!selfIsReal) {
        let tags: string[] = [];
        try {
          const p = JSON.parse(fr.tags ?? '[]');
          if (Array.isArray(p)) tags = p.map(String);
        } catch {
          /* ignore */
        }
        const withForm: I18nWord = { ...base, matchedForm: { form: word, display: word, tags } };
        return i18nToDetail(db, withForm, lang);
      }
    }
  }
  // 2) 直接词条
  if (direct) return i18nToDetail(db, direct, lang);
  return null;
}

/** 多语言词条 → WordDetail：补词源（词源语言与词条语言一致）与词根词缀拆解 */
function i18nToDetail(db: DatabaseSync, i: I18nWord, lang: string): WordDetail {
  const base = i.word; // 保留原词形（俄语专名 Китай 按原形入库），大小写兜底交给 getOrigin/getEtymology
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
    origin: getOrigin(db, base),
    etymology: getEtymology(db, base, lang),
    breakdown: breakdownWord(db, i.word, lang),
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
  const raw = rawWord.trim();
  const word = normalizeWord(rawWord);
  if (!word) return null;
  const lang = opts?.lang ?? 'auto';

  if (lang === 'ru') {
    // 强制俄语：直接词条或词形反查；未命中则放弃（不回落英语，避免混用）
    // 传原始词形（不预先小写）：专名 Франция「法国」与小写屈折词条 франция「франций 的属格单数」
    // 在库中并存，小写化会让用户查「法国」却看到「钫的属格单数」。
    return lookupI18n(db, raw, 'ru');
  }

  // 西里尔输入（auto）→ 俄语词条（先词形反查）
  if (lang !== 'en' && isCyrillic(word)) {
    const ru = lookupI18n(db, raw, 'ru');
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

export function suggest(db: DatabaseSync, rawQuery: string, limit = 20, lang?: string): SuggestItem[] {
  const q = normalizeWord(rawQuery);
  if (!q) return [];
  const lim = Math.min(Math.max(limit, 1), 50);
  /** 显式语言模式：'ru'/'en' 强制单语言；其它（undefined/'auto'）保持按输入脚本自动判定 */
  const mode: 'auto' | 'en' | 'ru' = lang === 'en' || lang === 'ru' ? lang : 'auto';
  const toItems = (rows: SuggestRow[]): SuggestItem[] =>
    rows.map((r) => ({
      word: r.word,
      bnc: r.bnc,
      frq: r.frq,
      tag: r.tag,
      lang: r.lang ?? undefined,
    }));

  const ruPrefix = (): SuggestItem[] =>
    toItems(
      db
        .prepare(
          `SELECT word, NULL AS bnc, NULL AS frq, 'ru' AS tag, 'ru' AS lang FROM words_i18n
           WHERE word >= ? AND word < ?
           ORDER BY word LIMIT ?`
        )
        .all(q, q + 'яяя', lim) as unknown as SuggestRow[],
    );

  const enPrefix = (): SuggestItem[] =>
    toItems(
      db
        .prepare(
          `SELECT word, bnc, frq, tag, 'en' AS lang FROM words
           WHERE word >= ? AND word < ?
           ORDER BY (word = ?) DESC, (bnc IS NULL), bnc, word LIMIT ?`
        )
        .all(q, q + 'zzzz', q, lim) as unknown as SuggestRow[],
    );

  const byTranslation = (target: 'en' | 'ru'): SuggestItem[] => {
    const like = `%${escapeLike(q)}%`;
    if (target === 'ru') {
      return toItems(
        db
          .prepare(
            "SELECT word, NULL AS bnc, NULL AS frq, 'ru' AS tag, 'ru' AS lang FROM words_i18n WHERE translation LIKE ? ESCAPE '\\' ORDER BY word LIMIT ?"
          )
          .all(like, lim) as unknown as SuggestRow[],
      );
    }
    return toItems(
      db
        .prepare(
          "SELECT word, bnc, frq, tag, 'en' AS lang FROM words WHERE translation LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc, word LIMIT ?"
        )
        .all(like, lim) as unknown as SuggestRow[],
    );
  };

  // 1) 显式语言模式：俄语模式下不再混入英语建议（中文反查同样限定语言）
  if (mode === 'ru') return isCjk(q) ? byTranslation('ru') : ruPrefix();
  if (mode === 'en') return isCjk(q) ? byTranslation('en') : enPrefix();

  // 2) 自动模式：按输入脚本判定（原行为）
  if (isCyrillic(q)) return ruPrefix();
  if (isCjk(q)) {
    const en = byTranslation('en');
    const ru = byTranslation('ru');
    // 英俄交错返回，保证中文反查时两种语言都可见（双语言分区）
    const mixed: SuggestItem[] = [];
    const n = Math.max(en.length, ru.length);
    for (let i = 0; i < n && mixed.length < lim; i += 1) {
      if (en[i]) mixed.push(en[i]);
      if (ru[i]) mixed.push(ru[i]);
    }
    return mixed.slice(0, lim);
  }
  return enPrefix();
}

/* ---------------- 词根词缀拆解 ---------------- */

let morphemeCache: { prefixes: Morpheme[]; suffixes: Morpheme[]; roots: Morpheme[] } | null = null;
/** 按语言缓存词素库（en 为英语，ru 为俄语） */
const morphemeCacheByLang = new Map<string, { prefixes: Morpheme[]; suffixes: Morpheme[]; roots: Morpheme[] }>();

function loadMorphemes(db: DatabaseSync, lang = 'en') {
  if (lang === 'en' && morphemeCache) return morphemeCache;
  const cached = morphemeCacheByLang.get(lang);
  if (cached) return cached;
  const rows = db
    .prepare('SELECT morpheme, kind, meaning_zh, meaning_en, origin, examples FROM morphemes WHERE lang = ?')
    .all(lang) as unknown as MorphemeRow[];
  const list: Morpheme[] = rows.map((r) => ({
    morpheme: r.morpheme,
    kind: r.kind as MorphemeKind,
    meaningZh: r.meaning_zh ?? '',
    meaningEn: r.meaning_en,
    origin: r.origin,
    examples: safeJsonArray(r.examples),
  }));
  const byKind = (k: MorphemeKind) => list.filter((m) => m.kind === k).sort((a, b) => b.morpheme.length - a.morpheme.length);
  const bundle = { prefixes: byKind('prefix'), suffixes: byKind('suffix'), roots: byKind('root') };
  morphemeCacheByLang.set(lang, bundle);
  if (lang === 'en') morphemeCache = bundle;
  return bundle;
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

/** 拆解最少覆盖率：整体覆盖不足则视为「不可拆」，避免 difficult→cul、business→-ness 这类碎片式误拆 */
const BREAKDOWN_MIN_COVERAGE = 0.55;

/** 同分时的词素优先级：前缀 > 后缀 > 词根（否则 unbelievable 的 un- 会被同名词根 un 顶掉） */
const MORPHEME_RANK: Record<MorphemeKind, number> = { prefix: 0, suffix: 1, root: 2 };
function rankOf(m: Morpheme | null): number {
  return m ? MORPHEME_RANK[m.kind] : 3;
}

/**
 * 构词拆解：lang='en' 英语词素库；lang='ru' 俄语词素库（含屈折词尾与单字符前缀处理）
 *
 * 算法：全局最优分段（动态规划），非「每步取最长」的贪心。
 * 贪心会被同位置的长词素抢占：стетоскоп 在位置 3 命中 тоск-（忧愁）而丢掉
 * 更优的 стето- + скоп-（观察镜），导致 тоск- 词根关联到一堆医疗仪器词。
 * DP 以「覆盖字符数最大、片段数最少」为准则回推，从根上消除这类抢占。
 */
export function breakdownWord(db: DatabaseSync, rawWord: string, lang = 'en'): BreakdownPart[] {
  const w = normalizeWord(rawWord);
  if (w.length < 2) return [];
  const { prefixes, suffixes, roots } = loadMorphemes(db, lang);
  const isRu = lang === 'ru';
  // 俄语 ё/е 等价（весёлый ↔ весел-、жёлтый ↔ желто-）：匹配用归一化副本。
  // 两个字符等长，匹配位置可直接映射回原词，start/end 无需换算。
  const mw = isRu ? w.replace(/ё/g, 'е') : w;
  // 词素原文（morpheme 字段）→ 匹配模式（去掉首尾连字符；俄语后缀额外允许屈折词尾变体）
  const all = [...prefixes, ...suffixes, ...roots].map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/ё/g, 'е') : raw;
    const patterns: { pat: string; core: boolean }[] = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
      // -ость → 核心 ост，可吸收 -и/-ью 等屈折词尾；
      // 核心须 ≥3 字符：否则 -ать（核心 ат）会抢占 писатель 的 -тель
      const core = stem.slice(0, -1);
      if (core.length >= 3) patterns.push({ pat: core, core: true });
    }
    return { m, stem, patterns };
  });

  // 首字符索引：把每个位置要比较的词素从 888 条降到十位数（DP 反而比贪心更快）
  const byFirst = new Map<string, typeof all>();
  for (const e of all) {
    for (const { pat } of e.patterns) {
      const c = pat[0];
      let arr = byFirst.get(c);
      if (!arr) { arr = []; byFirst.set(c, arr); }
      arr.push(e);
    }
  }

  /** 位置 pos 上所有合法词素候选 */
  const candidatesAt = (pos: number): { m: Morpheme; start: number; end: number }[] => {    const out: { m: Morpheme; start: number; end: number }[] = [];
    const entries = byFirst.get(mw[pos]);
    if (!entries) return out;
    for (const { m, stem, patterns } of entries) {
      for (const { pat, core } of patterns) {
        const minLen = isRu && m.kind === 'prefix' ? 1 : 2; // 俄语有 в-/с-/у-/о- 等单字符前缀
        if (pat.length < minLen || !mw.startsWith(pat, pos)) continue;
        // ① 前缀只能起于词首 —— 否则 principle 的 in-（位置 1）会被误收
        if (m.kind === 'prefix' && pos !== 0 && !core) continue;
        let end = pos + (core ? w.length - pos : pat.length);
        if (core) {
          // 后缀吸收屈折词尾（-ость → -ости/-остью），词尾过长则不算同一后缀
          if (w.length - (pos + pat.length) > 3) continue;
          end = w.length;
        } else if (isRu && m.kind === 'prefix' && pat.length === 1) {
          // 单字符前缀需有【紧邻】的词根/后缀支撑，避免 вода → в-|ода、страшный → с-|трашный 这类误拆。
          // 用 startsWith 而非 includes：远处的 -ный 不足以支撑词首的 с-
          const rest = mw.slice(pos + 1);
          const supported = all.some(
            (x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem)
          );
          if (!supported) continue;
        }
        // ② 后缀左侧须有 ≥3 字符词干 —— 否则 ателье、тельце 会被 -тель 误拆
        if (m.kind === 'suffix' && pos < 3) continue;
        out.push({ m, start: pos, end });
      }
    }
    return out;
  };

  // ---- DP：score[i] = 自 i 到词尾的最大覆盖；pieces[i] = 对应最少片段数 ----
  const n = w.length;
  const covered = new Int32Array(n + 1);
  const pieces = new Int32Array(n + 1);
  const stepTo = new Int32Array(n + 1);
  const stepEnd = new Int32Array(n + 1);
  const stepM: (Morpheme | null)[] = new Array(n + 1).fill(null);
  stepTo[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    // 选项 A：该字符不归属任何词素（碎片）
    let bestCov = covered[i + 1];
    let bestPieces = pieces[i + 1];
    let bestTo = i + 1;
    let bestEnd = i + 1;
    let bestM: Morpheme | null = null;
    for (const c of candidatesAt(i)) {
      const cov = c.end - c.start + covered[c.end];
      const pc = 1 + pieces[c.end];
      // 同分同片段时前缀 > 后缀 > 词根：否则 unbelievable 的 un- 会被同名词根 un 顶掉
      const better =
        cov > bestCov ||
        (cov === bestCov && (pc < bestPieces || (pc === bestPieces && rankOf(c.m) < rankOf(bestM))));
      if (better) {
        bestCov = cov; bestPieces = pc; bestTo = c.end; bestEnd = c.end; bestM = c.m;
      }
    }
    covered[i] = bestCov; pieces[i] = bestPieces; stepTo[i] = bestTo; stepEnd[i] = bestEnd; stepM[i] = bestM;
  }

  // ---- 回溯 ----
  const parts: BreakdownPart[] = [];
  let i = 0;
  while (i >= 0 && i < n && parts.length < 8) {
    const m = stepM[i];
    if (m) {
      parts.push({
        morpheme: m.morpheme,
        kind: m.kind,
        meaningZh: m.meaningZh,
        origin: m.origin,
        start: i,
        end: stepEnd[i],
        examples: m.examples?.length ? m.examples : undefined,
      });
      i = stepEnd[i];
    } else {
      i = stepTo[i];
    }
  }

  // 覆盖率不足视为不可拆（difficult/business/principle 一类碎片式误拆）
  const rawCovered = parts.reduce((s, p) => s + (p.end - p.start), 0);
  if (rawCovered / n < BREAKDOWN_MIN_COVERAGE) return [];

  // 词头 1 字符间隙的单片段（run→un、orange→-ange）判为不可拆；
  // achievement（chiev 起于位置 1，但后面还有 -ment，共 2 片段）不受影响。
  if (parts.length === 1 && parts[0].start === 1) return [];
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
  // 按生词条目自身的语言选词素库（俄语生词用俄语词素，否则会被英语库误拆）
  return groupBookByMorphemeData(items, (w, lang) => breakdownWord(db, w, lang ?? 'en'));
}

/* ---------------- 词频排行工具 ---------------- */

export function topFrequent(db: DatabaseSync, limit = 50): WordEntry[] {
  const rows = db
    .prepare('SELECT * FROM words WHERE bnc IS NOT NULL ORDER BY bnc LIMIT ?')
    .all(limit) as unknown as WordRow[];
  return rows.map(rowToEntry);
}
