// scripts/probe_sup_v9_placement_audit.mjs
// 主管侧【位置合法性审计】探针（只读，用生产官方引擎）
//
// 目的：T27 表里「真前缀组 63 → 9」需要解释；且新增词根在各词中的【起止位置】是否合法
//       （词根若被定位在词中任意位置，就会像 столп→стол- 一样制造假词族）。
//
// 本探针**不改任何东西**，只对现状逐词打印，用于判定：
//   ① 真前缀组为何骤降（是「度量变形」还是「真损失」）
//   ② 各候选词根家族里，词根【落位】是否合法（pos 0 为合法；pos>0 需另论）
//
// 用法: node scripts/probe_sup_v9_placement_audit.mjs [词1 词2 ...]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const core = await import(new URL('../packages/core/dist/db/index.js', import.meta.url).href);
const { breakdownWord, relatedByMorpheme } = core;
const db = new DatabaseSync(process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db'));

const morphemes = db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru'").all();
const stemOf = (m) => String(m).replace(/^-+|-+$/g, '');
const morphemeByStem = new Map();
for (const r of morphemes) morphemeByStem.set(stemOf(r.morpheme), String(r.kind));
const prefixStems = new Set(
  morphemes.filter((r) => r.kind === 'prefix').map((r) => stemOf(r.morpheme))
);
console.log(`【库】俄语词素 ${morphemes.length} · 前缀 ${prefixStems.size} · 单字符前缀 ${[...prefixStems].filter((s) => s.length === 1).join(' ')}`);

const fmt = (parts) =>
  parts.length ? parts.map((p) => `${p.morpheme}@${p.start}-${p.end}[${p.kind}]`).join(' + ') : '[]';

// ---- ① 真前缀组：全体 gap=1 且 gap ∈ 前缀集的可拆词 ----
const allRu = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
function leadGap(parts, n) {
  const cov = new Array(n).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < n; i++) cov[i] = true;
  let g = 0;
  while (g < n && !cov[g]) g++;
  return g;
}
const truePrefixWords = [];
const leadGap1NotPrefix = [];
for (const w of allRu) {
  const parts = breakdownWord(db, w, 'ru') ?? [];
  if (!parts.length) continue;
  const mw = w.replace(/ё/g, 'е').toLowerCase();
  const g = leadGap(parts, w.length);
  if (g === 1) {
    if (prefixStems.has(mw[0])) truePrefixWords.push([w, fmt(parts)]);
    else leadGap1NotPrefix.push([w, fmt(parts)]);
  }
}
console.log(`\n【真前缀组】gap=1 且 gap ∈ 前缀集：${truePrefixWords.length} 词`);
console.log(`【D1 残余】gap=1 且 gap ∉ 前缀集：${leadGap1NotPrefix.length} 词`);
for (const [w, f] of truePrefixWords.slice(0, 30)) console.log(`   ${w.padEnd(18)} ${f}`);

// ---- ② 新增/候选词根家族的位置审计 ----
const FAMILIES = {
  'суч-': ['сучок', 'сучковатый', 'сучить', 'засучивать', 'рассучивать', 'сучкорезка'],
  'суд-': ['самосуд', 'суд', 'судить', 'посуда', 'посудина', 'правосудие', 'обсудить'],
  'стат-': ['термостат', 'статика', 'статический', 'экстатический', 'достать', 'застать', 'верстать', 'вырастать', 'астатизм'],
  'пад-': ['водопад', 'звездопад', 'западный', 'нападать', 'выпадать', 'листопадный'],
  'тряс-': ['землетрясение', 'потрясать', 'сотрясать', 'натрясать'],
  '-ной': ['больной', 'внеземной', 'головной', 'заводной', 'выходной'],
  'домин-': ['доминировать', 'доминиканец', 'доминошный'],
  'столп-': ['столп', 'столпиться', 'столпотворение'],
  'казус-': ['казус', 'казусный'],
  'однако-': ['однако', 'поднаковальня', 'поднакопить'],
  'термостат-': ['термостат'],
  'дав-': ['вдаваться', 'вдавить', 'давать', 'выдавать', 'давильня'],
};
for (const [label, words] of Object.entries(FAMILIES)) {
  console.log(`\n【家族 ${label}】`);
  for (const w of words) {
    const parts = breakdownWord(db, w, 'ru') ?? [];
    const n = w.length;
    let holeA = 0, cur = 0, holeB = 0;
    const cov = new Array(n).fill(false);
    for (const p of parts) for (let i = p.start; i < p.end && i < n; i++) cov[i] = true;
    for (let i = 0; i < n; i++) { if (!cov[i]) { holeA++; cur++; if (cur > holeB) holeB = cur; } else cur = 0; }
    const posInfo = parts.length
      ? `词根落位=[${parts.map((p) => `${p.morpheme}@${p.start}`).join(', ')}]`
      : '（不可拆）';
    console.log(`   ${w.padEnd(18)} ${fmt(parts).padEnd(52)} 空洞A=${holeA} B=${holeB}  ${posInfo}`);
  }
}

// ---- ③ 现任词素库中会被 DP 用作「词中词根」的条目（潜在污染源） ----
console.log('\n【★ 词中词根落位普查】全库可拆词中，片段 start>0 且 kind=root 的出现次数（按词素降序，前 25）');
const midRoot = new Map();
for (const w of allRu) {
  const parts = breakdownWord(db, w, 'ru') ?? [];
  for (const p of parts) {
    if (p.kind === 'root' && p.start > 0) {
      const k = `${p.morpheme}@${p.start}`;
      midRoot.set(k, (midRoot.get(k) ?? 0) + 1);
    }
  }
}
[...midRoot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`   ${k.padEnd(16)} ${v} 词`));

// ---- ④ relatedByMorpheme 用户可见后果抽样 ----
console.log('\n【★ 用户可见词族规模（relatedByMorpheme）】');
for (const m of ['суч-', 'суд-', 'уч-', 'дн-', 'да-', 'стол-', 'каз-', 'дом-', 'боль-', 'термо-']) {
  try {
    const rel = relatedByMorpheme(db, m.replace(/-$/, ''), 'ru') ?? [];
    console.log(`   ${m.padEnd(10)} → ${rel.length} 词  ${rel.slice(0, 8).map((r) => r.word ?? r).join(' ')}`);
  } catch (e) {
    console.log(`   ${m.padEnd(10)} → 调用失败 ${e.message}`);
  }
}
