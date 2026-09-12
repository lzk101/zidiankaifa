/**
 * 设置面板内的「软件更新」卡片
 * - 桌面端：检查 / 下载（带进度）/ 重启安装 / 打开发布页 / 启动自动检查开关
 * - 浏览器模式：提示手动更新方式（刷新即获取最新版）
 */
import { useState } from 'react';
import type { UpdateController } from '../useUpdate';
import { describeUpdate, formatBytes } from '../useUpdate';

interface UpdateCardProps {
  ctl: UpdateController;
  autoCheck: boolean;
  onToggleAutoCheck: (on: boolean) => void;
}

export default function UpdateCard({ ctl, autoCheck, onToggleAutoCheck }: UpdateCardProps) {
  const { supported, state } = ctl;
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <div className="setting-row">
        <span className="setting-label">软件更新</span>
        <div className="setting-inline setting-stack">
          <span className="update-status">浏览器 / PWA 模式：刷新页面即获取最新版</span>
          <span className="setting-hint">自动更新仅桌面端（Electron）可用</span>
        </div>
      </div>
    );
  }

  const phase = state?.phase ?? 'idle';
  const downloading = phase === 'downloading';
  const percent = state?.percent ?? 0;

  return (
    <div className="setting-row update-row">
      <span className="setting-label">软件更新</span>
      <div className="setting-inline setting-stack">
        <div className="update-line">
          <span className={`update-status phase-${phase}`}>{describeUpdate(state)}</span>
          {state?.version && (phase === 'available' || phase === 'downloaded') && (
            <span className="update-version-tag">
              v{state.currentVersion} → v{state.version}
            </span>
          )}
        </div>

        {downloading && (
          <div className="update-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="update-progress-bar" style={{ width: `${percent}%` }} />
            <span className="update-progress-text">
              {percent}%{state && state.total > 0 ? ` · ${formatBytes(state.transferred)} / ${formatBytes(state.total)}` : ''}
              {state && state.bytesPerSecond > 0 ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ''}
            </span>
          </div>
        )}

        <div className="update-actions">
          <button className="btn" disabled={busy || downloading} onClick={() => void run(ctl.check)}>
            {phase === 'checking' ? '检查中…' : '检查更新'}
          </button>

          {phase === 'available' && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void run(ctl.download)}>
              下载更新
            </button>
          )}

          {phase === 'downloaded' && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void run(ctl.install)}>
              立即重启并安装
            </button>
          )}

          <button className="btn btn-ghost" onClick={() => void ctl.openRelease()}>
            打开发布页
          </button>
        </div>

        {state?.portable && (
          <span className="setting-hint warn">
            当前为便携版：请从发布页下载新版 exe 覆盖使用
          </span>
        )}

        {phase === 'downloaded' && (
          <span className="setting-hint">下载已完成，重启安装时会自动关闭并更新，安装后自动启动</span>
        )}

        {phase === 'error' && state?.message && (
          <span className="setting-hint warn">{state.message}</span>
        )}

        <label className="update-auto">
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={(e) => onToggleAutoCheck(e.target.checked)}
          />
          启动时自动检查更新
        </label>

        {state?.checkedAt && (
          <span className="setting-hint">
            上次检查：{new Date(state.checkedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
