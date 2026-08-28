import type { WordOrigin } from '@zidiankaifa/core';

interface OriginCardProps {
  origin: WordOrigin | null;
}

export default function OriginCard({ origin }: OriginCardProps) {
  return (
    <div className="card origin-card">
      <h3 className="card-title">词源 · 语言发展</h3>
      {origin ? (
        <div className="origin-body">
          <div className="origin-name">
            <span className="origin-value">{origin.origin}</span>
            {origin.originCode && (
              <span className="origin-code">{origin.originCode}</span>
            )}
          </div>
          {origin.lineage.length > 0 && (
            <div className="lineage" aria-label="语源演变链">
              {origin.lineage.map((lang, i) => (
                <span className="lineage-item" key={`${lang}-${i}`}>
                  {i > 0 && (
                    <span className="lineage-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                  <span className="lineage-chip">{lang}</span>
                </span>
              ))}
            </div>
          )}
          <div className="origin-depth">演变 {origin.depth} 级</div>
        </div>
      ) : (
        <div className="empty">暂无词源数据</div>
      )}
    </div>
  );
}
