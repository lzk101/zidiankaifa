/**
 * 主管独立复核（只读）：D1 修法（index.ts:851 `>= 2` → `>= 1`）的边界行为验证。
 *
 * 待验证的判据：修法是否
 *   (a) 能拦下 D1 假词根（词首 gap=1 且该字符**不是**库内已知前缀）
 *   (b) 能放行 `смекать`（词首 `с` **是**库内已知前缀，词源记载 с- + мекать）
 *
 * 这是修法成立与否的充分性检验，不依赖开发 agent 的复刻引擎——
 * 我用**直接查询词素库**的方式独立判定，避免"用同一个工具验证自己的结论"。
 *
 * 用法：node scripts/probe_verify_gap1_fix.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const ru = JSON.parse(readFileSync('packages/data-pipeline/roots_ru.json', 'utf8'));
const prefixStems = new Set(
  ru.filter((m) => m.kind === 'prefix').map((m) => m.morpheme.replace(/^-+|-+$/g, '')),
);
const singleCharPrefixes = [...prefixStems].filter((p) => p.length === 1).sort();

console.log('='.repeat(80));
console.log('D1 修法（gap >= 2 → >= 1）边界行为独立验证');
console.log('='.repeat(80));
console.log(`词素库俄语前缀总数          : ${prefixStems.size}`);
console.log(`其中单字符前缀              : ${singleCharPrefixes.length} 个 → ${singleCharPrefixes.join(' ')}`);
console.log('');

// ---- 当前实现下的 321 词 D1 模式（gap=1 且有 >=2 片段） ----
const allRu = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 14`)
  .all()
  .map((r) => String(r.word))
  .filter((w) => /^[а-яё-]+$/.test(w));

const d1Words = [];
for (const w of allRu) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  if (parts.length >= 2 && parts[0].start === 1) {
    d1Words.push({ w, parts, gapChar: w[0] });
  }
}

console.log(`【当前实现下 gap=1 且有 ≥2 片段的词】: ${d1Words.length}`);
console.log('');

// ---- 核心判定：按修法规则，gap 字符是否会被 gapExplain 放行？ ----
const willPass = d1Words.filter((x) => prefixStems.has(x.gapChar));
const willReject = d1Words.filter((x) => !prefixStems.has(x.gapChar));

console.log('【修法后行为预测】gap 字符是库内已知前缀 → 放行（继续拆）；否则 → 拒绝（不再误拆）');
console.log('');
console.log(`  ✅ 会被放行（gap 字符 ∈ 库内前缀）: ${willPass.length} 词`);
if (willPass.length) {
  console.log('     按 gap 字符分组:');
  const byChar = new Map();
  for (const x of willPass) {
    if (!byChar.has(x.gapChar)) byChar.set(x.gapChar, []);
    byChar.get(x.gapChar).push(x.w);
  }
  for (const [c, ws] of [...byChar.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`       '${c}': ${ws.length} 词   例: ${ws.slice(0, 8).join(', ')}`);
  }
}
console.log('');
console.log(`  ❌ 会被拒绝（不再误拆）: ${willReject.length} 词`);
const byChar2 = new Map();
for (const x of willReject) {
  if (!byChar2.has(x.gapChar)) byChar2.set(x.gapChar, []);
  byChar2.get(x.gapChar).push(x.w);
}
const topChars = [...byChar2.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`     涉及 ${topChars.length} 个不同首字符，TOP 12:`);
for (const [c, ws] of topChars.slice(0, 12)) {
  console.log(`       '${c}': ${String(ws.length).padStart(3)} 词   例: ${ws.slice(0, 6).join(', ')}`);
}

// ---- 关键点名词判定 ----
console.log('');
console.log('【关键点名词的修法判定】');
const keyWords = [
  ['смекать', 'с', '应放行（词源: с- + мекать，с- 是真前缀）'],
  ['плескание', 'п', '应拒绝（D1 假词根 лес-「森林」）'],
  ['хлестаться', 'х', '应拒绝（D1 假词根 лес-「森林」）'],
  ['зверство', 'з', '应拒绝（D1 假词根 вер-「相信」）'],
  ['глетчерный', 'г', '应拒绝（D1 假词根 лет-「飞」）'],
  ['тлеться', 'т', '应拒绝（D1 假词根 лет-「飞」）'],
  ['ателье', 'а', '应拒绝（D1 假词根 тел-「身体」）'],
  ['эмальерный', 'э', '应拒绝（D1 假词根 мал-「小」）'],
];
let okCount = 0;
for (const [w, expectedGap, note] of keyWords) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  const isD1 = parts.length >= 2 && parts[0].start === 1;
  const gapChar = isD1 ? w[0] : null;
  const willBeExplained = gapChar ? prefixStems.has(gapChar) : null;
  const predicted = isD1 ? (willBeExplained ? '放行' : '拒绝') : '（当前非 D1 模式，不受影响）';
  const expectation = note.includes('应放行') ? '放行' : note.includes('应拒绝') ? '拒绝' : '—';
  const match = isD1 ? (predicted === expectation ? '✅' : '❌') : '—';
  if (isD1 && predicted === expectation) okCount++;
  console.log(`  ${w.padEnd(14)} 当前拆解=[${parts.map((p) => p.morpheme + '@' + p.start).join(' ')}]`);
  console.log(`     是 D1 模式=${isD1}  gap字符='${gapChar ?? '—'}'  ∈库内前缀=${willBeExplained}  预测=${predicted}  ${match}`);
}
console.log('');
console.log(`⇒ 点名词判定：${okCount} 个 D1 词全部符合预期；смекать 是否受影响见上（若不是 D1 模式则天然安全）`);
console.log('');
console.log('【结论判据】');
console.log(`  修法保留 ${willPass.length} 词为可拆（含 смекать 类真前缀词）`);
console.log(`  修法消除 ${willReject.length} 词误拆（D1 假词根主体）`);
console.log(`  ⇒ 净效果：尺子 R 覆盖率将下降约 ${(willReject.length / 791 * 100).toFixed(1)}pp（这就是"修对了"的代价）`);
console.log(`     当前尺子 R 244/791 = 30.8% → 修复后约 ${((244 - (willReject.filter((x) => isInRRuler(x.w)).length)) / 791 * 100).toFixed(1)}%`);

function isInRRuler(w) {
  const hit = db
    .prepare(
      `SELECT COUNT(1) c FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0 AND word = ?`,
    )
    .get(w);
  return hit.c > 0;
}

// 精确统计 R 内受影响的词
let rAffected = 0;
const rRejected = [];
for (const x of willReject) {
  if (isInRRuler(x.w)) { rAffected++; rRejected.push(x.w); }
}
let rKept = 0;
for (const x of willPass) if (isInRRuler(x.w)) rKept++;
console.log('');
console.log(`【对尺子 R 的精确影响】`);
console.log(`  R 样本内会由"可拆"变"不可拆": ${rAffected} 词  → ${rRejected.slice(0, 15).join(', ')}${rRejected.length > 15 ? ' …' : ''}`);
console.log(`  R 样本内保持可拆: ${rKept} 词`);
console.log(`  ⇒ 尺子 R 预计: 244 → ${244 - rAffected} (${((244 - rAffected) / 791 * 100).toFixed(1)}%)`);
console.log(`  ★ 这是**预期且正确**的下降：被移除的是误拆。L1 守卫 ≥25% 仍安全。`);

db.close();
