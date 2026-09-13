/**
 * T19 主实验 §8：机制生效后「75 词真前缀组」与受保护真词的**逐词命运**
 * （只读；对应主管产出要求 ③「误杀清单（最重要）」）
 *
 * 对比 4 种状态：
 *   现状 / H-a（2 条负向规则）/ H-c-veto HC-A（严格）/ H-c-veto HC-B（宽松）
 *
 * 用法：node scripts/exp_v9_mechanism3.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const E = '\u0451';
const norm = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');

const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);
const CACHE = new Map();
function libRows(lang) { let r = CACHE.get(lang); if (!r) { r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?').all(lang); CACHE.set(lang, r); } return r; }
function buildMatchers(lang) {
  const list = libRows(lang).map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind) }));
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
function breakdownEx(word, gates = {}, veto = null) {
  const g = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1, ...gates };
  const { all, isRu } = MATCHERS.ru;
  const w = norm(word);
  if (w.length < 2) return { parts: [] };
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
    for (const c of cands(i)) { const cov = c.end - c.start + covered[c.end]; const pc = 1 + pieces[c.end]; if (cov > bc || (cov === bc && (pc < bp || (pc === bp && rankOf(c.m) < rankOf(bm))))) { bc = cov; bp = pc; bt = c.end; be = c.end; bm = c.m; } }
    covered[i] = bc; pieces[i] = bp; stepTo[i] = bt; stepEnd[i] = be; stepM[i] = bm;
  }
  const parts = []; let i = 0;
  while (i >= 0 && i < n && parts.length < 8) { const m = stepM[i]; if (m) { parts.push({ morpheme: m.morpheme, start: i, end: stepEnd[i] }); i = stepEnd[i]; } else i = stepTo[i]; }
  const coverage = parts.reduce((s, p) => s + (p.end - p.start), 0) / n;
  if (g.threshold && coverage < 0.55) return { parts: [] };
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return { parts: [] };
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 2)) { const gap = mw.slice(0, parts[0].start); if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return { parts: [] }; }
  return { parts: parts.sort((a, b) => a.start - b.start) };
}
const show = (p) => (p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join(' ')}` + '}' : '[]');

/* 保真自检 */
{
  const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
  let bad = 0;
  for (const w of R) if (core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}`).join('|') !== breakdownEx(w).parts.map((p) => `${p.morpheme}@${p.start}`).join('|')) bad++;
  console.log(`§0 保真自检：不一致 ${bad} 例 ${bad ? '✗ 中止' : '✔'}`);
  if (bad) { db.close(); process.exit(1); }
}

/* 词源 parts */
const stripStress = (s) => String(s).replace(/[\u0300-\u036f]/g, '');
const normPart = (s) => stripStress(String(s)).toLowerCase().replace(/\([^)]*\)/g, '').replace(/-/g, '').replace(/\u0451/g, '\u0435').trim();
const ety = db.prepare(`SELECT chain FROM word_etymology WHERE word = ? AND lang='ru' LIMIT 1`);
function partsOfEtym(w) {
  const e = ety.get(w); if (!e) return null;
  let ch = []; try { ch = JSON.parse(e.chain ?? '[]'); } catch { return null; }
  const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length >= 2);
  if (!steps.length) return null;
  const ps = steps.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), steps[0]).parts.map(normPart).filter(Boolean);
  return ps.length >= 2 ? ps : null;
}
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const vetoA = (morph, kind, w, pos, stem) => { const ps = partsOfEtym(w); return ps ? !ps.some((p) => p.startsWith(stem) || stem.startsWith(p)) : false; };
const vetoB = (morph, kind, w, pos, stem) => { const ps = partsOfEtym(w); return ps ? !(stem.length <= 2 || ps.some((p) => lcp(p, stem) >= 3)) : false; };
const rulesHa = [{ morpheme: 'уч-', after: '\u0441' }, { morpheme: 'дн-', after: '\u043e' }];
const vetoHa = (morph, kind, w, pos) => pos === 1 && rulesHa.some((r) => r.morpheme === morph && r.after === w[0]);

/* ===================== 75 词真前缀组 ===================== */
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const RU1 = new Set(['\u0432', '\u043e', '\u0441', '\u0443']);
const group = ALL.filter((w) => { const p = breakdownEx(w).parts; return p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0]); });
const byHead = new Map();
for (const w of group) { const k = breakdownEx(w).parts[0].morpheme; byHead.set(k, [...(byHead.get(k) ?? []), w]); }

console.log('\n' + '='.repeat(112));
console.log(`§8.1 「75 词真前缀组」逐词命运（实测 ${group.length} 词；首片段分布 ${[...byHead.entries()].map(([k, v]) => `${k}×${v.length}`).join(' / ')}）`);
console.log('='.repeat(112));
console.log(`  ${'词'.padEnd(18)}${'有parts'.padEnd(8)}${'现状'.padEnd(30)}${'H-a 后'.padEnd(26)}${'H-c(A) 后'.padEnd(26)}H-c(B) 后`);
let fate = { unchangedHa: 0, killedHa: 0, killedHcA: 0, killedHcB: 0, changedHcA: 0, changedHcB: 0 };
const killedHcAList = [], killedHcBList = [], changedList = [];
for (const w of group.sort()) {
  const b = breakdownEx(w).parts;
  const a = breakdownEx(w, {}, vetoHa).parts;
  const ca = breakdownEx(w, {}, vetoA).parts;
  const cb = breakdownEx(w, {}, vetoB).parts;
  const ps = partsOfEtym(w);
  if (!b.length) continue;
  if (a.length) fate.unchangedHa++; else fate.killedHa++;
  if (!ca.length) { fate.killedHcA++; killedHcAList.push(w); } else if (ca.map((x) => x.morpheme).join() !== b.map((x) => x.morpheme).join()) { fate.changedHcA++; changedList.push(`HC-A ${w}: ${show(b)} → ${show(ca)}`); }
  if (!cb.length) { fate.killedHcB++; killedHcBList.push(w); } else if (cb.map((x) => x.morpheme).join() !== b.map((x) => x.morpheme).join()) { fate.changedHcB++; changedList.push(`HC-B ${w}: ${show(b)} → ${show(cb)}`); }
  console.log(`  ${w.padEnd(18)}${(ps ? '✔' : '-').padEnd(8)}${show(b).padEnd(30)}${show(a).padEnd(26)}${show(ca).padEnd(26)}${show(cb)}`);
}
console.log(`\n  ⇒ H-a：保住 ${fate.unchangedHa} 词 / 拒绝 ${fate.killedHa} 词`);
console.log(`  ⇒ H-c(A)：拒绝 ${fate.killedHcA} 词 / 改写 ${fate.changedHcA} 词 / 保住 ${group.length - fate.killedHcA - fate.changedHcA} 词`);
console.log(`  ⇒ H-c(B)：拒绝 ${fate.killedHcB} 词 / 改写 ${fate.changedHcB} 词 / 保住 ${group.length - fate.killedHcB - fate.changedHcB} 词`);
if (killedHcAList.length) console.log(`  ⚠ H-c(A) 拒绝的 да- 族词（主管裁定「边缘可辩护」，不应被杀）: ${killedHcAList.slice(0, 20).join(' ')}${killedHcAList.length > 20 ? ' …' : ''}`);

/* ===================== 受保护真词 ===================== */
const PROTECTED = ['смекать', 'удачный', 'вода', 'вдыхать', 'безаварийный', 'велюровый', 'очко', 'свить',
  'сегодня', 'сущность', 'винище', 'улица', 'вишня', 'оптимальный', 'арест', 'Краков', 'Лена', 'Эдем', 'Мальта',
  'Абакан', 'Австралия', 'луна', 'небо', 'река', 'гора', 'человек', 'учитель', 'учебник'];
console.log('\n' + '='.repeat(112));
console.log('§8.2 受保护真词 / 判别集样本的命运（任一被机制改变即为误杀风险）');
console.log('='.repeat(112));
console.log(`  ${'词'.padEnd(16)}${'现状'.padEnd(30)}${'H-a 后'.padEnd(26)}${'H-c(A) 后'.padEnd(26)}H-c(B) 后`);
const harmed = [];
for (const w of PROTECTED) {
  const b = breakdownEx(w).parts, a = breakdownEx(w, {}, vetoHa).parts, ca = breakdownEx(w, {}, vetoA).parts, cb = breakdownEx(w, {}, vetoB).parts;
  const j = (p) => p.map((x) => x.morpheme).join('|');
  if (j(b) !== j(a) || j(b) !== j(ca) || j(b) !== j(cb)) harmed.push(`${w}: 现状${show(b)} | Ha${show(a)} | HcA${show(ca)} | HcB${show(cb)}`);
  console.log(`  ${w.padEnd(16)}${show(b).padEnd(30)}${show(a).padEnd(26)}${show(ca).padEnd(26)}${show(cb)}`);
}
console.log(`\n  ⇒ 被改变的受保护词：${harmed.length} 个`);
for (const h of harmed) console.log(`     ⚠ ${h}`);

/* ===================== суч- 全族 ===================== */
console.log('\n' + '='.repeat(112));
console.log('§8.3 全库 суч- 开头词全族（测试 agent 称 13 词，其中 11 落 уч- 形态）');
console.log('='.repeat(112));
const such = ALL.filter((w) => norm(w).startsWith('\u0441\u0443\u0447'));
for (const w of such.sort()) {
  const b = breakdownEx(w).parts;
  console.log(`  ${w.padEnd(18)} 现状 ${show(b).padEnd(30)} H-a 后 ${show(breakdownEx(w, {}, vetoHa).parts)}`);
}
console.log(`  合计 суч- 开头词 ${such.length} 词`);

db.close();
