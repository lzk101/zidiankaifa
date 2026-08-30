/**
 * zidiankaifa preload：向渲染进程安全暴露 dictAPI（contextBridge）
 */
import { contextBridge, ipcRenderer } from 'electron';

const dictAPI = {
  lookup: (word, lang) => ipcRenderer.invoke('dict:lookup', word, lang),
  suggest: (query, limit) => ipcRenderer.invoke('dict:suggest', query, limit ?? 20),
  breakdown: (word) => ipcRenderer.invoke('dict:breakdown', word),
  bookList: () => ipcRenderer.invoke('book:list'),
  bookAdd: (word, tags, lang) => ipcRenderer.invoke('book:add', word, tags ?? [], lang),
  bookRemove: (word) => ipcRenderer.invoke('book:remove', word),
  bookUpdate: (item) => ipcRenderer.invoke('book:update', item),
  bookGroups: () => ipcRenderer.invoke('book:groups'),
  syncNow: (syncUrl) => ipcRenderer.invoke('sync:now', syncUrl),
  setClipboardWatch: (on) => ipcRenderer.invoke('clipboard:set', on),
  onClipboard: (cb) => {
    const listener = (_event, text) => cb(text);
    ipcRenderer.on('clipboard:text', listener);
    return () => ipcRenderer.removeListener('clipboard:text', listener);
  },
};

contextBridge.exposeInMainWorld('dictAPI', dictAPI);
