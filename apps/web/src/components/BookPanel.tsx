import { useEffect, useState } from 'react';
import type { BookItem, BookStatus, MorphemeGroup } from '@zidiankaifa/core';
import { isCyrillic } from '@zidiankaifa/core';
import { getBackend } from '../api';
import BookGraph from './BookGraph';

interface BookPanelProps {
  items: BookItem[];
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

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

export default function BookPanel({ items, onChanged, onPick }: BookPanelProps) {
  const [filter, setFilter] = useState<BookStatus | 'all'>('all');
  const [input, setInput] = useState('');
  const [view, setView] = useState<'list' | 'groups'>('list');
  const [groups, setGroups] = useState<MorphemeGroup[]>([]);

  // 生词本变化时刷新词根分组
  useEffect(() => {
    let cancelled = false;
    getBackend()
      .bookGroups?.()
      .then((g) => {
        if (!cancelled) setGroups(g ?? []);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const visible =
    filter === 'all' ? items : items.filter((i) => i.status === filter);

  const cycleStatus = async (item: BookItem) => {
    const idx = STATUS_ORDER.indexOf(item.status);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    try {
      await getBackend().bookUpdate({
        ...item,
        status: next,
        updatedAt: Date.now(),
      });
    } catch {
      // 忽略
    }
    onChanged();
  };

  const remove = async (item: BookItem) => {
    try {
      await getBackend().bookRemove(item.word);
    } catch {
      // 忽略
    }
    onChanged();
  };

  const add = async () => {
    const w = input.trim();
    if (!w) return;
    try {
      // 西里尔输入 → 俄语生词，避免英俄混用
      await getBackend().bookAdd(w, [], isCyrillic(w) ? 'ru' : 'en');
    } catch {
      // 忽略
    }
    setInput('');
    onChanged();
  };

  return (
    <div className="card book-panel">
      <div className="book-head">
        <h3 className="card-title">生词本</h3>
        <span className="book-count">共 {items.length} 词</span>
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
                {items.filter((i) => i.status === f.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="book-add">
        <input
          className="book-input"
          type="text"
          placeholder="输入单词，回车加入生词本（俄语自动识别）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn btn-primary" onClick={() => void add()}>
          添加
        </button>
      </div>

      {view === 'groups' ? (
        groups.length === 0 ? (
          <div className="empty">
            暂无分组数据：生词本为空，或词根词缀库未命中任何词
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
        <div className="empty">生词本空空如也，快去查词收藏吧</div>
      ) : (
        <ul className="book-list">
          {visible.map((item) => (
            <li className="book-item" key={item.word}>
              <span className="book-word">
                {item.word}
                {item.lang && item.lang !== 'en' && (
                  <span className="book-lang-badge">🇷🇺</span>
                )}
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
                title="从生词本删除"
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
