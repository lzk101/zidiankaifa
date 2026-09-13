/**
 * zidiankaifa 桌面端主进程（Electron + node:sqlite）
 * - 打开词典 SQLite（环境变量/打包资源/用户数据/开发仓库 依次探测）
 * - IPC 提供查词/词形/词源/拆解/生词本/同步
 * - 剪贴板取词轮询（仅监听类英文单词文本）
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdater } from './updater.mjs';
import { ensureUserDb } from './dbmigrate.mjs';
import {
  bookAdd,
  bookList,
  bookListAll,
  bookRemove,
  bookUpdate,
  breakdownWord,
  countWords,
  getLexiconEntry,
  groupBookByMorpheme,
  lexiconStats,
  listLexicon,
  listWords,
  lookupWord,
  openDatabase,
  relatedByMorpheme,
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
  // 1) 环境变量显式指定（调试用，绕过升级逻辑）
  if (process.env.ZIDIANKAFA_DB && fs.existsSync(process.env.ZIDIANKAFA_DB)) {
    return process.env.ZIDIANKAFA_DB;
  }
  const userData = path.join(app.getPath('userData'), 'dict.db');
  const bundled = path.join(process.resourcesPath, 'dict', 'dict.db');

  // 2) 用户数据目录（可写）：与内置库指纹比对，不一致即换库并迁移生词本。
  //    旧逻辑只在副本「不存在」时才复制，导致升级安装后仍读旧词库
  //    （v0.7.0 用户实际仍在读 v0.2.x 的 509MB 旧库 → 词源/拆解全空）。
  if (fs.existsSync(bundled)) {
    try {
      const res = ensureUserDb({ bundled, userData, log: (m) => console.log(`[zidiankaifa] ${m}`) });
      if (fs.existsSync(res.path)) {
        return res.path;
      }
    } catch (e) {
      // 升级失败时退回内置库（只读，生词本不可写，但至少词源/拆解数据正确）
      console.error('[zidiankaifa] dict.db 升级失败，回退到内置库:', e);
      return bundled;
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
  // v0.10.0：book:list / book:remove / book:groups 均带可选 lang
  // book:list 缺省 = 不过滤（全部语言）；UI 必须显式传 lang（AC-16 第 7 条）
  ipcMain.handle('book:list', (_e, lang) => plain(bookList(db, lang ? String(lang) : undefined)));
  ipcMain.handle('book:add', (_e, word, tags, lang) =>
    bookAdd(db, String(word), Array.isArray(tags) ? tags.map(String) : [], lang ? String(lang) : 'en'),
  );
  ipcMain.handle('book:remove', (_e, word, lang) => {
    bookRemove(db, String(word), lang ? String(lang) : undefined);
  });
  // ★ v0.10.0 裁决十九 + T41：book:update 必须显式带 lang。
  // 核心 `bookUpdate` 对缺省 lang 走 `existingLangForWord()`（不按语言、按 updated_at 取「较新」的那条），
  // 同词双语言下**改哪条不可预期**（测试 agent B24/B25 以读码 + 断言登记）⇒ 本层拒绝无 lang 的更新，
  // 避免弱类型 IPC 通道静默改错语言。`lang` 亦必须是两个已知值之一，防止写入意外的语言标签。
  ipcMain.handle('book:update', (_e, item) => {
    const it = item && typeof item === 'object' ? item : {};
    const lang = it.lang;
    if (lang !== 'en' && lang !== 'ru') {
      throw new Error(
        'book:update 需要显式 lang（"en" | "ru"）：缺省语义在同词双语言下不确定（裁决十九）'
      );
    }
    return bookUpdate(db, it);
  });
  // 语言过滤发生在本层（先按 lang 过滤 items）；groupBookByMorpheme 只负责按 it.lang 选词素库（AC-17 第 6 条）
  ipcMain.handle('book:groups', (_e, lang) =>
    plain(groupBookByMorpheme(db, bookList(db, lang ? String(lang) : undefined))),
  );
  ipcMain.handle('dict:related', (_e, word, lang) =>
    word ? plain(relatedByMorpheme(db, String(word), lang ? String(lang) : 'en')) : []);

  // 词根表 / 词缀表 / 单词表
  ipcMain.handle('lexicon:list', (_e, opts) => {
    const o = opts ?? {};
    const kind = ['root', 'prefix', 'suffix', 'all'].includes(o.kind) ? o.kind : 'root';
    return plain(listLexicon(db, {
      kind,
      lang: o.lang ? String(o.lang) : 'en',
      query: o.query ? String(o.query) : undefined,
      sort: o.sort === 'alpha' ? 'alpha' : 'words',
      limit: Number(o.limit) || 60,
      offset: Number(o.offset) || 0,
    }));
  });
  ipcMain.handle('lexicon:entry', (_e, morpheme, lang) =>
    plain(getLexiconEntry(db, String(morpheme), lang ? String(lang) : 'en')));
  ipcMain.handle('lexicon:stats', () => plain(lexiconStats(db)));
  ipcMain.handle('words:list', (_e, lang, opts) => {
    const o = opts ?? {};
    return plain(listWords(db, lang ? String(lang) : 'en', {
      query: o.query ? String(o.query) : undefined,
      limit: Number(o.limit) || 60,
      offset: Number(o.offset) || 0,
    }));
  });

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
  ipcMain.handle('update:download', (e) => {
    console.log(`[zidiankaifa] IPC update:download from ${e?.sender?.getURL?.() ?? 'unknown'}`);
    return updater?.download() ?? null;
  });
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
  // ★★ T49（采纳需求 agent T47 异议 3）：`openDatabase()` 现在会**抛错**（迁移无法完成时，
  // 见 packages/core/src/db/index.ts 的 `assertBookCompositeOrThrow`）。
  // 若此处不捕获，抛错发生在 `createWindow()` **之前** ⇒ 打包版（无控制台）表现为
  // 「**双击图标没反应**」—— 那只是把静默从「写不进去」换成了「打不开」，对用户仍然不响亮。
  // 故必须：① 捕获 ② 用 `dialog.showErrorBox` **明确告知原因与出路** ③ 再退出。
  // 为什么不用 `app.quit()`：它在无窗口时可能不立即结束进程，且在 `whenReady` 早期行为不确定；
  // `app.exit(1)` 是同步立即退出，配合 `showErrorBox`（同步阻塞直到用户点确定）不会闪退。
  try {
    db = openDatabase(resolveDbPath());
  } catch (e) {
    const detail = e?.message ?? String(e);
    console.error('[zidiankaifa] 打开词库失败：', detail);
    dialog.showErrorBox(
      '无法打开词库',
      [
        '词典数据未能打开，为避免生词本出现「能看不能加」的静默故障，此处直接终止启动。',
        '',
        `原因：${detail}`,
        '',
        '可尝试：',
        '1. 确认磁盘剩余空间充足（生词本迁移需要写入备份）；',
        '2. 确认没有另一个词典实例或同步工具正在占用词库文件，然后重新打开；',
        '3. 若反复失败，可在数据目录中找到迁移时生成的 `dict.db.bak-<时间戳>` 备份并恢复。',
      ].join('\n')
    );
    app.exit(1);
    return;
  }
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
