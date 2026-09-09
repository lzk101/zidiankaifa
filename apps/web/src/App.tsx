import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookItem, LangMode, WordDetail } from '@zidiankaifa/core';
import { getBackend } from './api';
import SearchBar from './components/SearchBar';
import DetailCard from './components/DetailCard';
import OriginCard from './components/OriginCard';
import FormsCard from './components/FormsCard';
import BreakdownCard from './components/BreakdownCard';
import BookPanel from './components/BookPanel';
import SettingsPanel from './components/SettingsPanel';
import ClipboardPopup from './components/ClipboardPopup';

type Panel = 'lookup' | 'book' | 'settings';

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
  const [lang, setLang] = useState<LangMode>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === 'en' || saved === 'ru' ? saved : 'auto';
  });

  const setLangAndPersist = useCallback((l: LangMode) => {
    setLang(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

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
        const d = await getBackend().lookup(
          w,
          langOverride && langOverride !== 'auto' ? langOverride : lang,
        );
        setCurrent(d);
      } catch (e) {
        setCurrent(null);
        setError(
          e instanceof Error ? `查询失败：${e.message}` : '查询失败，请检查同步服务',
        );
      } finally {
        setSearching(false);
      }
    },
    [lang],
  );

  const toggleBook = useCallback(
    async (word: string) => {
      const inBook = book.some(
        (b) => b.word.toLowerCase() === word.toLowerCase(),
      );
      try {
        if (inBook) {
          await getBackend().bookRemove(word);
        } else {
          await getBackend().bookAdd(
            word,
            [],
            current?.i18n?.lang ?? 'en',
          );
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

  return (
    <div className="app">
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
            className={activePanel === 'settings' ? 'active' : ''}
            onClick={() => setActivePanel('settings')}
          >
            ⚙️ 设置
          </button>
        </nav>
        <div className="copyright">
          我的电子辞典 v0.2.1
          <br />
          词库来源 ECDICT
        </div>
      </aside>

      {/* 手机端顶部 */}
      <header className="mobile-header">
        <div className="logo">📖 我的电子辞典</div>
        <SearchBar onPick={lookup} />
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
          <SearchBar onPick={lookup} />
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
              {current && !searching && !current.i18n && (
                <>
                  <OriginCard
                    origin={current.origin}
                    etymology={current.etymology}
                    breakdown={current.breakdown}
                  />
                  <FormsCard forms={current.forms} onPick={lookup} />
                  <BreakdownCard
                    word={current.word}
                    breakdown={current.breakdown}
                    onPick={lookup}
                  />
                </>
              )}
            </>
          )}
          {activePanel === 'book' && (
            <BookPanel items={book} onChanged={refreshBook} onPick={lookup} />
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
