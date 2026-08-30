import { useCallback, useEffect, useState } from 'react';
import type { BookItem, WordDetail } from '@zidiankaifa/core';
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

export default function App() {
  const [current, setCurrent] = useState<WordDetail | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<BookItem[]>([]);
  const [activePanel, setActivePanel] = useState<Panel>('lookup');
  const [clipboardText, setClipboardText] = useState<string | null>(null);

  const refreshBook = useCallback(() => {
    getBackend()
      .bookList()
      .then(setBook)
      .catch(() => setBook([]));
  }, []);

  const lookup = useCallback(async (word: string) => {
    const w = word.trim();
    if (!w) return;
    setActivePanel('lookup');
    setSearching(true);
    setError(null);
    setQuery(w);
    localStorage.setItem(LAST_WORD_KEY, w);
    try {
      const d = await getBackend().lookup(w);
      setCurrent(d);
    } catch (e) {
      setCurrent(null);
      setError(
        e instanceof Error ? `查询失败：${e.message}` : '查询失败，请检查同步服务',
      );
    } finally {
      setSearching(false);
    }
  }, []);

  const toggleBook = useCallback(
    async (word: string) => {
      const inBook = book.some(
        (b) => b.word.toLowerCase() === word.toLowerCase(),
      );
      try {
        if (inBook) {
          await getBackend().bookRemove(word);
        } else {
          await getBackend().bookAdd(word);
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
    [book, refreshBook],
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

  // 启动时自动查询最近一次查过的词
  useEffect(() => {
    const last = localStorage.getItem(LAST_WORD_KEY);
    if (last) void lookup(last);
  }, [lookup]);

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
          我的电子辞典 v0.1.0
          <br />
          词库来源 ECDICT
        </div>
      </aside>

      {/* 手机端顶部 */}
      <header className="mobile-header">
        <div className="logo">📖 我的电子辞典</div>
        <SearchBar onPick={lookup} />
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
                  <OriginCard origin={current.origin} etymology={current.etymology} />
                  <FormsCard forms={current.forms} onPick={lookup} />
                  <BreakdownCard
                    word={current.word}
                    breakdown={current.breakdown}
                  />
                </>
              )}
            </>
          )}
          {activePanel === 'book' && (
            <BookPanel items={book} onChanged={refreshBook} />
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
