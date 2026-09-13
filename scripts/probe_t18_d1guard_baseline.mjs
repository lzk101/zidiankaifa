/**
 * probe_t18_d1guard_baseline.mjs —— T18 前置勘察：独立实测 V9-3 守卫所需的全部真值
 *
 * 用途：在写断言**之前**先把数字测出来，避免「先写期望值再凑」。全部口径显式标注：
 *   口径 A（全库俄语）= words_i18n.lang='ru' 全量，无长度/字符过滤
 *   口径 R（尺子 R）  = 口径 A 外加 length 4..12 AND rowid % 97 = 0
 * 只读、幂等。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');

/** 独立复刻实现侧的前缀 stem 集：morpheme 去首尾连字符 + ё→е（index.ts:734-745 的 stem 定义） */
const prefixStems = new Set(
  db
    .prepare(`SELECT morpheme FROM morphemes WHERE lang = 'ru' AND kind = 'prefix'`)
    .all()
    .map((r) => norm(String(r.morpheme).replace(/^-+|-+$/g, ''))),
);
const singleCharPrefixes = [...prefixStems].filter((s) => s.length === 1).sort();

const RU = db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all().map((r) => String(r.word));
const R = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

console.log('='.repeat(88));
console.log('T18 前置勘察：全库 D1 双向守卫所需真值（功能测试 agent 独立实测）');
console.log('='.repeat(88));
console.log(`词库：${DB_PATH}`);
console.log(`俄语前缀词素总数（口径：morphemes.lang='ru' AND kind='prefix'）= ${prefixStems.size}`);
console.log(`其中单字符前缀 = ${singleCharPrefixes.length} 个：${singleCharPrefixes.map((s) => `'${s}'`).join(' ')}`);

/* ---------------- 全库扫描 ---------------- */
const t0 = Date.now();
let breakable = 0; // 全库可拆
let gap1Total = 0; // 可拆 且 parts[0].start === 1（gap 恰 1 字符）
let gap1InPrefix = 0; // 上述中 gap ∈ 前缀 stem 集（真前缀组 = AC-4 保留组）
let d1 = 0; // 上述中 gap ∉ 前缀 stem 集（D1 模式 = 缺陷）
let gapGe2Unmatched = 0; // gap ≥2 且 gap ∉ 前缀集（裁决六自洽性检验）
let gapGe2Total = 0;
const gap1InPrefixWords = [];
const d1Words = [];
const gap1InPrefixFirstParts = new Map();

for (const w of RU) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  breakable++;
  const start = parts[0].start;
  if (start < 1) continue;
  const gap = norm(w).slice(0, start);
  const explained = prefixStems.has(gap);
  if (gap.length === 1) {
    gap1Total++;
    if (explained) {
      gap1InPrefix++;
      gap1InPrefixWords.push(w);
      const key = parts[0].morpheme;
      gap1InPrefixFirstParts.set(key, (gap1InPrefixFirstParts.get(key) ?? 0) + 1);
    } else {
      d1++;
      d1Words.push(w);
    }
  } else {
    gapGe2Total++;
    if (!explained) gapGe2Unmatched++;
  }
}
const scanMs = Date.now() - t0;

console.log(`\n【全库扫描】口径 A = words_i18n.lang='ru' 全量 = ${RU.length} 词`);
console.log(`  耗时 ${scanMs} ms（${Math.round(RU.length / (scanMs / 1000))} 词/秒）`);
console.log(`  可拆俄语词条            = ${breakable}`);
console.log(`  gap=1 且可拆（D1 全集） = ${gap1Total}   ← 权威口径 342`)
console.log(`    ├─ gap ∈ 前缀集（保留） = ${gap1InPrefix}   ← AC-4 真前缀组 75`);
console.log(`    └─ gap ∉ 前缀集（D1）   = ${d1}   ← 须为 0`);
console.log(`  gap≥2 且可拆            = ${gapGe2Total}`);
console.log(`    其中 gap ∉ 前缀集     = ${gapGe2Unmatched}   ← 自洽性检验须为 0`);
console.log(`  真前缀组首片段分布：`);
for (const [k, v] of [...gap1InPrefixFirstParts].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(10)} × ${v}`);
}
console.log(`  真前缀词样本（前 12）：${gap1InPrefixWords.slice(0, 12).join(', ')}`);
console.log(`  D1 词样本（前 12）：${d1Words.slice(0, 12).join(', ') || '（无）'}`);

/* ---------------- 尺子 R ---------------- */
const t1 = Date.now();
let rNonEmpty = 0;
let rHole3 = 0;
for (const w of R) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  rNonEmpty++;
  const cov = new Array(norm(w).length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < cov.length; i++) cov[i] = true;
  if (cov.filter((x) => !x).length >= 3) rHole3++;
}
const rMs = Date.now() - t1;
console.log(`\n【尺子 R】口径：口径 A + length 4..12 AND rowid % 97 = 0`);
console.log(`  样本 ${R.length} 词 · 可拆 ${rNonEmpty} = ${((rNonEmpty / R.length) * 100).toFixed(2)}%`);
console.log(`  L4 空洞≥3（口径 A 未覆盖字符总数）= ${rHole3}`);
console.log(`  耗时 ${rMs} ms`);

/* ---------------- 方向 B 哨兵 ---------------- */
console.log(`\n【方向 B 哨兵】`);
for (const w of ['удачный', 'удаваться', 'сдабривать', 'одалживать', 'вдаваться']) {
  const parts = breakdownWord(db, w, 'ru');
  console.log(
    `  ${w.padEnd(12)} ${parts.length ? parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' + ') : '[]'}` +
      `${parts.length ? `  parts[0].start=${parts[0].start} gap='${norm(w).slice(0, parts[0].start)}'` : ''}`,
  );
}
const ud = breakdownWord(db, 'удачный', 'ru');
console.log(`  удачный 是否在尺子 R 内 = ${R.includes('удачный')}`);

/* ---------------- 真前缀组单字符集是否恰为 {в,о,с,у} ---------------- */
const gapCharsUsed = new Set();
for (const w of gap1InPrefixWords) {
  const parts = breakdownWord(db, w, 'ru');
  gapCharsUsed.add(norm(w).slice(0, parts[0].start));
}
console.log(`\n真前缀组实际用到的 gap 字符集 = {${[...gapCharsUsed].sort().join(',')}}`);

db.close();
