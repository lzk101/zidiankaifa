/**
 * zidiankaifa preload：向渲染进程安全暴露 dictAPI（contextBridge）
 */
import { contextBridge, ipcRenderer } from 'electron';

const dictAPI = {
  lookup: (word, lang) => ipcRenderer.invoke('dict:lookup', word, lang),
  suggest: (query, limit, lang) => ipcRenderer.invoke('dict:suggest', query, limit ?? 20, lang),
  breakdown: (word, lang) => ipcRenderer.invoke('dict:breakdown', word, lang ?? 'en'),
  relatedByMorpheme: (word, lang) => ipcRenderer.invoke('dict:related', word, lang ?? 'en'),
  // v0.10.0：生词本按语言分离 —— bookList / bookRemove / bookGroups 带可选 lang
  bookList: (lang) => ipcRenderer.invoke('book:list', lang),
  bookAdd: (word, tags, lang) => ipcRenderer.invoke('book:add', word, tags ?? [], lang),
  bookRemove: (word, lang) => ipcRenderer.invoke('book:remove', word, lang),
  bookUpdate: (item) => ipcRenderer.invoke('book:update', item),
  bookGroups: (lang) => ipcRenderer.invoke('book:groups', lang),
  lexiconList: (opts) => ipcRenderer.invoke('lexicon:list', opts),
  lexiconEntry: (morpheme, lang) => ipcRenderer.invoke('lexicon:entry', morpheme, lang),
  lexiconStats: () => ipcRenderer.invoke('lexicon:stats'),
  wordList: (lang, opts) => ipcRenderer.invoke('words:list', lang, opts),
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openRelease: () => ipcRenderer.invoke('update:open-release'),
    onStatus: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
  syncNow: (syncUrl) => ipcRenderer.invoke('sync:now', syncUrl),
  setClipboardWatch: (on) => ipcRenderer.invoke('clipboard:set', on),
  onClipboard: (cb) => {
    const listener = (_event, text) => cb(text);
    ipcRenderer.on('clipboard:text', listener);
    return () => ipcRenderer.removeListener('clipboard:text', listener);
  },
};

contextBridge.exposeInMainWorld('dictAPI', dictAPI);
