import type {
  BookItem,
  BreakdownPart,
  DictBackend,
  SuggestItem,
  SyncResult,
  WordDetail,
} from '@zidiankaifa/core';

const DEFAULT_SYNC_URL = 'http://localhost:4570';
const SYNC_URL_KEY = 'zidian-sync-url';
const BOOK_LOCAL_KEY = 'zidian-book-local';

export function setSyncUrl(u: string): void {
  localStorage.setItem(SYNC_URL_KEY, u);
}

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) || DEFAULT_SYNC_URL;
}

/* ---------------- 本地生词本（浏览器 / PWA 模式） ---------------- */

function readLocalBook(): BookItem[] {
  try {
    const raw = localStorage.getItem(BOOK_LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BookItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocalBook(items: BookItem[]): void {
  localStorage.setItem(BOOK_LOCAL_KEY, JSON.stringify(items));
}

/* ---------------- 语音合成：统一走 Web Speech API ---------------- */

function pickEnglishVoice(
  synth: SpeechSynthesis,
): SpeechSynthesisVoice | undefined {
  const voices = synth.getVoices();
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => v.lang.toLowerCase().startsWith('en-us')) ??
    en.find((v) => v.lang.toLowerCase().startsWith('en-gb')) ??
    en[0]
  );
}

function speakViaWebSpeech(word: string): Promise<void> {
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
    const voice = pickEnglishVoice(synth);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = 'en-US';
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
  async lookup(word: string): Promise<WordDetail | null> {
    const detail = await restFetch<WordDetail | null>(
      `/api/v1/lookup?word=${encodeURIComponent(word)}`,
    );
    if (!detail) return null;
    // 浏览器模式下生词本在本地，inBook 以后端为准再叠加本地状态
    const local = readLocalBook();
    const inBook = local.some(
      (b) => b.word.toLowerCase() === detail.word.toLowerCase(),
    );
    return { ...detail, inBook };
  },

  async suggest(prefix: string, limit = 8): Promise<SuggestItem[]> {
    return restFetch<SuggestItem[]>(
      `/api/v1/suggest?q=${encodeURIComponent(prefix)}&limit=${limit}`,
    );
  },

  async breakdown(word: string): Promise<BreakdownPart[]> {
    return restFetch<BreakdownPart[]>(
      `/api/v1/breakdown?word=${encodeURIComponent(word)}`,
    );
  },

  async bookList(): Promise<BookItem[]> {
    return readLocalBook();
  },

  async bookAdd(word: string, tags: string[] = []): Promise<BookItem> {
    const items = readLocalBook();
    const existed = items.find(
      (b) => b.word.toLowerCase() === word.toLowerCase(),
    );
    if (existed) return existed;
    const now = Date.now();
    const item: BookItem = {
      word,
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

  async bookRemove(word: string): Promise<void> {
    writeLocalBook(
      readLocalBook().filter(
        (b) => b.word.toLowerCase() !== word.toLowerCase(),
      ),
    );
  },

  async bookUpdate(item: BookItem): Promise<void> {
    writeLocalBook(
      readLocalBook().map((b) =>
        b.word.toLowerCase() === item.word.toLowerCase() ? item : b,
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

  speak: speakViaWebSpeech,
};

/* ---------------- Electron 后端（转发 window.dictAPI） ---------------- */

function electronBackend(): DictBackend {
  const api = window.dictAPI!;
  return {
    lookup: (w) => api.lookup(w),
    suggest: (p, l) => api.suggest(p, l),
    breakdown: (w) => api.breakdown(w),
    bookList: () => api.bookList(),
    bookAdd: (w, t) => api.bookAdd(w, t),
    bookRemove: (w) => api.bookRemove(w),
    bookUpdate: (i) => api.bookUpdate(i),
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
