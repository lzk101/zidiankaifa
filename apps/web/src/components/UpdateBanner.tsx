/**
 * 桌面上部更新提示条：有可用更新 / 正在下载 / 下载完成时出现
 */
import type { UpdateController } from '../useUpdate';
import { describeUpdate, formatBytes } from '../useUpdate';

interface UpdateBannerProps {
  ctl: UpdateController;
  onDismiss: () => void;
}

export default function UpdateBanner({ ctl, onDismiss }: UpdateBannerProps) {
  const { state } = ctl;
  if (!state) return null;
  const { phase } = state;
  if (phase !== 'available' && phase !== 'downloading' && phase !== 'downloaded') {
    return null;
  }

  const speed = state.bytesPerSecond > 0 ? ` · ${formatBytes(state.bytesPerSecond)}/s` : '';
  const size = state.total > 0 ? formatBytes(state.total) : '';

  return (
    <div className={`update-banner ${phase}`} role="status">
      <span className="update-banner-icon" aria-hidden="true">
        {phase === 'downloaded' ? '✅' : '⬆️'}
      </span>
      <span className="update-banner-text">
        {describeUpdate(state)}
        {phase === 'downloading' && size && (
          <span className="update-banner-sub">
            {formatBytes(state.transferred)} / {size}
            {speed}
          </span>
        )}
      </span>

      {phase === 'downloading' && (
        <span className="update-progress-inline" aria-hidden="true">
          <span className="update-progress-bar" style={{ width: `${state.percent}%` }} />
        </span>
      )}

      <span className="update-banner-actions">
        {phase === 'available' && (
          <button className="btn btn-primary btn-sm" onClick={() => void ctl.download()}>
            下载更新
          </button>
        )}
        {phase === 'downloaded' && (
          <button className="btn btn-primary btn-sm" onClick={() => void ctl.install()}>
            立即重启安装
          </button>
        )}
        {phase === 'available' && (
          <button className="btn btn-sm" onClick={() => void ctl.openRelease()}>
            查看更新说明
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={onDismiss} title="本次忽略">
          ✕
        </button>
      </span>
    </div>
  );
}
