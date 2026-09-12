/**
 * zidiankaifa 桌面端主进程（Electron + node:sqlite）
 * - 打开词典 SQLite（环境变量/打包资源/用户数据/开发仓库 依次探测）
 * - IPC 提供查词/词形/词源/拆解/生词本/同步
 * - 剪贴板取词轮询（仅监听类英文单词文本）
 */
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdater } from './updater.mjs';
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
let updater = null;

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

/**
 * IPC 返回前拍平成普通对象：
 * node:sqlite 的行对象是 null 原型对象，Electron IPC（结构化克隆）无法序列化，
 * 会导致渲染进程 invoke 直接 reject（表现为「未收录」）。
 */
function plain(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function registerIpc() {
  ipcMain.handle('dict:lookup', (_e, word, lang) => {
    if (!word) return null;
    try {
      const detail = lookupWord(db, String(word), lang ? { lang: String(lang) } : undefined);
      return plain(detail);
    } catch (err) {
      console.error(`[zidiankaifa] dict:lookup("${word}", ${lang}) failed:`, err);
      throw err;
    }
  });
  ipcMain.handle('dict:suggest', (_e, q, limit, lang) =>
    q ? plain(suggest(db, String(q), Number(limit) || 20, lang ? String(lang) : undefined)) : [],
  );
  ipcMain.handle('dict:breakdown', (_e, word, lang) =>
    word ? plain(breakdownWord(db, String(word), lang ? String(lang) : 'en')) : []);
  ipcMain.handle('book:list', () => plain(bookList(db)));
  ipcMain.handle('book:add', (_e, word, tags, lang) =>
    bookAdd(db, String(word), Array.isArray(tags) ? tags.map(String) : [], lang ? String(lang) : 'en'),
  );
  ipcMain.handle('book:remove', (_e, word) => {
    bookRemove(db, String(word));
  });
  ipcMain.handle('book:update', (_e, item) => bookUpdate(db, item));
  ipcMain.handle('book:groups', () => plain(groupBookByMorpheme(db, bookList(db))));

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

  // ---- 自动更新 ----
  ipcMain.handle('update:state', () => updater?.getState() ?? null);
  ipcMain.handle('update:check', () => updater?.check() ?? null);
  ipcMain.handle('update:download', () => updater?.download() ?? null);
  ipcMain.handle('update:install', () => updater?.install() ?? false);
  ipcMain.handle('update:open-release', async () => {
    const url = updater?.getState().releasePage;
    if (url) await shell.openExternal(url);
    return true;
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
    const shotLang = process.env.ZIDIANKAFA_SHOT_LANG || '';
    const shotDelay = Number(process.env.ZIDIANKAFA_SHOT_DELAY || 2600);
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await mainWindow.webContents.executeJavaScript(
            `localStorage.setItem("zidian-last-word", ${JSON.stringify(shotWord)});` +
              (shotLang ? `localStorage.setItem("zidian-lang", ${JSON.stringify(shotLang)});` : '') +
              `location.reload(); true`
          );
          setTimeout(async () => {
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(process.env.ZIDIANKAFA_SHOT, img.toPNG());
            if (process.env.ZIDIANKAFA_DUMP) {
              const text = await mainWindow.webContents.executeJavaScript('document.body.innerText');
              fs.writeFileSync(process.env.ZIDIANKAFA_DUMP, text, 'utf-8');
            }
            if (process.env.ZIDIANKAFA_DIAG) {
              const diag = await mainWindow.webContents.executeJavaScript(`(async () => {
                const out = { hasDictAPI: !!window.dictAPI, lastWord: localStorage.getItem('zidian-last-word'), zidianLang: localStorage.getItem('zidian-lang'), hasUpdate: !!(window.dictAPI && window.dictAPI.update) };
                try { const r = await window.dictAPI.lookup('telephone', 'auto'); out.lookup = r ? Object.keys(r).length + ' fields' : null; }
                catch (e) { out.lookupErr = String((e && e.message) || e); }
                try { out.updateState = JSON.stringify(await window.dictAPI.update.state()); }
                catch (e) { out.updateErr = String((e && e.message) || e); }
                return JSON.stringify(out);
              })()`);
              console.log('[zidiankaifa] DIAG ' + diag);
            }
            console.log('[zidiankaifa] screenshot saved');
            app.quit();
          }, shotDelay);
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
  updater = createUpdater({
    log: (m) => console.log(`[zidiankaifa] ${m}`),
    onChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:status', state);
      }
    },
  });
  registerIpc();
  createWindow();
  // 更新检查由渲染进程触发（用户可在设置中关闭自动检查），此处仅记录版本
  console.log(`[zidiankaifa] app version ${app.getVersion()}, portable=${!!process.env.PORTABLE_EXECUTABLE_DIR}`);

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
