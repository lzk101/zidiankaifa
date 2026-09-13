/**
 * 独立复算 KPI 计数（功能测试 agent · T20 附加项）。
 * 目的：不依赖 `ru_morph_defects.mjs` 的实现，用**三种互相独立的方法**复算
 * 「空洞」四口径（≥2 / ≥3 / ≤1 / ==0），确认 171 / 134 / 67 / 37。
 *   方法① 游程求和（与 defects.mjs 同思路，但独立重写）
 *   方法② 算术法：holeLen = 词长 − Σ(片段长度)
 *   方法③ 位掩码法：未被任何片段标记的位计数
 * 三者必须逐词一致，否则说明口径有歧义。
 * 只读、幂等。用法：node scripts/probe_t20_kpi_recount.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const raw = new DatabaseSync(DB, { readOnly: true });
const db = raw;

const words = raw
  .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0")
  .all()
  .map((r) => String(r.word));

/** 方法① 游程求和 */
function holeRunSum(w, parts) {
  const cov = new Array(w.length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  let total = 0;
  let run = -1;
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length && !cov[i]) { if (run < 0) run = i; }
    else if (run >= 0) { total += i - run; run = -1; }
  }
  return total;
}
/** 方法② 算术法 */
function holeArith(w, parts) {
  let covered = 0;
  for (const p of parts) covered += Math.min(p.end, w.length) - Math.max(p.start, 0);
  return w.length - covered;
}
/** 方法③ 位掩码法（BigInt 位图，逻辑上与①不同源） */
function holeMask(w, parts) {
  let mask = 0n;
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) mask |= 1n << BigInt(i);
  let n = 0;
  for (let i = 0; i < w.length; i++) if ((mask & (1n << BigInt(i))) === 0n) n++;
  return n;
}

let mismatch = 0;
const tallies = {
  run: { hit: 0, ge2: 0, ge3: 0, le1: 0, zero: 0 },
  arith: { hit: 0, ge2: 0, ge3: 0, le1: 0, zero: 0 },
  mask: { hit: 0, ge2: 0, ge3: 0, le1: 0, zero: 0 },
};

for (const w of words) {
  const parts = breakdownWord(db, w, 'ru');
  const a = holeRunSum(w, parts);
  const b = holeArith(w, parts);
  const c = holeMask(w, parts);
  if (a !== b || b !== c) {
    mismatch++;
    if (mismatch <= 8) console.log(`  ⚠ 口径分歧 ${w}: run=${a} arith=${b} mask=${c} parts=${JSON.stringify(parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`))}`);
  }
  if (parts.length) { tallies.run.hit++; tallies.arith.hit++; tallies.mask.hit++; }
  if (a >= 2) tallies.run.ge2++;
  if (a >= 3) tallies.run.ge3++;
  if (a <= 1) tallies.run.le1++;
  if (a === 0) tallies.run.zero++;
  if (b >= 2) tallies.arith.ge2++;
  if (b >= 3) tallies.arith.ge3++;
  if (b <= 1) tallies.arith.le1++;
  if (b === 0) tallies.arith.zero++;
  if (c >= 2) tallies.mask.ge2++;
  if (c >= 3) tallies.mask.ge3++;
  if (c <= 1) tallies.mask.le1++;
  if (c === 0) tallies.mask.zero++;
}

const N = words.length;
console.log(`尺子 R 分母 N = ${N} 词`);
console.log(`三法逐词一致？ ${mismatch === 0 ? '✅ 完全一致（0 分歧）' : `❌ ${mismatch} 处分歧`}`);
console.log('');
console.log('口径           方法①游程   方法②算术   方法③位图   （口径 = 未覆盖字符**总数**）');
for (const k of ['hit', 'ge2', 'ge3', 'le1', 'zero']) {
  const label = { hit: '有拆解', ge2: '空洞≥2', ge3: '空洞≥3', le1: '空洞≤1', zero: '零空洞' }[k];
  console.log(`  ${label.padEnd(10)} ${String(tallies.run[k]).padStart(8)} ${String(tallies.arith[k]).padStart(11)} ${String(tallies.mask[k]).padStart(11)}`);
}
console.log('');
console.log(`⇒ 建议 XCHK 对照值：空洞≥2 = ${tallies.run.ge2} · 空洞≥3 = ${tallies.run.ge3} · 零空洞 = ${tallies.run.zero} · 空洞≤1 = ${tallies.run.le1}`);
raw.close();
