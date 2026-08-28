import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/** 启动时根据 localStorage('zidian-theme') 设置 <html data-theme> */
function applyTheme(): void {
  const saved = localStorage.getItem('zidian-theme');
  const theme =
    saved === 'dark' || saved === 'light'
      ? saved
      : typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

applyTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
