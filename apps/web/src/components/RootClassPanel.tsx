import { useEffect, useState } from 'react';
import type { BookItem, MorphemeGroup } from '@zidiankaifa/core';
import { isCyrillic } from '@zidiankaifa/core';
import { getBackend } from '../api';

interface RootClassPanelProps {
  /** **当前查看语言**的生词（App 用 `bookList(lang)` 显式读取后传入） */
  items: BookItem[];
  /** 当前查看的语言（子页签值；由 App 持有 ⇒ App 的每次读取都能显式传它） */
  lang: ClassLang;
  /** 切换语言：通知 App 持久化并按新语言重新拉取 */
  onLangChange: (lang: ClassLang) => void;
  /** 点击单词回查 */
  onPick: (word: string) => void;
}

/**
 * 🌱 词根分类（v0.10.0 顶层第 5 面板，AC-17）
 *
 * ★ 职责区分（勿与 LexiconPanel 混淆、勿判为重复实现）：
 *   - `LexiconPanel.tsx`（`/lexicon`「词根词缀」面板）= **全库**词根/词缀表（与生词本无关）；
 *   - `RootClassPanel.tsx`（本文件）= **只对「生词本」内的词**按词根归类
 *     （数据来源 = 生词本按语言过滤后的 items → `groupBookByMorphemeData`）。
 *   ⇒ **生词本为空时必须显示空态**，**不得**回退成展示全库词根表。
 *
 * ★ 分层纪律（AC-17 第 6 条）：语言过滤发生在**后端 `bookGroups(lang)` 这一层**（先过滤 items），
 *   而**不是**词素库层 —— `packages/core/src/db/index.ts` 的 `groupBookByMorpheme` 只负责按
 *   `it.lang` 选对应的词素库去拆解，它**不**替调用方过滤语言。
 */

type ClassLang = 'en' | 'ru';

const LANG_TABS: { key: ClassLang; label: string }[] = [
  { key: 'en', label: '🇬🇧 英语' },
  { key: 'ru', label: '🇷🇺 俄语' },
];

const KIND_LABEL: Record<MorphemeGroup['kind'], string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
};

/** 条目语言（兼容旧数据：无 lang 字段时按词形判定） */
function itemLang(b: BookItem): string {
  return b.lang && b.lang !== 'auto' ? b.lang : isCyrillic(b.word) ? 'ru' : 'en';
}

export default function RootClassPanel({ items, lang, onLangChange, onPick }: RootClassPanelProps) {
  const [groups, setGroups] = useState<MorphemeGroup[]>([]);
  const [loading, setLoading] = useState(false);

  // items 已是「当前语言」的生词（App 侧显式 bookList(lang) 读取而来）⇒ 直接计数
  const bookCount = items.filter((b) => !b.deleted && itemLang(b) === lang).length;

  // 显式传 lang 读取（AC-16 第 7 条同源纪律）；语言过滤在后端 bookGroups(lang) 层完成
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBackend()
      .bookGroups?.(lang)
      .then((g) => {
        if (!cancelled) setGroups(g ?? []);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, items]);

  const label = lang === 'ru' ? '🇷🇺 俄语' : '🇬🇧 英语';

  return (
    <div className="card rootclass-panel">
      <div className="book-head">
        <h3 className="card-title">🌱 词根分类</h3>
        <span className="book-count">
          {label} 生词 {bookCount} 词 · 归入 {groups.length} 个词素
        </span>
      </div>

      <div className="book-lang-tabs">
        {LANG_TABS.map((t) => (
          <button
            key={t.key}
            className={`lang-tab${lang === t.key ? ' active' : ''}`}
            onClick={() => onLangChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="rootclass-hint">
        本面板只归类<strong>我的生词本</strong>里{label}的词（点词可回查）；
        全库词根/词缀表请到「🌱 词根词缀」面板。
      </p>

      {loading ? (
        <div className="empty">正在归类…</div>
      ) : groups.length === 0 ? (
        <div className="empty">
          {bookCount === 0
            ? `${label}生词本为空：先去查词并收藏，这里会自动按词根归类`
            : `${label}生词本共 ${bookCount} 词，但词根词缀库未命中任何词素`}
        </div>
      ) : (
        <div className="book-groups">
          {groups.map((g) => (
            <div className="book-group" key={`${lang}:${g.morpheme}`}>
              <div className="book-group-head">
                <span className={`morpheme-chip ${g.kind}`}>{g.morpheme}</span>
                <span className="book-group-kind">{KIND_LABEL[g.kind]}</span>
                {g.meaningZh && <span className="book-group-meaning">{g.meaningZh}</span>}
                {g.origin && <span className="book-group-origin">源自 {g.origin}</span>}
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
      )}
    </div>
  );
}
