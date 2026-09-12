import { useState } from 'react';
import { getBackend, getSyncUrl, setSyncUrl } from '../api';

type Theme = 'light' | 'dark';

export default function SettingsPanel() {
  const [syncUrl, setUrl] = useState<string>(getSyncUrl());
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const saveUrl = () => {
    setSyncUrl(syncUrl.trim());
    setSyncMsg('同步服务器地址已保存');
  };

  const doSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const r = await getBackend().syncNow();
    setSyncing(false);
    setSyncMsg(
      r.ok
        ? `同步完成：推送 ${r.pushed} 条，拉取 ${r.pulled} 条`
        : `同步失败：${r.message ?? '未知错误'}`,
    );
  };

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('zidian-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <div className="card settings-panel">
      <h3 className="card-title">设置</h3>

      <div className="setting-row">
        <label className="setting-label" htmlFor="sync-url">
          同步服务器地址
        </label>
        <div className="setting-inline">
          <input
            id="sync-url"
            className="book-input"
            type="text"
            value={syncUrl}
            placeholder="http://localhost:4570"
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" onClick={saveUrl}>
            保存
          </button>
        </div>
        <div className="setting-hint">
          生词本同步服务地址；浏览器 / PWA 模式生效。
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label">立即同步</span>
        <div className="setting-inline">
          <button
            className="btn btn-primary"
            disabled={syncing}
            onClick={() => void doSync()}
          >
            {syncing ? '同步中…' : '开始同步'}
          </button>
          {syncMsg && <span className="sync-msg">{syncMsg}</span>}
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label">主题</span>
        <div className="setting-inline">
          <button className="btn" onClick={toggleTheme}>
            {theme === 'light' ? '🌙 切换到深色' : '☀️ 切换到浅色'}
          </button>
        </div>
      </div>

      <div className="setting-row about">
        <span className="setting-label">关于</span>
        <div className="about-info">
          <div>我的电子辞典 v0.3.0</div>
          <div>词库来源：ECDICT（开源英汉词典数据）</div>
          <div>词源、词形、词根拆解由后端计算生成</div>
          <div>支持桌面端（Electron）与浏览器 / PWA 双模式</div>
        </div>
      </div>
    </div>
  );
}
