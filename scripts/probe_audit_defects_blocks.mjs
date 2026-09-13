// 主管独立复核：按块统计 ru_morph_defects.mjs 的断言通过/失败数
// 用 ru_morph_defects.mjs:1-8 之外无法可靠切分标签，故以「--- 段头 ---」机械切分
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? 'scripts/out_defects_baseline_v090.txt';
const raw = fs.readFileSync(path.resolve(__dirname, '..', src), 'utf8');

const blocks = [];
let cur = null;
for (const line of raw.split(/\r?\n/)) {
  // ⚠ 段头格式不统一：源文件里有的闭合 `---` 前有空格、有的没有
  //    （如「--- D1. …漏网）---」无空格）。故不能要求 `\s+` 前缀。
  const h = line.match(/^---\s+(.+?)\s*---\s*$/);
  if (h) {
    cur = { name: h[1], pass: 0, fail: 0 };
    blocks.push(cur);
    continue;
  }
  if (!cur) continue;
  if (/^\s*\u2713/.test(line)) cur.pass++;
  else if (/^\s*\u2717/.test(line)) cur.fail++;
}

let tp = 0, tf = 0;
console.log('=== 主管独立复核：块级断言普查 ===');
for (const b of blocks) {
  tp += b.pass; tf += b.fail;
  const short = b.name.length > 50 ? b.name.slice(0, 50) + '…' : b.name;
  console.log(`  ${short.padEnd(52)} 通过 ${String(b.pass).padStart(2)} / 失败 ${String(b.fail).padStart(2)}`);
}
console.log(`  ${''.padEnd(52)} ---- 合计 通过 ${tp} / 失败 ${tf}   断言总数 ${tp + tf}`);
console.log('');
console.log('  需求 agent（T21 DEC-015）声称：23 通过 / 33 失败，56 条断言');
console.log(`  主管实测：                     ${tp} 通过 / ${tf} 失败，${tp + tf} 条断言  ${tp === 23 && tf === 33 ? '✅ 完全吻合' : '❌ 不符'}`);
console.log('');
console.log('  断言达成态（AC-2 = 30 红 → 0 红，D2 排除本迭代）：');
console.log('    目标 = 53 通过 / 3 失败（仅 D2 块），exit 1');
console.log('    「全绿 exit 0」不是本迭代目标 —— 见 DEC-015 / DEC-016');
console.log('');
console.log('  ⚠ 解析器注意：段头闭合 `---` 前**空格不统一**（D1–D4 无空格、D5/D6 有）。');
console.log('    用 /^---\\s+(.+?)\\s+---$/ 只能匹配到后 2 块（得 14/24），会低估成 38 条断言。');
console.log('    必须用 /^---\\s+(.+?)\\s*---\\s*$/。主管已在此踩过一次。');
