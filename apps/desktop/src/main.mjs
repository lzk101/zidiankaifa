/**
 * zidiankaifa 桌面端主进程（Electron + node:sqlite）
 * - 打开词典 SQLite（环境变量/打包资源/用户数据/开发仓库 依次探测）
 * - IPC 提供查词/词形/词源/拆解/生词本/同步
 * - 剪贴板取词轮询（仅监听类英文单词文本）
 */
import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bookAdd,
  bookList,
  bookListAll,
  bookRemove,
  bookUpdate,
  breakdownWord,
  countWords,
  groupBookByMorpheme,
  lookupWord,
  openDatabase,
  suggest,
  syncMerge,
} from '@zidiankaifa/core/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORD_RE = /^[A-Za-z][A-Za-z'’-]{1,63}$/;

let db = null;
let mainWindow = null;
let clipboardTimer = null;
let lastClipboard = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function resolveDbPath() {
  // 1) 环境变量显式指定
  if (process.env.ZIDIANKAFA_DB && fs.existsSync(process.env.ZIDIANKAFA_DB)) {
    return process.env.ZIDIANKAFA_DB;
  }
  // 2) 用户数据目录（可写）；首次运行时把打包内置词库复制过来
  const userData = path.join(app.getPath('userData'), 'dict.db');
  const bundled = path.join(process.resourcesPath, 'dict', 'dict.db');
  if (!fs.existsSync(userData) && fs.existsSync(bundled)) {
    try {
      fs.mkdirSync(path.dirname(userData), { recursive: true });
      fs.copyFileSync(bundled, userData);
      console.log('[zidiankaifa] bundled dict.db copied to userData');
    } catch (e) {
      console.error('[zidiankaifa] copy bundled db failed:', e);
    }
  }
  if (fs.existsSync(userData)) {
    return userData;
  }
  // 3) 打包内置（只读，仅当复制失败时兜底）
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  // 4) 开发仓库
  const dev = path.join(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');
  if (fs.existsSync(dev)) {
    return dev;
  }
  return userData;
}

function registerIpc() {
  ipcMain.handle('dict:lookup', (_e, word, lang) =>
    word
      ? lookupWord(db, String(word), lang ? { lang: String(lang) } : undefined)
      : null,
  );
  ipcMain.handle('dict:suggest', (_e, q, limit) => (q ? suggest(db, String(q), Number(limit) || 20) : []));
  ipcMain.handle('dict:breakdown', (_e, word) => (word ? breakdownWord(db, String(word)) : []));
  ipcMain.handle('book:list', () => bookList(db));
  ipcMain.handle('book:add', (_e, word, tags, lang) =>
    bookAdd(db, String(word), Array.isArray(tags) ? tags.map(String) : [], lang ? String(lang) : 'en'),
  );
  ipcMain.handle('book:remove', (_e, word) => {
    bookRemove(db, String(word));
  });
  ipcMain.handle('book:update', (_e, item) => bookUpdate(db, item));
  ipcMain.handle('book:groups', () => groupBookByMorpheme(db, bookList(db)));

  ipcMain.handle('sync:now', async (_e, syncUrl) => {
    const url = (syncUrl && String(syncUrl).trim()) || process.env.ZIDIANKAFA_SYNC_URL || '';
    if (!url) {
      return { ok: false, pushed: 0, pulled: 0, message: '未配置同步服务器地址，请在设置中填写' };
    }
    try {
      const items = bookListAll(db);
      const res = await fetch(url.replace(/\/+$/, '') + '/api/v1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        return { ok: false, pushed: 0, pulled: 0, message: `同步服务器响应 ${res.status}` };
      }
      const data = await res.json();
      const merged = syncMerge(db, Array.isArray(data.items) ? data.items : []);
      return { ok: true, pushed: merged.pushed, pulled: merged.pulled };
    } catch (err) {
      return { ok: false, pushed: 0, pulled: 0, message: `同步失败：${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ipcMain.handle('clipboard:set', (_e, on) => {
    if (on) startClipboardWatch();
    else stopClipboardWatch();
  });
}

function startClipboardWatch() {
  if (clipboardTimer) return;
  lastClipboard = clipboard.readText().trim();
  clipboardTimer = setInterval(() => {
    const text = clipboard.readText().trim();
    if (!text || text === lastClipboard) return;
    lastClipboard = text;
    if (WORD_RE.test(text) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard:text', text);
    }
  }, 900);
}

function stopClipboardWatch() {
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 780,
    minHeight: 560,
    title: '我的电子辞典',
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  const devUrl = process.env.ZIDIANKAFA_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else if (app.isPackaged) {
    mainWindow.loadFile(path.join(app.getAppPath(), 'web', 'dist', 'index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'web', 'dist', 'index.html'));
  }

  // 开发验证钩子：ZIDIANKAFA_SHOT=<png路径> 时，加载后自动截图并退出
  if (process.env.ZIDIANKAFA_SHOT) {
    const shotWord = process.env.ZIDIANKAFA_SHOT_WORD || 'telephone';
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await mainWindow.webContents.executeJavaScript(
            `localStorage.setItem("zidian-last-word", ${JSON.stringify(shotWord)}); location.reload(); true`
          );
          setTimeout(async () => {
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(process.env.ZIDIANKAFA_SHOT, img.toPNG());
            if (process.env.ZIDIANKAFA_DUMP) {
              const text = await mainWindow.webContents.executeJavaScript('document.body.innerText');
              fs.writeFileSync(process.env.ZIDIANKAFA_DUMP, text, 'utf-8');
            }
            console.log('[zidiankaifa] screenshot saved');
            app.quit();
          }, 2600);
        } catch (e) {
          console.error('[zidiankaifa] shot failed:', e);
          app.exit(1);
        }
      }, 1800);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  db = openDatabase(resolveDbPath());
  const words = countWords(db);
  console.log(`[zidiankaifa] dict.db opened, ${words} words`);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('quit', () => {
  stopClipboardWatch();
  try {
    db?.close();
  } catch {
    /* ignore */
  }
});
