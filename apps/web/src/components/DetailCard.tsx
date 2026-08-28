import { useEffect, useState } from 'react';
import type { SuggestItem, WordDetail } from '@zidiankaifa/core';
import { getBackend } from '../api';

interface DetailCardProps {
  /** 最近一次查询的词（未收录时用于相近词建议） */
  query: string;
  detail: WordDetail | null;
  searching: boolean;
  onPick: (word: string) => void;
  onToggleBook: (word: string) => void;
}

/** 考试标签映射：zk→中考 gk→高考 cet4→四级 cet6→六级 ky→考研 toefl→托福 gre→GRE ielts→雅思 */
const TAG_MAP: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  gre: 'GRE',
  ielts: '雅思',
};

/** 把 translation 中的 <br/> 与 \n 统一拆成行，避免直接注入 HTML */
function splitLines(t: string | null): string[] {
  if (!t) return [];
  return t
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function DetailCard({
  query,
  detail,
  searching,
  onPick,
  onToggleBook,
}: DetailCardProps) {
  const [speaking, setSpeaking] = useState(false);
  const [suggests, setSuggests] = useState<SuggestItem[]>([]);

  const notFound = !searching && detail === null;

  // 未收录时拉取相近词
  useEffect(() => {
    if (!notFound || !query.trim()) {
      setSuggests([]);
      return;
    }
    let cancelled = false;
    getBackend()
      .suggest(query.trim(), 8)
      .then((list) => {
        if (!cancelled) setSuggests(list);
      })
      .catch(() => {
        if (!cancelled) setSuggests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notFound, query]);

  const speak = async (word: string) => {
    if (speaking) return;
    setSpeaking(true);
    try {
      await getBackend().speak(word);
    } catch {
      // 发音失败静默处理
    } finally {
      setSpeaking(false);
    }
  };

  if (searching) {
    return (
      <div className="card detail-card loading">
        <span className="loading-spinner" aria-hidden="true" />
        正在查询…
      </div>
    );
  }

  if (!detail) {
    if (!query.trim()) {
      return (
        <div className="card detail-card not-found">
          <div className="not-found-title">📖 开始查词吧</div>
          <div className="muted">
            在上方输入英文单词，即可查看释义、发音、词源与词根拆解
          </div>
        </div>
      );
    }
    return (
      <div className="card detail-card not-found">
        <div className="not-found-title">未收录该词</div>
        <div className="muted">没有找到与「{query || '…'}」匹配的词条</div>
        {suggests.length > 0 && (
          <div className="related">
            <div className="related-label">相近词：</div>
            <div className="related-list">
              {suggests.map((s) => (
                <button
                  key={s.word}
                  className="chip-btn"
                  onClick={() => onPick(s.word)}
                >
                  {s.word}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const collins = detail.collins ?? 0;
  const oxford = detail.oxford ?? 0;
  const freq = detail.bnc ?? detail.frq;
  const tags = detail.tag
    ? detail.tag.split(/\s+/).filter(Boolean)
    : [];
  const transLines = splitLines(detail.translation);

  return (
    <div className="card detail-card">
      <div className="detail-head">
        <h2 className="detail-word">{detail.word}</h2>
        <div className="detail-actions">
          <button
            className="btn speak-btn"
            title="发音"
            disabled={speaking}
            onClick={() => void speak(detail.word)}
          >
            🔊 {speaking ? '发音中…' : '发音'}
          </button>
          <button
            className={`btn fav-btn${detail.inBook ? ' faved' : ''}`}
            title={detail.inBook ? '取消收藏' : '加入生词本'}
            onClick={() => onToggleBook(detail.word)}
          >
            {detail.inBook ? '★ 已收藏' : '☆ 收藏'}
          </button>
        </div>
      </div>

      <div className="detail-phonetic">
        {detail.phonetic ? detail.phonetic : '暂无音标'}
      </div>

      <div className="detail-badges">
        {collins > 0 && (
          <span className="stars" title="柯林斯星级">
            柯林斯 {'★'.repeat(Math.min(collins, 5))}
          </span>
        )}
        {oxford > 0 && (
          <span className="stars" title="牛津星级">
            牛津 {'★'.repeat(Math.min(oxford, 5))}
          </span>
        )}
        {freq != null && (
          <span className="freq-chip">语料频次 第 {freq} 位</span>
        )}
        {tags.map((t) => (
          <span className="tag-chip" key={t}>
            {TAG_MAP[t] ?? t}
          </span>
        ))}
      </div>

      <div className="detail-def">
        {detail.pos && <span className="pos">{detail.pos}</span>}
        <span className="definition">
          {detail.definition || '暂无英英释义'}
        </span>
      </div>

      {transLines.length > 0 && (
        <div className="detail-trans">
          {transLines.map((line, i) => (
            <div className="trans-line" key={i}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
