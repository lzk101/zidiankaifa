import { useCallback, useEffect, useState } from 'react';
import type { BookItem, BookStatus, MorphemeGroup } from '@zidiankaifa/core';
import { isCyrillic } from '@zidiankaifa/core';
import { getBackend } from '../api';
import BookGraph from './BookGraph';

interface BookPanelProps {
  /** **当前查看语言**的生词（App 用 `bookList(lang)` 显式读取后传入；v0.10.0 语言分离） */
  items: BookItem[];
  /** 当前查看的语言（子页签值；由 App 持有 ⇒ App 的每次读取都能显式传它） */
  lang: BookLang;
  /** 切换语言：通知 App 持久化并按新语言重新拉取（AC-16② 子页签仍在本面板内） */
  onLangChange: (lang: BookLang) => void;
  /** 任意增删改之后通知 App 刷新列表 */
  onChanged: () => void;
  /** 点击单词回查（图谱/分组中的词） */
  onPick: (word: string) => void;
}

const STATUS_LABEL: Record<BookStatus, string> = {
  new: '新学',
  learning: '学习中',
  mastered: '已掌握',
  suspended: '已暂停',
};

/** 状态循环：new → learning → mastered → suspended → new */
const STATUS_ORDER: BookStatus[] = [
  'new',
  'learning',
  'mastered',
  'suspended',
];

const FILTERS: { key: BookStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '新学' },
  { key: 'learning', label: '学习中' },
  { key: 'mastered', label: '已掌握' },
  { key: 'suspended', label: '已暂停' },
];

const KIND_LABEL: Record<MorphemeGroup['kind'], string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
};

/** 生词本子页签 = 语言（v0.10.0 AC-16②：一个入口 + 内部英/俄子页签，不新增顶层入口） */
type BookLang = 'en' | 'ru';

const LANG_TABS: { key: BookLang; label: string }[] = [
  { key: 'en', label: '🇬🇧 英语' },
  { key: 'ru', label: '🇷🇺 俄语' },
];

/** 添加时的语言选择：自动（按词形）/ 强制英语 / 强制俄语 —— 手动覆盖（AC-16④） */
type LangChoice = 'auto' | BookLang;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

export default function BookPanel({ items, lang, onLangChange, onChanged, onPick }: BookPanelProps) {
  const [filter, setFilter] = useState<BookStatus | 'all'>('all');
  const [input, setInput] = useState('');
  const [choice, setChoice] = useState<LangChoice>('auto');
  const [view, setView] = useState<'list' | 'groups'>('list');
  /** 当前语言的生词（**本面板显式读取**：`bookList(lang)` —— AC-16⑦，不得依赖核心缺省「不过滤」） */
  const [list, setList] = useState<BookItem[]>([]);
  /** 词根分组（**显式传 lang 读取**；语言过滤发生在后端 `bookGroups(lang)` 层，AC-17 第 6 条） */
  const [groups, setGroups] = useState<MorphemeGroup[]>([]);

  // 按当前语言读取生词。触发时机：① 切换子页签语言（lang 变化）；② 生词本有增删改
  // （App 显式按语言重新拉取后把新的 items 传下来 ⇒ 本面板随之重载）。
  useEffect(() => {
    let cancelled = false;
    getBackend()
      .bookList(lang)
      .then((r) => {
        if (!cancelled) setList(r ?? []);
      })
      .catch(() => {
        if (!cancelled) setList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, items]);

  // 生词本变化 / 切换语言时刷新词根分组（显式传 lang）
  useEffect(() => {
    let cancelled = false;
    getBackend()
      .bookGroups?.(lang)
      .then((g) => {
        if (!cancelled) setGroups(g ?? []);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, items]);

  const visible =
    filter === 'all' ? list : list.filter((i) => i.status === filter);

  const cycleStatus = useCallback(
    async (item: BookItem) => {
      const idx = STATUS_ORDER.indexOf(item.status);
      const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
      try {
        await getBackend().bookUpdate({
          ...item,
          lang: item.lang ?? lang,
          status: next,
          updatedAt: Date.now(),
        });
      } catch {
        // 忽略
      }
      onChanged();
    },
    [lang, onChanged],
  );

  const remove = useCallback(
    async (item: BookItem) => {
      try {
        // 显式传 lang：只删当前语言的这一条（同拼写的另一语言条目保留）
        await getBackend().bookRemove(item.word, item.lang ?? lang);
      } catch {
        // 忽略
      }
      onChanged();
    },
    [lang, onChanged],
  );

  const add = async () => {
    const w = input.trim();
    if (!w) return;
    // 自动判语言（西里尔 → ru），或按手动覆盖的选择入库
    const target: BookLang = choice === 'auto' ? (isCyrillic(w) ? 'ru' : 'en') : choice;
    try {
      await getBackend().bookAdd(w, [], target);
    } catch {
      // 忽略
    }
    setInput('');
    // 跳到该语言子页签，让用户立刻看到刚加入的词
    onLangChange(target);
    setFilter('all');
    onChanged();
  };

  return (
    <div className="card book-panel">
      <div className="book-head">
        <h3 className="card-title">生词本</h3>
        {/* 计数按语言分别计算（AC-16③） */}
        <span className="book-count">
          {lang === 'ru' ? '🇷🇺 俄语' : '🇬🇧 英语'} 共 {list.length} 词
        </span>
      </div>

      <div className="book-lang-tabs">
        {LANG_TABS.map((t) => (
          <button
            key={t.key}
            className={`lang-tab${lang === t.key ? ' active' : ''}`}
            onClick={() => {
              onLangChange(t.key);
              setFilter('all');
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="book-view-tabs">
        <button
          className={`view-tab${view === 'list' ? ' active' : ''}`}
          onClick={() => setView('list')}
        >
          📋 列表
        </button>
        <button
          className={`view-tab${view === 'groups' ? ' active' : ''}`}
          onClick={() => setView('groups')}
        >
          🧬 按词根分组
          {groups.length > 0 && (
            <span className="view-tab-num">{groups.length}</span>
          )}
        </button>
      </div>

      <div className="book-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-btn${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="filter-num">
                {list.filter((i) => i.status === f.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="book-add">
        <input
          className="book-input"
          type="text"
          placeholder={
            lang === 'ru'
              ? '输入俄语单词，回车加入俄语生词本'
              : '输入单词，回车加入生词本（俄语自动识别）'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {/* 手动覆盖语言（缺省「自动」= 按 isCyrillic 判定） */}
        <select
          className="book-lang-select"
          title="加入哪个语言的生词本"
          value={choice}
          onChange={(e) => setChoice(e.target.value as LangChoice)}
        >
          <option value="auto">自动</option>
          <option value="en">🇬🇧 英语</option>
          <option value="ru">🇷🇺 俄语</option>
        </select>
        <button className="btn btn-primary" onClick={() => void add()}>
          添加
        </button>
      </div>

      {view === 'groups' ? (
        groups.length === 0 ? (
          <div className="empty">
            暂无分组数据：{lang === 'ru' ? '俄语' : '英语'}生词本为空，
            或词根词缀库未命中任何词
          </div>
        ) : (
          <>
            <BookGraph groups={groups} onPick={onPick} />
            <div className="book-groups">
              {groups.map((g) => (
                <div className="book-group" key={g.morpheme}>
                  <div className="book-group-head">
                    <span className={`morpheme-chip ${g.kind}`}>
                      {g.morpheme}
                    </span>
                    <span className="book-group-kind">
                      {KIND_LABEL[g.kind]}
                    </span>
                    {g.meaningZh && (
                      <span className="book-group-meaning">{g.meaningZh}</span>
                    )}
                    {g.origin && (
                      <span className="book-group-origin">源自 {g.origin}</span>
                    )}
                    <span className="book-group-count">{g.words.length} 词</span>
                  </div>
                  <div className="book-group-words">
                    {g.words.map((w) => (
                      <button
                        key={w}
                        className="book-group-word"
                        title={`查询 ${w}`}
                        onClick={() => onPick(w)}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                  {g.examples.length > 0 && (
                    <div className="book-group-examples">
                      例词：
                      {g.examples.slice(0, 8).map((ex) => (
                        <button
                          key={ex}
                          className="morpheme-example"
                          title={`查询 ${ex}`}
                          onClick={() => onPick(ex)}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )
      ) : visible.length === 0 ? (
        <div className="empty">
          {lang === 'ru' ? '🇷🇺 俄语' : '🇬🇧 英语'}生词本空空如也，快去查词收藏吧
        </div>
      ) : (
        <ul className="book-list">
          {visible.map((item) => (
            <li className="book-item" key={`${item.lang ?? lang}:${item.word}`}>
              <span className="book-word">
                {item.word}
                {item.lang === 'ru' && <span className="book-lang-badge">🇷🇺</span>}
              </span>
              <button
                className={`badge ${item.status}`}
                title="点击切换状态（新学→学习中→已掌握→已暂停）"
                onClick={() => void cycleStatus(item)}
              >
                {STATUS_LABEL[item.status]}
              </button>
              <span className="book-time">{fmtTime(item.addedAt)}</span>
              <button
                className="book-del"
                title="从生词本删除（只删当前语言）"
                onClick={() => void remove(item)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
