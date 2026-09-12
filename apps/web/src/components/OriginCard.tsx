import type { BreakdownPart, WordEtymology, WordOrigin } from '@zidiankaifa/core';

interface OriginCardProps {
  origin: WordOrigin | null;
  etymology: WordEtymology | null;
  /** 词根词缀拆解（构词成分，衔接演变链） */
  breakdown?: BreakdownPart[];
}

const KIND_LABEL: Record<BreakdownPart['kind'], string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
};

function LangBadge({ text }: { text: string }) {
  return <span className="lang-badge">{text}</span>;
}

export default function OriginCard({
  origin,
  etymology,
  breakdown,
}: OriginCardProps) {
  const originName = etymology?.origin ?? origin?.origin ?? null;
  const chainWords = origin?.lineageWords?.length ? origin.lineageWords : null;
  const chainEtym = etymology?.chain?.length ? etymology.chain : null;
  const hasAny = !!(originName || chainWords || chainEtym || etymology?.textZh || etymology?.textEn || (breakdown && breakdown.length > 0));

  if (!hasAny) {
    return (
      <div className="card origin-card">
        <h3 className="card-title">词源 · 语言发展</h3>
        <div className="empty">暂无词源数据</div>
      </div>
    );
  }

  return (
    <div className="card origin-card">
      <h3 className="card-title">词源 · 语言发展</h3>

      {originName && (
        <div className="origin-hero">
          <span className="origin-value">{originName === '构词' ? '构词法' : originName}</span>
          {etymology?.originCode && <span className="origin-code">{etymology.originCode}</span>}
          {origin && !etymology?.origin && origin.originCode && (
            <span className="origin-code">{origin.originCode}</span>
          )}
          <span className="origin-depth">{originName === '构词' ? '派生 / 复合构词' : `源自 ${originName}`}</span>
        </div>
      )}

      {breakdown && breakdown.length > 0 && (
        <div className="origin-section construction-section">
          <div className="origin-section-label">构词成分（词根词缀）</div>
          <div className="construction" aria-label="词素级构词路径">
            {breakdown.map((p, i) => (
              <span className="construction-item" key={`${p.morpheme}-${i}`}>
                {i > 0 && (
                  <span className="construction-plus" aria-hidden="true">
                    +
                  </span>
                )}
                <span className={`construction-chip ${p.kind}`}>
                  {p.morpheme}
                  <span className="construction-kind">
                    {KIND_LABEL[p.kind]}
                  </span>
                  {p.meaningZh && (
                    <span className="construction-meaning">{p.meaningZh}</span>
                  )}
                  {p.origin && (
                    <span className="construction-origin">源自 {p.origin}</span>
                  )}
                </span>
              </span>
            ))}
          </div>
          <div className="construction-hint">
            由 {breakdown.length} 个词素构成，与下方演变链（词级）共同构成完整发展路径
          </div>
        </div>
      )}

      {chainWords && chainWords.length > 1 && (
        <div className="origin-section">
          <div className="origin-section-label">演变链</div>
          <div className="lineage" aria-label="词级语源演变链">
            {chainWords.map((step, i) => (
              <span className="lineage-item" key={`${step.w}-${i}`}>
                {i > 0 && (
                  <span className="lineage-arrow" aria-hidden="true">
                    ←
                  </span>
                )}
                <span className="lineage-chip">
                  {step.w}
                  <LangBadge text={step.lz} />
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!chainWords && chainEtym && chainEtym.length > 0 && (
        <div className="origin-section">
          <div className="origin-section-label">
            派生链（Wiktionary）
            {chainEtym.some((s) => s.kind === 'cognate') && (
              <span className="cognate-hint">灰底为同源词（非派生来源）</span>
            )}
          </div>
          <div className="lineage" aria-label="Wiktionary 派生链">
            {chainEtym.map((step, i) => {
              const isCognate = step.kind === 'cognate';
              return (
                <span className="lineage-item" key={`${step.lang}-${i}`}>
                  {i > 0 && (
                    <span className="lineage-arrow" aria-hidden="true">
                      ←
                    </span>
                  )}
                  <span className={`lineage-chip${isCognate ? ' cognate' : ''}`}>
                    {step.word ?? step.parts?.join('+') ?? step.langZh}
                    <LangBadge text={step.langZh} />
                    {isCognate && <span className="cognate-tag">同源</span>}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {!chainWords && !chainEtym && origin && origin.lineage.length > 0 && (
        <div className="origin-section">
          <div className="origin-section-label">演变链</div>
          <div className="lineage" aria-label="语源演变链">
            {origin.lineage.map((lang, i) => (
              <span className="lineage-item" key={`${lang}-${i}`}>
                {i > 0 && (
                  <span className="lineage-arrow" aria-hidden="true">
                    ←
                  </span>
                )}
                <span className="lineage-chip">{lang}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(etymology?.textZh || etymology?.textEn) && (
        <div className="origin-section">
          <div className="origin-section-label">
            词源详解
            {etymology?.source && <span className="origin-source">Wiktionary</span>}
          </div>
          {etymology?.textZh && (
            <p className="origin-text">
              <span className="origin-text-tag">中</span>
              {etymology.textZh}
            </p>
          )}
          {etymology?.textEn && (
            <p className="origin-text origin-text-en">
              <span className="origin-text-tag">EN</span>
              {etymology.textEn}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
