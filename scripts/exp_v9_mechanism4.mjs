/**
 * T19 主实验 §9：把「字母级 gap 判定」升级为「词素级」——**测试 agent 自己记录在案的方向**
 * （packages/core/test/ru_morph_defects.mjs:351-355）
 *
 *   修法方向：要求该单字符前缀**确实被 DP 匹配为片段**（parts[0].start === 0）。
 *   ⚠ 测试 agent 自己已注明：直接这么改会把这 75 词全部拒绝，
 *     因为它们卡在 index.ts:773-781「单字符前缀支撑规则」⇒ 必须先修支撑规则，两步缺一不可。
 *
 * 本脚本实测 4 种变体（不改任何产品代码，只在复刻引擎里开关）：
 *   V0     基线
 *   VH-a′  仅第 2 步：gap=1 要求词素级（首字符必须被某片段覆盖）⇒ 预期 75 词全废
 *   VH-a″  第 1+2 步：关闭单字符前缀支撑规则 + 词素级 ⇒ 预期 75 词「复活」但首片段变成 с-/в-/о-/у-
 *   VH-a   人工 2 条负向规则（对照，已实测 −12）
 *
 * 用法：node scripts/exp_v9_mechanism4.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const norm = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');

const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);
const CACHE = new Map();
function libRows(lang) { let r = CACHE.get(lang); if (!r) { r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?').all(lang); CACHE.set(lang, r); } return r; }
function buildMatchers(lang, extra = []) {
  const list = libRows(lang).map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind) })).concat(extra.map((e) => ({ morpheme: String(e.morpheme), kind: String(e.kind) })));
  list.sort((a, b) => { const k = (RANK[a.kind] ?? 3) - (RANK[b.kind] ?? 3); return k !== 0 ? k : String(b.morpheme).length - String(a.morpheme).length; });
  const isRu = lang === 'ru';
  const all = list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/\u0451/g, '\u0435') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[\u044c\u0439\u043e\u0430\u044f\u0435\u044b\u0438\u0443\u044e]$/.test(stem)) { const c = stem.slice(0, -1); if (c.length >= 3) patterns.push({ pat: c, core: true }); }
    return { m, stem, patterns };
  });
  return { all, isRu };
}
const MATCHERS = { ru: buildMatchers('ru') };
const MBUNDLES = new Map();
function matchersFor(extra) {
  if (!extra || !extra.length) return MATCHERS.ru;
  const key = extra.map((e) => e.morpheme + ':' + e.kind).join(',');
  let b = MBUNDLES.get(key);
  if (!b) { b = buildMatchers('ru', extra); MBUNDLES.set(key, b); }
  return b;
}

/**
 * gates:
 *   gapLevel: 'letter'（产品现状）| 'morpheme'（测试 agent 建议的升级）
 *   oneCharPre: true（产品现状）| false（关闭支撑规则 = 修法第 1 步）
 */
function breakdownEx(word, gates = {}, veto = null, bundle = MATCHERS.ru) {
  const g = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1, gapLevel: 'letter', ...gates };
  const { all, isRu } = bundle;
  const w = norm(word);
  if (w.length < 2) return { parts: [] };
  const mw = w;
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
      if (veto && veto(m.morpheme, m.kind, word, pos, stem)) continue;
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
    for (const c of cands(i)) { const cov = c.end - c.start + covered[c.end]; const pc = 1 + pieces[c.end]; if (cov > bc || (cov === bc && (pc < bp || (pc === bp && rankOf(c.m) < rankOf(bm))))) { bc = cov; bp = pc; bt = c.end; be = c.end; bm = c.m; } }
    covered[i] = bc; pieces[i] = bp; stepTo[i] = bt; stepEnd[i] = be; stepM[i] = bm;
  }
  const parts = []; let i = 0;
  while (i >= 0 && i < n && parts.length < 8) { const m = stepM[i]; if (m) { parts.push({ morpheme: m.morpheme, start: i, end: stepEnd[i] }); i = stepEnd[i]; } else i = stepTo[i]; }
  const cov = parts.reduce((s, p) => s + (p.end - p.start), 0) / n;
  if (g.threshold && cov < 0.55) return { parts: [] };
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return { parts: [] };
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 2)) {
    const gap = mw.slice(0, parts[0].start);
    const explained = all.some((x) => x.m.kind === 'prefix' && x.stem === gap);
    if (!explained) return { parts: [] };
    // ★ 词素级升级：单字符 gap 必须**确实被 DP 匹配为片段**（即位置 0 被覆盖）
    if (g.gapLevel === 'morpheme' && gap.length === 1 && parts[0].start !== 0) return { parts: [] };
  }
  return { parts: parts.sort((a, b) => a.start - b.start) };
}
const show = (p) => (p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join(' ')}` + '}' : '[]');

const VARIANTS_BASE = [
  ['V0 基线', {}],
  ['VH-a\u2032 词素级（仅第2步）', { gapLevel: 'morpheme' }],
  ['VH-a\u2033 支撑规则关闭+词素级（1+2步）', { gapLevel: 'morpheme', oneCharPre: false }],
];

/* ---- H-c：词源链 veto（对照，供归因表精确到「哪一条红」） ---- */
const stripStress2 = (s) => String(s).replace(/[\u0300-\u036f]/g, '');
const normPart2 = (s) => stripStress2(String(s)).toLowerCase().replace(/\([^)]*\)/g, '').replace(/-/g, '').replace(/\u0451/g, '\u0435').trim();
const etyStmt = db.prepare(`SELECT chain FROM word_etymology WHERE word = ? AND lang='ru' LIMIT 1`);
const ETY_CACHE = new Map();
function partsOfEtym(w) {
  if (ETY_CACHE.has(w)) return ETY_CACHE.get(w);
  const out = partsOfEtymRaw(w);
  ETY_CACHE.set(w, out);
  return out;
}
function partsOfEtymRaw(w) {
  const e = etyStmt.get(w); if (!e) return null;
  let ch = []; try { ch = JSON.parse(e.chain ?? '[]'); } catch { return null; }
  const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length >= 2);
  if (!steps.length) return null;
  const ps = steps.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), steps[0]).parts.map(normPart2).filter(Boolean);
  return ps.length >= 2 ? ps : null;
}
const lcp2 = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const vetoA = (morph, kind, w, pos, stem) => { const ps = partsOfEtym(w); return ps ? !ps.some((p) => p.startsWith(stem) || stem.startsWith(p)) : false; };
const vetoB = (morph, kind, w, pos, stem) => { const ps = partsOfEtym(w); return ps ? !(stem.length <= 2 || ps.some((p) => lcp2(p, stem) >= 3)) : false; };
const rulesHa = [{ morpheme: '\u0443\u0447-', after: '\u0441' }, { morpheme: '\u0434\u043d-', after: '\u043e' }];
const vetoHa = (morph, kind, w, pos) => pos === 1 && rulesHa.some((r) => r.morpheme === morph && r.after === String(w)[0]);

/* ★ 诚实替代路线：补词素（本迭代已排除，但作为 v0.9.0+ 建议必须量化） */
const EXTRA_SUCH = [{ morpheme: '\u0441\u0443\u0447-', kind: 'root' }];
const EXTRA_SUD = [{ morpheme: '\u0441\u0443\u0434-', kind: 'root' }, { morpheme: '-\u043d\u043e\u0439', kind: 'suffix' }];
const EXTRA_D2 = [{ morpheme: '\u043f\u0430\u0434-', kind: 'root' }, { morpheme: '\u0442\u0440\u044f\u0441-', kind: 'root' }];
const EXTRA_D4 = [{ morpheme: '\u0441\u0442\u043e\u043b\u043f-', kind: 'root' }, { morpheme: '\u0441\u0442\u0430\u0442-', kind: 'root' }];
const EXTRA_ALL = [].concat(EXTRA_SUCH, EXTRA_SUD, EXTRA_D2, EXTRA_D4);

const VARIANTS = [
  ...VARIANTS_BASE.map(([n, g]) => [n, g, null, null]),
  ['VH-a 人工负向规则(2条)', {}, vetoHa, null],
  ['VH-c veto HC-A(词源严格)', {}, vetoA, null],
  ['VH-c veto HC-B(词源宽松)', {}, vetoB, null],
  ['VH-e1 补 1 条词素 суч-', {}, null, EXTRA_SUCH],
  ['VH-e2 +суд-/-ной（D4b 2条）', {}, null, EXTRA_SUCH.concat(EXTRA_SUD)],
  ['VH-e3 +пад-/тряс-（D2 2条）', {}, null, EXTRA_SUCH.concat(EXTRA_SUD, EXTRA_D2)],
  ['VH-e4 +столп-/стат-（全 8 条）', {}, null, EXTRA_ALL],
];

/* §0 保真自检 */
{
  const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
  let bad = 0;
  for (const w of R) if (core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}`).join('|') !== breakdownEx(w).parts.map((p) => `${p.morpheme}@${p.start}`).join('|')) bad++;
  console.log(`§0 保真自检（尺子 R 791 词）：不一致 ${bad} 例 ${bad ? '✗ 中止' : '✔'}\n`);
  if (bad) { db.close(); process.exit(1); }
}

/* 33 条红断言（逐条复刻 ru_morph_defects.mjs） */
const NORM = (s) => String(s).replace(/\u0451/g, '\u0435');
function evaluator(bd) {
  const parts = (w) => bd(w);
  const holeLen = (w) => { const p = parts(w); const cov = p.reduce((s, x) => s + (x.end - x.start), 0); return NORM(w).length - cov; };
  const headM = (w) => parts(w)[0]?.morpheme ?? null;
  const coveredAt0 = (w) => parts(w).some((p) => p.start === 0 && p.end > 0);
  const atStart = (w, m) => parts(w).some((p) => p.start === 0 && p.morpheme === m);
  const A = [];
  A.push(['D2.1 землетрясение 不含 лет-', () => !parts('землетрясение').some((m) => m.morpheme.includes('лет-'))]);
  A.push(['D2.2 землетрясение 空洞<3', () => holeLen('землетрясение') < 3]);
  A.push(['D2.3 водопад 空洞<3', () => holeLen('водопад') < 3]);
  A.push(['D4.1 столп 不含 стол-', () => !parts('столп').some((m) => m.morpheme.includes('стол-'))]);
  A.push(['D4.2 казус 不含 каз-', () => !parts('казус').some((m) => m.morpheme.includes('каз-'))]);
  A.push(['D4.3 доминировать 不含 дом-', () => !parts('доминировать').some((m) => m.morpheme.includes('дом-'))]);
  A.push(['D4.4 больной 含 -ной', () => parts('больной').some((m) => m.morpheme.includes('ной'))]);
  A.push(['D4.5 самосуд 含 суд', () => parts('самосуд').some((m) => m.morpheme.includes('суд'))]);
  A.push(['D4.6 термостат 不得仅剥 термо-', () => !(parts('термостат').length === 1 && parts('термостат')[0].morpheme === 'термо-')]);
  const FA = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный'];
  for (const w of FA) { A.push([`V92.${w}.i 首片段≠уч-`, () => headM(w) !== 'уч-']); A.push([`V92.${w}.ii 词首被覆盖`, () => coveredAt0(w)]); }
  A.push(['V92.однако.i 首片段≠дн-', () => headM('однако') !== 'дн-']);
  A.push(['V92.однако.ii 词首被覆盖', () => coveredAt0('однако')]);
  return { A, parts, holeLen, coveredAt0, atStart, headM };
}

/* 全库 / R / 空洞 端到端 */
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
const holeTotals = (w, p) => { const n = NORM(w).length; const cov = p.reduce((s, x) => s + (x.end - x.start), 0); return { total: n - cov, maxSeg: (() => { let mx = 0, cur = 0; const cv = new Array(n).fill(false); for (const q of p) for (let i = q.start; i < q.end; i++) cv[i] = true; for (let i = 0; i < n; i++) { if (!cv[i]) { cur++; mx = Math.max(mx, cur); } else cur = 0; } return mx; })() }; };

console.log('='.repeat(100));
console.log('§9 全库端到端（101,512 词，非抽样）+ 33 条红断言逐条判定');
console.log('='.repeat(100));
console.log(`  ${'变体'.padEnd(34)}${'可拆'.padEnd(9)}${'口径A'.padEnd(9)}${'口径B'.padEnd(9)}${'尺子R'.padEnd(14)}${'gap=1残余'.padEnd(11)}33红`);
const rows = [];
for (const [name, gates, veto, extra] of VARIANTS) {
  const bundle = matchersFor(extra);
  let hit = 0, ca = 0, cb = 0;
  for (const w of ALL) { const p = breakdownEx(w, gates, veto, bundle).parts; if (!p.length) continue; hit++; const h = holeTotals(w, p); if (h.total >= 3) ca++; if (h.maxSeg >= 3) cb++; }
  let rh = 0; for (const w of R) if (breakdownEx(w, gates, veto, bundle).parts.length) rh++;
  let g1 = 0;
  for (const w of ALL) { const p = breakdownEx(w, gates, veto, bundle).parts; if (p.length >= 2 && p[0].start === 1) g1++; }
  const ev = evaluator((w) => breakdownEx(w, gates, veto, bundle).parts);
  const reds = ev.A.filter(([, f]) => !f()).length;
  rows.push({ name, hit, ca, cb, rh, g1, reds });
  console.log(`  ${name.padEnd(34)}${String(hit).padEnd(9)}${String(ca).padEnd(9)}${String(cb).padEnd(9)}${`${rh}/791=${(rh / 791 * 100).toFixed(2)}%`.padEnd(14)}${String(g1).padEnd(11)}${reds}/33`);
}

/* 逐条红 × 变体 归因表 */
console.log('\n' + '='.repeat(100));
console.log('§9.1 33 条红 × 变体 归因表（✔=消除 / ✗=仍红）');
console.log('='.repeat(100));
const evs = VARIANTS.map(([n, g, v, x]) => [n, evaluator((w) => breakdownEx(w, g, v, matchersFor(x)).parts)]);
const base = evs[0][1].A;
console.log(`  ${'断言 id'.padEnd(34)}${evs.map(([n]) => n.slice(0, 6).padEnd(9)).join('')}`);
for (let i = 0; i < base.length; i++) {
  const [id, f] = base[i];
  if (f()) continue; // 只看 33 红
  const cells = evs.map(([, e]) => (e.A[i][1]() ? '✔' : '✗'));
  console.log(`  ${id.padEnd(34)}${cells.map((c) => c.padEnd(9)).join('')}`);
}

/* 12 个靶词在新变体下的实际输出 */
console.log('\n' + '='.repeat(100));
console.log('§9.2 12 个 V9-2 靶词在新变体下的**实际拆解**（关键：变体是否只是「把断言骗绿」）');
console.log('='.repeat(100));
const T12 = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный', 'однако'];
console.log(`  ${'词'.padEnd(16)}${'V0'.padEnd(26)}${'VH-a\u2032'.padEnd(14)}VH-a\u2033`);
for (const w of T12) {
  const a = show(breakdownEx(w, {}).parts), b = show(breakdownEx(w, { gapLevel: 'morpheme' }).parts), c = show(breakdownEx(w, { gapLevel: 'morpheme', oneCharPre: false }).parts);
  console.log(`  ${w.padEnd(16)}${a.padEnd(26)}${b.padEnd(14)}${c}`);
}

/* 63 个 да- 词在 VH-a′ 下的命运 */
console.log('\n' + '='.repeat(100));
console.log('§9.3 「75 词真前缀组」在 VH-a′ / VH-a\u2033 下的**生存率**（误杀面）');
console.log('='.repeat(100));
const RU1 = new Set(['\u0432', '\u043e', '\u0441', '\u0443']);
const g75 = ALL.filter((w) => { const p = breakdownEx(w).parts; return p.length >= 2 && p[0].start === 1 && RU1.has(NORM(w)[0]); });
const surv = (gates) => g75.filter((w) => breakdownEx(w, gates).parts.length).length;
console.log(`  75 词真前缀组（да-×63 / уч-×11 / дн-×1）：`);
console.log(`    V0 基线            : ${surv({})}/75 存活`);
console.log(`    VH-a\u2032 词素级（第2步） : ${surv({ gapLevel: 'morpheme' })}/75 存活  ⇒ 误杀 ${75 - surv({ gapLevel: 'morpheme' })} 词`);
console.log(`    VH-a\u2033 1+2步全上      : ${surv({ gapLevel: 'morpheme', oneCharPre: false })}/75 存活`);
const da = g75.filter((w) => breakdownEx(w).parts[0].morpheme.startsWith('\u0434'));
console.log(`    да- 族（${da.length} 词）在 VH-a\u2033 下的首片段：${[...new Set(da.map((w) => breakdownEx(w, { gapLevel: 'morpheme', oneCharPre: false }).parts[0]?.morpheme ?? '[]'))].join(' / ')}`);
console.log(`    受保护词 удачный：V0 ${show(breakdownEx('удачный').parts)} | VH-a\u2032 ${show(breakdownEx('удачный', { gapLevel: 'morpheme' }).parts)} | VH-a\u2033 ${show(breakdownEx('удачный', { gapLevel: 'morpheme', oneCharPre: false }).parts)}`);
console.log(`    受保护词 смекать：V0 ${show(breakdownEx('смекать').parts)} | VH-a\u2032 ${show(breakdownEx('смекать', { gapLevel: 'morpheme' }).parts)} | VH-a\u2033 ${show(breakdownEx('смекать', { gapLevel: 'morpheme', oneCharPre: false }).parts)}`);
/* §9.5 冻结护栏口径的「真前缀组」逐变体实测（严格复刻 ru_morph_d1guard.mjs:176-199 的判定） */
console.log('\n' + '='.repeat(100));
console.log('§9.5 ★ 更正后验收口径：真前缀组 / да- 子集（严格复刻 d1guard.mjs:176-199）');
console.log('='.repeat(100));
const PSTEMS = new Set(libRows('ru').filter((r) => String(r.kind) === 'prefix').map((r) => String(r.morpheme).replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')));
console.log(`  前缀 stem 集规模 = ${PSTEMS.size}；单字符前缀 = ${[...PSTEMS].filter((s) => s.length === 1).join(' ')}`);
console.log(`  ${'变体'.padEnd(34)}${'真前缀组'.padEnd(11)}${'да- 子集'.padEnd(11)}其余首片段分布`);
for (const [name, gates, veto, extra] of VARIANTS) {
  const bundle = matchersFor(extra);
  let tp = 0, da = 0; const dist = new Map();
  for (const w of ALL) {
    const p = breakdownEx(w, gates, veto, bundle).parts;
    if (!p.length) continue;
    const start = p[0].start;
    if (start < 1) continue;
    const gap = NORM(w).slice(0, start);
    if (gap.length === 1 && PSTEMS.has(gap)) { tp++; if (p[0].morpheme === '\u0434\u0430-') da++; dist.set(p[0].morpheme, (dist.get(p[0].morpheme) ?? 0) + 1); }
  }
  console.log(`  ${name.padEnd(34)}${String(tp).padEnd(11)}${String(da).padEnd(11)}${[...dist.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`);
}
console.log('  （冻结护栏：真前缀组 ≥63；да- 子集 = 63 零容差；基线实测 75 / 63）');

/* §9.4 尺子 R 上的 L1/L4 质量指标（冻结值：L1 ≥25%、L4 空洞≥3 = 134 词） */
console.log('\n' + '='.repeat(100));
console.log('§9.4 尺子 R 上的 L1 / L4 质量指标（L4 冻结值 = 134 词，定义：未覆盖字符【总数】≥3）');
console.log('='.repeat(100));
console.log(`  ${'变体'.padEnd(34)}${'R命中'.padEnd(16)}${'空洞≥3(L4)'.padEnd(14)}${'空洞≥2'.padEnd(9)}${'零空洞'.padEnd(9)}空洞≤1`);
for (const [name, gates, veto, extra] of VARIANTS) {
  const bundle = matchersFor(extra);
  let hit = 0, deep = 0, s2 = 0, zero = 0, le1 = 0;
  for (const w of R) { const p = breakdownEx(w, gates, veto, bundle).parts; if (!p.length) continue; hit++; const tot = holeTotals(w, p).total; if (tot >= 3) deep++; if (tot >= 2) s2++; if (tot === 0) zero++; if (tot <= 1) le1++; }
  const tag = deep > 134 ? ' ❌劣化' : deep === 134 ? ' ✅持平' : ' ✅改善';
  console.log(`  ${name.padEnd(34)}${`${hit}/791`.padEnd(16)}${`${deep}${tag}`.padEnd(14)}${String(s2).padEnd(9)}${String(zero).padEnd(9)}${le1}`);
}
console.log('  （基线口径核对：R 命中 238 / 空洞≥3 = 134 ✅ / 空洞≥2 = 171 / 零空洞 37 / 空洞≤1 67）');

db.close();
