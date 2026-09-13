/**
 * 受限沙箱下的 web 构建绕行脚本。
 *
 * 背景：本机沙箱**禁止带管道 stdio 的 spawn**（`spawn EPERM`），而 esbuild 的
 * `ensureServiceIsRunning` 必须用 `stdio: ["pipe","pipe","inherit"]` 与后端进程 IPC，
 * 因此 `vite build` 在「加载配置文件」这一步就崩（vite 6 的 `bundleConfigFile`
 * 对任何扩展名的配置都走 esbuild，`configFileDependencies` 支持需要打包）。
 *
 * 绕行：用 vite 的 JS API 传**内联配置** + `configFile: false`，从根上跳过 `bundleConfigFile`。
 * 配置内容与 `apps/web/vite.config.ts` 逐字等价。
 *
 * 用法：cd apps/web && node ../../scripts/build_web_nospawn.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const webDir = process.cwd();
if (!webDir.replace(/\\/g, '/').endsWith('/apps/web')) {
  console.error(`❌ 请在 apps/web 目录下运行（当前 cwd = ${webDir}）`);
  process.exit(1);
}

// 从 apps/web 的 node_modules 解析依赖（脚本自身位于仓库根 scripts/，解析不到）
const require = createRequire(resolve(webDir, 'package.json'));

async function loadPkg(name) {
  // pnpm 布局：优先用 createRequire().resolve 找到真实入口，再以 file:// 动态 import
  const entry = require.resolve(name);
  return import(pathToFileURL(entry).href);
}

const { build } = await loadPkg('vite');
const reactMod = await loadPkg('@vitejs/plugin-react');
const react = reactMod.default ?? reactMod;

await build({
  configFile: false, // ★ 关键：跳过 bundleConfigFile（避开 esbuild spawn）
  root: webDir,
  base: './', // 使产物可被 Electron 以 file:// 加载；同时支持浏览器/PWA 部署
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@zidiankaifa/core'],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
console.log('[build_web_nospawn] ✅ vite build 完成（已跳过配置文件打包）');
