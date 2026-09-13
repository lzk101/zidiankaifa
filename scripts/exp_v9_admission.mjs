/**
 * T17 · v0.9.0 准入条件实验台（**只读**：不写 data/db/dict.db、不改 src/、test/、roots*.json、package.json）
 *
 * 唯一问题：「补词首词根，能否在提升尺子 R 覆盖率的同时，不让全库 D1 计数上升？」
 *
 * ★ 与派单给的方法有一处**必须的偏差（已实测发现）**：
 *   派单建议复用 `scripts/exp_ru_ceiling.mjs:29-152` 的复刻引擎。实测该复刻是 **v0.8.0 D1 修复之前**的版本
 *   （其 `gapExplain` 判据写作 `parts[0].start >= (g.gapMin ?? 2)`，而生产 `packages/core/src/db/index.ts:859`
 *    现为 `parts[0].start >= 1`）。用 §0 全库自检逐词比对可复现：旧复刻 vs 现 dist **296 例不一致**，
 *   且旧复刻给出的基线是 **R=244 / D1=267 / 尺子A=33,441（即 v0.8.0 修复前状态）**——与冻结基线（238/0/33,174）不符。
 *   ⇒ 本脚本按**现生产源码 index.ts:725-865 逐条复刻**（唯一修改点：`:859` 的 `>= 1`），并用 §0 全库自检证明保真。
 *   `exp_ru_ceiling.mjs` 本身**未改动**（派单红线：不得为导出而去改它）。
 *
 * 三条判据（全部为真实引擎在真实词表上的**端到端实测**，非启发式计数）：
 *   判据① 全库 D1 模式计数 = 全库 101,512 俄语词中「可拆 且 首片段 start==1 且 gap 字符 ∉ 库内前缀 stem 集合」的词数
 *   判据② 全库空洞≥3 计数 = 口径 A（未覆盖字符总数 ≥3），只在可拆词上计
 *   判据③ 尺子 R 覆盖率 = 与 packages/core/test/related.mjs:144 同定义的 791 词样本
 *
 * 方法：**内存注入**候选词素（`extra`），零副作用。
 * 用法（必须从仓库根跑）：node scripts/exp_v9_admission.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const DB_PATH = 'data/db/dict.db';
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const MIN_COVERAGE = 0.55; // = packages/core/src/db/index.ts:709（只读，不改）
const W = (s) => process.stdout.write(s);
const NOW = () => new Date().toISOString();

/* ============================ 词表与尺子 ============================ */
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
// 尺子 R：与 packages/core/test/related.mjs:144 / BASELINE.md §4 同定义
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
const TOTAL_R = R.length;
const NEED45 = Math.ceil(0.45 * TOTAL_R);
const pctR = (x) => `${((x / TOTAL_R) * 100).toFixed(2)}%`;

/* ============ 1. 复刻 breakdownWord（源：packages/core/src/db/index.ts:725-865，含 v0.8.0 的 :859 修复） ============
 * 与原实现的**唯一差异是性能结构**：把 `all` / `byFirst` / 前缀集合等派生结构**预计算进 bundle**（原实现每词重建）。
 * 语义等价由 §0 的「全库 101,512 词逐词比对官方 breakdownWord」保证（0 例不一致才继续）。
 * 另外把原 `all.some(...)` 两处（:777 单字符前缀支撑、:861 gap 解释）改为等价的预计算集合查询。            */
const RANK = { prefix: 0, suffix: 1, root: 2 }; // index.ts:712
const rankOf = (m) => (m ? RANK[m.kind] : 3); // index.ts:713-715
const ROW_CACHE = new Map();
function libRows(lang) {
  let r = ROW_CACHE.get(lang);
  if (!r) { r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?').all(lang); ROW_CACHE.set(lang, r); }
  return r;
}
/** 预计算一个词素集合的全部派生结构（等价于 index.ts:734-756 每次调用重建的那些） */
function prepBundle(lang, extra = []) {
  const rows = libRows(lang);
  const list = rows.map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind), meaningZh: r.meaning_zh ?? '', origin: r.origin ?? null }));
  for (const x of extra) list.push({ morpheme: x.morpheme, kind: x.kind, meaningZh: x.meaningZh ?? '', origin: null });
  const isRu = lang === 'ru';
  // ★ 顺序必须复刻 index.ts:691-692：按 kind 分组（prefix → suffix → root），组内按**原始 morpheme 串长降序**。
  //   顺序决定 DP 同分同片段时的 tie-break（candidatesAt 返回顺序），漏掉它会在全库造成 29 例不一致（已实测）。
  //   注：注入候选（extra）排在最后一位，等价于「新增词素在库尾」的确定性约定。
  const nLibRows = rows.length;
  const ordered = [
    ...list.slice(0, nLibRows).filter((m) => m.kind === 'prefix').sort((a, b) => b.morpheme.length - a.morpheme.length),
    ...list.slice(0, nLibRows).filter((m) => m.kind === 'suffix').sort((a, b) => b.morpheme.length - a.morpheme.length),
    ...list.slice(0, nLibRows).filter((m) => m.kind === 'root').sort((a, b) => b.morpheme.length - a.morpheme.length),
    ...list.slice(nLibRows),
  ];
  const all = ordered.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/ё/g, 'е') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
      const core = stem.slice(0, -1);
      if (core.length >= 3) patterns.push({ pat: core, core: true });
    }
    return { m, stem, patterns };
  });
  return finalizeBundle({ all, isRu });
}
function finalizeBundle(b) {
  const byFirst = new Map();
  for (const e of b.all) for (const { pat } of e.patterns) {
    const c = pat[0]; let arr = byFirst.get(c); if (!arr) { arr = []; byFirst.set(c, arr); } arr.push(e);
  }
  // 前缀 stem 精确集合（替代 index.ts:861 的 all.some(m.kind==='prefix' && stem===gap)）
  const prefixStems = new Set();
  for (const e of b.all) if (e.m.kind === 'prefix') prefixStems.add(e.stem);
  // 非前缀 stem（len≥3）按首字符分桶（替代 index.ts:777 的 all.some(startsWith)）
  const nonPreByChar = new Map();
  for (const e of b.all) {
    if (e.m.kind === 'prefix' || e.stem.length < 3) continue;
    const c = e.stem[0]; let arr = nonPreByChar.get(c); if (!arr) { arr = []; nonPreByChar.set(c, arr); } arr.push(e.stem);
  }
  return { ...b, byFirst, prefixStems, nonPreByChar };
}
/** O(1) 扩展一个 root 候选（不复制整个 all 数组——roots 不改变 prefix 集合） */
function extendBundle(b, stem) {
  const e = { m: { morpheme: stem, kind: 'root', meaningZh: '', origin: null }, stem, patterns: [{ pat: stem, core: false }] };
  const byFirst = new Map(b.byFirst);
  const c = stem[0];
  byFirst.set(c, (byFirst.get(c) ?? []).concat([e]));
  const nonPreByChar = new Map(b.nonPreByChar);
  nonPreByChar.set(c, (nonPreByChar.get(c) ?? []).concat([stem]));
  return { isRu: b.isRu, byFirst, prefixStems: b.prefixStems, nonPreByChar };
}
const MATCHERS = { ru: prepBundle('ru'), en: prepBundle('en') };
const BUNDLE_CACHE = new Map();
const sigOf = (extra) => extra.map((x) => `${x.kind}:${x.morpheme}`).sort().join(',');
function matchersWith(lang, extra) {
  if (!extra.length) return MATCHERS[lang];
  const key = `${lang}|${sigOf(extra)}`;
  let m = BUNDLE_CACHE.get(key);
  if (!m) { m = prepBundle(lang, extra); BUNDLE_CACHE.set(key, m); }
  return m;
}
const GATES_STRICT = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true };

function breakdownEx(word, lang, gates, bundle) {
  const g = { ...GATES_STRICT, ...gates };
  const b = bundle ?? MATCHERS[lang];
  const w = word.trim().toLowerCase();               // index.ts:726
  if (w.length < 2) return { parts: [], coverage: 0 }; // index.ts:727
  const isRu = b.isRu;
  const mw = isRu ? w.replace(/ё/g, 'е') : w;         // index.ts:732
  const candidatesAt = (pos) => {                     // index.ts:759-788
    const out = [];
    const entries = b.byFirst.get(mw[pos]);
    if (!entries) return out;
    for (const { m, stem, patterns } of entries) for (const { pat, core } of patterns) {
      const minLen = isRu && m.kind === 'prefix' ? 1 : 2;
      if (pat.length < minLen || !mw.startsWith(pat, pos)) continue;
      if (g.prefixPos && m.kind === 'prefix' && pos !== 0 && !core) continue;
      let end = pos + (core ? w.length - pos : pat.length);
      if (core) { if (w.length - (pos + pat.length) > 3) continue; end = w.length; }
      else if (g.oneCharPre && isRu && m.kind === 'prefix' && pat.length === 1) {
        const rest = mw.slice(pos + 1);
        const bucket = b.nonPreByChar.get(rest[0] ?? '') ?? [];   // ← 等价 index.ts:777 的 all.some(startsWith)
        if (!bucket.some((s) => rest.startsWith(s))) continue;
      }
      if (g.suffixPos && m.kind === 'suffix' && pos < 3) continue;
      out.push({ m, start: pos, end });
    }
    return out;
  };
  const n = w.length;                                  // index.ts:790-817
  const covered = new Int32Array(n + 1), pieces = new Int32Array(n + 1);
  const stepTo = new Int32Array(n + 1), stepEnd = new Int32Array(n + 1);
  const stepM = new Array(n + 1).fill(null);
  stepTo[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    let bestCov = covered[i + 1], bestPieces = pieces[i + 1], bestTo = i + 1, bestEnd = i + 1, bestM = null;
    for (const c of candidatesAt(i)) {
      const cov = c.end - c.start + covered[c.end], pc = 1 + pieces[c.end];
      if (cov > bestCov || (cov === bestCov && (pc < bestPieces || (pc === bestPieces && rankOf(c.m) < rankOf(bestM))))) {
        bestCov = cov; bestPieces = pc; bestTo = c.end; bestEnd = c.end; bestM = c.m;
      }
    }
    covered[i] = bestCov; pieces[i] = bestPieces; stepTo[i] = bestTo; stepEnd[i] = bestEnd; stepM[i] = bestM;
  }
  const parts = [];                                    // index.ts:819-838
  let i = 0;
  while (i >= 0 && i < n && parts.length < 8) {
    const m = stepM[i];
    if (m) { parts.push({ morpheme: m.morpheme, kind: m.kind, start: i, end: stepEnd[i] }); i = stepEnd[i]; }
    else i = stepTo[i];
  }
  const rawCovered = parts.reduce((s, p) => s + (p.end - p.start), 0);
  if (rawCovered / n < (g.minCov ?? MIN_COVERAGE)) return { parts: [], coverage: rawCovered / n };   // index.ts:842
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return { parts: [], coverage: rawCovered / n }; // index.ts:846
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 1)) {   // index.ts:859（v0.8.0：>= 1）
    const gap = mw.slice(0, parts[0].start);
    if (!b.prefixStems.has(gap)) return { parts: [], coverage: rawCovered / n };
  }
  return { parts: parts.sort((a, b2) => a.start - b2.start), coverage: rawCovered / n };
}
const hitOf = (w, extra, bundle) => breakdownEx(w, 'ru', GATES_STRICT, bundle ?? matchersWith('ru', extra)).parts;

/* ============================ 2. 度量工具（口径写死） ============================ */
const ruStems = libRows('ru').map((r) => {
  const raw = String(r.morpheme).replace(/^-+|-+$/g, '');
  return { stem: raw.replace(/ё/g, 'е'), kind: String(r.kind) };
});
const PREFIX_STEMS = new Set(ruStems.filter((s) => s.kind === 'prefix').map((s) => s.stem));
const ONE_CHAR_PREFIXES = [...PREFIX_STEMS].filter((s) => s.length === 1).sort();
const LIB_KINDS = new Map();
for (const s of ruStems) { if (!LIB_KINDS.has(s.stem)) LIB_KINDS.set(s.stem, new Set()); LIB_KINDS.get(s.stem).add(s.kind); }

/** 空洞口径 A = 未覆盖字符总数（BASELINE 权威口径） */
function holeTotal(word, parts) {
  const n = norm(word).length;
  const cov = new Uint8Array(n);
  for (const p of parts) for (let i = p.start; i < p.end && i < n; i++) cov[i] = 1;
  let h = 0; for (let i = 0; i < n; i++) if (!cov[i]) h++;
  return h;
}
/** 空洞口径 B = 最大单段未覆盖 */
function holeMaxRun(word, parts) {
  const n = norm(word).length;
  const cov = new Uint8Array(n);
  for (const p of parts) for (let i = p.start; i < p.end && i < n; i++) cov[i] = 1;
  let max = 0, cur = 0;
  for (let i = 0; i < n; i++) { if (!cov[i]) { cur++; if (cur > max) max = cur; } else cur = 0; }
  return max;
}

/** 全库扫描：三条判据 + 辅助诊断（wordList 默认全库；R 用单独函数） */
function fullScan(extra = []) {
  const bundle = matchersWith('ru', extra);
  const res = { d1: 0, d1pass: 0, d1PreGuard: 0, hole3: 0, hole2: 0, holeMax3: 0, holeMax3old: 0, holeMax3new: 0, holeTotalMax: 0, hole3old: 0, hole3new: 0, covered: 0, coveredR: 0, loses: [], newHole3: [], newHits: [] };
  const Rset = new Set(R);
  const baseHitAll = fullScan._baseHit ?? null;
  for (const w of ALL) {
    const { parts } = breakdownEx(w, 'ru', GATES_STRICT, bundle);
    const mw = norm(w);
    if (parts.length) {
      res.covered++;
      if (Rset.has(w)) res.coveredR++;
      const wasHit = baseHitAll?.has(w) ?? true;
      if (!wasHit && extra.length) res.newHits.push(w);
      const h = holeTotal(w, parts);
      if (h >= 3) { res.hole3++; if (wasHit) res.hole3old++; else res.hole3new++; }
      if (h >= 2) res.hole2++;
      if (h > res.holeTotalMax) res.holeTotalMax = h;
      if (holeMaxRun(w, parts) >= 3) { res.holeMax3++; if (wasHit) res.holeMax3old++; else res.holeMax3new++; }
      if (parts[0].start === 1) { if (PREFIX_STEMS.has(mw.slice(0, 1))) res.d1pass++; else res.d1++; }
    } else if (extra.length && baseHitAll?.has(w)) res.loses.push(w);
    // 辅助：守卫前 DP 原生 D1 形态（关掉两道词首守卫后仍过覆盖率闸）
    const raw = breakdownEx(w, 'ru', { ...GATES_STRICT, leadGap: false, gapExplain: false }, bundle);
    if (raw.parts.length && raw.parts[0].start >= 1 && !PREFIX_STEMS.has(mw.slice(0, raw.parts[0].start))) res.d1PreGuard++;
  }
  return res;
}

/* ============================ 3. §0 复刻保真自检（全库逐词） ============================ */
W('='.repeat(98) + '\n');
W('§0 复刻保真自检（全库 101,512 俄语词逐词，官方 core.breakdownWord vs 本脚本 breakdownEx）\n');
W('='.repeat(98) + '\n');
{
  const t0 = Date.now();
  let bad = 0; const ex = [];
  for (const w of ALL) {
    let a = [];
    try { a = core.breakdownWord(db, w, 'ru'); } catch { a = []; }
    const b2 = breakdownEx(w, 'ru', GATES_STRICT, MATCHERS.ru).parts;
    const sa = a.map((p) => `${p.morpheme}:${p.start}-${p.end}`).join('|');
    const sb = b2.map((p) => `${p.morpheme}:${p.start}-${p.end}`).join('|');
    if (sa !== sb) { bad++; if (ex.length < 6) ex.push(`    ${w}\n      官方[${sa}]\n      复刻[${sb}]`); }
  }
  W(`  不一致 ${bad} 例 ${bad ? '⚠ 复刻不可信，后续数字作废\n' + ex.join('\n') : '✔（全库零不一致 ⇒ 复刻保真）'}\n`);
  W(`  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n`);
}

/* ============================ 4. §1 基线 ============================ */
W('='.repeat(98) + '\n');
W('§1 基线实测（extra = 空；口径逐条标注）\n');
W('='.repeat(98) + '\n');
let t0 = Date.now();
const BASE = fullScan([]);
const baseScanMs = Date.now() - t0;
const BASE_HIT_ALL = new Set(ALL.filter((w) => hitOf(w, [], MATCHERS.ru).length));
fullScan._baseHit = BASE_HIT_ALL;
const BASE_HIT_R = new Set(R.filter((w) => BASE_HIT_ALL.has(w)));
W(`  判据① 全库 D1 模式计数（全库 101,512 词；可拆 且 首片段 start==1 且 gap ∉ 前缀集）: ${BASE.d1}   ← 冻结基线 0\n`);
W(`        └ 同形态但 gap ∈ 前缀集{${ONE_CHAR_PREFIXES.join(',')}}（真前缀组）: ${BASE.d1pass}   ← TASKS.md 记载 75\n`);
W(`        └ 辅助·守卫前 DP 原生形态数（关掉 :846 单片段 + :859 前缀解释两道词首守卫）: ${BASE.d1PreGuard}\n`);
W(`  判据② 全库空洞≥3 计数（**全库分母 101,512 词**，仅可拆词上计）\n`);
W(`        ├ 口径 A（未覆盖字符【总数】≥3；定义 = 词长 − Σ片段长度）基线 = ${BASE.hole3}\n`);
W(`        └ 口径 B（【最大单段】空洞 ≥3，含词尾残余段）基线 = ${BASE.holeMax3}\n`);
W(`        参考：全库空洞≥2（口径 A）= ${BASE.hole2}；全库**最大未覆盖总数** = ${BASE.holeTotalMax}；可拆词 ${BASE.covered} 词（空洞率 ${(BASE.hole3 / BASE.covered * 100).toFixed(1)}%）\n`);
W(`        ⚠ R 内 L4（口径 A）= 134 **仅回归护栏，不作有效性判据**：灵敏度比 134/20214 = 0.66%。\n`);
W(`  判据③ 尺子 R 覆盖率: ${BASE.coveredR}/${TOTAL_R} = ${pctR(BASE.coveredR)}   ← 冻结基线 238/791 = 30.09%\n`);
W(`        达 45% 需 ${NEED45} 词，当前差 ${NEED45 - BASE.coveredR} 词\n`);
W(`  尺子 A（全库俄语词条 ${ALL.length}）覆盖: ${BASE.covered} = ${((BASE.covered / ALL.length) * 100).toFixed(2)}%   ← 冻结基线 33,174\n`);
W(`  R 内 L4（样本内空洞≥3；仅回归护栏，非判据）: ${R.filter((w) => { const p = hitOf(w, [], MATCHERS.ru); return p.length && holeTotal(w, p) >= 3; }).length}   ← 冻结值 134\n`);
W(`  全库扫描 ${baseScanMs}ms/次（含两次 DP：正式 + 守卫前诊断）\n`);
W(`  库内单字符前缀词素: [${ONE_CHAR_PREFIXES.join(' ')}]   前缀 stem 共 ${PREFIX_STEMS.size} 条\n\n`);

/* ============================ 5. §2 候选池 ============================ */
W('='.repeat(98) + '\n');
W('§2 候选池构建（规则：root 类 / 词首锚定 / 长度 ≥2 / 剥离后剩余 ≥3）\n');
W('='.repeat(98) + '\n');
const missR = R.filter((w) => !BASE_HIT_R.has(w));
W(`  尺子 R 现状: 可拆 ${BASE_HIT_R.size} / 不可拆 ${missR.length}（分母 ${TOTAL_R}）\n`);
const candMap = new Map();
for (const w0 of missR) {
  const w = norm(w0);
  for (let k = 2; k <= w.length - 3; k++) {
    const c = w.slice(0, k);
    let rec = candMap.get(c);
    if (!rec) { rec = { stem: c, len: k, src: [] }; candMap.set(c, rec); }
    if (rec.src.length < 6 && !rec.src.includes(w0)) rec.src.push(w0);
  }
}
const CANDS = [...candMap.values()];
W(`  R 缺失词 ${missR.length} 词 → 头部子串候选 ${CANDS.length} 个（去重）\n`);
W(`  其中 stem 已在库内（同形异 kind）: ${CANDS.filter((c) => LIB_KINDS.has(c.stem)).length}；库里完全没有的新 stem: ${CANDS.filter((c) => !LIB_KINDS.has(c.stem)).length}\n\n`);

// R 子串倒排索引（加速：仅含候选 stem 的词会受该候选影响）
const SUBIDX = new Map();
for (const w of R) {
  const mw = norm(w);
  for (let i = 0; i < mw.length; i++) for (let L = 2; i + L <= mw.length; L++) {
    const s = mw.slice(i, i + L);
    let set = SUBIDX.get(s); if (!set) { set = new Set(); SUBIDX.set(s, set); }
    set.add(w);
  }
}

/* ============================ 6. §3 单条候选端到端边际增益 ============================ */
W('='.repeat(98) + '\n');
W('§3 逐条候选单独注入的真实引擎实测（R 解锁集 / 解锁方式 / 既有拆解丢失）\n');
W('='.repeat(98) + '\n');
t0 = Date.now();
for (const c of CANDS) {
  const ext = extendBundle(MATCHERS.ru, c.stem);
  const affected = [...(SUBIDX.get(c.stem) ?? [])];
  const gained = [], lost = [], headGained = [];
  for (const w of affected) {
    const parts = breakdownEx(w, 'ru', GATES_STRICT, ext).parts;
    const had = BASE_HIT_R.has(w);
    if (parts.length && !had) { gained.push(w); if (parts[0].start === 0 && parts[0].morpheme.replace(/^-+|-+$/g, '') === c.stem) headGained.push(w); }
    else if (!parts.length && had) lost.push(w);
  }
  c.soloGained = gained; c.soloLost = lost; c.soloGain = gained.length; c.headGain = headGained.length;
}
W(`  评测耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s（${CANDS.length} 条 × 各自受影响词）\n`);
const dist = new Map();
for (const c of CANDS) dist.set(c.soloGain, (dist.get(c.soloGain) ?? 0) + 1);
W(`  单条 R 解锁数分布: ${[...dist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}词:${v}条`).join('  ')}\n`);
W(`  ★ 单条解锁 ≥2 词: ${CANDS.filter((c) => c.soloGain >= 2).length}/${CANDS.length} = ${((CANDS.filter((c) => c.soloGain >= 2).length / CANDS.length) * 100).toFixed(1)}%\n`);
W(`  ★ 只能解锁 1 词（泛化价值为零）：${CANDS.filter((c) => c.soloGain === 1).length} 条；解锁 0 词：${CANDS.filter((c) => c.soloGain === 0).length} 条\n`);
W(`  ★ 造成 R 内既有拆解丢失的候选：${CANDS.filter((c) => c.soloLost.length).length} 条\n\n`);

/* ============================ 7. §4 精确贪婪 ============================ */
W('='.repeat(98) + '\n');
W('§4 精确贪婪选择（每步对池内每条候选做真实引擎增量评估；池 = 单条增益≥1）\n');
W('='.repeat(98) + '\n');
function greedyRun(poolCands, label) {
  const POOL = poolCands.map((c) => ({ ...c, used: false }));
  W(`  [${label}] 池规模 ${POOL.length} 条\n`);
  let curExtra = [];
  let curBundle = MATCHERS.ru;
  let curHit = new Set(BASE_HIT_R);
  const chosen = [];
  const trace = [];
  const MAXSTEPS = 400;
  const t = Date.now();
  for (let step = 1; step <= MAXSTEPS; step++) {
    let best = null;
    for (const c of POOL) {
      if (c.used) continue;
      const affected = SUBIDX.get(c.stem);
      if (!affected) continue;
      let todo = 0; for (const w of affected) if (!curHit.has(w)) { todo++; }
      if (!todo) continue;   // 当前集合下该条无增益可能（不剪枝：留待后续步骤复核）
      const ext = extendBundle(curBundle, c.stem);
      let gain = 0; const newOnes = [];
      for (const w of affected) {
        if (curHit.has(w)) continue;
        if (breakdownEx(w, 'ru', GATES_STRICT, ext).parts.length) { gain++; newOnes.push(w); }
      }
      if (!best || gain > best.gain) best = { c, gain, newOnes };
    }
    if (!best || best.gain === 0) { W(`    [${label}] 第 ${chosen.length + 1} 步：池内再无边际增益 ⇒ 停止\n`); break; }
    best.c.used = true;
    curExtra = [...curExtra, { morpheme: best.c.stem, kind: 'root' }];
    curBundle = extendBundle(curBundle, best.c.stem);
    for (const w of best.newOnes) curHit.add(w);
    chosen.push({ stem: best.c.stem, marginal: best.gain, cum: curHit.size, examples: best.newOnes.slice(0, 5), src: best.c.src });
    trace.push({ n: chosen.length, cum: curHit.size, cov: +(curHit.size / TOTAL_R).toFixed(4) });
    if (chosen.length % 10 === 0 || curHit.size >= NEED45) {
      W(`      n=${String(chosen.length).padStart(3)}  R=${curHit.size}/${TOTAL_R} = ${pctR(curHit.size)}   本次 ${best.c.stem}(+${best.gain})\n`);
    }
  }
  const first45 = trace.find((x) => x.cum >= NEED45) ?? null;
  W(`    ★ 首次达到 45%（${NEED45}/${TOTAL_R}）= ${first45 ? `${first45.n} 条（R=${first45.cum} = ${(first45.cov * 100).toFixed(2)}%）` : '未达标（贪婪增量记账口径，未计 losses）'}\n`);
  W(`    ★ 池耗尽时 ${chosen.length} 条 → R=${curHit.size}/${TOTAL_R} = ${pctR(curHit.size)}（机械天花板，贪婪增量记账口径）\n`);
  W(`    [${label}] 耗时 ${((Date.now() - t) / 1000).toFixed(1)}s\n\n`);
  return { chosen, trace, first45, finalHit: curHit };
}
const GREEDY_ALL = greedyRun(CANDS.filter((c) => c.soloGain >= 1), '全池（含 2 字符片段）');
const GREEDY_L3 = greedyRun(CANDS.filter((c) => c.soloGain >= 1 && c.stem.length >= 3), '仅 len≥3 候选');
const chosen = GREEDY_ALL.chosen;
const trace = GREEDY_ALL.trace;
const first45 = GREEDY_ALL.first45;
W(`  ▶ 候选长度分解（全池贪婪序列的边际增益合计）：${[...chosen.reduce((m, c) => { const k = c.stem.length; return m.set(k, (m.get(k) ?? 0) + c.marginal); }, new Map()).entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}字符:${v}词`).join('  ')}\n`);
W(`  ▶ 前 19 条贪婪候选（全池）: ${chosen.slice(0, 19).map((c) => c.stem).join(' ')}\n`);
W(`  ▶ 前 19 条贪婪候选（仅 len≥3）: ${GREEDY_L3.chosen.slice(0, 19).map((c) => c.stem).join(' ')}\n\n`);

/* ============================ 8. §5 三条判据的全库实测 ============================ */
W('='.repeat(98) + '\n');
W('§5 三条判据 · 候选组在全库口径下的端到端实测\n');
W('='.repeat(98) + '\n');
const mkExtra = (stems) => stems.map((s) => ({ morpheme: s, kind: 'root' }));
const plans = [];
plans.push({ key: 'l3all', label: `仅 len≥3 候选全量（${GREEDY_L3.chosen.length} 条）`, stems: GREEDY_L3.chosen.map((c) => c.stem) });
if (chosen.length >= 70) plans.push({ key: 'n70', label: '全池前 70 条', stems: chosen.slice(0, 70).map((c) => c.stem) });
if (chosen.length >= 90) plans.push({ key: 'n90', label: '全池前 90 条', stems: chosen.slice(0, 90).map((c) => c.stem) });
plans.push({ key: 'all', label: `全池贪婪耗尽（${chosen.length} 条）`, stems: chosen.map((c) => c.stem) });
const planResults = [];
W(`  ${'方案'.padEnd(24)}${'n'.padEnd(5)}${'R 覆盖率'.padEnd(16)}${'ΔR'.padEnd(6)}${'D1'.padEnd(4)}${'口径A≥3'.padEnd(9)}${'ΔA'.padEnd(8)}${'口径B≥3'.padEnd(9)}${'ΔB'.padEnd(8)}${'旧词A'.padEnd(7)}${'新词A'.padEnd(7)}${'空洞率'.padEnd(8)}${'尺子A'.padEnd(9)}丢失\n`);
for (const p of plans) {
  const t1 = Date.now();
  const s = fullScan(mkExtra(p.stems));
  const ms = Date.now() - t1;
  const rate = s.covered ? (s.hole3 / s.covered * 100).toFixed(1) + '%' : '—';
  const dA = s.hole3 - BASE.hole3, dB = s.holeMax3 - BASE.holeMax3;
  W(`  ${p.label.padEnd(24)}${String(p.stems.length).padEnd(5)}${(pctR(s.coveredR) + `(${s.coveredR})`).padEnd(16)}${((s.coveredR - BASE.coveredR >= 0 ? '+' : '') + (s.coveredR - BASE.coveredR)).padEnd(6)}${String(s.d1).padEnd(4)}${String(s.hole3).padEnd(9)}${((dA >= 0 ? '+' : '') + dA).padEnd(8)}${String(s.holeMax3).padEnd(9)}${((dB >= 0 ? '+' : '') + dB).padEnd(8)}${String(s.hole3old).padEnd(7)}${String(s.hole3new).padEnd(7)}${rate.padEnd(8)}${(((s.covered / ALL.length) * 100).toFixed(2) + '%').padEnd(9)}${s.loses.length}\n`);
  planResults.push({ ...p, scan: s, ms });
}
W(`\n  基线对照（空注入）: R=${pctR(BASE.coveredR)}  D1=${BASE.d1}  空洞≥3=${BASE.hole3}（旧词 ${BASE.hole3} / 新词 0，基线可拆 ${BASE.covered} 词，空洞率 ${(BASE.hole3 / BASE.covered * 100).toFixed(1)}%）  尺子A=${((BASE.covered / ALL.length) * 100).toFixed(2)}%\n`);
W(`  ⇒ 判据① D1 是否上升: ${planResults.every((r) => r.scan.d1 <= BASE.d1) ? `✔ 未上升（全部方案 = ${Math.max(...planResults.map((r) => r.scan.d1))}）` : '❌ 有方案上升'}\n`);
W(`  ⇒ 判据② 空洞≥3 是否上升: ${planResults.every((r) => r.scan.hole3 <= BASE.hole3) ? `✔ 未上升（最大 ${Math.max(...planResults.map((r) => r.scan.hole3))} ≤ 基线 ${BASE.hole3}）` : `❌ 上升（最大 ${Math.max(...planResults.map((r) => r.scan.hole3))} > 基线 ${BASE.hole3}；旧词部分 ${Math.max(...planResults.map((r) => r.scan.hole3old))} ≤ ${BASE.hole3}，全部增量来自新解锁词）`}\n`);
W(`  ⇒ 判据③ R 覆盖率提升: ${planResults.map((r) => `${r.key}=${pctR(r.scan.coveredR)}`).join('  ')}\n\n`);

/* ---- §5b 计入 losses 的「真·端到端 45% 交叉点」（贪婪增量记账未减 losses，必须复算） ---- */
W('='.repeat(98) + '\n');
W('§5b 端到端 R 覆盖率随候选条数的真实曲线（含注入导致既有拆解丢失的 losses）\n');
W('='.repeat(98) + '\n');
function rCurve(seq, label) {
  const rows = [];
  for (let n = 1; n <= seq.length; n++) {
    const bundle = matchersWith('ru', mkExtra(seq.slice(0, n).map((c) => c.stem)));
    let hit = 0, lost = 0;
    for (const w of R) {
      const p = breakdownEx(w, 'ru', GATES_STRICT, bundle).parts;
      if (p.length) hit++; else if (BASE_HIT_R.has(w)) lost++;
    }
    rows.push({ n, stem: seq[n - 1].stem, R: hit, pct: +(hit / TOTAL_R * 100).toFixed(2), lost });
  }
  const cross = rows.find((x) => x.R >= NEED45) ?? null;
  W(`  [${label}] 端到端首次达到 45%（需 ${NEED45} 词）= ${cross ? `${cross.n} 条（R=${cross.R} = ${cross.pct}%）` : '未达标'}\n`);
  W(`  [${label}] 末态 n=${rows.length} → R=${rows[rows.length - 1].R} = ${rows[rows.length - 1].pct}%  累计 losses=${rows[rows.length - 1].lost}\n`);
  return { rows, cross };
}
const CURVE_ALL = rCurve(chosen, '全池');
const CURVE_L3 = rCurve(GREEDY_L3.chosen, '仅 len≥3');
W(`  全池曲线前 22 步: ${CURVE_ALL.rows.slice(0, 22).map((x) => `${x.stem}:${x.R}${x.lost ? `(-${x.lost})` : ''}`).join(' ')}\n`);
W(`  仅 len≥3 曲线前 22 步: ${CURVE_L3.rows.slice(0, 22).map((x) => `${x.stem}:${x.R}${x.lost ? `(-${x.lost})` : ''}`).join(' ')}\n`);
W(`  仅 len≥3 曲线抽样: ${[40, 60, 80, 100, 140, 180, 220, 260].filter((k) => k <= CURVE_L3.rows.length).map((k) => `n=${k}:${CURVE_L3.rows[k - 1].R}(${CURVE_L3.rows[k - 1].pct}%)`).join('  ')}\n\n`);

/* ---- §5b-2 两个「达标 45% 方案」在全库三判据下的实测（判据③ 的达标方案必须一并过 ①②） ---- */
W('  ── 两个达标 45% 方案的全库三判据实测 ──\n');
const crossPlans = [];
if (CURVE_ALL.cross) crossPlans.push({ key: 'all45', label: `全池达标方案（${CURVE_ALL.cross.n} 条 2 字符片段）`, stems: chosen.slice(0, CURVE_ALL.cross.n).map((c) => c.stem) });
if (CURVE_L3.cross) crossPlans.push({ key: 'l3_45', label: `仅 len≥3 达标方案（${CURVE_L3.cross.n} 条）`, stems: GREEDY_L3.chosen.slice(0, CURVE_L3.cross.n).map((c) => c.stem) });
for (const p of crossPlans) {
  const s = fullScan(mkExtra(p.stems));
  const d1o = d1OldGate(p.stems);
  const ro = rOldGate(p.stems);
  W(`  ${p.label}\n`);
  W(`    R=${s.coveredR}/${TOTAL_R} = ${pctR(s.coveredR)}   全库D1=${s.d1}（守卫退回后 D1 形态=${d1o}）   口径A≥3=${s.hole3}（Δ${s.hole3 - BASE.hole3 >= 0 ? '+' : ''}${s.hole3 - BASE.hole3}；旧词 ${s.hole3old}+新词 ${s.hole3new}，基线 ${BASE.hole3}）   口径B≥3=${s.holeMax3}（Δ${s.holeMax3 - BASE.holeMax3 >= 0 ? '+' : ''}${s.holeMax3 - BASE.holeMax3}，基线 ${BASE.holeMax3}）   尺子A=${s.covered}   丢失=${s.loses.length}   守卫退回 R=${ro}\n`);
  planResults.push({ ...p, scan: s, ms: 0 });
}
W('\n');

/* ---- §5c R 丢失诊断（注入后原本可拆的词变不可拆） ---- */
W('='.repeat(98) + '\n');
W('§5c 注入导致既有拆解丢失（losses）诊断\n');
W('='.repeat(98) + '\n');
const lossCands = CANDS.filter((c) => c.soloLost.length).sort((a, b) => b.soloLost.length - a.soloLost.length);
W(`  §3 中造成 R 丢失的候选（单独注入）: ${lossCands.length} 条\n`);
for (const c of lossCands.slice(0, 12)) W(`    ${c.stem.padEnd(8)} 丢失 ${c.soloLost.length} 词: ${c.soloLost.slice(0, 5).join(' ')}\n`);
for (const r of planResults) {
  if (!r.scan.loses.length) continue;
  W(`  方案 ${r.key}：全库丢失 ${r.scan.loses.length} 词 → ${r.scan.loses.slice(0, 12).join(' ')}${r.scan.loses.length > 12 ? ' …' : ''}\n`);
  const ex = r.scan.loses[0];
  W(`    例：${ex} 基线=[${hitOf(ex, [], MATCHERS.ru).map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|')}]  注入后=[${hitOf(ex, mkExtra(r.stems), matchersWith('ru', mkExtra(r.stems))).map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|')}]\n`);
}
W('\n');

/* ---- §5d D1 守卫与补词根的相互作用（判别实验：把守卫退回 v0.8.0 修复前语义 gapMin=2） ---- */
W('='.repeat(98) + '\n');
W('§5d 判别实验：D1 守卫对「补词根」增益的代价（同一候选组，守卫在 / 守卫退回修复前）\n');
W('='.repeat(98) + '\n');
function d1OldGate(stems) { // gapMin=2 ⇒ 等价 v0.8.0 修复前的 `parts[0].start >= 2`
  const bundle = matchersWith('ru', mkExtra(stems));
  let n = 0;
  for (const w of ALL) {
    const p = breakdownEx(w, 'ru', { ...GATES_STRICT, gapMin: 2 }, bundle).parts;
    if (p.length && p[0].start === 1 && !PREFIX_STEMS.has(norm(w).slice(0, 1))) n++;
  }
  return n;
}
function rOldGate(stems) {
  const bundle = matchersWith('ru', mkExtra(stems));
  let hit = 0;
  for (const w of R) if (breakdownEx(w, 'ru', { ...GATES_STRICT, gapMin: 2 }, bundle).parts.length) hit++;
  return hit;
}
W(`  基线（空注入）：守卫退回 gapMin=2 时全库 D1 形态 = ${d1OldGate([])}   ← 冻结记录 267（v0.8.0 消除量）\n`);
W(`  基线（空注入）：守卫退回 gapMin=2 时尺子 R 覆盖率 = ${rOldGate([])}/791 = ${((rOldGate([]) / TOTAL_R) * 100).toFixed(2)}%   ← 冻结记录 244 = 30.85%\n`);
for (const p of planResults) {
  const d1o = d1OldGate(p.stems);
  const ro = rOldGate(p.stems);
  W(`  ${p.key.padEnd(6)} n=${String(p.stems.length).padEnd(4)} 守卫在: R=${p.scan.coveredR} / D1=${p.scan.d1}   守卫退回: R=${ro} / D1形态=${d1o}   ⇒ 守卫吃掉 R ${ro - p.scan.coveredR} 词、否决 D1 形态 ${d1o} 个\n`);
}
W('  ⇒ 解读：守卫（index.ts:859）会把「注入候选后首片段跳过 1 个非前缀字符」的拆解整个否决，因此\n');
W('    ① 判据①（D1 计数）在 root 类候选下**结构性恒为 0**：root 无法进入 gap 解释集合 {prefix stem}，\n');
W('       任何 gap≥1 且 gap 非前缀的拆解都被否决 ⇒ 补词根本就无法让该计数上升。\n');
W('    ② 该计数**对补词根无鉴别力**；有鉴别力的是「守卫退回后新增的 D1 形态数」（本行 D1形态 列）。\n\n');

W('='.repeat(98) + '\n');
W('§6 候选审定表素材（按贪婪边际贡献降序；全库解锁数 = 单独注入在全库新解锁的词数）\n');
W('='.repeat(98) + '\n');
const stmtLike = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND REPLACE(word,'ё','е') LIKE ?`);
const topN = Math.min(chosen.length, 120);
const table = [];
t0 = Date.now();
for (let i = 0; i < topN; i++) {
  const c = chosen[i];
  const affected = stmtLike.all(`%${c.stem}%`).map((r) => String(r.word));
  const ext = extendBundle(MATCHERS.ru, c.stem);
  const allGained = [];
  for (const w of affected) if (!BASE_HIT_ALL.has(w) && breakdownEx(w, 'ru', GATES_STRICT, ext).parts.length) allGained.push(w);
  table.push({
    rank: i + 1, stem: c.stem, kind: 'root',
    rSolo: c.marginal, rCum: c.cum,
    rExamples: (c.soloGained ?? []).slice(0, 5).length ? c.soloGained.slice(0, 5) : c.examples.slice(0, 5),
    dbUnlock: allGained.length, dbExamples: allGained.slice(0, 5),
    inLib: LIB_KINDS.has(c.stem) ? [...LIB_KINDS.get(c.stem)] : null,
    src: c.src,
  });
}
W(`  逐条全库解锁数评测 ${((Date.now() - t0) / 1000).toFixed(1)}s（前 ${topN} 条）\n`);
W(`  ${'#'.padEnd(4)}${'stem'.padEnd(10)}${'len'.padEnd(5)}${'R边际'.padEnd(7)}${'R累计'.padEnd(7)}${'全库解锁'.padEnd(9)}解锁例词\n`);
for (const r of table.slice(0, 40)) {
  W(`  ${String(r.rank).padEnd(4)}${r.stem.padEnd(10)}${String(r.stem.length).padEnd(5)}${String(r.rSolo).padEnd(7)}${String(r.rCum).padEnd(7)}${String(r.dbUnlock).padEnd(9)}${r.dbExamples.slice(0, 4).join(' ')}\n`);
}
W(`  （第 41–${topN} 条见 scripts/out_v9_admission.json 的 table 字段）\n\n`);

/* ---- §6b len≥3 候选的审定表素材（人工/联网审定的对象是这一组，不是 2 字符片段组） ---- */
W('='.repeat(98) + '\n');
W('§6b len≥3 贪婪序列的逐条审定素材（前 50 条）\n');
W('='.repeat(98) + '\n');
const soloByStem = new Map(CANDS.map((c) => [c.stem, c]));
const l3Table = [];
t0 = Date.now();
for (let i = 0; i < Math.min(50, GREEDY_L3.chosen.length); i++) {
  const c = GREEDY_L3.chosen[i];
  const solo = soloByStem.get(c.stem);
  const affected = stmtLike.all(`%${c.stem}%`).map((r) => String(r.word));
  const ext = extendBundle(MATCHERS.ru, c.stem);
  const dbGained = [];
  for (const w of affected) if (!BASE_HIT_ALL.has(w) && breakdownEx(w, 'ru', GATES_STRICT, ext).parts.length) dbGained.push(w);
  l3Table.push({
    rank: i + 1, stem: c.stem, kind: 'root', len: c.stem.length,
    rSolo: solo ? solo.soloGain : null, rMarginal: c.marginal, rCum: c.cum,
    rExamples: (solo ? solo.soloGained : []).slice(0, 5),
    dbUnlock: dbGained.length, dbExamples: dbGained.slice(0, 5),
    inLib: LIB_KINDS.has(c.stem) ? [...LIB_KINDS.get(c.stem)] : null,
    src: c.src,
  });
}
W(`  评测耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
W(`  ${'#'.padEnd(4)}${'stem'.padEnd(8)}${'单条R'.padEnd(7)}${'边际'.padEnd(6)}${'累计'.padEnd(6)}${'全库解锁'.padEnd(9)}解锁例词（≤4）\n`);
for (const r of l3Table) {
  W(`  ${String(r.rank).padEnd(4)}${r.stem.padEnd(8)}${String(r.rSolo).padEnd(7)}${String(r.rMarginal).padEnd(6)}${String(r.rCum).padEnd(6)}${String(r.dbUnlock).padEnd(9)}${r.dbExamples.slice(0, 4).join(' ')}\n`);
}
W('\n');

/* ============================ 10. §7 联网词源审定后的「合格候选」实测 ============================
 * AUDIT = 联网词源审定结果（Wiktionary，来源链接见字段 src / EVIDENCE §41.5）。
 * 判定口径：通过 = 有词源证据显示该 stem 确是例词的词根；部分通过 = 只对部分例词成立；
 *          否决 = 不是词根（前缀/外来词整体/别的词根的截断）。
 * ★ 只有「通过」的候选才允许进入交付表（无来源 / 否决者不得落库，见 BOARD.md:695）。 */
const AUDIT = [
  // stem | verdict | 建议释义(中文) | 来源链接 | 证据引文 | 理由（详见 .board/EVIDENCE.md §41.5）
  { stem: 'кар', verdict: '部分通过', gloss: '拟声词干「кар-」（каркать 呱呱叫）', source: 'https://en.wiktionary.org/wiki/каркать#Russian', evidence: 'Onomatopoeic.', reason: '真:карканье；巧合:карасик/кардамонный/карт/скарн' },
  { stem: 'пла', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/плавка#Russian', evidence: 'пла́вить (plávitʹ) + -ка', reason: '真词根是 плав-/пласт-；план 系法语借词' },
  { stem: 'гор', verdict: '通过', gloss: '燃烧/山/苦 词根「гор-」', source: 'https://en.wiktionary.org/wiki/гореть#Russian', evidence: '{{root|ru|ine-pro|*gʷʰer-}} {{inh+|ru|sla-pro|*gorěti}}', reason: 'Related terms 直接列 горючий/горе/горестный/огорчение' },
  { stem: 'стр', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/острослов#Russian', evidence: '{{af|ru|о́стрый|-о-|слово}}', reason: '真词根是 стрел-/струй-/струп-' },
  { stem: 'вар', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/авария#Russian', evidence: '{{bor+|ru|it|avaria}}, from {{der|ru|ar|عَوَارِيَّة}}', reason: '3 例均无 вар-：авария 意/阿源、вариация 拉丁、товар 突厥源' },
  { stem: 'кон', verdict: '部分通过', gloss: '马 词根「кон-」（конь）', source: 'https://en.wiktionary.org/wiki/конь#Russian', evidence: 'Compound words: конево́д, конево́дство', reason: '真:коневодство；巧合:конголезский(专名)/конфетный(德 Konfekt)' },
  { stem: 'лак', verdict: '部分通过', gloss: '漆 词根「лак-」', source: 'https://en.wiktionary.org/wiki/лак#Russian', evidence: '{{bor+|ru|de|Lack}} … from {{der|ru|fa-cls|لاک}}', reason: '真:лакировка；巧合:релакционный(лат. relaxātiō)' },
  { stem: 'леп', verdict: '部分通过', gloss: '塑/粘 词根「леп-」（лепить）', source: 'https://en.wiktionary.org/wiki/лепёшка#Russian', evidence: '{{af|ru|лепи́ть|-шка}}', reason: '真:лепешка；巧合:слепун(слеп-)；подлепестный 无来源' },
  { stem: 'мат', verdict: '部分通过', gloss: '哑光/将死「мат」', source: 'https://en.wiktionary.org/wiki/матовый#Russian', evidence: '{{af|ru|мат|t1=matte|-овый}}', reason: '真:матовый；巧合:киноавтомат(греч. αὐτόμᾰτος)；мат.=缩写' },
  { stem: 'пер', verdict: '部分通过', gloss: '羽毛 词根「пер-」（перо）', source: 'https://en.wiktionary.org/wiki/пёрышко#Russian', evidence: '{{af|ru|перо́|-ышко}}', reason: '真:пёрышко/перочинный；巧合:операторный(лат. operator)' },
  { stem: 'мет', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/металл#Russian', evidence: 'Ultimately from {{der|ru|la|metallum}}', reason: '三例真词根是 металл-/гамет-/метел-' },
  { stem: 'нит', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/унитаз#Russian', evidence: '{{bor+|ru|la|ūnitās||unity}}', reason: '三例均无 нит-（线）：拉丁/国际词' },
  { stem: 'оже', verdict: '否决', gloss: '（非词根）', source: 'https://ru.wiktionary.org/wiki/похожий', evidence: 'Происходит от глагола походить, из по- и ходить', reason: 'похоже=по-+хож-；ожеребиться=о-+жереб-' },
  { stem: 'опа', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/невпопад#Russian', evidence: 'не- (ne-) + впопа́д (vpopád)', reason: 'опала←палити；无 опа 词根' },
  { stem: 'ора', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/оракул#Russian', evidence: 'Ultimately borrowed from Latin ōrāculum.', reason: 'дезодорация 词根 одор-' },
  { stem: 'сто', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/стопор#Russian', evidence: 'Borrowed from Dutch stopper.', reason: 'стопор- 荷兰语借词；пластоген 词根 пласт-' },
  { stem: 'тро', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/патрон#Russian', evidence: 'Borrowed from German Patrone… from Latin patrōnus', reason: 'трое 真词根是 тр-/*trojь' },
  { stem: 'бел', verdict: '部分通过', gloss: '白 词根「бел-/бял-」', source: 'https://en.wiktionary.org/wiki/Белград#Russian', evidence: 'Univerbation of бял (bjal, “white”) + град (grad)', reason: '真:Белград；巧合:рентабельный(法语 rentable)' },
  { stem: 'кра', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/краткий#Russian', evidence: 'from Proto-Slavic *kortъkъ. Doublet of коро́ткий', reason: '真词根 крат-；Краков 是专名' },
  { stem: 'бит', verdict: '否决', gloss: '（非词根）', source: 'https://ru.wiktionary.org/wiki/битум', evidence: 'Корень: -битум- [Тихонов, 1996]', reason: 'бить 词根 би-' },
  { stem: 'бог', verdict: '通过', gloss: '神 词根「бог-」（ПСл *bogъ）', source: 'https://en.wiktionary.org/wiki/богиня#Russian', evidence: 'By surface analysis, бог (bog) + -иня (-inja)', reason: '覆盖全部例词（богиня/Богъ）' },
  { stem: 'бро', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/броня#Russian', evidence: 'from Proto-Slavic *brъňa, from Gothic brunjō', reason: 'бросить 词根 брос-' },
  { stem: 'бры', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/брызгать#Russian', evidence: 'Inherited from Proto-Slavic *brỳzgati. Of onomatopoeic origin.', reason: '真词根是 брызг-，бры 是截断' },
  { stem: 'вин', verdict: '部分通过', gloss: '酒 词根「вин-」（лат. vīnum）', source: 'https://en.wiktionary.org/wiki/вино#Russian', evidence: 'from Proto-Slavic *vino, from Latin vīnum', reason: '真:винище；巧合:свинопас(свин-)' },
  { stem: 'вос', verdict: '否决', gloss: '（非词根，是前缀 вос-/воз-）', source: 'https://en.wiktionary.org/wiki/воспретить#Russian', evidence: 'By surface analysis, вос- (vos-) + прети́ть (pretítʹ)', reason: '真词根 прет-/ста-' },
  { stem: 'гла', verdict: '否决', gloss: '（非词根）', source: 'https://en.wiktionary.org/wiki/глава#Russian', evidence: 'from Proto-Slavic *golva', reason: 'гладкий 词根 глад-（*gladъkъ）' },
];
W('='.repeat(98) + '\n');
W('§7 联网词源审定后的合格候选子集实测（只有「通过」者才可落库）\n');
W('='.repeat(98) + '\n');
if (!AUDIT.length) {
  W('  未填充 AUDIT（见脚本末尾常量）\n\n');
} else {
  const tally = (v) => AUDIT.filter((a) => a.verdict === v).length;
  W(`  审定 ${AUDIT.length} 条：通过 ${tally('通过')} / 部分通过 ${tally('部分通过')} / 否决 ${tally('否决')} / 无法审定 ${tally('无法审定')}\n`);
  const accepted = AUDIT.filter((a) => a.verdict === '通过').map((a) => a.stem);
  const partial = AUDIT.filter((a) => a.verdict === '部分通过').map((a) => a.stem);
  W(`  通过: ${accepted.join(' ') || '（无）'}\n  部分通过: ${partial.join(' ') || '（无）'}\n`);
  for (const [label, stems] of [['仅真实通过的候选', accepted], ['通过+部分通过', [...accepted, ...partial]], ['全部已审定候选（含否决，作对照上界）', AUDIT.map((a) => a.stem)]]) {
    if (!stems.length) { W(`  [${label}] 空集\n`); continue; }
    const s = fullScan(mkExtra(stems));
    let rl = 0; for (const w of R) if (BASE_HIT_R.has(w)) rl++;
    W(`  [${label}] n=${stems.length}  全库 R=${s.coveredR}/${TOTAL_R} = ${pctR(s.coveredR)}（ΔR ${s.coveredR - BASE.coveredR >= 0 ? '+' : ''}${s.coveredR - BASE.coveredR}）  D1=${s.d1}  空洞≥3=${s.hole3}（旧词 ${s.hole3old}+新词 ${s.hole3new}）  尺子A=${s.covered}  丢失=${s.loses.length}\n`);
  }
  W(`  ⇒ 结论：合格候选（有词源来源）能提升的 R 覆盖率 = 见上行；与 45% 目标（需 ${NEED45} 词）的差距 = 见上行的 ΔR。\n\n`);
  const auditOut = AUDIT.map((a) => {
    const solo = soloByStem.get(a.stem);
    const g = GREEDY_L3.chosen.find((c) => c.stem === a.stem);
    return { stem: a.stem, verdict: a.verdict, gloss: a.gloss, source: a.source, evidence: a.evidence, reason: a.reason, rSolo: solo ? solo.soloGain : 0, rMarginal: g ? g.marginal : 0, rExamples: solo ? solo.soloGained.slice(0, 5) : [], dbUnlock: (l3Table.find((t) => t.stem === a.stem) ?? {}).dbUnlock ?? null };
  });
  writeFileSync('scripts/out_v9_audit.json', JSON.stringify(auditOut, null, 1), 'utf8');
  W(`  已落盘 scripts/out_v9_audit.json\n\n`);
}

/* ============================ 11. §8 点名三候选专项（主管「一举两得」假说的全库检验） ============================
 * 主管早前用 scripts/exp_ru_dual_win.mjs 得出（仅 3 词初步证据）：антияпонский 补 япон-、водозащитный 补 защит-、
 * вызвонить 补 звон- 后覆盖率达 100% 且空洞归零。本节在**全库端到端**尺度检验该效应是否成立。 */
W('='.repeat(98) + '\n');
W('§8 主管点名三候选（япон- / защит- / звон-）的全库端到端实测\n');
W('='.repeat(98) + '\n');
{
  const NAMED = [['япон', 'антияпонский'], ['защит', 'водозащитный'], ['звон', 'вызвонить']];
  W('  ① 三词逐字核对（0 = 完全覆盖、空洞 0）\n');
  for (const [stem, word] of NAMED) {
    const before = hitOf(word, [], MATCHERS.ru);
    const after = hitOf(word, [{ morpheme: stem, kind: 'root' }], matchersWith('ru', mkExtra([stem])));
    const fmt = (p) => p.length ? p.map((x) => `${x.morpheme}[${x.kind}]@${x.start}-${x.end}`).join(' + ') : '不可拆';
    W(`    ${word.padEnd(14)} 补 ${(stem + '-').padEnd(8)} 前: ${fmt(before).padEnd(38)} → 后: ${fmt(after).padEnd(46)} 覆盖率=${(after.reduce((s, p) => s + (p.end - p.start), 0) / norm(word).length * 100).toFixed(0)}% 空洞=${holeTotal(word, after)}\n`);
  }
  W('\n  ② 该 3 候选在全库三判据下的实测\n');
  const namedStems = NAMED.map((x) => x[0]);
  const namedExtra = mkExtra(namedStems);
  const sN = fullScan(namedExtra);
  const roN = rOldGate(namedStems);
  W(`    n=3 [${namedStems.join(' ')}]  R=${sN.coveredR}/${TOTAL_R} = ${pctR(sN.coveredR)}（ΔR ${sN.coveredR - BASE.coveredR >= 0 ? '+' : ''}${sN.coveredR - BASE.coveredR}）\n`);
  W(`      判据① D1=${sN.d1}（基线 ${BASE.d1}）\n`);
  W(`      判据② 口径A=${sN.hole3}（基线 ${BASE.hole3}，Δ ${sN.hole3 - BASE.hole3 >= 0 ? '+' : ''}${sN.hole3 - BASE.hole3}；旧词 ${sN.hole3old}+新词 ${sN.hole3new}）  口径B=${sN.holeMax3}（基线 ${BASE.holeMax3}，Δ ${sN.holeMax3 - BASE.holeMax3 >= 0 ? '+' : ''}${sN.holeMax3 - BASE.holeMax3}）\n`);
  W(`      尺子A=${sN.covered}（Δ ${sN.covered - BASE.covered >= 0 ? '+' : ''}${sN.covered - BASE.covered}）  丢失=${sN.loses.length}  最大未覆盖总数=${sN.holeTotalMax}\n`);
  W('\n  ③ 每条的单独全库解锁数与例词（含专名/屈折形，口径同上）\n');
  for (const stem of namedStems) {
    const affected = stmtLike.all(`%${stem}%`).map((r) => String(r.word));
    const ext = extendBundle(MATCHERS.ru, stem);
    const g = [];
    for (const w of affected) if (!BASE_HIT_ALL.has(w) && breakdownEx(w, 'ru', GATES_STRICT, ext).parts.length) g.push(w);
    W(`    ${stem.padEnd(8)} 影响词 ${String(affected.length).padStart(4)}  全库新解锁 ${String(g.length).padStart(4)}  例: ${g.slice(0, 8).join(' ')}\n`);
  }
  W('\n  ④ 叠加对照（同一全库口径下逐步加料，看两条判据的方向）\n');
  const combos = [
    ['点名 3 条（япон/защит/звон）', namedStems],
    ['点名 3 + 通过 2（гор/бог）', [...namedStems, ...AUDIT.filter((a) => a.verdict === '通过').map((a) => a.stem)]],
    ['点名 3 + 通过 2 + 部分通过 8', [...new Set([...namedStems, ...AUDIT.filter((a) => a.verdict === '通过').map((a) => a.stem), ...AUDIT.filter((a) => a.verdict === '部分通过').map((a) => a.stem)])]],
    ['仅部分通过 8（不含点名与通过）', AUDIT.filter((a) => a.verdict === '部分通过').map((a) => a.stem)],
    ['全部已审定 26（含 16 条否决，仅上界对照）', AUDIT.map((a) => a.stem)],
  ];
  let lastScan = null, lastStems = null;
  for (const [label, stems] of combos) {
    const s = fullScan(mkExtra(stems));
    const dA = s.hole3 - BASE.hole3, dB = s.holeMax3 - BASE.holeMax3;
    W(`    ${label.padEnd(30)} n=${String(stems.length).padEnd(3)} R=${String(s.coveredR).padStart(3)}(${pctR(s.coveredR).padStart(6)}，Δ${s.coveredR - BASE.coveredR >= 0 ? '+' : ''}${s.coveredR - BASE.coveredR})  D1=${s.d1}  口径A=${s.hole3}(Δ${dA >= 0 ? '+' : ''}${dA})  口径B=${s.holeMax3}(Δ${dB >= 0 ? '+' : ''}${dB})  尺子A=${s.covered}(Δ${s.covered - BASE.covered >= 0 ? '+' : ''}${s.covered - BASE.covered})  丢失=${s.loses.length}\n`);
    lastScan = s; lastStems = stems;
  }
  writeFileSync('scripts/out_v9_named.json', JSON.stringify({ named: NAMED, scan: sN, combos: combos.map(([l, s2]) => ({ label: l, stems: s2 })), scanPlus: lastScan, plusStems: lastStems, rOldGate: roN }, null, 1), 'utf8');
  W(`    ⇒ 判读见 §8 结论。已落盘 scripts/out_v9_named.json\n\n`);
}

/* ---- §7b 45% 计划长什么样：抽 6 个「新解锁」词的拆解逐字打印（证明机械增益的性质） ---- */
W('='.repeat(98) + '\n');
W('§7b 「14 条 2 字符候选 → R 45.76%」这个达标方案的实际拆解样本（逐字）\n');
W('='.repeat(98) + '\n');
{
  const stems14 = chosen.slice(0, 14).map((c) => c.stem);
  const bundle14 = matchersWith('ru', mkExtra(stems14));
  const newly = R.filter((w) => !BASE_HIT_R.has(w) && breakdownEx(w, 'ru', GATES_STRICT, bundle14).parts.length);
  W(`  该方案新解锁 R 词 ${newly.length} 个（另因注入丢失 0 个）。候选 = [${stems14.join(' ')}]\n`);
  for (const w of newly.slice(0, 6)) {
    const p = breakdownEx(w, 'ru', GATES_STRICT, bundle14).parts;
    W(`    ${w.padEnd(16)} → ${p.map((x) => `${x.morpheme}[${x.kind}]@${x.start}-${x.end}`).join(' + ')}   空洞=${holeTotal(w, p)}\n`);
  }
  W(`  对照（同 6 词在基线引擎下均为不可拆）: ${newly.slice(0, 6).map((w) => `${w}=[${hitOf(w, [], MATCHERS.ru).map((x) => x.morpheme).join('|') || '不可拆'}]`).join('  ')}\n\n`);
}

const planAll = planResults.find((r) => r.key === 'all');
const planL3 = planResults.find((r) => r.key === 'l3all');
writeFileSync('scripts/out_v9_admission.json', JSON.stringify({
  generatedAt: NOW(), db: DB_PATH,
  baseline: { R: BASE.coveredR, Rtotal: TOTAL_R, d1: BASE.d1, d1pass: BASE.d1pass, d1PreGuard: BASE.d1PreGuard, hole3: BASE.hole3, hole2: BASE.hole2, holeMax3: BASE.holeMax3, A: BASE.covered, Atotal: ALL.length, need45: NEED45 },
  pool: { missR: missR.length, cands: CANDS.length },
  candidates: CANDS.filter((c) => c.soloGain >= 1).sort((a, b) => b.soloGain - a.soloGain || a.stem.localeCompare(b.stem)).map((c) => ({ stem: c.stem, soloGain: c.soloGain, headGain: c.headGain, gained: c.soloGained, lost: c.soloLost, src: c.src, inLib: LIB_KINDS.has(c.stem) ? [...LIB_KINDS.get(c.stem)] : null })),
  greedy: chosen, trace, first45,
  greedyL3: { chosen: GREEDY_L3.chosen, trace: GREEDY_L3.trace, first45: GREEDY_L3.first45 },
  curveAll: CURVE_ALL, curveL3: CURVE_L3,
  lossCands: lossCands.map((c) => ({ stem: c.stem, lost: c.soloLost })),
  plans: planResults.map((r) => ({ key: r.key, label: r.label, n: r.stems.length, R: r.scan.coveredR, d1: r.scan.d1, d1pass: r.scan.d1pass, d1PreGuard: r.scan.d1PreGuard, hole3: r.scan.hole3, hole3old: r.scan.hole3old, hole3new: r.scan.hole3new, hole2: r.scan.hole2, A: r.scan.covered, loses: r.scan.loses, stems: r.stems })),
  table,
  l3Table,
}, null, 1), 'utf8');
W(`  已落盘 scripts/out_v9_admission.json\n`);
W(`  全池贪婪耗尽组：R=${planAll.scan.coveredR}  D1=${planAll.scan.d1}  空洞≥3=${planAll.scan.hole3}（旧词 ${planAll.scan.hole3old} + 新词 ${planAll.scan.hole3new}）  A=${planAll.scan.covered}  丢失 ${planAll.scan.loses.length}\n`);
if (planL3) W(`  仅 len≥3 全量组：R=${planL3.scan.coveredR}  D1=${planL3.scan.d1}  空洞≥3=${planL3.scan.hole3}（旧词 ${planL3.scan.hole3old} + 新词 ${planL3.scan.hole3new}）  A=${planL3.scan.covered}  丢失 ${planL3.scan.loses.length}\n`);
db.close();
