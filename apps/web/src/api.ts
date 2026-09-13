import type {
  BookItem,
  BreakdownPart,
  DictBackend,
  LangMode,
  LexiconEntry,
  LexiconPage,
  LexiconQueryOptions,
  LexiconStats,
  MorphemeGroup,
  SuggestItem,
  SyncResult,
  WordDetail,
  WordListPage,
} from '@zidiankaifa/core';
import { groupBookByMorphemeData, isCyrillic } from '@zidiankaifa/core';

const DEFAULT_SYNC_URL = 'http://localhost:4570';
const SYNC_URL_KEY = 'zidian-sync-url';
const BOOK_LOCAL_KEY = 'zidian-book-local';

export function setSyncUrl(u: string): void {
  localStorage.setItem(SYNC_URL_KEY, u);
}

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) || DEFAULT_SYNC_URL;
}

/* ---------------- 本地生词本（浏览器 / PWA 模式） ----------------
 * v0.10.0（AC-16 第 5/6 条）：SQLite 与 localStorage **两条路径都要做语言隔离**。
 * 存储结构升级为 `{ version: 2, items: BookItem[] }`（条目带 `lang`）；
 * 旧的**裸数组**（条目无 `lang`）在**首次读取时**按 `isCyrillic(word)` 归语言并**立即写回一次**，
 * 写回后不再满足迁移条件 ⇒ 天然幂等（不会重复改写）。
 */

const BOOK_LOCAL_VERSION = 2;

interface LocalBookFile {
  version: number;
  items: BookItem[];
}

/** 按词形判语言（与 BookPanel 的添加规则同源：西里尔 = ru，其余 = en） */
function inferLang(word: string): string {
  return isCyrillic(word) ? 'ru' : 'en';
}

/** 条目语言（缺省兼容旧数据：无 lang 字段时按词形判定，不写回也读得对） */
function itemLang(b: BookItem): string {
  return b.lang && b.lang !== 'auto' ? b.lang : inferLang(b.word);
}

function readLocalBook(): BookItem[] {
  try {
    const raw = localStorage.getItem(BOOK_LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const legacyArray = Array.isArray(parsed);
    const arr: unknown[] = legacyArray
      ? (parsed as unknown[])
      : Array.isArray((parsed as LocalBookFile | null)?.items)
        ? ((parsed as LocalBookFile).items as unknown[])
        : [];
    if (!arr.length && !legacyArray) return [];
    let migrated = legacyArray; // 旧结构（裸数组）⇒ 必须写回一次
    const items = arr.map((raw2) => {
      const it = raw2 as BookItem;
      if (it && typeof it.word === 'string' && !it.lang) {
        migrated = true;
        return { ...it, lang: inferLang(it.word) };
      }
      return it;
    });
    if (migrated) writeLocalBook(items);
    return items;
  } catch {
    return [];
  }
}

function writeLocalBook(items: BookItem[]): void {
  const file: LocalBookFile = { version: BOOK_LOCAL_VERSION, items };
  localStorage.setItem(BOOK_LOCAL_KEY, JSON.stringify(file));
}

/* ---------------- 语音合成：统一走 Web Speech API ---------------- */

function pickVoice(
  synth: SpeechSynthesis,
  langPrefix: string,
): SpeechSynthesisVoice | undefined {
  const voices = synth.getVoices();
  return voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
}

function speakViaWebSpeech(word: string, lang = 'en'): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      !window.speechSynthesis
    ) {
      reject(new Error('当前环境不支持语音合成'));
      return;
    }
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(word);
    const prefix = lang === 'en' ? 'en' : lang;
    const voice = pickVoice(synth, prefix);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = lang === 'en' ? 'en-US' : `${lang}-RU`;
    }
    utter.rate = 0.85;
    utter.onend = () => resolve();
    utter.onerror = (ev) => reject(new Error(ev.error || '语音合成失败'));
    synth.speak(utter);
  });
}

/* ---------------- REST 后端（浏览器 / PWA 模式） ---------------- */

async function restFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getSyncUrl().replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }
  return (await res.json()) as T;
}

const restBackend: DictBackend = {
  async lookup(word: string, lang?: LangMode | string): Promise<WordDetail | null> {
    const detail = await restFetch<WordDetail | null>(
      `/api/v1/lookup?word=${encodeURIComponent(word)}${lang && lang !== 'auto' ? `&lang=${encodeURIComponent(String(lang))}` : ''}`,
    );
    if (!detail) return null;
    // 浏览器模式下生词本在本地，inBook 以后端为准再叠加本地状态
    // v0.10.0：按 **(word, lang)** 判定 —— 同拼写的另一语言条目不算「已收藏」
    const local = readLocalBook();
    const entryLang = detail.i18n?.lang ?? 'en';
    const inBook = local.some(
      (b) =>
        b.word.toLowerCase() === detail.word.toLowerCase() &&
        itemLang(b) === entryLang &&
        !b.deleted,
    );
    return { ...detail, inBook };
  },

  async suggest(prefix: string, limit = 8, lang?: string): Promise<SuggestItem[]> {
    const langParam = lang && lang !== 'auto' ? `&lang=${encodeURIComponent(lang)}` : '';
    return restFetch<SuggestItem[]>(
      `/api/v1/suggest?q=${encodeURIComponent(prefix)}&limit=${limit}${langParam}`,
    );
  },

  async breakdown(word: string, lang = 'en'): Promise<BreakdownPart[]> {
    return restFetch<BreakdownPart[]>(
      `/api/v1/breakdown?word=${encodeURIComponent(word)}&lang=${encodeURIComponent(lang === 'auto' ? 'en' : lang)}`,
    );
  },

  async relatedByMorpheme(word: string, lang = 'en'): Promise<MorphemeGroup[]> {
    const r = await restFetch<{ groups: MorphemeGroup[] }>(
      `/api/v1/related?word=${encodeURIComponent(word)}&lang=${encodeURIComponent(lang === 'auto' ? 'en' : lang)}`,
    );
    return r.groups ?? [];
  },

  /** 缺省（不传 lang）= 不过滤，返回全部语言（与 core `bookList` 语义一致，AC-13 第 6 条） */
  async bookList(lang?: string): Promise<BookItem[]> {
    const items = readLocalBook().filter((b) => !b.deleted);
    return lang ? items.filter((b) => itemLang(b) === lang) : items;
  },

  async bookAdd(word: string, tags: string[] = [], lang = 'en'): Promise<BookItem> {
    const items = readLocalBook();
    const l = lang && lang !== 'auto' ? lang : inferLang(word);
    const existed = items.find(
      (b) => b.word.toLowerCase() === word.toLowerCase() && itemLang(b) === l && !b.deleted,
    );
    if (existed) return existed;
    const now = Date.now();
    const item: BookItem = {
      word,
      lang: l,
      addedAt: now,
      updatedAt: now,
      status: 'new',
      note: null,
      tags,
      reviewCount: 0,
      lastReviewedAt: null,
    };
    writeLocalBook([...items, item]);
    return item;
  },

  /** 只删指定语言的条目：同拼写的另一语言条目不受影响（AC-13 第 2 条） */
  async bookRemove(word: string, lang?: string): Promise<void> {
    const items = readLocalBook();
    const w = word.toLowerCase();
    const l =
      lang ?? items.find((b) => b.word.toLowerCase() === w)?.lang ?? inferLang(word);
    writeLocalBook(items.filter((b) => !(b.word.toLowerCase() === w && itemLang(b) === l)));
  },

  async bookUpdate(item: BookItem): Promise<void> {
    const items = readLocalBook();
    const w = item.word.toLowerCase();
    const l = item.lang ?? items.find((b) => b.word.toLowerCase() === w)?.lang ?? inferLang(item.word);
    writeLocalBook(
      items.map((b) =>
        b.word.toLowerCase() === w && itemLang(b) === l ? { ...item, lang: l } : b,
      ),
    );
  },

  async syncNow(): Promise<SyncResult> {
    const items = readLocalBook();
    try {
      const res = await restFetch<{
        ok: boolean;
        pushed: number;
        pulled: number;
        items?: BookItem[];
      }>('/api/v1/sync', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      if (res.ok && Array.isArray(res.items)) {
        writeLocalBook(res.items);
      }
      return { ok: res.ok, pushed: res.pushed, pulled: res.pulled };
    } catch (e) {
      return {
        ok: false,
        pushed: 0,
        pulled: 0,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  /**
   * 浏览器模式：生词本在本地，逐个拆解后聚合分组（按条目语言选用对应词素库）。
   * v0.10.0：**语言过滤发生在本层**（先按 lang 过滤 items）；缺省（不传 lang）= 不过滤。
   * 拆解回调按条目语言取词素库（`itemLang`），故同拼写的英/俄两条各用各的词素库。
   */
  async bookGroups(lang?: string): Promise<MorphemeGroup[]> {
    const all = readLocalBook().filter((b) => !b.deleted);
    const items = lang ? all.filter((b) => itemLang(b) === lang) : all;
    const partsMap = new Map<string, BreakdownPart[]>();
    await Promise.all(
      items.map(async (b) => {
        const l = itemLang(b);
        try {
          const parts = await restFetch<BreakdownPart[]>(
            `/api/v1/breakdown?word=${encodeURIComponent(b.word)}&lang=${encodeURIComponent(l)}`,
          );
          partsMap.set(b.word, parts);
        } catch {
          partsMap.set(b.word, []);
        }
      }),
    );
    return groupBookByMorphemeData(items, (w) => partsMap.get(w) ?? []);
  },

  speak: speakViaWebSpeech,

  /* ---- 词根表 / 词缀表 / 单词表（走同步服务） ---- */

  async lexiconList(opts: LexiconQueryOptions): Promise<LexiconPage> {
    const p = new URLSearchParams();
    p.set('kind', opts.kind ?? 'root');
    p.set('lang', opts.lang ?? 'en');
    if (opts.query) p.set('q', opts.query);
    if (opts.sort) p.set('sort', opts.sort);
    p.set('limit', String(opts.limit ?? 60));
    p.set('offset', String(opts.offset ?? 0));
    return restFetch<LexiconPage>(`/api/v1/lexicon?${p.toString()}`);
  },

  async lexiconEntry(morpheme: string, lang = 'en'): Promise<LexiconEntry | null> {
    try {
      return await restFetch<LexiconEntry>(
        `/api/v1/lexicon/entry?morpheme=${encodeURIComponent(morpheme)}&lang=${encodeURIComponent(lang)}`,
      );
    } catch {
      return null;
    }
  },

  async lexiconStats(): Promise<LexiconStats> {
    return restFetch<LexiconStats>('/api/v1/lexicon/stats');
  },

  async wordList(lang: string, opts: { query?: string; limit?: number; offset?: number } = {}): Promise<WordListPage> {
    const p = new URLSearchParams();
    p.set('lang', lang);
    if (opts.query) p.set('q', opts.query);
    p.set('limit', String(opts.limit ?? 60));
    p.set('offset', String(opts.offset ?? 0));
    return restFetch<WordListPage>(`/api/v1/words?${p.toString()}`);
  },
};

/* ---------------- Electron 后端（转发 window.dictAPI） ---------------- */

function electronBackend(): DictBackend {
  const api = window.dictAPI!;
  return {
    lookup: (w, lang) => api.lookup(w, lang),
    suggest: (p, l, lang) => api.suggest(p, l, lang),
    breakdown: (w, lang) => api.breakdown(w, lang),
    bookList: (lang) => api.bookList(lang),
    bookAdd: (w, t, lang) => api.bookAdd(w, t, lang),
    bookRemove: (w, lang) => api.bookRemove(w, lang),
    bookUpdate: (i) => api.bookUpdate(i),
    bookGroups: (lang) => (api.bookGroups ? api.bookGroups(lang) : Promise.resolve([])),
    relatedByMorpheme: (w, lang) =>
      api.relatedByMorpheme ? api.relatedByMorpheme(w, lang) : Promise.resolve([]),
    lexiconList: (o) => (api.lexiconList ? api.lexiconList(o) : Promise.reject(new Error('当前后端不支持词根表'))),
    lexiconEntry: (m, lang) => (api.lexiconEntry ? api.lexiconEntry(m, lang) : Promise.resolve(null)),
    lexiconStats: () => (api.lexiconStats ? api.lexiconStats() : Promise.reject(new Error('当前后端不支持词根表'))),
    wordList: (lang, o) => (api.wordList ? api.wordList(lang, o) : Promise.reject(new Error('当前后端不支持词表'))),
    // 自动更新仅 Electron 提供；浏览器/PWA 无此能力（undefined → UI 提示手动更新）
    update: api.update,
    syncNow: () => api.syncNow(),
    // 按统一约定，发音走 Web Speech API
    speak: speakViaWebSpeech,
    onClipboard: api.onClipboard ? (cb) => api.onClipboard!(cb) : undefined,
  };
}

/* ---------------- 后端选择（实例缓存，保证剪贴板订阅一致） ---------------- */

let cachedBackend: DictBackend | null = null;

export function getBackend(): DictBackend {
  if (!cachedBackend) {
    cachedBackend =
      typeof window !== 'undefined' && window.dictAPI
        ? electronBackend()
        : restBackend;
  }
  return cachedBackend;
}
