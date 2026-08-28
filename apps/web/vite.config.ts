import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' 使产物可被 Electron 以 file:// 加载；同时支持浏览器/PWA 部署
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['@zidiankaifa/core'],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
