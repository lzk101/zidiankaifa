// 主管权威测定：D1 形态数在 gapMin=2 vs gapMin=1 下的值
// 方法：临时副本法（v0.8.0 曾用于 D1 修复的双实现对照）——
//   复制 packages/core/dist 到临时目录，只在副本里把 index.ts 编译产物中的
//   `parts[0].start >= 1` 改回 `>= 2`，用 file:// 动态 import 两份实现对照。
//   工作区零改动。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');
const dist = path.join(repo, 'packages', 'core', 'dist');

// 1) 复制 dist 到临时目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-d1-'));
const tmpDist = path.join(tmpRoot, 'dist');
fs.cpSync(dist, tmpDist, { recursive: true });
console.log(`临时副本：${tmpDist}`);

// 2) 定位 db/index.js 里的守卫并改回 >= 2
const idx = path.join(tmpDist, 'db', 'index.js');
let src = fs.readFileSync(idx, 'utf8');

// 生产代码形如：if (parts.length && parts[0].start >= 1) {
const re = /parts\[0\]\.start >= 1\b/;
const m = src.match(re);
if (!m) {
  console.error('❌ 未在副本里找到 `parts[0].start >= 1`，无法构造对照实现。');
  console.error('   实际出现的相关片段：');
  for (const line of src.split(/\r?\n/)) {
    if (/parts\[0\]\.start/.test(line)) console.error('     ' + line.trim());
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
}
src = src.replace(re, 'parts[0].start >= 2');
fs.writeFileSync(idx, src, 'utf8');
console.log('✔ 已把副本守卫改回 `>= 2`（修复前行为）');

// 3) 动态 import 两份实现
const prodMod = await import(pathToFileURL(path.join(dist, 'db', 'index.js')).href);
const preMod = await import(pathToFileURL(idx).href);

// 4) 自检：两份实现必须在「无 gap=1 影响」的词上一致（抽样验证副本可用）
const db = new DatabaseSync(path.join(repo, 'data', 'db', 'dict.db'));
const ru = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
const prefixStems = new Set(
  db.prepare("SELECT morpheme FROM morphemes WHERE lang='ru' AND kind='prefix'").all()
    .map((r) => String(r.morpheme).replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')),
);

function measure(mod, label) {
  let breakable = 0, gap1 = 0, d1 = 0, kept = 0, elim = 0;
  for (const w of ru) {
    const parts = mod.breakdownWord(db, w, 'ru');
    if (!parts.length) continue;
    breakable++;
    if (parts[0].start === 1) {
      gap1++;
      const gap = w.replace(/\u0451/g, '\u0435').slice(0, 1);
      if (prefixStems.has(gap)) kept++; else elim++;
    }
  }
  d1 = kept + elim;
  console.log(`  ${label.padEnd(28)} 可拆=${String(breakable).padStart(6)}  gap=1残余=${String(gap1).padStart(4)}  (前缀集内 ${kept} / 集外 ${elim})  D1形态=${String(d1).padStart(4)}`);
  return { breakable, gap1, kept, elim, d1 };
}

console.log('');
console.log('=== 权威测定（官方引擎两份实现，同一词库）===');
const prod = measure(prodMod, 'gapMin=1（生产现值）');
const pre = measure(preMod, 'gapMin=2（修复前守卫）');

console.log('');
console.log('=== 独立复刻校验（应 0 例不一致）===');
let diff = 0, checked = 0;
for (const w of ru) {
  const a = prodMod.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
  const b = preMod.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
  checked++;
  if (a !== b) diff++;
}
console.log(`  两份实现在全库 ${checked} 词上的差异词数 = ${diff}  ${diff === 267 ? '← 应等于被消除数 267' : ''}`);

console.log('');
console.log('=== 裁定 ===');
console.log(`  生产 gapMin=1          D1 形态 = ${prod.d1}`);
console.log(`  退回 gapMin=2（修复前） D1 形态 = ${pre.d1}`);
if (pre.d1 === 342) {
  console.log('  ✅ 342 型正确 —— V9-8/AC-6 的「判据① 替代量」基线 = **342**。');
  console.log('  ⚠ 267 = 修复前后差异词数（被消除数），不是 gapMin=2 下的形态数。');
} else {
  console.log(`  ⚠ 实测 ${pre.d1}，与 342/267 均不符，需再查。`);
}
db.close();
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`已清理临时副本 ${tmpRoot}`);
