import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookItem, LangMode, MorphemeGroup, WordDetail } from '@zidiankaifa/core';
import { getBackend } from './api';
import SearchBar from './components/SearchBar';
import DetailCard from './components/DetailCard';
import OriginCard from './components/OriginCard';
import FormsCard from './components/FormsCard';
import BreakdownCard from './components/BreakdownCard';
import RelatedCard from './components/RelatedCard';
import BookPanel from './components/BookPanel';
import LexiconPanel from './components/LexiconPanel';
import RootClassPanel from './components/RootClassPanel';
import SettingsPanel from './components/SettingsPanel';
import ClipboardPopup from './components/ClipboardPopup';
import UpdateBanner from './components/UpdateBanner';
import { isAutoUpdateEnabled, useUpdateState } from './useUpdate';

/** v0.10.0：新增 'rootclass'（🌱 词根分类）—— 共 5 个顶层面板（不新增第 6 个） */
type Panel = 'lookup' | 'book' | 'lexicon' | 'rootclass' | 'settings';

const LAST_WORD_KEY = 'zidian-last-word';
const LANG_KEY = 'zidian-lang';

/** 查询语言切换器：自动 / 英语 / 俄语 */
function LangSwitcher({
  value,
  onChange,
}: {
  value: LangMode;
  onChange: (l: LangMode) => void;
}) {
  const opts: { key: LangMode; label: string; hint: string }[] = [
    { key: 'auto', label: '自动', hint: '按输入自动识别语言' },
    { key: 'en', label: '英语', hint: '只查英语词库' },
    { key: 'ru', label: '俄语', hint: '只查俄语词库（含变格变位）' },
  ];
  return (
    <div className="lang-switcher" role="group" aria-label="查询语言">
      {opts.map((o) => (
        <button
          key={o.key}
          className={`lang-btn${value === o.key ? ' active' : ''}`}
          title={o.hint}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [current, setCurrent] = useState<WordDetail | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<BookItem[]>([]);
  const [activePanel, setActivePanel] = useState<Panel>('lookup');
  const [clipboardText, setClipboardText] = useState<string | null>(null);
  /** 从构词拆解点进来的词素：切到词根面板并直接打开它的详情 */
  const [lexFocus, setLexFocus] = useState<string | null>(null);
  /** 当前词的同根词（按共享词素分组） */
  const [related, setRelated] = useState<MorphemeGroup[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [lang, setLang] = useState<LangMode>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === 'en' || saved === 'ru' ? saved : 'auto';
  });

  const setLangAndPersist = useCallback((l: LangMode) => {
    setLang(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  /**
   * 生词本**全量**（全部语言）读取。
   *
   * ★ 这里刻意**不传 lang**：本读取不是「列表展示读取」，而是给跨语言状态判定用的
   *   （`toggleBook` 要知道 (word, lang) 到底在不在生词本里，`items` 同时充当子面板的
   *   「有变化就重载」信号）。**列表展示读取全部在子面板内**，且按 AC-16⑦ **显式传 lang**
   *   （`BookPanel.tsx` 的 `bookList(lang)` / `RootClassPanel.tsx` 的 `bookGroups?.(lang)`）。
   *   契约脚本 `scripts/check_v10_ui_contract.mjs` 头部已记档这条豁免及其理由。
   */
  const refreshBook = useCallback(() => {
    getBackend()
      .bookList()
      .then(setBook)
      .catch(() => setBook([]));
  }, []);

  const lookup = useCallback(
    async (word: string, langOverride?: string) => {
      const w = word.trim();
      if (!w) return;
      setActivePanel('lookup');
      setSearching(true);
      setError(null);
      setQuery(w);
      localStorage.setItem(LAST_WORD_KEY, w);
      try {
        const backend = getBackend();
        const d = await backend.lookup(
          w,
          langOverride && langOverride !== 'auto' ? langOverride : lang,
        );
        setCurrent(d);

        // 同根词与主查词并行加载：失败不影响查词结果
        if (d && backend.relatedByMorpheme) {
          // 俄语词条命中 i18n 时按 ru 取词素库，否则按查询语言
          const wLang = d.i18n?.lang ?? (langOverride && langOverride !== 'auto' ? langOverride : lang);
          setRelatedLoading(true);
          backend
            .relatedByMorpheme(w, wLang === 'auto' ? 'en' : wLang)
            .then(setRelated)
            .catch(() => setRelated([]))
            .finally(() => setRelatedLoading(false));
        } else {
          setRelated([]);
          setRelatedLoading(false);
        }
      } catch (e) {
        setCurrent(null);
        setRelated([]);
        setError(
          e instanceof Error ? `查询失败：${e.message}` : '查询失败，请检查同步服务',
        );
      } finally {
        setSearching(false);
      }
    },
    [lang],
  );

  /** 打开词根/词缀详情（来自构词拆解卡片） */
  const openMorpheme = useCallback((morpheme: string) => {
    setLexFocus(morpheme);
    setActivePanel('lexicon');
  }, []);

  const toggleBook = useCallback(
    async (word: string) => {
      // v0.10.0：按 (word, lang) 判定与操作 —— 同拼写的另一语言条目互不影响
      const entryLang = current?.i18n?.lang ?? 'en';
      const inBook = book.some(
        (b) =>
          b.word.toLowerCase() === word.toLowerCase() &&
          (b.lang ?? 'en') === entryLang &&
          !b.deleted,
      );
      try {
        if (inBook) {
          await getBackend().bookRemove(word, entryLang);
        } else {
          await getBackend().bookAdd(word, [], entryLang);
        }
      } catch {
        // 忽略
      }
      setCurrent((prev) =>
        prev && prev.word.toLowerCase() === word.toLowerCase()
          ? { ...prev, inBook: !inBook }
          : prev,
      );
      refreshBook();
    },
    [book, current, refreshBook],
  );

  const closeClipboard = useCallback(() => setClipboardText(null), []);

  // 生词本初始加载
  useEffect(() => {
    refreshBook();
  }, [refreshBook]);

  // 剪贴板取词订阅（仅 Electron 生效）
  useEffect(() => {
    const backend = getBackend();
    const off = backend.onClipboard?.((t) => setClipboardText(t));
    return () => {
      off?.();
    };
  }, []);

  // 启动时自动查询最近一次查过的词（仅挂载一次；语言切换不重查）
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  useEffect(() => {
    const last = localStorage.getItem(LAST_WORD_KEY);
    if (last) void lookupRef.current(last);
  }, []);

  // 自动检查更新（桌面端且用户未关闭；延迟启动避免拖慢首屏）
  const updateCtl = useUpdateState();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => {
    if (!updateCtl.supported || !isAutoUpdateEnabled()) return;
    const t = setTimeout(() => void updateCtl.check(), 3500);
    return () => clearTimeout(t);
    // 仅在挂载时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateCtl.supported]);

  return (
    <div className="app">
      {!updateDismissed && (
        <UpdateBanner ctl={updateCtl} onDismiss={() => setUpdateDismissed(true)} />
      )}
      {/* 桌面端侧栏 */}
      <aside className="sidebar">
        <div className="logo">📖 我的电子辞典</div>
        <nav className="side-nav">
          <button
            className={activePanel === 'lookup' ? 'active' : ''}
            onClick={() => setActivePanel('lookup')}
          >
            🔍 查词
          </button>
          <button
            className={activePanel === 'book' ? 'active' : ''}
            onClick={() => setActivePanel('book')}
          >
            📚 生词本
          </button>
          <button
            className={activePanel === 'lexicon' ? 'active' : ''}
            title="词根表与词缀表（英语 / 俄语分开）"
            onClick={() => {
              setLexFocus(null);
              setActivePanel('lexicon');
            }}
          >
            🌱 词根词缀
          </button>
          <button
            className={activePanel === 'rootclass' ? 'active' : ''}
            title="按词根归类我的生词（英语 / 俄语分开）"
            onClick={() => setActivePanel('rootclass')}
          >
            🌱 词根分类
          </button>
          <button
            className={activePanel === 'settings' ? 'active' : ''}
            onClick={() => setActivePanel('settings')}
          >
            ⚙️ 设置
          </button>
        </nav>
        <div className="copyright">
          我的电子辞典 v0.10.0
          <br />
          词库来源 ECDICT
        </div>
      </aside>

      {/* 手机端顶部 */}
      <header className="mobile-header">
        <div className="logo">📖 我的电子辞典</div>
        <SearchBar onPick={lookup} lang={lang} />
        <LangSwitcher value={lang} onChange={setLangAndPersist} />
        <nav className="tabs">
          <button
            className={activePanel === 'lookup' ? 'active' : ''}
            onClick={() => setActivePanel('lookup')}
          >
            查词
          </button>
          <button
            className={activePanel === 'book' ? 'active' : ''}
            onClick={() => setActivePanel('book')}
          >
            生词本
          </button>
          <button
            className={activePanel === 'lexicon' ? 'active' : ''}
            onClick={() => {
              setLexFocus(null);
              setActivePanel('lexicon');
            }}
          >
            词根词缀
          </button>
          <button
            className={activePanel === 'rootclass' ? 'active' : ''}
            onClick={() => setActivePanel('rootclass')}
          >
            词根分类
          </button>
          <button
            className={activePanel === 'settings' ? 'active' : ''}
            onClick={() => setActivePanel('settings')}
          >
            设置
          </button>
        </nav>
      </header>

      {/* 主区 */}
      <main className="main">
        <div className="search-area">
          <SearchBar onPick={lookup} lang={lang} />
          <LangSwitcher value={lang} onChange={setLangAndPersist} />
        </div>
        <div className="content">
          {activePanel === 'lookup' && (
            <>
              {error && <div className="error-banner">⚠️ {error}</div>}
              <DetailCard
                query={query}
                detail={current}
                searching={searching}
                onPick={lookup}
                onToggleBook={toggleBook}
              />
              {current && !searching && (
                <>
                  {/* 词源/构词路径：英语与俄语词条共用（俄语词源来自 zh 转储中文词源 + 俄语词素库） */}
                  <OriginCard
                    origin={current.origin}
                    etymology={current.etymology}
                    breakdown={current.breakdown}
                    onMorpheme={openMorpheme}
                    onPickWord={lookup}
                  />
                  {!current.i18n && <FormsCard forms={current.forms} onPick={lookup} />}
                  <BreakdownCard
                    word={current.word}
                    breakdown={current.breakdown}
                    onMorpheme={openMorpheme}
                    onPick={
                      current.i18n
                        ? (w: string) => lookup(w, current.i18n!.lang)
                        : lookup
                    }
                  />
                  <RelatedCard
                    word={current.word}
                    groups={related}
                    loading={relatedLoading}
                    onPick={(w) =>
                      lookup(w, current.i18n?.lang ?? (lang === 'auto' ? 'en' : lang))
                    }
                    onMorpheme={openMorpheme}
                  />
                </>
              )}
            </>
          )}
          {activePanel === 'book' && (
            <BookPanel items={book} onChanged={refreshBook} onPick={lookup} />
          )}
          {activePanel === 'lexicon' && (
            <LexiconPanel
              key={lexFocus ?? 'lexicon'}
              lang={lang}
              focusMorpheme={lexFocus}
              onLangChange={(l) => setLangAndPersist(l as LangMode)}
              onPickWord={lookup}
            />
          )}
          {activePanel === 'rootclass' && (
            <RootClassPanel items={book} onPick={lookup} />
          )}
          {activePanel === 'settings' && <SettingsPanel />}
        </div>
      </main>

      {/* 剪贴板取词浮窗（仅 Electron 触发） */}
      {clipboardText && (
        <ClipboardPopup
          text={clipboardText}
          onClose={closeClipboard}
          onBookChanged={refreshBook}
        />
      )}
    </div>
  );
}
