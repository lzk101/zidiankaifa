/**
 * 修复 README.md:144 的字节损坏（第二版 —— 用稳定拉丁锚点定位）
 *
 * 实测：该行 CR 在码点 122、BEL 在 135 —— 二者不相邻，说明损坏并非单个词。
 * 稳定锚点：'oots(476)' 与 'ffixes(403)' 都是纯 ASCII，可用 indexOf 精确定位；
 * 起点 = 'oots(476)' 前那个反斜杠；终点 = 'ffixes(403)' 的右括号。
 * 原文（由上下文与 v0.6.0 语义推定）应为：『корни(476) / аффиксы(403)』。
 */
import * as fs from 'node:fs';

const P = 'README.md';
const lines = fs.readFileSync(P, 'utf8').split('\n');
const i = 143;
const line = lines[i];

const a = line.indexOf('oots(476)');
const b = line.indexOf('ffixes(403)');
console.log('oots(476) @', a, ' ffixes(403) @', b);
if (a < 0 || b < 0) { console.log('锚点缺失 —— 中止'); process.exit(1); }

const start = a - 1;                 // 反斜杠
console.log('起点字符:', JSON.stringify(line[start]));
const endExcl = b + 'ffixes(403)'.length + 1; // 到右括号之后
const oldSeg = line.slice(start, endExcl);
console.log('将替换:', JSON.stringify(oldSeg));
console.log('码点:', [...oldSeg].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' '));

const newSeg = 'корни(476) / аффиксы(403)';
lines[i] = line.slice(0, start) + newSeg + line.slice(endExcl);
fs.writeFileSync(P, lines.join('\n'), 'utf8');

const after = fs.readFileSync(P, 'utf8').split('\n')[143];
const k = after.indexOf('新增');
console.log('');
console.log('替换后:', JSON.stringify(after.slice(k, k + 46)));
const left = [...after].filter((c) => c.codePointAt(0) < 32);
console.log('该行残留控制字符:', left.length ? left.map((c) => 'U+' + c.codePointAt(0).toString(16)).join(',') : '无 ✔');
