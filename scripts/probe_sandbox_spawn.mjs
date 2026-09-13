/**
 * 沙箱边界判别实验（只读，无副作用）：
 * 判断 `spawn EPERM` 的确切范围，以决定 vite build 是否有可行绕行路径。
 *   A. spawn node 带 piped stdio（默认）
 *   B. spawn node 带 stdio:'inherit'
 *   C. spawn node 带 stdio:'ignore'
 *   D. spawn esbuild 平台 exe 带 piped stdio
 *   E. spawn esbuild 平台 exe 带 stdio:'inherit'
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let esbuildBin = null;
try {
  esbuildBin = require('D:/lzk17/Documents/zidiankaifa/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js');
} catch { /* ignore */ }
// esbuild 的平台二进制路径（pnpm 布局）
const candidates = [
  'node_modules/.pnpm/@esbuild+win32-x64@0.25.12/node_modules/@esbuild/win32-x64/esbuild.exe',
  'node_modules/.pnpm/@esbuild+win32-x64@0.25.12/node_modules/esbuild/bin/esbuild',
];
let exePath = null;
for (const c of candidates) if (existsSync(c)) { exePath = c; break; }

function trySpawn(label, cmd, args, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, opts);
    } catch (e) {
      console.log(`${label}: THROW ${e.code ?? ''} ${e.message.split('\n')[0]}`);
      return resolve();
    }
    child.on('error', (e) => {
      console.log(`${label}: ERROR ${e.code ?? ''} ${e.message.split('\n')[0]}`);
      resolve();
    });
    if (opts.stdio === 'inherit' || opts.stdio === 'ignore') {
      child.on('exit', (code) => { console.log(`${label}: OK exit=${code}`); resolve(); });
    } else {
      let out = '';
      child.stdout?.on('data', (d) => { out += d; });
      child.on('exit', (code) => { console.log(`${label}: OK exit=${code} stdout=${JSON.stringify(out.slice(0, 40))}`); resolve(); });
    }
    setTimeout(() => { try { child.kill(); } catch {} ; console.log(`${label}: TIMEOUT`); resolve(); }, 8000);
  });
}

console.log('=== 沙箱 spawn 边界判别 ===');
console.log(`esbuild.exe 路径: ${exePath ?? '（未找到）'}`);
console.log('');

await trySpawn('A node + piped   ', process.execPath, ['-e', 'console.log("hi")'], { stdio: ['ignore', 'pipe', 'pipe'] });
await trySpawn('B node + inherit  ', process.execPath, ['-e', 'console.log("hi")'], { stdio: 'inherit' });
await trySpawn('C node + ignore   ', process.execPath, ['-e', 'console.log("hi")'], { stdio: 'ignore' });

if (exePath) {
  await trySpawn('D esbuild + piped ', exePath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await trySpawn('E esbuild + ignore', exePath, ['--version'], { stdio: 'ignore' });
}

console.log('');
console.log('=== spawnSync 变体 ===');
for (const [label, opts] of [
  ['F spawnSync + piped  ', { encoding: 'utf8' }],
  ['G spawnSync + ignore ', { stdio: 'ignore' }],
]) {
  const r = spawnSync(process.execPath, ['-e', 'console.log("hi")'], opts);
  console.log(`${label}: error=${r.error ? r.error.code : 'none'} status=${r.status} out=${JSON.stringify((r.stdout ?? '').slice(0, 20))}`);
}

console.log('');
console.log('=== 沙箱环境变量线索 ===');
for (const k of Object.keys(process.env).filter((k) => /DSH|SANDBOX|CODEX/i.test(k))) {
  console.log(`  ${k} = ${String(process.env[k]).slice(0, 120)}`);
}
