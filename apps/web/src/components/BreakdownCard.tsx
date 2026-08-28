import type { BreakdownPart, MorphemeKind } from '@zidiankaifa/core';

interface BreakdownCardProps {
  word: string;
  breakdown: BreakdownPart[];
}

const KIND_LABEL: Record<MorphemeKind, string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
};

export default function BreakdownCard({
  word,
  breakdown,
}: BreakdownCardProps) {
  // 先拼接整词字母串：命中的词素片段着色，其余字母灰色
  const hitMap: (MorphemeKind | null)[] = new Array(word.length).fill(null);
  for (const p of breakdown) {
    if (p.start >= 0 && p.end > p.start) {
      const s = Math.min(p.start, word.length);
      const e = Math.min(p.end, word.length);
      for (let i = s; i < e; i += 1) {
        hitMap[i] = p.kind;
      }
    }
  }

  return (
    <div className="card breakdown-card">
      <h3 className="card-title">词根词缀拆解</h3>
      {breakdown.length === 0 ? (
        <div className="empty">暂未拆解</div>
      ) : (
        <div className="breakdown-body">
          <div className="word-letters" aria-label={`${word} 的词素着色`}>
            {word.split('').map((ch, i) => (
              <span
                key={i}
                className={`letter${hitMap[i] ? ` hit-${hitMap[i]}` : ''}`}
              >
                {ch}
              </span>
            ))}
          </div>
          <div className="morpheme-list">
            {breakdown.map((p, i) => (
              <div className="morpheme-row" key={`${p.morpheme}-${i}`}>
                <span className={`morpheme-chip ${p.kind}`}>{p.morpheme}</span>
                <span className="morpheme-kind">{KIND_LABEL[p.kind]}</span>
                <span className="morpheme-meaning">{p.meaningZh}</span>
                {p.origin && (
                  <span className="morpheme-origin">源自 {p.origin}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
