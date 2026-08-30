/**
 * 生词本知识图谱（桌面端简易 SVG）
 * 每个词根/词缀为一幅星形图：中心=词素节点，环绕=命中该词素的生词。
 * 点击单词节点回查该词。
 */
import type { MorphemeGroup } from '@zidiankaifa/core';

interface BookGraphProps {
  groups: MorphemeGroup[];
  onPick: (word: string) => void;
}

const KIND_LABEL: Record<MorphemeGroup['kind'], string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
};

const W = 280;
const H = 190;
const CX = W / 2;
const CY = H / 2;
const R = 68;

function fitText(text: string, maxLen = 14): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export default function BookGraph({ groups, onPick }: BookGraphProps) {
  if (groups.length === 0) return null;
  return (
    <div className="book-graph">
      <div className="book-graph-title">
        🕸️ 知识图谱 —— 词根词缀把生词联系起来
      </div>
      <div className="book-graph-grid">
        {groups.map((g) => {
          const words = g.words.slice(0, 8);
          return (
            <div className="graph-cell" key={g.morpheme}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width={W}
                height={H}
                role="img"
                aria-label={`词素 ${g.morpheme}（${KIND_LABEL[g.kind]}）关联 ${words.length} 个生词`}
              >
                {words.map((w, i) => {
                  const ang = (2 * Math.PI * i) / words.length - Math.PI / 2;
                  const x = CX + R * Math.cos(ang);
                  const y = CY + R * Math.sin(ang);
                  return (
                    <g key={w}>
                      <line
                        x1={CX}
                        y1={CY}
                        x2={x}
                        y2={y}
                        className="graph-edge"
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={15}
                        className={`graph-word-node ${g.kind}`}
                        onClick={() => onPick(w)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') onPick(w);
                        }}
                      >
                        <title>{w}</title>
                      </circle>
                      <text
                        x={x}
                        y={y + 4}
                        textAnchor="middle"
                        className="graph-word-text"
                        onClick={() => onPick(w)}
                      >
                        {fitText(w)}
                      </text>
                    </g>
                  );
                })}
                <circle
                  cx={CX}
                  cy={CY}
                  r={20}
                  className={`graph-root-node ${g.kind}`}
                >
                  <title>{`${g.morpheme}：${g.meaningZh}`}</title>
                </circle>
                <text
                  x={CX}
                  y={CY + 4}
                  textAnchor="middle"
                  className="graph-root-text"
                >
                  {fitText(g.morpheme, 8)}
                </text>
              </svg>
              <div className="graph-cell-cap">
                {g.morpheme} · {KIND_LABEL[g.kind]}
                {g.meaningZh ? ` · ${g.meaningZh}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
