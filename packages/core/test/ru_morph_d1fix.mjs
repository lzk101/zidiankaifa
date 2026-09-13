/**
 * ru_morph_d1fix.mjs —— D1 修法（index.ts:851 `>=2` → `>=1`）的 **AC-4 验收门**
 * 功能测试 agent 独立判别集 · 2026-09-16 · T15
 *
 * 被测对象：packages/core/dist/db/index.js（非 src）
 * 判据来源：packages/core/src/db/index.ts:851-855
 *   if (parts.length && parts[0].start >= 1) {
 *     const gap = mw.slice(0, parts[0].start);
 *     const explained = all.some((x) => x.m.kind === 'prefix' && x.stem === gap);
 *     if (!explained) return [];
 *   }
 *   ⇒ 修法后，词首被跳过的词只有当 gap **恰好等于**某个前缀的 stem 时才放行。
 *   俄语库内单字符前缀只有 в- / о- / с- / у-（4 个）⇒ 等价于 gap ∈ {в,о,с,у}。
 *
 * ★★ 本文件对主管 T15 交付要求做了一处**纠正**，理由见 §2 注释：
 *   主管要求「对 71 词断言：修法后非空，且**首个片段的 morpheme 就是该单字符前缀**（如 сдабривать 的首片段应为 с-）」。
 *   实测该断言形式**恒假**：放行组的定义就是 `parts[0].start === 1`，即首字符被跳过，
 *   首片段**不可能**是占用位置 0 的那个前缀。实测 30/30 首片段均为 `да-`（start=1），
 *   首片段 = 该单字符前缀者 **0/30**。
 *   ⇒ 本文件改为断言**正确的结构不变量**：
 *       (a) 结果非空（未被修过头误杀）；
 *       (b) parts[0].start === 1（首字符确实被跳过，与放行组定义自洽）；
 *       (c) 首字符 **未被任何片段覆盖**（位置 0 是空洞），第 2 个字符 **必须** 被覆盖。
 *     这三条同样能抓「修过头」（任一不成立即报红），且为真命题。
 *
 * 退出码：0=全绿 · 1=回归（AC-4 失败，须回退修法）· 2=迭代目标未达成
 * 只读、幂等：不写任何数据，可反复运行。
 *
 * 运行：node packages/core/test/ru_morph_d1fix.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../dist/db/index.js';

// ⚠ AGENTS.md 铁律 6：词库路径必须与 cwd 无关，且支持 ZIDIANKAIFA_DB 覆盖。
// `pnpm --filter @zidiankaifa/core test` 的 cwd 是 packages/core（不是仓库根），
// 写成 new DatabaseSync('data/db/dict.db') 会在 pnpm test 下崩 errcode 14 ⇒ 假绿。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? `  —— ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? `  —— ${detail}` : ''}`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, a === e ? '' : `实测 ${a} ≠ 期望 ${e}`);
}

/** 与实现同构的归一化（normalizeWord + ё→е），用于取 gap 字符 */
const normWord = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
/** 拆解结果 → 词素名数组 */
const bd = (w, lang = 'ru') => breakdownWord(db, w, lang).map((p) => p.morpheme);
/** 位置显式字符串 */
const at = (w, lang = 'ru') =>
  breakdownWord(db, w, lang).map((p) => `${p.morpheme}@${p.start}-${p.end}`);

/** 某位置是否被任一片段覆盖 */
function coveredAt(w, idx, lang = 'ru') {
  return breakdownWord(db, w, lang).some((p) => p.start <= idx && idx < p.end);
}

console.log('='.repeat(88));
console.log('ru_morph_d1fix.mjs —— D1 修法 AC-4 验收门（功能测试 agent · T15）');
console.log('='.repeat(88));

/* ------------------------------------------------------------------ *
 * §0 状态探测：修法是否已落到被测的 dist
 * ------------------------------------------------------------------ */
console.log('\n§0 状态探测（被测产物 = packages/core/dist）');

const probeCanonical = bd('плескание'); // D1 点名词，gap='п' ∉ {в,о,с,у}
const FIXED = probeCanonical.length === 0;
const passProbe = bd('сдабривать'); // 放行组代表词，gap='с' ∈ 前缀
console.log(`  плескание（D1 典型误拆）→ ${FIXED ? '[]' : JSON.stringify(probeCanonical)}`);
console.log(`  сдабривать（真实 с- 前缀词）→ ${JSON.stringify(passProbe)}`);
console.log(`  ⇒ 被测 dist 状态：${FIXED ? '【修法后】' : '【修法前】'}`);

if (!FIXED) {
  console.log('\n  修法前状态：§1/§3 的「消除」断言按设计全红（详见文件头说明），仅 §2 放行组应绿。');
}

/* ------------------------------------------------------------------ *
 * §1 消除组：首字符 ∉ {в,о,с,у} ⇒ 必须返回 []
 *    （主管 T15 交付 #1；样本 27 词，来自 D1 全库 267 词拒绝组，覆盖 а/б/г/з/п/т/х/э 等 8 个首字符）
 * ------------------------------------------------------------------ */
console.log('\n§1 消除组：修法后必须返回 []（消除词首单字符被跳过的假词根误拆）');

const ELIMINATED = {
  'п（плескание 系列）': ['плескание'],
  'х（хлестаться 系列）': ['хлестаться'],
  'з（зверство 系列）': ['зверство', 'звериный', 'зверовод', 'звероловство'],
  'г（глетчерный 系列）': ['глетчерный', 'гигрометр', 'гигрология', 'градостроитель'],
  'т（тлеться 系列）': ['тлеться'],
  'а（ателье 系列）': ['ателье', 'аполярный', 'аполярность', 'аполитизм', 'атравматический', 'аметропия', 'анестезия', 'амальгамация'],
  'э（эмальерный 系列）': ['эмальерный'],
  'б（блестеть 系列）': ['блестеть', 'блистать', 'блистательный', 'блескость', 'блеснуть', 'бучарда'],
};

let elimTotal = 0;
for (const [group, ws] of Object.entries(ELIMINATED)) {
  for (const w of ws) {
    elimTotal++;
    eq(`${group.padEnd(22)} ${w}`, bd(w), []);
  }
}
console.log(`  —— 消除组断言 ${elimTotal} 条`);

/* ------------------------------------------------------------------ *
 * §2 放行组：首字符 ∈ {в,о,с,у} ⇒ 必须保留，且首字符仍被跳过（结构不变量）
 *    （主管 T15 交付 #2；样本 30 词，覆盖 в/о/с/у 四个前缀字母）
 *
 *    ★ 断言形式已按实测纠正，见文件头 ★★ 说明。
 * ------------------------------------------------------------------ */
console.log('\n§2 放行组：修法后必须【非空】且【首字符仍被跳过】——防「修过头」误杀真前缀词');

const PASS_KEPT = {
  'у（удаваться 系列）': ['удаваться', 'удавить', 'удавиться', 'удавка', 'удавливать', 'удаление', 'удалец', 'удалить', 'удалять'],
  'с（сдабривать 系列）': ['сдабривать', 'сдавать', 'сдаваться', 'сдавить', 'сдавленный', 'сдавливать', 'сдаточный', 'сдатчик', 'сдаться'],
  'о（одалживать 系列）': ['одалживать', 'одаренность', 'одаренный', 'одаривать', 'одарить', 'одарять'],
  'в（вдаваться 系列）': ['вдаваться', 'вдавить', 'вдавливать', 'вдалбливать', 'вдалеке', 'вдаться'],
};

let keptTotal = 0;
for (const [group, ws] of Object.entries(PASS_KEPT)) {
  for (const w of ws) {
    keptTotal += 1;
    const parts = breakdownWord(db, w, 'ru');
    const label = `${group.padEnd(22)} ${w}`;
    const prefixLetter = group[0]; // 组名首字符 = 该组前缀字母（у/с/о/в）
    // (a) 未被误杀
    ok(`${label} · 非空（无修过头）`, parts.length > 0, `实测 ${JSON.stringify(bd(w))}`);
    if (!parts.length) continue;
    // (b) 首片段起于位置 1（放行组定义；若变了说明 DP 行为被改动）
    ok(
      `${label} · parts[0].start === 1`,
      parts[0].start === 1,
      `实测 ${at(w)}`,
    );
    // (c) 首字符确实是空洞，第 2 个字符确实被覆盖
    ok(`${label} · 首字符(${w[0]})未被覆盖`, coveredAt(w, 0) === false, `实测 ${at(w)}`);
    ok(`${label} · 第2字符(${w[1]})已被覆盖`, coveredAt(w, 1) === true, `实测 ${at(w)}`);
    // (e) 词首 gap 字符恰为该单字符前缀（主管裁决五 §三之补 ③ 的显式形式）
    ok(
      `${label} · gap 字符 === '${prefixLetter}'（确为该前缀字母）`,
      normWord(w)[0] === prefixLetter,
      `实测 '${normWord(w)[0]}' ≠ '${prefixLetter}'`,
    );
  }
}
console.log(`  —— 放行组断言 ${keptTotal} 词 × 4 项`);

/* ------------------------------------------------------------------ *
 * §3 7 个 D1 点名词逐个复验（主管 T15 事实二）
 * ------------------------------------------------------------------ */
console.log('\n§3 主管 T15 点名的 7 个 D1 词：修法后必须全部 []');
for (const w of ['плескание', 'хлестаться', 'зверство', 'глетчерный', 'тлеться', 'ателье', 'эмальерный']) {
  eq(`点名D1 ${w}`, bd(w), []);
}

/* ------------------------------------------------------------------ *
 * §4 事实一：смекать 不是 D1 模式（恒真断言仅作记录，无鉴别力）
 * ------------------------------------------------------------------ */
console.log('\n§4 смекать 复验（记录用：它当前无拆解，非 D1 模式，不受修法影响）');
eq('смекать 当前输出', bd('смекать'), []);
ok('смекать 非 D1 形态（长度<2 片段）', breakdownWord(db, 'смекать', 'ru').length < 2);

/* ------------------------------------------------------------------ *
 * §5 尺子 R 影响 + L1/L4 守卫（KPI 报告，不硬编码为红灯）
 * ------------------------------------------------------------------ */
console.log('\n§5 尺子 R 影响与质量守卫（KPI）');

const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
let rNonEmpty = 0;
let rHole3 = 0;
let rHole2 = 0;
let rZeroHole = 0;
for (const w of R) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  rNonEmpty++;
  const cov = new Array(w.length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  const holes = cov.filter((x) => !x).length;
  if (holes >= 3) rHole3++;
  if (holes >= 2) rHole2++;
  if (holes === 0) rZeroHole++;
}
const rate = (rNonEmpty / R.length) * 100;
console.log(`  尺子 R 样本 ${R.length} 词 · 拆解非空 ${rNonEmpty} 词 = ${rate.toFixed(1)}%`);
console.log(`  （修法前基线 30.8% / 244 词；主管预计修法后 238 = 30.1%）`);
console.log(`  质量 KPI：空洞≥3 = ${rHole3}（冻结值 134）· 空洞≥2 = ${rHole2} · 零空洞 = ${rZeroHole}`);

ok(`L1 反塌陷守卫：尺子 R 覆盖率 ≥ 25%（实测 ${rate.toFixed(1)}%）`, rate >= 25, `实测 ${rate.toFixed(1)}%`);
ok(
  `L4 质量守卫：空洞≥3 未超过冻结值 134（实测 ${rHole3}）`,
  rHole3 <= 134,
  `实测 ${rHole3} > 冻结值 134，质量劣化`,
);
if (rHole3 < 134) console.log(`  ⓘ 空洞≥3 已改善至 ${rHole3}，建议主管下调冻结值 134 → ${rHole3}`);

/* ------------------------------------------------------------------ *
 * §6 结构性不变量：修法不得改变「首字符被跳过」以外的任何行为
 * ------------------------------------------------------------------ */
console.log('\n§6 结构不变量');
eq('修法前后均应可拆（对照，未被误杀）', bd('телескоп'), ['теле-', 'скоп-']);
eq('修法前后均应可拆（对照）', bd('пароход'), ['паро-', 'ход-']);
eq('前缀词未受影响', bd('переписать'), ['пере-', 'пис-', '-ать']);
eq('前缀词未受影响', bd('записать'), ['за-', 'пис-', '-ать']);
ok('сегодня 仍不可拆（旧守卫未被破坏）', bd('сегодня').length === 0);
ok('стетоскоп 不含词首 тоск-', !breakdownWord(db, 'стетоскоп', 'ru').some((p) => p.morpheme === 'тоск-'));
ok('арест 仍不可拆', bd('арест').length === 0);

/* ------------------------------------------------------------------ *
 * §7 已知残余漏洞（修法未覆盖，见 ru_morph_defects.mjs D6）——只报告不判红
 * ------------------------------------------------------------------ */
console.log('\n§7 已知残余漏洞（只报告，不判红；已登记为缺陷 D6）');
const RESIDUAL = ['однако', 'сучить', 'сучение', 'сучильный', 'вдавлина', 'сдаигаться'];
let residualLeak = 0;
for (const w of RESIDUAL) {
  const parts = breakdownWord(db, w, 'ru');
  if (parts.length) residualLeak++;
  console.log(`  ${w.padEnd(14)} ${parts.length ? JSON.stringify(at(w)) : '[]'}`);
}
console.log(`  ⇒ ${residualLeak}/${RESIDUAL.length} 词仍被放行：首字符只是「形似」в/о/с/у，实为词根首字母`);
console.log('     修法只做「字母级」判定（gap ∈ 前缀字母表），不做「词素级」判定（该字母是否真被匹配为前缀）。');

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(88));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (failures.length) {
  console.log('失败项：');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('='.repeat(88));

db.close();
process.exit(fail > 0 ? (FIXED ? 1 : 2) : 0);
