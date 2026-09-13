// scripts/probe_t64_js_axis.mjs —— T64 附加判别实验（只读，秒级）
// 目的：§2 已实测「全库扇描期间每词 0 次 SQL」⇒ 时间全在 JS。本探针回答：**JS 时间落在哪**
//   假设 H1：每次调用的**固定开销**（候选表构建 / DP 初始化）主导 ⇒ 耗时与词长无关
//   假设 H2：DP 与词长成正比 ⇒ 长词显著更慢
// 判据：同一批词里按长度分层吞吐是否平移（H1 平 / H2 单调下降）；以及「可拆 vs 不可拆」是否等速（可拆含 DP 回溯）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB, { readOnly: true });
const { breakdownWord } = await import(
  new URL('../packages/core/dist/db/index.js', import.meta.url).href
);
const t = (fn) => {
  const a = performance.now();
  fn();
  return performance.now() - a;
};
const rate = (n, ms) => `${(n / (ms / 1000)).toFixed(0)} 词/秒`;

const RU = db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all().map((r) => String(r.word));
breakdownWord(db, RU[0], 'ru'); // 暖缓存

console.log('§A 同一词重复 2000 次：词长 → 单次成本（隔离词长变量）');
for (const w of ['дом', 'домик', 'землетрясение', 'переосвидетельствование']) {
  const ms = t(() => { for (let i = 0; i < 2000; i += 1) breakdownWord(db, w, 'ru'); });
  const parts = breakdownWord(db, w, 'ru');
  console.log(
    `  · ${w}（${[...w].length} 字符，片段 ${parts.length}）：2000 次 ${ms.toFixed(1)} ms ⇒ ${(ms / 2000).toFixed(4)} ms/词 · ${rate(2000, ms)}`,
  );
}
{
  const a = t(() => { for (let i = 0; i < 2000; i += 1) breakdownWord(db, 'дом', 'ru'); });
  const b = t(() => { for (let i = 0; i < 2000; i += 1) breakdownWord(db, 'переосвидетельствование', 'ru'); });
  console.log(`  ⇒ 4 字符 vs 23 字符（5.75× 词长）成本比 = ${(b / a).toFixed(2)}×（若 ≈1 ⇒ 固定开销主导）`);
}

console.log('\n§B 可拆 vs 不可拆（同为 2000 词采样，等长区间）');
const pool = RU.filter((w) => [...w].length >= 8 && [...w].length <= 10);
const yes = [];
const no = [];
for (const w of pool) {
  if (yes.length >= 2000 && no.length >= 2000) break;
  (breakdownWord(db, w, 'ru').length ? yes : no).push(w);
}
for (const [name, arr] of [['可拆', yes.slice(0, 2000)], ['不可拆', no.slice(0, 2000)]]) {
  const ms = t(() => { for (const w of arr) breakdownWord(db, w, 'ru'); });
  console.log(`  · ${name}（${arr.length} 词，长度 8–10）：${ms.toFixed(1)} ms · ${rate(arr.length, ms)}`);
}
db.close();
