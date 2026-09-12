import type { MorphemeGroup, MorphemeKind } from '@zidiankaifa/core';

interface RelatedCardProps {
  /** 当前词（用于提示文案） */
  word: string;
  /** 按共享词素分组的同根词 */
  groups: MorphemeGroup[];
  loading?: boolean;
  /** 点击同根词 → 直接查词 */
  onPick: (word: string) => void;
  /** 点击词素 → 打开词根表/词缀表详情 */
  onMorpheme?: (morpheme: string) => void;
}

const KIND_LABEL: Record<MorphemeKind, string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
};

/**
 * 查词页「同根词 · 词族」：当前词经构词拆解关联到的词，按共享词素分组。
 * 与词源卡「提到的词」互补——能拆解的词在这里横向展开词族，
 * 拆不开的单词根词（луна/небо）则由词源链接补足。
 */
export default function RelatedCard({
  word,
  groups,
  loading,
  onPick,
  onMorpheme,
}: RelatedCardProps) {
  if (loading) {
    return (
      <div className="card related-card">
        <h3 className="card-title">同根词 · 词族</h3>
        <div className="empty">加载中…</div>
      </div>
    );
  }
  if (!groups.length) return null;

  const total = groups.reduce((s, g) => s + g.words.length, 0);

  return (
    <div className="card related-card">
      <h3 className="card-title">
        同根词 · 词族
        <span className="related-total">{total} 词</span>
      </h3>
      <div className="related-hint">
        与「{word}」共享构词成分的词，点词素可查看该词根/词缀的全部关联词
      </div>

      {groups.map((g) => (
        <div className="related-group" key={`${g.kind}-${g.morpheme}`}>
          <div className="related-head">
            <button
              type="button"
              className={`related-morpheme ${g.kind}`}
              title={onMorpheme ? `在词根/词缀表中查看 ${g.morpheme}` : undefined}
              onClick={() => onMorpheme?.(g.morpheme)}
            >
              {g.morpheme}
              <span className="related-kind">{KIND_LABEL[g.kind]}</span>
            </button>
            {g.meaningZh && <span className="related-meaning">{g.meaningZh}</span>}
            {g.origin && <span className="related-origin">源自 {g.origin}</span>}
            <span className="related-count">{g.words.length} 词</span>
          </div>
          <div className="related-words">
            {g.words.map((w) => (
              <button
                type="button"
                key={w}
                className="related-word"
                title={`查 ${w}`}
                onClick={() => onPick(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
