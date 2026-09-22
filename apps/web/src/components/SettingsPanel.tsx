import { useState } from 'react';
import {
  authLogout,
  authRequest,
  getAuthEmail,
  getBackend,
  getSyncUrl,
  setSyncUrl,
} from '../api';
import UpdateCard from './UpdateCard';
import { isAutoUpdateEnabled, setAutoUpdateEnabled, useUpdateState } from '../useUpdate';

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
  const [autoCheck, setAutoCheck] = useState<boolean>(() => isAutoUpdateEnabled());
  const updateCtl = useUpdateState();

  // ★ AC-27：账号绑定（本地优先 —— 不绑定账号时生词本照常在本机使用，与 v0.10.0 完全一致）
  const [account, setAccount] = useState<string>(() => getAuthEmail());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  const doAuth = async (kind: 'register' | 'login') => {
    if (!email.trim() || !password) {
      setAuthMsg('请填写邮箱与口令（口令至少 8 位）');
      return;
    }
    setAuthBusy(true);
    setAuthMsg(null);
    const r = await authRequest(kind, email.trim(), password);
    setAuthBusy(false);
    if (r.ok) {
      setAccount(getAuthEmail());
      setPassword('');
      const claimed = r.claimed ? `，已认领本机存量生词本 ${r.claimed} 条` : '';
      setAuthMsg(r.message + claimed + '；点「开始同步」即可上传 / 拉取');
    } else {
      setAuthMsg(r.message);
    }
  };

  const doLogout = async () => {
    setAuthBusy(true);
    const r = await authLogout();
    setAuthBusy(false);
    setAccount('');
    setAuthMsg(r.message);
  };

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
          生词本同步服务地址；桌面端 / 浏览器 / 手机 App 均生效。
          <br />
          手机端填写电脑的局域网地址（如 <code>http://192.168.1.13:4570</code>），手机与电脑需同一 Wi-Fi。
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
        <span className="setting-label">账号（生词本同步）</span>
        <div className="setting-inline">
          {account ? (
            <>
              <span className="sync-msg">已绑定：{account}</span>
              <button className="btn" disabled={authBusy} onClick={() => void doLogout()}>
                {authBusy ? '处理中…' : '登出'}
              </button>
            </>
          ) : (
            <>
              <input
                className="book-input"
                type="email"
                value={email}
                placeholder="邮箱"
                autoComplete="email"
                spellCheck={false}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="book-input"
                type="password"
                value={password}
                placeholder="口令（至少 8 位）"
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={authBusy}
                onClick={() => void doAuth('login')}
              >
                登录
              </button>
              <button className="btn" disabled={authBusy} onClick={() => void doAuth('register')}>
                注册
              </button>
            </>
          )}
        </div>
        {authMsg && <div className="sync-msg">{authMsg}</div>}
        <div className="setting-hint">
          不绑定账号时，生词本只存在本机（与旧版一致，照常可用）。
          <br />
          绑定后不同账号的生词本互相隔离；<strong>首个账号会认领本机已有的生词本</strong>。
          <br />
          ⚠ 服务端一旦存在账号，同步就必须登录 —— 未登录时「开始同步」会失败。
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

      <UpdateCard
        ctl={updateCtl}
        autoCheck={autoCheck}
        onToggleAutoCheck={(on) => {
          setAutoCheck(on);
          setAutoUpdateEnabled(on);
        }}
      />

      <div className="setting-row about">
        <span className="setting-label">关于</span>
        <div className="about-info">
          <div>我的电子辞典 v0.11.0</div>
          <div>词库来源：ECDICT（开源英汉词典数据）</div>
          <div>词源、词形、词根拆解由后端计算生成</div>
          <div>支持桌面端（Electron）与浏览器 / PWA 双模式</div>
        </div>
      </div>
    </div>
  );
}

