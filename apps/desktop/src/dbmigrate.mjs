/**
 * 词库升级（纯 Node，不依赖 electron，便于单测）
 *
 * 背景：`apps/desktop/src/main.mjs` 的 `resolveDbPath()` 优先使用 userData 中的 dict.db 副本，
 * 且**只在副本不存在时**才复制内置库 —— 导致安装新版本后仍然读旧词库。
 * 实测：v0.7.0 的用户仍在读 v0.2.x 时期的 509MB 旧库（word_etymology(ru)=0、morphemes(ru)=0、
 * 无 roots 表），界面表现为「暂无词源数据 / 暂未拆解」。
 *
 * 本模块用内置库指纹（size:mtime）与 userData 旁的 .stamp 比对，不一致即换库，
 * 并把用户生词本（book 表，含墓碑）迁移过去；旧库改名备份而非删除。
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, bookListAll, syncMerge } from '@zidiankaifa/core/db';

export const STAMP_SUFFIX = '.stamp';

/** 词库指纹：文件大小 + 修改时间（毫秒） */
export function stampOf(file) {
  const st = fs.statSync(file);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

export function readStamp(stampPath) {
  try {
    return fs.readFileSync(stampPath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * 读取旧库的生词本（含墓碑记录，保留删除状态）。
 * 失败时返回空数组 —— 换库仍应继续，不能因为读不到生词本就把用户卡在旧库上。
 */
export function readBookRows(dbPath, log = () => {}) {
  let db = null;
  try {
    db = openDatabase(dbPath);
    return bookListAll(db);
  } catch (e) {
    log(`[db] 读取旧生词本失败（将不带入新库）：${e?.message ?? e}`);
    return [];
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/** 删除主库文件及其 WAL/SHM/临时残留 */
export function removeDbFiles(dbPath) {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}.new`]) {
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
  }
}

/**
 * 确保 userData 中的词库与内置库一致。
 * @returns {{ path: string, action: 'kept'|'created'|'upgraded'|'no-bundled', carried?: number, backup?: string }}
 */
export function ensureUserDb({ bundled, userData, log = () => {} }) {
  if (!fs.existsSync(bundled)) {
    log('[db] 内置词库不存在，保持现状');
    return { path: userData, action: 'no-bundled' };
  }

  const stampPath = `${userData}${STAMP_SUFFIX}`;
  const want = stampOf(bundled);

  // 首次运行：复制内置库
  if (!fs.existsSync(userData)) {
    fs.mkdirSync(path.dirname(userData), { recursive: true });
    fs.copyFileSync(bundled, userData);
    fs.writeFileSync(stampPath, want);
    log('[db] 首次运行：内置词库已复制到 userData');
    return { path: userData, action: 'created' };
  }

  const have = readStamp(stampPath);
  if (have === want) {
    return { path: userData, action: 'kept' };
  }

  // 需要升级：先迁移生词本，再替换（旧库改名备份，不删除）
  const carried = readBookRows(userData, log);
  const backup = `${userData}.bak-${Date.now()}`;
  let backedUp = false;
  try {
    fs.renameSync(userData, backup);
    backedUp = true;
  } catch (e) {
    log(`[db] 备份旧词库失败，改为直接删除：${e?.message ?? e}`);
  }
  removeDbFiles(userData);
  fs.copyFileSync(bundled, userData);
  fs.writeFileSync(stampPath, want);

  let restored = 0;
  if (carried.length) {
    let db = null;
    try {
      db = openDatabase(userData);
      restored = syncMerge(db, carried).pushed;
    } catch (e) {
      log(`[db] 生词本迁移失败：${e?.message ?? e}`);
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  }

  log(`[db] 词库已升级（${have || '无标记'} → ${want}），迁移生词 ${restored}/${carried.length} 条`);
  return { path: userData, action: 'upgraded', carried: restored, backup: backedUp ? backup : undefined };
}
