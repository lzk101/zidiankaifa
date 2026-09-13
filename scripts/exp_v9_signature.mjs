/**
 * T22 §1：gap=1 词族的**空洞结构**全量勘察（判别分类器实验第一步）
 * 目的：把 T20 的「真词根末辅音被截」口头签名，形式化为**可计算量**，并逐词列出。
 *
 * 用法：node scripts/exp_v9_signature.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const NORM = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');
const VOWELS = new Set('аеёиоуыэюя'.split(''));
const SIGNS = new Set(['ь', 'й']);
const isCons = (c) => !VOWELS.has(c) && !SIGNS.has(c);

/* §0 中止式保真自检（本脚本直接用官方引擎取 parts，另做一致性核对） */
const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
{
  let bad = 0;
  for (const w of R) { const p = breakdownWord(db, w, 'ru'); if (!Array.isArray(p)) bad++; }
  console.log(`§0 官方引擎可用性自检：尺子 R ${R.length} 词，异常 ${bad} 例 ${bad ? '✗ 中止' : '✔'}`);
  if (bad) process.exit(1);
}

const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const PSTEMS = new Set(db.prepare(`SELECT morpheme FROM morphemes WHERE lang='ru' AND kind='prefix'`).all()
  .map((r) => String(r.morpheme).replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')));

/** 空洞结构：未被任何片段覆盖的连续字符段 */
function holes(w, parts) {
  const n = NORM(w).length;
  const cov = new Array(n).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < n; i++) cov[i] = true;
  const runs = [];
  for (let i = 0; i < n; i++) {
    if (cov[i]) continue;
    let j = i; while (j < n && !cov[j]) j++;
    runs.push({ start: i, end: j, text: NORM(w).slice(i, j), len: j - i });
    i = j - 1;
  }
  const covered = parts.reduce((s, p) => s + (p.end - p.start), 0);
  return { runs, coverage: covered / n, totalHole: n - covered };
}
const show = (p) => (p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join(' ')}` + '}' : '[]');

/** gap=1 词族（严格复刻 d1guard 口径） */
const GAP1 = [];
for (const w of ALL) {
  const p = breakdownWord(db, w, 'ru');
  if (!p.length) continue;
  const s = p[0].start;
  if (s !== 1) continue;
  const gap = NORM(w).slice(0, s);
  if (gap.length === 1 && PSTEMS.has(gap)) GAP1.push({ w, p, gap, h: holes(w, p) });
}
console.log(`\ngap=1 且 gap ∈ 前缀集 的词 = ${GAP1.length} 个`);
const headDist = new Map();
for (const g of GAP1) headDist.set(g.p[0].morpheme, (headDist.get(g.p[0].morpheme) ?? 0) + 1);
console.log(`首片段分布：${[...headDist.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`);

console.log('\n' + '='.repeat(118));
console.log('§1.1 全部 gap=1 词的「空洞结构」（按首片段分组；H=内部空洞 H1=首片段后第一段空洞）');
console.log('='.repeat(118));
for (const [m, cnt] of [...headDist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`\n  ── 首片段 ${m}（${cnt} 词）`);
  console.log(`  ${'词'.padEnd(24)}${'拆解'.padEnd(34)}${'空洞段（位置:文本）'.padEnd(30)}首内洞 H1     H1类`);
  for (const g of GAP1.filter((x) => x.p[0].morpheme === m).sort((a, b) => a.w.localeCompare(b.w))) {
    const all = g.h.runs.map((r) => `${r.start}:${r.text}`).join(' ');
    const internal = g.h.runs.filter((r) => r.start >= 1);
    const h1 = internal[0];
    const cls = !h1 ? '（无内部空洞）' : `${h1.text}(${h1.len}${h1.text.split('').every(isCons) ? '纯辅音' : h1.text.split('').some((c) => SIGNS.has(c)) ? '含ь/й' : '含元音'})`;
    console.log(`  ${g.w.padEnd(24)}${show(g.p).padEnd(34)}${all.padEnd(30)}${String(internal.length).padEnd(8)}${(h1 ? h1.text : '-').padEnd(8)}${cls}`);
  }
}

/* T20 的标签（主管转述） */
const TRUE10 = ['вдаваться', 'вдаться', 'сдавать', 'сдаваться', 'сдаточный', 'сдаться', 'удаваться', 'удаться', 'удачливый', 'удачный'];
const FALSE26 = ['вдавить', 'вдавливать', 'одалживать', 'одаривать', 'одарить', 'одарять', 'сдавить', 'сдавливать', 'удавить', 'удавиться', 'удавка', 'удавливать', 'удавливаться', 'удаление', 'удалить', 'удалить', 'удалиться', 'удалять', 'удаляться', 'ударить', 'ударник', 'ударный', 'ударять', 'ударяться', 'удалец', 'удалить'];
const UC11 = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный'];
const DN1 = ['однако'];

console.log('\n' + '='.repeat(118));
console.log('§1.2 T20 标注的「真族 10 / 假族 26」逐词空洞结构对照（★ 关键判别对）');
console.log('='.repeat(118));
const dump = (w) => {
  const p = breakdownWord(db, w, 'ru');
  if (!p.length) return null;
  const h = holes(w, p);
  const internal = h.runs.filter((r) => r.start >= 1);
  return { p, h, h1: internal[0] ?? null, nInternal: internal.length };
};
console.log(`  ${'标注'.padEnd(7)}${'词'.padEnd(22)}${'拆解'.padEnd(32)}${'全部空洞'.padEnd(22)}H1   H1长度 H1纯辅音`);
for (const [label, list] of [['真族', TRUE10], ['假族', FALSE26], ['уч-', UC11], ['дн-', DN1]]) {
  for (const w of [...new Set(list)]) {
    const d = dump(w);
    if (!d) { console.log(`  ${label.padEnd(7)}${w.padEnd(22)}[]（不可拆）`); continue; }
    const h1 = d.h1;
    const pureC = h1 ? h1.text.split('').every(isCons) : null;
    console.log(`  ${label.padEnd(7)}${w.padEnd(22)}${show(d.p).padEnd(32)}${d.h.runs.map((r) => `${r.start}:${r.text}`).join(' ').padEnd(22)}${(h1 ? h1.text : '-').padEnd(5)}${String(h1 ? h1.len : '-').padEnd(7)}${h1 ? (pureC ? '是' : '否') : '-'}`);
  }
}

/* 逐词特征表（供后续判别） */
console.log('\n' + '='.repeat(118));
console.log('§1.3 ★ 签名可计算性：把「真词根末辅音被截」形式化为 4 个可计算量');
console.log('='.repeat(118));
console.log('  D1 = 首片段是否从位置 1 开始（gap=1）                     —— 本组恒真');
console.log('  D2 = 内部空洞段数 nInternal（首片段之后未被覆盖的连续段数）');
console.log('  D3 = H1 = 首片段之后第一段内部空洞；D3.len、D3.text');
console.log('  D4 = 复根候选 = w[1:parts[0].end] + H1.text（若 D2≥1），即「首片段 ∪ H1」');
console.log('  ★ 题面签名 = 「D4 以辅音结尾且 |D4| ≥ 2」（= 真词根被截去末辅音）');
const feat = (w) => {
  const d = dump(w);
  if (!d) return null;
  const seg = NORM(w).slice(1, d.p[0].end);
  const cand = d.h1 ? seg + d.h1.text : null;
  return {
    w, nInternal: d.nInternal, h1: d.h1?.text ?? null, h1len: d.h1?.len ?? 0,
    seg, cand, candEndsCons: cand ? isCons(cand[cand.length - 1]) : null,
    sig: cand ? (cand.length >= 2 && isCons(cand[cand.length - 1])) : false,
    coverage: d.h.coverage, nParts: d.p.length, totalHole: d.h.totalHole,
  };
};
const rows = [];
for (const w of [...new Set([...TRUE10, ...FALSE26, ...UC11, ...DN1])]) {
  const f = feat(w);
  const label = TRUE10.includes(w) ? '真' : '假';
  if (!f) { rows.push({ w, label, dead: true }); continue; }
  rows.push({ ...f, label });
}
console.log(`\n  ${'标注'.padEnd(5)}${'词'.padEnd(22)}${'nInternal'.padEnd(10)}${'H1'.padEnd(7)}${'复根候选D4'.padEnd(14)}${'D4末辅音'.padEnd(11)}${'签名D4'.padEnd(8)}覆盖率    段数`);
for (const r of rows.sort((a, b) => (a.label === b.label ? a.w.localeCompare(b.w) : a.label === '真' ? -1 : 1))) {
  if (r.dead) { console.log(`  ${r.label.padEnd(5)}${r.w.padEnd(22)}（不可拆）`); continue; }
  console.log(`  ${r.label.padEnd(5)}${r.w.padEnd(22)}${String(r.nInternal).padEnd(10)}${String(r.h1 ?? '-').padEnd(7)}${String(r.cand ?? '-').padEnd(14)}${(r.candEndsCons === null ? '-' : r.candEndsCons ? '是' : '否').padEnd(11)}${(r.sig ? '✔' : '✘').padEnd(8)}${r.coverage.toFixed(3).padEnd(10)}${r.nParts}`);
}
db.close();
