/**
 * 词根表 / 词缀表 面板
 *
 * 需求：把单词表分成英语和俄语，并新增可浏览、可搜索的词根表与词缀表。
 * 数据来自 roots / affixes 表，关联词由真实拆解统计（非子串匹配）。
 *
 * ★ 职责区分（v0.10.0 AC-17 第 4 条，勿与 `RootClassPanel.tsx` 混淆、勿判为重复实现）：
 *   本面板 = **全库**词根/词缀表（数据源 = `roots`/`affixes` 倒排表，与生词本**无关**）；
 *   `RootClassPanel.tsx`（顶层「🌱 词根分类」）= **只归类「生词本」里的词**（数据源 = 生词本 items）。
 *   ⇒ 两者数据源不同、用途不同：这里是「这本书里有哪些词根」，那里是「我背的词落在哪些词根下」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LexiconEntry, LexiconKind, LexiconPage, LexiconStats } from '@zidiankaifa/core';
import { getBackend } from '../api';

const KIND_TABS: { key: LexiconKind; label: string; hint: string }[] = [
  { key: 'root', label: '词根表', hint: '承载核心词义的词根' },
  { key: 'prefix', label: '前缀表', hint: '位于词首、改变词义的词缀' },
  { key: 'suffix', label: '后缀表', hint: '位于词尾、决定词性的词缀' },
];

const PAGE_SIZE = 60;

interface Props {
  /** 初始语言（跟随查词页的语言选择） */
  lang: string;
  /** 从构词拆解卡片点进来的词素：挂载后直接打开它的详情 */
  focusMorpheme?: string | null;
  onLangChange?: (lang: string) => void;
  /** 点击关联词 → 回到查词页查询 */
  onPickWord: (word: string, lang: string) => void;
}

export default function LexiconPanel({ lang, focusMorpheme, onLangChange, onPickWord }: Props) {
  // 从构词拆解点进来的词素自带语言线索：西里尔词素一律落俄语表，否则跟随查词页语言
  const [lexLang, setLexLang] = useState<string>(() =>
    focusMorpheme && /[\u0400-\u04FF]/.test(focusMorpheme)
      ? 'ru'
      : lang === 'ru'
        ? 'ru'
        : 'en',
  );
  const [kind, setKind] = useState<LexiconKind>('root');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState<LexiconPage | null>(null);
  const [entry, setEntry] = useState<LexiconEntry | null>(null);
  const [stats, setStats] = useState<LexiconStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const backend = getBackend();
    if (!backend.lexiconStats) return;
    backend
      .lexiconStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const load = useCallback(
    async (offset: number) => {
      const backend = getBackend();
      if (!backend.lexiconList) {
        setError('当前后端不支持词根表（请通过同步服务或桌面端使用）');
        return;
      }
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await backend.lexiconList({
          kind,
          lang: lexLang,
          query: debounced || undefined,
          sort: debounced ? 'alpha' : 'words',
          limit: PAGE_SIZE,
          offset,
        });
        if (mine !== seq.current) return;
        setPage((prev) => (offset > 0 && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [kind, lexLang, debounced],
  );

  useEffect(() => {
    setEntry(null);
    void load(0);
  }, [load]);

  // 从构词拆解卡片点进来的词素：直接打开它的详情（App 用 key 重建组件，故等价于只跑一次）
  useEffect(() => {
    if (!focusMorpheme) return;
    const backend = getBackend();
    if (!backend.lexiconEntry) return;
    void backend
      .lexiconEntry(focusMorpheme, lexLang)
      .then((e) => {
        if (e) setEntry(e);
      })
      .catch(() => {
        /* 取不到就停留在列表 */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMorpheme]);

  const openEntry = useCallback(
    async (morpheme: string) => {
      const backend = getBackend();
      if (!backend.lexiconEntry) return;
      try {
        const e = await backend.lexiconEntry(morpheme, lexLang);
        if (e) setEntry(e);
      } catch {
        /* 忽略：详情取不到就停留在列表 */
      }
    },
    [lexLang],
  );

  const switchLang = (l: string) => {
    setLexLang(l);
    setEntry(null);
    onLangChange?.(l);
  };

  const statOf = (k: LexiconKind): number | undefined => {
    if (!stats) return undefined;
    if (k === 'root') return stats.roots[lexLang]?.count;
    if (k === 'all') return undefined;
    return stats.affixes[`${lexLang}:${k}`]?.count;
  };

  if (entry) {
    return (
      <div className="lexicon-panel">
        <button type="button" className="lexicon-back" onClick={() => setEntry(null)}>
          ← 返回{kind === 'root' ? '词根表' : '词缀表'}
        </button>
        <div className="lexicon-detail">
          <div className="lexicon-detail-head">
            <span className="lexicon-morpheme">{entry.morpheme}</span>
            <span className={`lexicon-kind lexicon-kind-${entry.kind}`}>
              {entry.kind === 'root' ? '词根' : entry.kind === 'prefix' ? '前缀' : '后缀'}
            </span>
            <span className="lexicon-lang-badge">{entry.lang === 'ru' ? '🇷🇺 俄语' : '🇬🇧 英语'}</span>
          </div>
          {entry.meaningZh && <p className="lexicon-meaning">{entry.meaningZh}</p>}
          {entry.meaningEn && <p className="lexicon-meaning-en">{entry.meaningEn}</p>}
          {entry.origin && (
            <p className="lexicon-origin">
              <span className="lexicon-label">词源</span>
              {entry.origin}
            </p>
          )}
          {entry.examples.length > 0 && (
            <div className="lexicon-block">
              <div className="lexicon-label">典型例词</div>
              <div className="lexicon-chips">
                {entry.examples.map((w) => (
                  <button key={w} type="button" className="lexicon-chip lexicon-chip-example" onClick={() => onPickWord(w, entry.lang)}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="lexicon-block">
            <div className="lexicon-label">
              关联词 <span className="lexicon-count">{entry.wordCount}</span>
              <span className="lexicon-hint">按真实构词拆解统计，点词即可查询</span>
            </div>
            {entry.words.length === 0 ? (
              <p className="lexicon-empty">暂无关联词</p>
            ) : (
              <div className="lexicon-chips">
                {entry.words.map((w) => (
                  <button key={w} type="button" className="lexicon-chip" onClick={() => onPickWord(w, entry.lang)}>
                    {w}
                  </button>
                ))}
              </div>
            )}
            {entry.wordCount > entry.words.length && (
              <p className="lexicon-hint">仅显示按词长升序的前 {entry.words.length} 个（共 {entry.wordCount} 个）</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lexicon-panel">
      <div className="lexicon-toolbar">
        <div className="lexicon-lang-switch">
          <button type="button" className={lexLang === 'en' ? 'active' : ''} onClick={() => switchLang('en')}>
            🇬🇧 英语
          </button>
          <button type="button" className={lexLang === 'ru' ? 'active' : ''} onClick={() => switchLang('ru')}>
            🇷🇺 俄语
          </button>
        </div>
        <div className="lexicon-kind-tabs">
          {KIND_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.hint}
              className={kind === t.key ? 'active' : ''}
              onClick={() => setKind(t.key)}
            >
              {t.label}
              {statOf(t.key) !== undefined && <span className="lexicon-tab-count">{statOf(t.key)}</span>}
            </button>
          ))}
        </div>
      </div>

      <input
        className="lexicon-search"
        type="search"
        value={query}
        placeholder={kind === 'root' ? '搜索词根、含义…（如 тоск、忧愁）' : '搜索词缀、含义…（如 -тель、施动者）'}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <div className="lexicon-error">{error}</div>}

      <ul className="lexicon-list">
        {(page?.items ?? []).map((it) => (
          <li key={`${it.lang}-${it.morpheme}`} className="lexicon-item" onClick={() => void openEntry(it.morpheme)}>
            <div className="lexicon-item-main">
              <span className="lexicon-morpheme">{it.morpheme}</span>
              <span className={`lexicon-kind lexicon-kind-${it.kind}`}>
                {it.kind === 'root' ? '词根' : it.kind === 'prefix' ? '前缀' : '后缀'}
              </span>
            </div>
            <div className="lexicon-item-sub">
              <span className="lexicon-item-meaning">{it.meaningZh || it.meaningEn || '—'}</span>
              <span className="lexicon-item-count">{it.wordCount} 词</span>
            </div>
            {it.origin && <div className="lexicon-item-origin">{it.origin}</div>}
          </li>
        ))}
      </ul>

      {!loading && page && page.items.length === 0 && (
        <p className="lexicon-empty">没有匹配的{kind === 'root' ? '词根' : '词缀'}</p>
      )}

      {page && page.items.length < page.total && (
        <button type="button" className="lexicon-more" disabled={loading} onClick={() => void load(page.items.length)}>
          {loading ? '加载中…' : `加载更多（已显示 ${page.items.length} / ${page.total}）`}
        </button>
      )}
      {loading && !page && <p className="lexicon-empty">加载中…</p>}
    </div>
  );
}
