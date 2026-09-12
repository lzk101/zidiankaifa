import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SuggestItem } from '@zidiankaifa/core';
import { getBackend } from '../api';

interface SearchBarProps {
  onPick: (word: string) => void;
  placeholder?: string;
  /** 当前查询语言模式：'ru' 时建议只返回俄语项，'en' 只返回英语项，'auto' 按输入脚本判定 */
  lang?: string;
}

export default function SearchBar({
  onPick,
  placeholder = '输入单词，回车查询…',
  lang,
}: SearchBarProps) {
  const [value, setValue] = useState('');
  const [suggests, setSuggests] = useState<SuggestItem[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 120ms 防抖拉取建议（语言切换时重新拉取）
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setSuggests([]);
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      getBackend()
        .suggest(q, 8, lang)
        .then((list) => {
          setSuggests(list);
          setActive(list.length > 0 ? 0 : -1);
          setOpen(list.length > 0);
        })
        .catch(() => {
          setSuggests([]);
          setOpen(false);
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [value, lang]);

  // 点击外部关闭下拉
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (word: string) => {
    setValue(word);
    setOpen(false);
    onPick(word);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open && suggests.length > 0) {
        setActive((a) => (a + 1) % suggests.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open && suggests.length > 0) {
        setActive((a) => (a - 1 + suggests.length) % suggests.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && suggests[active]) {
        pick(suggests[active].word);
      } else if (value.trim()) {
        pick(value.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    }
  };

  return (
    <div className="search-wrap" ref={wrapRef}>
      <input
        className="search-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (suggests.length > 0) setOpen(true);
        }}
        aria-label="查词搜索框"
        autoComplete="off"
        spellCheck={false}
      />
      {open && suggests.length > 0 && (
        <div className="suggest-panel" role="listbox" aria-label="搜索建议">
          {suggests.map((s, i) => {
            const freq = s.frq ?? s.bnc;
            // 混排（中文反查含英俄）或俄语项时显示语言徽章
            const mixed = suggests.some((x) => x.lang === 'ru');
            const showBadge = s.lang === 'ru' || mixed;
            return (
              <div
                key={s.word}
                role="option"
                aria-selected={i === active}
                className={`suggest-item${i === active ? ' active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s.word)}
              >
                {showBadge && (
                  <span className={`suggest-lang ${s.lang === 'ru' ? 'ru' : 'en'}`}>
                    {s.lang === 'ru' ? '🇷🇺' : '🇬🇧'}
                  </span>
                )}
                <span className="suggest-word">{s.word}</span>
                <span className="suggest-freq">
                  {freq != null ? `频次 ${freq}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
