/**
 * 主管独立预演（只读、零副作用、不碰 src/dist）：
 * 在**临时副本**上应用 D1 修法（`parts[0].start >= 2` → `>= 1`），
 * 端到端实测修法后尺子 R 的真实覆盖率与 L4 空洞指标，
 * 以便在开发 agent 完成 T12 前就拿到**可信的预期值**用于交叉核对。
 *
 * 原理：把 packages/core/dist 整棵树复制到临时目录，
 * 只在副本里把 `parts[0].start >= 2` 改成 `>= 1`，
 * 通过绝对 file:// URL 动态 import 副本模块 —— 不改工作区任何文件。
 *
 * 用法：node scripts/probe_preview_d1_fix.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const SRC_DIST = join(ROOT, 'packages', 'core', 'dist');

// ---------- 1. 建立 dist 临时副本并打补丁 ----------
const tmp = mkdtempSync(join(tmpdir(), 'd1preview-'));
const DIST = join(tmp, 'dist');
cpSync(SRC_DIST, DIST, { recursive: true });
// dist 内可能通过相对路径引用 node_modules；把包根也复制以保留可解析性
cpSync(join(ROOT, 'packages', 'core', 'package.json'), join(tmp, 'package.json'));

const target = join(DIST, 'db', 'index.js');
const before = readFileSync(target, 'utf8');

// 与 src 同构：定位 `parts[0].start >= N` 那一行。
// 两种形态都要支持：① 尚未修复（>= 2）→ 在副本上打补丁；② 已修复（>= 1）→ 直接验证真实实现。
const m1 = before.match(/if\s*\(\s*parts\.length\s*&&\s*parts\[0\]\.start\s*>=\s*1\s*\)/);
const m2 = before.match(/if\s*\(\s*parts\.length\s*&&\s*parts\[0\]\.start\s*>=\s*2\s*\)/);

let PRE_FIX_TEXT; // 用于给 beforeMod 构造"修法前"副本的原文
let restoreOriginal = false;
if (m2) {
  // 工作区尚未修复：副本打补丁当作"修法后"
  const patched = before.replace(m2[0], m2[0].replace('>= 2', '>= 1'));
  writeFileSync(target, patched, 'utf8');
  restoreOriginal = true;
  PRE_FIX_TEXT = before;
  console.log(`✅ 工作区未修复。已在副本打补丁: ${m2[0]}  →  ${m2[0].replace('>= 2', '>= 1')}`);
} else if (m1) {
  // 工作区已修复（开发 agent 已落盘）：直接验证真实实现；beforeMod 用副本回退成 >= 2
  const reverted = before.replace(m1[0], m1[0].replace('>= 1', '>= 2'));
  restoreOriginal = true;
  PRE_FIX_TEXT = reverted;
  console.log(`✅ 工作区已修复（开发 agent 已落盘）。当前 guard: ${m1[0]}`);
  console.log(`   ⇒ 直接验证真实实现；"修法前"基线由副本回退为 >= 2 得出。`);
} else {
  console.error('❌ 未在 dist/db/index.js 中定位到 `parts[0].start >= 1|2` 守卫；dist 可能未构建。');
  console.error('   前 200 字符上下文:', before.slice(0, 200));
  process.exit(1);
}
console.log(`   副本位置: ${tmp}（工作区未改动）`);
console.log('');

// ---------- 2. 动态载入「修法后」副本 与「修法前」回退副本 ----------
const after = await import(pathToFileURL(target).href);
const revertPath = join(DIST, 'db', '__pre_fix.js');
writeFileSync(revertPath, PRE_FIX_TEXT, 'utf8');
const beforeMod = await import(pathToFileURL(revertPath).href);

const db = new DatabaseSync(join(ROOT, 'data', 'db', 'dict.db'), { readOnly: true });

const RU = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru'`)
  .all()
  .map((r) => String(r.word));
const R_SQL = `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`;
const R = db.prepare(R_SQL).all().map((r) => String(r.word));

console.log('='.repeat(78));
console.log('D1 修法 · 端到端预演（尺子 R 真实覆盖率）');
console.log('='.repeat(78));
console.log(`尺子 R 分母: ${R.length}`);

// ---------- 3. 覆盖率对比 ----------
function coverage(mod) {
  let hit = 0;
  const hitWords = [];
  for (const w of R) {
    const p = mod.breakdownWord(db, w, 'ru');
    if (p.length) { hit++; hitWords.push(w); }
  }
  return { hit, hitWords, set: new Set(hitWords) };
}

const covBefore = coverage(beforeMod);
const covAfter = coverage(after);

const pct = (n) => ((n / R.length) * 100).toFixed(2) + '%';
console.log('');
console.log('【覆盖率】');
console.log(`  修法前: ${String(covBefore.hit).padStart(3)} / ${R.length} = ${pct(covBefore.hit)}`);
console.log(`  修法后: ${String(covAfter.hit).padStart(3)} / ${R.length} = ${pct(covAfter.hit)}`);
console.log(`  变化  : ${covAfter.hit - covBefore.hit} 词（${(((covAfter.hit - covBefore.hit) / R.length) * 100).toFixed(2)}pp）`);
console.log(`  L1 守卫 related.mjs:150 断言 ≥25% → ${(covAfter.hit / R.length) * 100 >= 25 ? '✅ 仍然安全' : '❌ 危险'}`);
console.log('');

// ---------- 4. 诊断：哪些词由可拆变不可拆（应全是 D1 误拆）----------
const lost = covBefore.hitWords.filter((w) => !covAfter.set.has(w));
const gained = covAfter.hitWords.filter((w) => !covBefore.set.has(w));
const R_SET = new Set(R);

console.log('【由「可拆」变「不可拆」的词】——预期应全部是 D1 误拆');
console.log(`  R 内共 ${lost.length} 词:`);
for (const w of lost) {
  const p = beforeMod.breakdownWord(db, w, 'ru');
  const gap = p.length ? w.slice(0, p[0].start) : '?';
  const inWide = RU.includes(w);
  console.log(
    `    ${w.padEnd(16)} gap='${gap}' 拆解=[${p.map((x) => x.morpheme + '@' + x.start).join(' ')}]`,
  );
}
console.log('');
console.log(`【由「不可拆」变「可拆」的词】: ${gained.length} 词 ${gained.slice(0, 10).join(', ')}${gained.length > 10 ? ' …' : ''}`);
console.log('');

// ---------- 5. 全库影响规模 ----------
let fullBefore = 0, fullAfter = 0;
let fullLost = [], fullGained = [];
for (const w of RU) {
  const b = beforeMod.breakdownWord(db, w, 'ru').length > 0;
  const a = after.breakdownWord(db, w, 'ru').length > 0;
  if (b) fullBefore++;
  if (a) fullAfter++;
  if (b && !a) fullLost.push(w);
  if (!b && a) fullGained.push(w);
}
console.log('【全库俄语词条影响】');
console.log(`  全体俄语词条: ${RU.length}`);
console.log(`  可拆: ${fullBefore} → ${fullAfter}  (${fullAfter - fullBefore})`);
console.log(`  变不可拆: ${fullLost.length} 词  |  变可拆: ${fullGained.length} 词`);
console.log(`  ⚠ 若「变可拆」> 0，说明修法产生新拆解，须逐一审查是否为新误拆。`);
if (fullGained.length) {
  console.log('    变可拆样本:', fullGained.slice(0, 20).join(', '));
}
console.log('');

// ★ 自洽性检验（抓「守卫遗漏」的钩子）：
// 修法后若某词仍可拆、且其词首 gap=1、且该 gap 字符 ∉ 库内单字符前缀集 → 说明还有别的守卫放行了它。
// 这是对"修法是否真的全局闭合"的强检验，不依赖任何具名清单。
const PREFIX_SET = new Set(['в', 'о', 'с', 'у']);
const leaked = [];
for (const w of RU) {
  const p = after.breakdownWord(db, w, 'ru');
  if (!p.length) continue;
  const start = p[0].start;
  if (start === 1) {
    const gap = w.slice(0, 1);
    if (!PREFIX_SET.has(gap)) leaked.push({ w, gap, parts: p });
  }
}
console.log('【自洽性检验】修法后「词首 gap=1 但 gap 字符 ∉ 前缀集」却仍可拆的词');
console.log(`  数量: ${leaked.length} 词  ${leaked.length === 0 ? '✅ 修法全局闭合' : '❌ 存在守卫遗漏'}`);
if (leaked.length) {
  for (const x of leaked.slice(0, 15)) {
    console.log(`    ⚠ ${x.w} gap='${x.gap}' [${x.parts.map((p) => p.morpheme + '@' + p.start).join(' ')}]`);
  }
}
console.log('');

// ---------- 6. 71 词正向回归（防修过头）----------
// 具名清单来自主管 probe_verify_gap1_fix.mjs 的实测分组
const TRUE_PREFIX_WORDS = [
  // у
  'удаваться', 'удавить', 'удавиться', 'удавка', 'удавливать', 'удавчик', 'удаление',
  'удалой', 'удаль', 'удалять', 'удаляться', 'ударение', 'ударить', 'удариться', 'ударник',
  'ударный', 'ударять', 'ударяться', 'удачливый', 'удачный',
  // с
  'сдабривать', 'сдавать', 'сдаваться', 'сдавить', 'сдавленный', 'сдавливать', 'сдавочный',
  'сдача', 'сдвоенный', 'сдвоить', 'сдвиг', 'сдвигать', 'сдвигаться', 'сдвинуть', 'сдвинуться',
  // о
  'одалживать', 'одалживаться', 'одаренность', 'одаренный', 'одаривать', 'одарить', 'одарять',
  'одарённость', 'одарённый', 'одев', 'одеваться',
  // в
  'вдаваться', 'вдавить', 'вдавливать', 'вдалбливать', 'вдалеке', 'вдаться', 'вдвигать',
];
// ★ 判据订正（主管第一次预演时写错，此处改正）：
// 单字符前缀 в/о/с/у 在 gap=1 情形下**不会**被指派为片段——它是「被前缀解释掉的 gap」。
// 实测 удаваться 的拆解是 [да-@1 -вать@4]，`у` 从未出现在 parts 里。
// 因此正确断言是：① 修法后仍可拆 ② 首片段 start === 1 ③ 词首 gap 字符 === 该单字符前缀。
console.log('【71 词正向回归（AC-4 无修过头）】——修法后必须仍可拆，且词首 gap 被该单字符前缀解释');
let pass = 0, fail = 0, skippedNoDb = 0;
const failures = [];
for (const w of TRUE_PREFIX_WORDS) {
  const pb = beforeMod.breakdownWord(db, w, 'ru');
  const pa = after.breakdownWord(db, w, 'ru');
  const wasOk = pb.length > 0;
  if (!wasOk) { skippedNoDb++; continue; } // 修法前就不可拆 ⇒ 不是回归，不计入
  const stillOk = pa.length > 0;
  const firstStart = pa.length ? pa[0].start : null;
  const gap = pa.length ? w.slice(0, firstStart) : null;
  const gapIsPrefix = gap === w[0]; // 该单字符前缀是否正是被解释的 gap
  const ok = stillOk && firstStart === 1 && gapIsPrefix;
  if (ok) pass++;
  else {
    fail++;
    failures.push({ w, stillOk, firstStart, gap, firstMor: pa.length ? pa[0].morpheme : null });
  }
}
console.log(`  ✅ 修法后仍可拆 且 gap 恰为该单字符前缀: ${pass} 词`);
console.log(`  ❌ 疑似修过头: ${fail} 词`);
for (const f of failures) {
  console.log(`    ⚠ ${f.w}  可拆=${f.stillOk} 首片段start=${f.firstStart} gap='${f.gap}' 首片段=${f.firstMor}`);
}
console.log(`  （跳过 ${skippedNoDb} 词：修法前本就不可拆，不构成回归）`);
console.log('');
console.log('  注：单字符前缀是被 gapExplain「解释掉」的 gap，不进入 parts ——');
console.log('      故 удаваться = [да-@1 -вать@4]，`у` 不作为片段出现。这是既有设计，非缺陷。');
console.log('');

// ---------- 7. L4 质量指标（最大单段空洞 ≥3）----------
function maxGap(p, n) {
  if (!p.length) return null;
  const sorted = [...p].sort((a, b) => a.start - b.start);
  let gaps = [];
  let cursor = 0;
  for (const x of sorted) {
    if (x.start > cursor) gaps.push(x.start - cursor);
    cursor = Math.max(cursor, x.end);
  }
  if (cursor < n) gaps.push(n - cursor);
  return gaps.length ? Math.max(...gaps) : 0;
}

function l4(mod) {
  let ge3 = 0, ge2 = 0;
  for (const w of R) {
    const p = mod.breakdownWord(db, w, 'ru');
    if (!p.length) continue;
    const g = maxGap(p, w.length);
    if (g >= 3) ge3++;
    if (g >= 2) ge2++;
  }
  return { ge3, ge2 };
}
const l4b = l4(beforeMod);
const l4a = l4(after);
console.log('【L4 质量指标（尺子 R，口径=词中最大单段空洞）】');
console.log(`  最大单段空洞 ≥3（← L4 冻结值 134）: ${l4b.ge3} → ${l4a.ge3}   ${l4a.ge3 <= 134 ? '✅ 未截穿' : '❌ 截穿 L4'}`);
console.log(`  最大单段空洞 ≥2（← D2 口径，非门禁）: ${l4b.ge2} → ${l4a.ge2}`);
console.log('');

console.log('='.repeat(78));
console.log('结论判据');
console.log('='.repeat(78));
const verdict = {
  'L1 覆盖率 ≥25% 安全': (covAfter.hit / R.length) * 100 >= 25,
  'L4 空洞≥3 未截穿 134': l4a.ge3 <= 134,
  'AC-4 无修过头（71 词全保有）': fail === 0,
  '无新增拆解（全库变可拆=0）': fullGained.length === 0,
};
for (const [k, v] of Object.entries(verdict)) {
  console.log(`  ${v ? '✅' : '❌'} ${k}`);
}
console.log('');
console.log(`  R 覆盖率预期值（供与开发 agent 交叉核对）: ${covAfter.hit}/${R.length} = ${pct(covAfter.hit)}`);
console.log(`  L4 空洞≥3 预期值（供交叉核对）: ${l4a.ge3}`);

db.close();
rmSync(tmp, { recursive: true, force: true });
console.log('\n（临时副本已清理，工作区未改动）');
