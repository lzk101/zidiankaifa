/**
 * T19 主实验 §6–§7：H-c（词源链交叉核证）+ 全库端到端实测（只读）
 *
 * §6 H-c：word_etymology.chain.parts 是否可用作「真值约束」
 *    6.1 33 红中哪些词有 parts 信号
 *    6.2 两种 veto 变体（HC-A 严格 / HC-B 宽松）能消除几条红
 *    6.3 ★ 误杀度量：对**当前可拆**的尺子 R 词，veto 会否决多少（假阳性代价）
 *    6.4 H-c 作为「覆盖器」（直接用 parts 当拆解）的可行性
 * §7 全库端到端（101,512 词，非抽样）：基线 / H-a / H-c veto
 *    指标口径：可拆数 · 空洞≥3 口径A(未覆盖字符总数) · 口径B(最大单段) · 尺子 R · gapMin=2 D1 形态数
 *
 * 用法：node scripts/exp_v9_mechanism2.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const E = '\u0451';
const norm = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');

/* ---------- 复刻引擎（同 exp_v9_mechanism.mjs，§0 自检保证保真） ---------- */
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);
const CACHE = new Map();
function libRows(lang) {
  let r = CACHE.get(lang);
  if (!r) { r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?').all(lang); CACHE.set(lang, r); }
  return r;
}
function buildMatchers(lang) {
  const list = libRows(lang).map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind), meaningZh: r.meaning_zh ?? '', origin: r.origin ?? null }));
  list.sort((a, b) => { const k = (RANK[a.kind] ?? 3) - (RANK[b.kind] ?? 3); return k !== 0 ? k : String(b.morpheme).length - String(a.morpheme).length; });
  const isRu = lang === 'ru';
  const all = list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/\u0451/g, '\u0435') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[\u044c\u0439\u043e\u0430\u044f\u0435\u044b\u0438\u0443\u044e]$/.test(stem)) {
      const c = stem.slice(0, -1); if (c.length >= 3) patterns.push({ pat: c, core: true });
    }
    return { m, stem, patterns };
  });
  return { all, isRu };
}
const MATCHERS = { ru: buildMatchers('ru') };
const G = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1 };
function breakdownEx(word, gates, veto = null) {
  const g = { ...G, ...gates };
  const { all, isRu } = MATCHERS.ru;
  const w = norm(word);
  if (w.length < 2) return { parts: [], coverage: 0 };
  const mw = isRu ? w.replace(/\u0451/g, '\u0435') : w;
  const byFirst = new Map();
  for (const e of all) for (const { pat } of e.patterns) { const c = pat[0]; let a = byFirst.get(c); if (!a) { a = []; byFirst.set(c, a); } a.push(e); }
  const cands = (pos) => {
    const out = []; const entries = byFirst.get(mw[pos]); if (!entries) return out;
    for (const { m, stem, patterns } of entries) for (const { pat, core } of patterns) {
      const minLen = isRu && m.kind === 'prefix' ? 1 : 2;
      if (pat.length < minLen || !mw.startsWith(pat, pos)) continue;
      if (g.prefixPos && m.kind === 'prefix' && pos !== 0 && !core) continue;
      let end = pos + (core ? w.length - pos : pat.length);
      if (core) { if (w.length - (pos + pat.length) > 3) continue; end = w.length; }
      else if (g.oneCharPre && isRu && m.kind === 'prefix' && pat.length === 1) {
        const rest = mw.slice(pos + 1);
        if (!all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem))) continue;
      }
      if (g.suffixPos && m.kind === 'suffix' && pos < 3) continue;
      if (veto && veto(m.morpheme, m.kind, w, pos, stem)) continue;
      out.push({ m, start: pos, end });
    }
    return out;
  };
  const n = w.length;
  const covered = new Int32Array(n + 1), pieces = new Int32Array(n + 1);
  const stepTo = new Int32Array(n + 1), stepEnd = new Int32Array(n + 1), stepM = new Array(n + 1).fill(null);
  stepTo[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    let bc = covered[i + 1], bp = pieces[i + 1], bt = i + 1, be = i + 1, bm = null;
    for (const c of cands(i)) {
      const cov = c.end - c.start + covered[c.end]; const pc = 1 + pieces[c.end];
      if (cov > bc || (cov === bc && (pc < bp || (pc === bp && rankOf(c.m) < rankOf(bm))))) { bc = cov; bp = pc; bt = c.end; be = c.end; bm = c.m; }
    }
    covered[i] = bc; pieces[i] = bp; stepTo[i] = bt; stepEnd[i] = be; stepM[i] = bm;
  }
  const parts = []; let i = 0;
  while (i >= 0 && i < n && parts.length < 8) { const m = stepM[i]; if (m) { parts.push({ morpheme: m.morpheme, kind: m.kind, start: i, end: stepEnd[i] }); i = stepEnd[i]; } else i = stepTo[i]; }
  const coverage = parts.reduce((s, p) => s + (p.end - p.start), 0) / n;
  if (g.threshold && coverage < 0.55) return { parts: [], coverage };
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return { parts: [], coverage };
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 2)) {
    const gap = mw.slice(0, parts[0].start);
    if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return { parts: [], coverage };
  }
  return { parts: parts.sort((a, b) => a.start - b.start), coverage };
}

/* ---------- §0 保真自检（中止式） ---------- */
const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
{
  let bad = 0;
  for (const w of R) {
    const a = core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
    const b = breakdownEx(w, {}).parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
    if (a !== b) bad++;
  }
  console.log(`§0 复刻保真自检（尺子 R ${R.length} 词）：不一致 ${bad} 例 ${bad ? '✗' : '✔'}`);
  if (bad) { console.log('⇒ 中止。'); db.close(); process.exit(1); }
}

/* ---------- 词源 parts 工具 ---------- */
const stripStress = (s) => String(s).replace(/[\u0300-\u036f]/g, '');
const normPart = (s) => stripStress(String(s)).toLowerCase().replace(/\([^)]*\)/g, '').replace(/-/g, '').replace(/\u0451/g, '\u0435').trim();
const etyStmt = db.prepare(`SELECT chain FROM word_etymology WHERE word = ? AND lang='ru' LIMIT 1`);
function partsOfEtym(w) {
  const e = etyStmt.get(w);
  if (!e) return null;
  let ch = [];
  try { ch = JSON.parse(e.chain ?? '[]'); } catch { return null; }
  const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length >= 2);
  if (!steps.length) return null;
  const longest = steps.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), steps[0]);
  const ps = longest.parts.map(normPart).filter(Boolean);
  return ps.length >= 2 ? ps : null;
}
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
/** HC-A 严格：片段 stem 必须是某 part 的前缀 */
const hcA = (ps, stem) => ps.some((p) => p.startsWith(stem) || stem.startsWith(p));
/** HC-B 宽松：片段 stem 与某 part 的最长公共前缀 ≥3，或 stem ≤2 字符 */
const hcB = (ps, stem) => stem.length <= 2 || ps.some((p) => lcp(p, stem) >= 3);

/* ===================== §6.1 ===================== */
const FAMILY_A = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', `суч${E}ный`];
const REDS = [...FAMILY_A, 'однако', 'столп', 'казус', 'доминировать', 'больной', 'самосуд', 'термостат', 'землетрясение', 'водопад'];
console.log('\n' + '='.repeat(84));
console.log('§6.1 20 个红灯词的词源 parts 信号（H-c 的作用域）');
console.log('='.repeat(84));
let withSignal = 0;
for (const w of REDS) {
  const ps = partsOfEtym(w);
  if (ps) withSignal++;
  console.log(`  ${ps ? '✔' : '✗'} ${w.padEnd(18)} ${ps ? JSON.stringify(ps) : '—— **无 parts 信号**'}`);
}
console.log(`\n  ⇒ 20 词中有 parts 信号 ${withSignal}/20`);
console.log(`  ★ 关键：12 个 V9-2 词（суч-族 11 + однако）中有信号的 = ${FAMILY_A.concat(['однако']).filter((w) => partsOfEtym(w)).length}/12`);

/* ===================== §6.2 / §6.3 ===================== */
console.log('\n' + '='.repeat(84));
console.log('§6.2/6.3 H-c veto 变体：能消除几条红 vs 误杀多少当前可拆词');
console.log('='.repeat(84));
const makeVeto = (mode) => (morph, kind, w, pos, stem) => {
  const ps = partsOfEtym(w);
  if (!ps) return false;               // 无信号 ⇒ 不干预
  const ok = mode === 'A' ? hcA(ps, stem) : hcB(ps, stem);
  return !ok;
};
/* 断言集（与 exp_v9_mechanism.mjs 同源，仅取 33 红的判据） */
const holeTot = (w, p) => { const cov = new Array(w.length).fill(false); for (const q of p) for (let i = q.start; i < q.end && i < w.length; i++) cov[i] = true; return cov.filter((x) => !x).length; };
const V = [];
V.push({ id: 'D2.1', w: 'землетрясение', pred: (p) => !p.map((x) => x.morpheme).includes('лет-') });
V.push({ id: 'D2.2', w: 'землетрясение', pred: (p) => holeTot('землетрясение', p) < 3 });
V.push({ id: 'D2.3', w: 'водопад', pred: (p) => holeTot('водопад', p) < 3 });
V.push({ id: 'D4.1', w: 'столп', pred: (p) => !p.map((x) => x.morpheme).includes('стол-') });
V.push({ id: 'D4.2', w: 'казус', pred: (p) => !p.map((x) => x.morpheme).includes('каз-') });
V.push({ id: 'D4.3', w: 'доминировать', pred: (p) => !p.map((x) => x.morpheme).includes('дом-') });
V.push({ id: 'D4.4', w: 'больной', pred: (p) => p.map((x) => x.morpheme).some((m) => m.includes('ной')) });
V.push({ id: 'D4.5', w: 'самосуд', pred: (p) => p.map((x) => x.morpheme).some((m) => m.includes('суд')) });
V.push({ id: 'D4.6', w: 'термостат', pred: (p) => !(p.length === 1 && p[0].morpheme === 'термо-') });
for (const w of FAMILY_A) {
  V.push({ id: `${w}.i`, w, pred: (p) => (p[0]?.morpheme ?? null) !== 'уч-' });
  V.push({ id: `${w}.ii`, w, pred: (p) => p.some((x) => x.start === 0 && x.end > 0) });
}
V.push({ id: 'однако.i', w: 'однако', pred: (p) => (p[0]?.morpheme ?? null) !== 'дн-' });
V.push({ id: 'однако.ii', w: 'однако', pred: (p) => p.some((x) => x.start === 0 && x.end > 0) });
console.log(`  断言集规模：${V.length}（应 = 33）${V.length === 33 ? '✔' : '⚠'}`);

/* 基线：确认 33 全红 */
let baseRed = 0;
for (const a of V) if (!a.pred(breakdownEx(a.w, {}).parts)) baseRed++;
console.log(`  基线红数：${baseRed}/33 ${baseRed === 33 ? '✔' : '⚠'}`);

for (const mode of ['A', 'B']) {
  const v = makeVeto(mode);
  let fixed = 0;
  for (const a of V) if (a.pred(breakdownEx(a.w, {}, v).parts)) fixed++;
  // 误杀：对 R 中当前可拆的词，veto 后变不可拆的数量
  let killed = 0; const killedS = [];
  for (const w of R) {
    const before = breakdownEx(w, {}).parts;
    if (!before.length) continue;
    const after = breakdownEx(w, {}, v).parts;
    if (!after.length) { killed++; if (killedS.length < 8) killedS.push(`${w}(${before.map((x) => x.morpheme).join('+')})`); }
  }
  console.log(`\n  ── HC-${mode}（${mode === 'A' ? '片段 stem 须与某 part 互为前缀' : 'LCP≥3 或 stem≤2 字符'}）`);
  console.log(`     消除红：${fixed}/33`);
  console.log(`     ★ 误杀当前可拆的尺子 R 词：${killed} 词  样例: ${killedS.join(' ')}`);
}

/* ===================== §7 全库端到端 ===================== */
console.log('\n' + '='.repeat(84));
console.log('§7 全库端到端（101,512 词，非抽样）');
console.log('='.repeat(84));
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const RU1 = new Set(['\u0432', '\u043e', '\u0441', '\u0443']);
const rulesHa = [{ morpheme: 'уч-', after: '\u0441' }, { morpheme: 'дн-', after: '\u043e' }];
const vetoHa = (morph, kind, w, pos) => pos === 1 && rulesHa.some((r) => r.morpheme === morph && r.after === w[0]);

function scan(label, veto) {
  let hit = 0, hA = 0, hB = 0, gap1 = 0, rHit = 0, d1old = 0;
  const rSet = new Set(R);
  for (const w of ALL) {
    const p = breakdownEx(w, {}, veto).parts;
    if (p.length) {
      hit++;
      if (rSet.has(w)) rHit++;
      const cov = new Array(w.length).fill(false);
      for (const q of p) for (let i = q.start; i < q.end && i < w.length; i++) cov[i] = true;
      let tot = 0, run = 0, mx = 0;
      for (let i = 0; i < w.length; i++) { if (!cov[i]) { tot++; run++; if (run > mx) mx = run; } else run = 0; }
      if (tot >= 3) hA++;
      if (mx >= 3) hB++;
      if (p.length >= 2 && p[0].start === 1) gap1++;
    }
  }
  // gapMin=2 ⇒ D1 形态（修复前口径）
  for (const w of ALL) { const p = breakdownEx(w, { gapMin: 2 }).parts; if (p.length >= 2 && p[0].start === 1) d1old++; }
  console.log(`\n  ── ${label}`);
  console.log(`     全库可拆              : ${hit.toLocaleString()}`);
  console.log(`     空洞≥3 口径A(总数)    : ${hA.toLocaleString()}`);
  console.log(`     空洞≥3 口径B(单段)    : ${hB.toLocaleString()}`);
  console.log(`     尺子 R                : ${rHit}/${R.length} = ${((rHit / R.length) * 100).toFixed(2)}%`);
  console.log(`     gapMin=2 D1 形态数    : ${d1old}`);
  console.log(`     gap=1 且片段≥2（字母级残余）: ${gap1}`);
  return { hit, hA, hB, rHit, gap1, d1old };
}
const b = scan('基线（现状 / D1 修法已生效）', null);
const ha = scan('H-a 生效（2 条词素级负向规则：уч- 不在 с 后 @1、дн- 不在 о 后 @1）', vetoHa);
const hcBv = makeVeto('B');
const hcb = scan('H-c veto 生效（HC-B 宽松变体）', hcBv);
const hcAv = makeVeto('A');
const hca = scan('H-c veto 生效（HC-A 严格变体）', hcAv);

console.log('\n' + '='.repeat(84));
console.log('§7 汇总（全部为全库口径，vs 主管给的基线）');
console.log('='.repeat(84));
const fmt = (x) => String(x).padStart(8);
console.log(`  ${'机制'.padEnd(30)}${fmt('可拆')}${fmt('口径A')}${fmt('口径B')}${fmt('R命中')}${fmt('D1形态')}${fmt('gap1残')}`);
for (const [n, s] of [['基线（主管给值）', { hit: 33174, hA: 20214, hB: 18762, rHit: 238, d1old: 267 }], ['基线（本次实测）', b], ['H-a', ha], ['H-c veto HC-B', hcb], ['H-c veto HC-A', hca]]) {
  console.log(`  ${n.padEnd(30)}${fmt(s.hit)}${fmt(s.hA)}${fmt(s.hB)}${fmt(s.rHit)}${fmt(s.d1old)}${fmt(s.gap1 ?? '-')}`);
}
db.close();
