import type { WordEtymology, WordOrigin } from '@zidiankaifa/core';

interface OriginCardProps {
  origin: WordOrigin | null;
  etymology: WordEtymology | null;
}

function LangBadge({ text }: { text: string }) {
  return <span className="lang-badge">{text}</span>;
}

export default function OriginCard({ origin, etymology }: OriginCardProps) {
  const originName = etymology?.origin ?? origin?.origin ?? null;
  const chainWords = origin?.lineageWords?.length ? origin.lineageWords : null;
  const chainEtym = etymology?.chain?.length ? etymology.chain : null;
  const hasAny = !!(originName || chainWords || chainEtym || etymology?.textZh || etymology?.textEn);

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
          <span className="origin-value">{originName}</span>
          {etymology?.originCode && <span className="origin-code">{etymology.originCode}</span>}
          {origin && !etymology?.origin && origin.originCode && (
            <span className="origin-code">{origin.originCode}</span>
          )}
          <span className="origin-depth">源自 {originName}</span>
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
          <div className="origin-section-label">派生链（Wiktionary）</div>
          <div className="lineage" aria-label="Wiktionary 派生链">
            {chainEtym.map((step, i) => (
              <span className="lineage-item" key={`${step.lang}-${i}`}>
                {i > 0 && (
                  <span className="lineage-arrow" aria-hidden="true">
                    ←
                  </span>
                )}
                <span className="lineage-chip">
                  {step.word ?? step.parts?.join('+') ?? step.langZh}
                  <LangBadge text={step.langZh} />
                </span>
              </span>
            ))}
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
