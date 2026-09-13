// scripts/probe_sup_v9_final_audit.mjs
// 主管侧 v0.9.0 落盘后【独立端到端复核】探针（只读）
//
// 目的：在 roots_ru.json 合并 + build_db.py morphemes 重建 + core build 之后，
//       用【生产官方引擎】直接测全部验收判据，不看任何 agent 的转述数字。
//
// 口径（引用必须带口径，AGENTS.md 铁律 7）：
//   尺子 R     = related.mjs:144  SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0  → 791 词
//   全库        = words_i18n lang='ru' 全部（约 101,512）
//   空洞口径 A  = 未覆盖字符【总数】   ← L4 权威口径（R 内基线 134）
//   空洞口径 B  = 最大【单段】空洞     （R 内基线 129）
//   D1 形态     = gap=1 且 gap ∉ 库内前缀 stem 集
//
// 判据（BOARD 裁决十七 + T24 四项裁决）：
//   1. 真前缀组 ≥63 · `да-` 子集 =63 · 4 哨兵保持可拆 · `смекать` 不得凭空新增
//   2. L4（R 内空洞≥3 口径A）≤134
//   3. 全库空洞≥3 口径A/B【绝对值 + 率】—— 率不得上升；绝对值为正时须 Δ率 ≤0
//   4. 全库可拆 ≥33162 · 尺子 R ≥238 · 率 ≥30.0%
//   5. 判据①替代量（gapMin=2 退回变体）—— 只报不判
//
// 用法: node scripts/probe_sup_v9_final_audit.mjs
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');

const core = await import(new URL('../packages/core/dist/db/index.js', import.meta.url).href);
const { breakdownWord } = core;

const db = new DatabaseSync(DB);

// ---------- 词素库：独立自算前缀 stem 集（不 import 内部 loadMorphemes） ----------
const prefixStems = new Set();
for (const r of db.prepare("SELECT morpheme FROM morphemes WHERE lang='ru' AND kind='prefix'").all()) {
  prefixStems.add(String(r.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е'));
}
const allMorphemes = db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru'").all();
const morphemeSet = new Map(allMorphemes.map((r) => [String(r.morpheme), String(r.kind)]));
console.log(`【词素库】俄语词素 ${allMorphemes.length} 条 · 前缀 ${prefixStems.size} 个`);
console.log(`【单字符前缀】${[...prefixStems].filter((s) => s.length === 1).map((s) => `'${s}'`).join(' ')}`);

// ---------- 尺子 R ----------
const R = db
  .prepare(
    "SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0 ORDER BY rowid"
  )
  .all()
  .map((r) => String(r.word));

const norm = (w) => w.replace(/ё/g, 'е').toLowerCase();

// 返回 { parts, holeA（未覆盖总数）, holeB（最大单段）, gaps, prefixLeads }
function analyze(word, lang = 'ru') {
  const parts = breakdownWord(db, word, lang) ?? [];
  const n = word.length;
  const covered = new Array(n).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < n; i++) covered[i] = true;
  let holeA = 0;
  let cur = 0;
  let holeB = 0;
  for (let i = 0; i < n; i++) {
    if (!covered[i]) {
      holeA++;
      cur++;
      if (cur > holeB) holeB = cur;
    } else cur = 0;
  }
  // 词首未覆盖片段（gap）
  let lead = 0;
  while (lead < n && !covered[lead]) lead++;
  return { parts, holeA, holeB, lead };
}

// ---------- 全库扫描 ----------
const allRu = db
  .prepare("SELECT word FROM words_i18n WHERE lang='ru'")
  .all()
  .map((r) => String(r.word));

console.log(`\n【分母】尺子 R = ${R.length} 词 · 全库俄语 = ${allRu.length} 词`);
console.log('全库扫描中（约 12–20 s）…');
const t0 = Date.now();

let A_break = 0;
let A_hole3 = 0; // 口径A（未覆盖总数 ≥3）
let A_hole2 = 0;
let B_hole3 = 0; // 口径B（最大单段 ≥3）
// D1 形态：可拆且词首 gap 恰 1 字符且该字符 ∉ 前缀集
let d1 = 0;
// 真前缀组：可拆且词首 gap ===1 且 gap ∈ 前缀集
let truePrefix = 0;
const truePrefixWords = [];
const daCore = [];
const d1Words = [];

for (const w of allRu) {
  const mw = norm(w);
  // 引擎内部对俄语做 ё→е；这里用原词调用，由引擎自行处理
  const a = analyze(w);
  if (a.parts.length > 0) {
    A_break++;
    if (a.holeA >= 3) A_hole3++;
    if (a.holeA >= 2) A_hole2++;
    if (a.holeB >= 3) B_hole3++;
  }
  if (a.lead === 1 && a.parts.length > 0) {
    const g = mw[0];
    if (prefixStems.has(g)) {
      truePrefix++;
      truePrefixWords.push(w);
    } else {
      d1++;
      d1Words.push(w);
    }
  }
  // `да-` 子集：词首首片段恰为 да- 起于 pos 1
  const p0 = a.parts[0];
  if (p0 && p0.start === 1 && mw.slice(1, 3) === 'да') daCore.push(w);
}
const ms = Date.now() - t0;

const A_rate = A_break ? A_hole3 / A_break : 0;
const B_rate = A_break ? B_hole3 / A_break : 0;

console.log(`\n【全库】可拆 ${A_break} · 空洞≥3 口径A ${A_hole3}（率 ${(A_rate * 100).toFixed(4)}%）· 口径B ${B_hole3}（率 ${(B_rate * 100).toFixed(4)}%）· 空洞≥2 口径A ${A_hole2}`);
console.log(`【全库】D1 形态 ${d1} · 真前缀组 ${truePrefix} · 真前缀词样例 ${truePrefixWords.slice(0, 5).join(' / ')}`);
console.log(`【全库】\`да-\` 首片段子集 ${daCore.length}`);
if (d1Words.length) console.log(`⚠ D1 残余（前 20）：${d1Words.slice(0, 20).join(' ')}`);
console.log(`耗时 ${ms} ms`);

// ---------- 尺子 R ----------
let R_nonempty = 0;
let R_hole3A = 0;
let R_hole3B = 0;
let R_hole2A = 0;
let R_zero = 0;
for (const w of R) {
  const a = analyze(w);
  if (a.parts.length > 0) {
    R_nonempty++;
    if (a.holeA === 0) R_zero++;
    if (a.holeA >= 3) R_hole3A++;
    if (a.holeB >= 3) R_hole3B++;
    if (a.holeA >= 2) R_hole2A++;
  }
}
console.log(`\n【尺子 R】可拆 ${R_nonempty}/${R.length} = ${((R_nonempty / R.length) * 100).toFixed(2)}%`);
console.log(`【尺子 R】空洞≥3 口径A ${R_hole3A} · 口径B ${R_hole3B} · 空洞≥2 口径A ${R_hole2A} · 零空洞 ${R_zero}`);

// ---------- 哨兵与靶词 ----------
const SENTINELS = {
  'вдаваться': '真哨兵·必须可拆',
  'одалживать': '真哨兵·必须可拆',
  'сдабривать': '真哨兵·必须可拆',
  'удачный': '真哨兵·必须可拆（唯一落在 R 内的真前缀词）',
  'смекать': '不得凭空新增（基线本就 []）',
  'вода': '基线 {вод-@0}',
  'вдаться': 'да- 真族 10',
  'сдавать': 'да- 真族 10',
  'сдаваться': 'да- 真族 10',
  'сдаточный': 'да- 真族 10',
  'сдаться': 'да- 真族 10',
  'удаваться': 'да- 真族 10',
  'удаться': 'да- 真族 10',
  'удачливый': 'да- 真族 10',
  'сучить': 'V9-2 靶词·须不再含 уч-@1',
  'сучок': 'V9-2 靶词',
  'сучковатый': 'V9-2 靶词',
  'однако': 'V9-2 靶词·须不再含 дн-@1',
  'больной': 'D4 靶词·须为 боль + -ной',
  'самосуд': 'D4 靶词·须为 само + суд',
  'термостат': 'D4 靶词·须为 терм + -о- + стат',
  'столп': 'D4a 假词根·兜底',
  'казус': 'D4a 假词根·兜底',
  'доминировать': 'D4a 假词根',
  'землетрясение': 'D2 已知留红（v0.10.0）',
  'водопад': 'D2 已知留红（v0.10.0）',
};
console.log('\n【哨兵与靶词逐词输出】');
for (const [w, note] of Object.entries(SENTINELS)) {
  const parts = breakdownWord(db, w, 'ru') ?? [];
  const fmt = parts.map((p) => `${p.morpheme ?? p.kind}@${p.start}-${p.end}`).join(' + ') || '[]';
  const a = analyze(w);
  console.log(`  ${w.padEnd(16)} ${fmt.padEnd(46)} 空洞A=${a.holeA} B=${a.holeB} lead=${a.lead}  «${note}»`);
}

// ---------- 关键结构断言（不判分，只报） ----------
const headMorpheme = (w) => {
  const parts = breakdownWord(db, w, 'ru') ?? [];
  return parts.length ? String(parts[0].morpheme ?? '') : '';
};
const ucWords = allRu.filter((w) => headMorpheme(w) === 'уч-' && (breakdownWord(db, w, 'ru') ?? [])[0]?.start === 1);
const dnWords = allRu.filter((w) => headMorpheme(w) === 'дн-' && (breakdownWord(db, w, 'ru') ?? [])[0]?.start === 1);
console.log(`\n【★ 靶点】词首 = уч-@1 且可拆的词：${ucWords.length} 个  ${ucWords.slice(0, 15).join(' ')}`);
console.log(`【★ 靶点】词首 = дн-@1 且可拆的词：${dnWords.length} 个  ${dnWords.slice(0, 15).join(' ')}`);
console.log(`【★ 靶点】глава 含 уч- 于 pos1 的词（含非词首片段）：`);
let ucAny = 0;
for (const w of allRu) {
  const parts = breakdownWord(db, w, 'ru') ?? [];
  if (parts.some((p) => String(p.morpheme) === 'уч-' && p.start === 1)) ucAny++;
}
console.log(`  ${ucAny} 个`);

console.log('\n【词素库核对】本次应新增/确认的条目：');
for (const m of ['суч-', 'суд-', 'стат-', '-ной', 'столп-', 'казус-', 'однако-', 'домин-', 'боль-', '-ный', 'уч-', 'дн-', 'каз-', 'дом-', 'стол-']) {
  console.log(`  ${m.padEnd(10)} ${morphemeSet.has(m) ? `存在 (kind=${morphemeSet.get(m)})` : '缺失'}`);
}

console.log(`\n【判据对照（基线 → 现测）】`);
console.log(`  全库可拆       33174 → ${A_break}      判据 ≥33162  ${A_break >= 33162 ? '✅' : '❌'}`);
console.log(`  真前缀组          75 → ${truePrefix}        判据 ≥63     ${truePrefix >= 63 ? '✅' : '❌'}`);
console.log(`  \`да-\` 子集        63 → ${daCore.length}        判据 =63     ${daCore.length === 63 ? '✅' : '❌'}`);
console.log(`  尺子 R           238 → ${R_nonempty}       判据 ≥238    ${R_nonempty >= 238 ? '✅' : '❌'}`);
console.log(`  R 率          30.09% → ${((R_nonempty / R.length) * 100).toFixed(2)}%  判据 ≥30.0%  ${R_nonempty / R.length >= 0.3 ? '✅' : '❌'}`);
console.log(`  L4(R 内空洞≥3A)  134 → ${R_hole3A}       判据 ≤134    ${R_hole3A <= 134 ? '✅' : '❌'}`);
console.log(`  全库空洞≥3A    20214 → ${A_hole3}   绝对值/率双口径`);
console.log(`  全库空洞≥3B    18762 → ${B_hole3}   绝对值/率双口径`);
console.log(`  基线率 A 60.9333% → ${(A_rate * 100).toFixed(4)}%   ${(A_rate * 100).toFixed(4) <= 60.9333 ? '✅ 率未上升' : '❌ 率上升'}`);
console.log(`  基线率 B 56.5563% → ${(B_rate * 100).toFixed(4)}%   ${(B_rate * 100).toFixed(4) <= 56.5563 ? '✅ 率未上升' : '❌ 率上升'}`);
console.log(`  全库 D1 形态       0 → ${d1}         判据 ===0     ${d1 === 0 ? '✅' : '❌'}`);
