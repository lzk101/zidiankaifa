import { useEffect, useState } from 'react';
import type { WordDetail } from '@zidiankaifa/core';
import { getBackend } from '../api';

interface ClipboardPopupProps {
  text: string;
  onClose: () => void;
  /** 收藏变化后通知 App 刷新生词本 */
  onBookChanged?: () => void;
}

export default function ClipboardPopup({
  text,
  onClose,
  onBookChanged,
}: ClipboardPopupProps) {
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [speaking, setSpeaking] = useState(false);

  // 挂载后 8 秒自动关闭
  useEffect(() => {
    const timer = window.setTimeout(onClose, 8000);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  // 取词：查询剪贴板内容
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    const word = text.trim();
    if (!word) return;
    getBackend()
      .lookup(word)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const word = detail?.word ?? text.trim();
  const firstLine = detail?.translation
    ? (detail.translation
        .replace(/<br\s*\/?>/gi, '\n')
        .split('\n')
        .map((s) => s.trim())
        .find(Boolean) ?? '')
    : '';

  const speak = async () => {
    if (speaking || !word) return;
    setSpeaking(true);
    try {
      await getBackend().speak(word);
    } catch {
      // 忽略发音失败
    } finally {
      setSpeaking(false);
    }
  };

  const toggleBook = async () => {
    if (!detail) return;
    // v0.10.0：按 (word, lang) 操作 —— 弹窗里的词条语言由 i18n 决定，缺省英语
    const lang = detail.i18n?.lang ?? 'en';
    try {
      if (detail.inBook) {
        await getBackend().bookRemove(detail.word, lang);
      } else {
        await getBackend().bookAdd(detail.word, [], lang);
      }
    } catch {
      // 忽略
    }
    setDetail({ ...detail, inBook: !detail.inBook });
    onBookChanged?.();
  };

  return (
    <div className="clipboard-popup" role="dialog" aria-label="剪贴板取词">
      <button className="popup-close" title="关闭" onClick={onClose}>
        ✕
      </button>
      <div className="popup-title">📋 剪贴板取词</div>
      <div className="popup-word">{word}</div>
      <div className="popup-trans">
        {detail ? firstLine || '（无释义）' : '查询中…'}
      </div>
      <div className="popup-actions">
        <button
          className="btn speak-btn"
          disabled={speaking}
          onClick={() => void speak()}
        >
          🔊 发音
        </button>
        <button
          className={`btn fav-btn${detail?.inBook ? ' faved' : ''}`}
          disabled={!detail}
          onClick={() => void toggleBook()}
        >
          {detail?.inBook ? '★ 已收藏' : '☆ 收藏'}
        </button>
      </div>
    </div>
  );
}
