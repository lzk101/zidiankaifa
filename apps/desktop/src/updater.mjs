/**
 * 自动更新（electron-updater）
 *
 * 状态机：idle → checking → (available | not-available) → downloading → downloaded
 *                                     ↘ error ↗
 *
 * 设计要点：
 * - autoDownload = false：安装包 ~180MB，由用户确认后再下载
 * - autoInstallOnAppQuit = true：下载完成后退出时自动安装
 * - 支持 ZIDIANKAFA_UPDATE_URL 覆盖更新源（generic provider，可指向镜像/内网）
 * - 支持 ZIDIANKAFA_FORCE_DEV_UPDATE=1 + dev-app-update.yml：开发模式验证更新流程
 * - 便携版（PORTABLE_EXECUTABLE_DIR）无法自更新，状态标记 portable 由前端提示手动下载
 */
import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

/** @typedef {'idle'|'checking'|'available'|'downloading'|'downloaded'|'not-available'|'error'|'unsupported'} UpdatePhase */

const RELEASE_PAGE = 'https://github.com/lzk101/zidiankaifa/releases/latest';

function isPortable() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

export function createUpdater({ onChange, log = () => {} } = {}) {
  /** @type {{phase: UpdatePhase, currentVersion: string, version: string|null, releaseName: string|null, releaseNotes: string|null, percent: number, transferred: number, total: number, bytesPerSecond: number, message: string|null, portable: boolean, releasePage: string, checkedAt: number|null}} */
  let state = {
    phase: 'idle',
    currentVersion: app.getVersion(),
    version: null,
    releaseName: null,
    releaseNotes: null,
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    message: null,
    portable: isPortable(),
    releasePage: RELEASE_PAGE,
    checkedAt: null,
  };

  const emit = (patch = {}) => {
    state = { ...state, ...patch, currentVersion: app.getVersion() };
    try {
      onChange?.(state);
    } catch (e) {
      log(`onChange failed: ${e}`);
    }
    return state;
  };

  // 自定义更新源（generic）：只改 feed，不动 provider 结构
  const customUrl = (process.env.ZIDIANKAFA_UPDATE_URL || '').trim();
  if (customUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: customUrl.replace(/\/+$/, '') });
      log(`update feed overridden: ${customUrl}`);
    } catch (e) {
      log(`setFeedURL failed: ${e}`);
    }
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  log(
    `updater config: autoDownload=${autoUpdater.autoDownload} autoInstallOnAppQuit=${autoUpdater.autoInstallOnAppQuit} feed=${customUrl || 'package.json publish (github)'}`,
  );
  // 开发模式验证更新流程：需要 dev-app-update.yml + forceDevUpdateConfig
  if (process.env.ZIDIANKAFA_FORCE_DEV_UPDATE === '1') {
    autoUpdater.forceDevUpdateConfig = true;
    log('forceDevUpdateConfig enabled (dev update test)');
  }
  autoUpdater.logger = {
    info: (m) => log(`[updater] ${m}`),
    warn: (m) => log(`[updater:warn] ${m}`),
    error: (m) => log(`[updater:error] ${m}`),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => emit({ phase: 'checking', message: null }));

  autoUpdater.on('update-available', (info) => {
    emit({
      phase: 'available',
      version: info?.version ?? null,
      releaseName: info?.releaseName ?? null,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : null,
      message: null,
      checkedAt: Date.now(),
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    emit({
      phase: 'not-available',
      version: info?.version ?? null,
      message: null,
      checkedAt: Date.now(),
    });
  });

  autoUpdater.on('download-progress', (p) => {
    emit({
      phase: 'downloading',
      percent: Math.round(Number(p?.percent ?? 0)),
      transferred: Number(p?.transferred ?? 0),
      total: Number(p?.total ?? 0),
      bytesPerSecond: Number(p?.bytesPerSecond ?? 0),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emit({
      phase: 'downloaded',
      version: info?.version ?? state.version,
      percent: 100,
      message: null,
    });
  });

  autoUpdater.on('error', (err) => {
    emit({
      phase: 'error',
      message: humanError(err),
      checkedAt: Date.now(),
    });
  });

  return {
    getState: () => state,

    /** 检查更新；返回最新状态（状态变化另有 onChange 推送） */
    async check() {
      if (isPortable()) {
        return emit({
          phase: 'unsupported',
          portable: true,
          message: '便携版不支持自动更新，请到发布页下载新版',
          checkedAt: Date.now(),
        });
      }
      emit({ phase: 'checking', message: null });
      try {
        autoUpdater.autoDownload = false; // 每次检查前重申：只有用户点「下载更新」才应下载
        log(`check: autoDownload=${autoUpdater.autoDownload}`);
        const res = await autoUpdater.checkForUpdates();
        log(
          `check done: available=${res?.isUpdateAvailable} hasDownloadPromise=${!!res?.downloadPromise} autoDownload=${autoUpdater.autoDownload}`,
        );
        // 兜底：若库内部仍启动了自动下载（autoDownload 被覆盖等），立即取消，保留用户确认权
        if (res?.downloadPromise) {
          log('unexpected auto-download detected → cancelling');
          try {
            res.cancellationToken?.cancel?.();
          } catch (e) {
            log(`cancel failed: ${e}`);
          }
        }
      } catch (e) {
        emit({ phase: 'error', message: humanError(e), checkedAt: Date.now() });
      }
      return state;
    },

    async download() {
      if (state.phase !== 'available' && state.phase !== 'error') return state;
      try {
        emit({ phase: 'downloading', percent: 0, message: null });
        await autoUpdater.downloadUpdate();
      } catch (e) {
        emit({ phase: 'error', message: humanError(e) });
      }
      return state;
    },

    /** 退出并安装（isSilent=false 显示安装界面，isForceRunAfter=true 安装后自动启动） */
    install() {
      if (state.phase !== 'downloaded') return false;
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (e) {
          log(`quitAndInstall failed: ${e}`);
        }
      });
      return true;
    },
  };
}

function humanError(err) {
  const raw = err instanceof Error ? err.message : String(err ?? '未知错误');
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network|net::/i.test(raw)) {
    return `网络连接失败，请检查网络后重试（${raw.slice(0, 120)}）`;
  }
  if (/404|Cannot find latest|no published versions/i.test(raw)) {
    return '未找到可用更新（发布页暂无新版本）';
  }
  if (/sha512|checksum/i.test(raw)) {
    return `安装包校验失败，请重试（${raw.slice(0, 120)}）`;
  }
  return raw.slice(0, 200);
}
