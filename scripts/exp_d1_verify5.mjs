/**
 * 裁决五 · T12 验证清单执行（只读）
 *
 * 清单：
 *   1) ❌ 已删除 смекать 项（裁决五订正一：它是假警报，不满足 D1 模式）
 *   2) ✅ 71 词「真单字符前缀组」抽样 ≥15：修法后必须**非空**（不被误杀）—— AC-4 的正确检验对象
 *   3) ✅ 250 词「拒绝组」抽样 ≥15：修法后必须返回 []
 *   4) ✅ 口径对账：我的 342/75/267 vs 主管 321/71/250 —— 差异是否为过滤器所致
 *
 * 前置自检（否则 exit 1）：
 *   A) gapMin=1 复刻 ≡ 官方（已 build 的 dist，含修复）在全 791 词上 0 例不一致
 *   B) gapMin=2 复刻 ≡ 修复前官方 KPI（244 / 空洞≥3 134 / ≥2 175 / 零 37 / ≤1 69）
 *
 * 用法：node scripts/exp_d1_verify5.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

/* ================= 复刻引擎（与 exp_ru_ceiling.mjs 同源，此处自带双重自检） ================= */
const libRows = db.prepare(`SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?`);
const CACHE = new Map();
function libRowsOf(lang) {
  if (!CACHE.has(lang)) CACHE.set(lang, libRows.all(lang));
  return CACHE.get(lang);
}
function buildMatchers(lang) {
  const isRu = lang === 'ru';
  const all = libRowsOf(lang).map((r) => {
    const m = { morpheme: String(r.morpheme), kind: String(r.kind) };
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/ё/g, 'е') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
      const c = stem.slice(0, -1);
      if (c.length >= 3) patterns.push({ pat: c, core: true });
    }
    return { m, stem, patterns };
  });
  return { all, isRu };
}
const RU_M = buildMatchers('ru');
const STRICT = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true };
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);

function breakdownEx(word, gates) {
  const g = { ...STRICT, ...gates };
  const { all, isRu } = RU_M;
  const w = word.trim().toLowerCase();
  if (w.length < 2) return { parts: [], coverage: 0 };
  const mw = isRu ? w.replace(/ё/g, 'е') : w;
  const byFirst = new Map();
  for (const e of all) for (const { pat } of e.patterns) {
    const c = pat[0];
    let a = byFirst.get(c); if (!a) { a = []; byFirst.set(c, a); } a.push(e);
  }
  const candidatesAt = (pos) => {
    const out = [];
    const entries = byFirst.get(mw[pos]);
    if (!entries) return out;
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
      out.push({ m, start: pos, end });
    }
    return out;
  };
  const n = w.length;
  const covered = new Int32Array(n + 1), pieces = new Int32Array(n + 1);
  const stepTo = new Int32Array(n + 1), stepEnd = new Int32Array(n + 1);
  const stepM = new Array(n + 1).fill(null);
  stepTo[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    let bestCov = covered[i + 1], bestPieces = pieces[i + 1], bestTo = i + 1, bestEnd = i + 1, bestM = null;
    for (const c of candidatesAt(i)) {
      const cov = c.end - c.start + covered[c.end];
      const pc = 1 + pieces[c.end];
      const better = cov > bestCov || (cov === bestCov && (pc < bestPieces || (pc === bestPieces && rankOf(c.m) < rankOf(bestM))));
      if (better) { bestCov = cov; bestPieces = pc; bestTo = c.end; bestEnd = c.end; bestM = c.m; }
    }
    covered[i] = bestCov; pieces[i] = bestPieces; stepTo[i] = bestTo; stepEnd[i] = bestEnd; stepM[i] = bestM;
  }
  const parts = [];
  let i = 0;
  while (i >= 0 && i < n && parts.length < 8) {
    const m = stepM[i];
    if (m) { parts.push({ morpheme: m.morpheme, kind: m.kind, start: i, end: stepEnd[i] }); i = stepEnd[i]; }
    else i = stepTo[i];
  }
  const coverage = parts.reduce((s, p) => s + (p.end - p.start), 0) / n;
  if (g.threshold && coverage < 0.55) return { parts: [], coverage };
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return { parts: [], coverage };
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 2)) {
    const gap = mw.slice(0, parts[0].start);
    if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return { parts: [], coverage };
  }
  return { parts: parts.sort((a, b) => a.start - b.start), coverage };
}

/* ================= 自检 A / B ================= */
let badA = 0;
for (const w of R) {
  const a = core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
  const b = breakdownEx(w, { gapMin: 1 }).parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
  if (a !== b) badA++;
}
console.log(`【自检A】gapMin=1 复刻 vs 官方(含修复) 全 ${R.length} 词：不一致 ${badA} 例 ${badA === 0 ? '✔' : '✗'}`);
const holeTotal = (w, parts) => {
  const cov = new Array(w.length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  let tot = 0, run = -1;
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length && !cov[i]) { if (run < 0) run = i; } else if (run >= 0) { tot += i - run; run = -1; }
  }
  return tot;
};
const kpiPre = { hit: 0, deep: 0, s2: 0, zero: 0, le1: 0 };
for (const w of R) {
  const r = breakdownEx(w, { gapMin: 2 });
  if (!r.parts.length) continue;
  kpiPre.hit++;
  const hl = holeTotal(w, r.parts);
  if (hl >= 3) kpiPre.deep++;
  if (hl >= 2) kpiPre.s2++;
  if (hl === 0) kpiPre.zero++;
  if (hl <= 1) kpiPre.le1++;
}
const expPre = { hit: 244, deep: 134, s2: 175, zero: 37, le1: 69 };
const badB = Object.entries(expPre).filter(([k, v]) => kpiPre[k] !== v);
console.log(`【自检B】gapMin=2 复刻 vs 修复前官方 KPI：${JSON.stringify(kpiPre)} ${badB.length === 0 ? '✔ 完全一致' : '✗ 差异 ' + JSON.stringify(badB)}`);
if (badA || badB.length) { console.log('⇒ 自检失败，中止。'); db.close(); process.exit(1); }

/* ================= 口径对账 ================= */
const ALL_RU = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru'`)
  .all()
  .map((r) => String(r.word));
/* 主管的过滤器（probe_verify_gap1_fix.mjs:34-37） */
const SUO_FILTER = (w) => w.length >= 4 && w.length <= 14 && /^[а-яё-]+$/.test(w);

/* 修复前 D1 集（gapMin=2），两种口径 */
const preD1All = [];
for (const w of ALL_RU) {
  const r = breakdownEx(w, { gapMin: 2 });
  if (r.parts.length >= 2 && r.parts[0].start === 1) preD1All.push(w);
}
const preD1Suo = preD1All.filter(SUO_FILTER);
const PREFIXES = new Set(
  JSON.parse(readFileSync('packages/data-pipeline/roots_ru.json', 'utf8'))
    .filter((m) => m.kind === 'prefix')
    .map((m) => m.morpheme.replace(/^-+|-+$/g, '')),
);
const SINGLE = [...PREFIXES].filter((p) => p.length === 1).sort();
const split = (arr) => ({ pass: arr.filter((w) => PREFIXES.has(w[0])), reject: arr.filter((w) => !PREFIXES.has(w[0])) });
const sAll = split(preD1All), sSuo = split(preD1Suo);

console.log('\n' + '='.repeat(74));
console.log('④ 口径对账：我的 342/75/267 vs 主管 321/71/250');
console.log('='.repeat(74));
console.log(`  库内单字符前缀: ${SINGLE.join(' ')}`);
const cmp = (label, mine, theirs) => console.log(`  ${label.padEnd(26)} 我 ${String(mine).padStart(4)}   主管 ${String(theirs).padStart(4)}   ${mine === theirs ? '✔' : '⚠'}`);
console.log('  —— 我的口径（全部 words_i18n(ru)，无长度/字符过滤）——');
cmp('D1 集总数', preD1All.length, 342);
cmp('├ 放行组(gap∈前缀)', sAll.pass.length, 75);
cmp('└ 拒绝组(gap∉前缀)', sAll.reject.length, 267);
console.log('  —— 套用主管过滤器 length4-14 且 /^[а-яё-]+$/ ——');
cmp('D1 集总数', preD1Suo.length, 321);
cmp('├ 放行组(gap∈前缀)', sSuo.pass.length, 71);
cmp('└ 拒绝组(gap∉前缀)', sSuo.reject.length, 250);
const excluded = preD1All.filter((w) => !SUO_FILTER(w));
console.log(`\n  ⇒ 差异 = 过滤器排除 ${excluded.length} 词（我 342−321=${preD1All.length - preD1Suo.length}；放行组 75−71=${sAll.pass.length - sSuo.pass.length}；拒绝组 267−250=${sAll.reject.length - sSuo.reject.length}）`);
console.log(`  被排除的词（前 25）: ${excluded.slice(0, 25).join(' ')}`);
console.log(`  ★ 结论：${preD1Suo.length === 321 && sSuo.pass.length === 71 && sSuo.reject.length === 250 ? '两套口径完全同构，差异 100% 由过滤器解释 ⇒ 321/71/250 与 342/75/267 是同一事实的两种口径，两实现一致 ✔' : '仍有未解释差异 ⚠'}`);

/* ================= 清单 2：71 词放行组抽样（AC-4 正确检验对象）================= */
console.log('\n' + '='.repeat(74));
console.log('② 放行组（真单字符前缀词）抽样 ≥15：修法后必须【非空】');
console.log('='.repeat(74));
const passSample = sSuo.pass.filter((_, i) => i % Math.max(1, Math.floor(sSuo.pass.length / 18)) === 0).slice(0, 18);
let killed = 0;
console.log(`  放行组共 ${sSuo.pass.length} 词（у:${sSuo.pass.filter((w) => w[0] === 'у').length} с:${sSuo.pass.filter((w) => w[0] === 'с').length} о:${sSuo.pass.filter((w) => w[0] === 'о').length} в:${sSuo.pass.filter((w) => w[0] === 'в').length}），抽样 ${passSample.length} 词：`);
for (const w of passSample) {
  const p = core.breakdownWord(db, w, 'ru');
  const okNonEmpty = p.length > 0;
  if (!okNonEmpty) killed++;
  console.log(
    `    ${okNonEmpty ? '✓' : '✖ 被误杀!'} ${w.padEnd(16)} 首片段=${(p[0]?.morpheme ?? '—').padEnd(9)}@${p[0]?.start ?? '-'}  gap='${w[0]}'  ${p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join('+')}}` : '—不可拆'}`,
  );
}
console.log(`  ⇒ 被误杀 ${killed} 词 ${killed === 0 ? '✔ AC-4「无修过头」通过' : '✖ AC-4 失败'}`);
const firstIsPrefix = passSample.filter((w) => core.breakdownWord(db, w, 'ru')[0]?.start === 0 && core.breakdownWord(db, w, 'ru')[0]?.morpheme.replace(/-+$/, '') === w[0]).length;
console.log(`  ⚠ 机制澄清：主管清单②要求「首片段 morpheme 恰为该单字符前缀」，实测 ${firstIsPrefix}/${passSample.length} 满足。`);
console.log(`     这**不可能**满足——本组定义就是 parts[0].start === 1，即首字符【未被任何片段覆盖】。`);
console.log(`     原因：单字符前缀 с-/в-/о-/у- 被 index.ts:773-781 的「紧邻 ≥3 字符词根支撑」规则拦住`);
console.log(`     （如 сдабривать 的 rest='дабривать' 不以任何已知 ≥3 字符词根起首），故它只能留作 1 字符词首间隙，`);
console.log(`     由 gapExplain 容忍。⇒ AC-4 的可测属性是「非空（不被误杀）」，不是「首片段=с-」。`);

/* ================= 清单 3：250 词拒绝组抽样 ================= */
console.log('\n' + '='.repeat(74));
console.log('③ 拒绝组（假前缀词）抽样 ≥15：修法后必须返回 []');
console.log('='.repeat(74));
const rejSample = sSuo.reject.filter((_, i) => i % Math.max(1, Math.floor(sSuo.reject.length / 18)) === 0).slice(0, 18);
let notEmpty = 0;
console.log(`  拒绝组共 ${sSuo.reject.length} 词，抽样 ${rejSample.length} 词：`);
for (const w of rejSample) {
  const p = core.breakdownWord(db, w, 'ru');
  const ok = p.length === 0;
  if (!ok) notEmpty++;
  console.log(`    ${ok ? '✓' : '✖ 仍有拆解!'} ${w.padEnd(16)} 修前={${breakdownEx(w, { gapMin: 2 }).parts.map((x) => x.morpheme + '@' + x.start).join('+')}}  修后=${p.length ? `{${p.map((x) => x.morpheme).join('+')}}` : '[] ✔'}`);
}
console.log(`  ⇒ 未消除 ${notEmpty} 词 ${notEmpty === 0 ? '✔ 全部消除' : '✖'}`);

/* ================= 汇总 ================= */
console.log('\n' + '='.repeat(74));
console.log('AC-4 判定汇总');
console.log('='.repeat(74));
console.log(`  ① 放行组 ${sSuo.pass.length} 词：误杀 ${killed}/${passSample.length} 抽样 → ${killed === 0 ? 'PASS' : 'FAIL'}`);
console.log(`  ② 拒绝组 ${sSuo.reject.length} 词：残留 ${notEmpty}/${rejSample.length} 抽样 → ${notEmpty === 0 ? 'PASS' : 'FAIL'}`);
console.log(`  ③ 全库残留检查：见 exp_d1_audit.mjs（改后 gap=1 拆解 75 词，gap 首字符 100% ∈ в/о/с/у）`);
db.close();
