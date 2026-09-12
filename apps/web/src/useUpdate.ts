/**
 * 自动更新状态 hook（仅 Electron 桌面端有后端实现；浏览器模式 supported=false）
 */
import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '@zidiankaifa/core';
import { getBackend } from './api';

export const AUTO_UPDATE_KEY = 'zidian-auto-update';

export function isAutoUpdateEnabled(): boolean {
  return localStorage.getItem(AUTO_UPDATE_KEY) !== 'off';
}

export function setAutoUpdateEnabled(on: boolean): void {
  localStorage.setItem(AUTO_UPDATE_KEY, on ? 'on' : 'off');
}

export interface UpdateController {
  supported: boolean;
  state: UpdateState | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openRelease: () => Promise<void>;
}

export function useUpdateState(): UpdateController {
  const api = getBackend().update;
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.state().then((s) => {
      if (alive && s) setState(s);
    });
    const off = api.onStatus((s) => setState(s));
    return () => {
      alive = false;
      off();
    };
  }, [api]);

  const check = useCallback(async () => {
    const s = await api?.check();
    if (s) setState(s);
  }, [api]);

  const download = useCallback(async () => {
    const s = await api?.download();
    if (s) setState(s);
  }, [api]);

  const install = useCallback(async () => {
    await api?.install();
  }, [api]);

  const openRelease = useCallback(async () => {
    await api?.openRelease();
  }, [api]);

  return { supported: !!api, state, check, download, install, openRelease };
}

/** 状态 → 中文文案 */
export function describeUpdate(state: UpdateState | null): string {
  if (!state) return '未检查';
  switch (state.phase) {
    case 'idle':
      return '未检查更新';
    case 'checking':
      return '正在检查更新…';
    case 'available':
      return `发现新版本 v${state.version ?? '?'}`;
    case 'downloading':
      return `正在下载 v${state.version ?? ''}… ${state.percent}%`;
    case 'downloaded':
      return `v${state.version ?? ''} 已下载，重启即可安装`;
    case 'not-available':
      return `已是最新版本（v${state.currentVersion}）`;
    case 'unsupported':
      return '便携版不支持自动更新';
    case 'error':
      return `检查失败：${state.message ?? '未知错误'}`;
    default:
      return String(state.phase);
  }
}

/** 字节 → 人类可读 */
export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
