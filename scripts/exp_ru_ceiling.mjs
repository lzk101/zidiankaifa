/**
 * A2 判别实验 —— 尺子 R 的「可拆解天花板」量化（只读：不改库、不改 src/、不改 test/）
 *
 * 题目：把俄语词根词缀拆解覆盖率从 30.8% 提到 >45%（尺子 R）。
 * 本脚本不调参、不加词素，只做判别。方法：把 packages/core/src/db/index.ts 的 breakdownWord
 * **逐条复刻**到本脚本（只读复制，源文件不动），并加 opts 逐级放宽规则/门槛，用「同一批 791 词」
 * 量出各级天花板。复刻保真度由脚本内自检保证（默认开关下必须与官方 100% 一致）。
 *
 * 用法：node scripts/exp_ru_ceiling.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const DB_PATH = 'data/db/dict.db';
const db = new DatabaseSync(DB_PATH);
const MIN_COVERAGE = 0.55; // = packages/core/src/db/index.ts:709 BREAKDOWN_MIN_COVERAGE

const R = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));
const TOTAL = R.length;
const NEED45 = Math.ceil(0.45 * TOTAL);
const pct = (x) => `${((x / TOTAL) * 100).toFixed(2)}%`;

/* ===================== 1. 复刻 breakdownWord（带开关） ===================== */
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);

const ROW_CACHE = new Map();
function libRows(lang) {
  let r = ROW_CACHE.get(lang);
  if (!r) {
    r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?').all(lang);
    ROW_CACHE.set(lang, r);
  }
  return r;
}

function buildMatchers(lang, extra = []) {
  const rows = libRows(lang);
  const list = rows.map((r) => ({
    morpheme: String(r.morpheme),
    kind: String(r.kind),
    meaningZh: r.meaning_zh ?? '',
    origin: r.origin ?? null,
  }));
  for (const x of extra) list.push({ morpheme: x.morpheme, kind: x.kind, meaningZh: x.meaningZh ?? '', origin: null });
  const isRu = lang === 'ru';
  const all = list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/ё/g, 'е') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
      const core = stem.slice(0, -1);
      if (core.length >= 3) patterns.push({ pat: core, core: true });
    }
    return { m, stem, patterns };
  });
  return { all, isRu };
}
const MATCHERS = { ru: buildMatchers('ru'), en: buildMatchers('en') };
/** 带候选词素的匹配器缓存（键 = 候选签名），避免重复建索引 */
const MATCHER_CACHE = new Map();
function sigOf(extra) {
  return extra.map((x) => `${x.kind}:${x.morpheme}`).sort().join(',');
}
function matchersWith(lang, extra) {
  if (!extra.length) return MATCHERS[lang];
  const key = `${lang}|${sigOf(extra)}`;
  let m = MATCHER_CACHE.get(key);
  if (!m) { m = buildMatchers(lang, extra); MATCHER_CACHE.set(key, m); }
  return m;
}

const GATES_STRICT = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true };

function breakdownEx(word, lang, gates, extra = [], bundle = null) {
  const g = { ...GATES_STRICT, ...gates };
  const { all, isRu } = bundle ?? matchersWith(lang, extra);
  const w = word.trim().toLowerCase();
  if (w.length < 2) return { parts: [], coverage: 0 };
  const mw = isRu ? w.replace(/ё/g, 'е') : w;

  const byFirst = new Map();
  for (const e of all) for (const { pat } of e.patterns) {
    const c = pat[0];
    let arr = byFirst.get(c); if (!arr) { arr = []; byFirst.set(c, arr); } arr.push(e);
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
        // 单字符前缀支撑规则。oneCharPreMode 用于判别实验：
        //   strict(现行 startsWith) / includes(历史失败的放宽版) / consonant(裸辅音前缀后须辅音起首) / consAny
        const rest = mw.slice(pos + 1);
        const CONS = /[бвгджзйклмнпрстфхцчшщ]/;
        const mode = g.oneCharPreMode ?? 'strict';
        let ok;
        if (mode === 'includes') ok = all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.includes(x.stem));
        else if (mode === 'consonant') ok = CONS.test(rest[0] ?? '') && all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.includes(x.stem));
        else if (mode === 'consAny') ok = CONS.test(rest[0] ?? '');
        else ok = all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem));
        if (!ok) continue;
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
      const cov = c.end - c.start + covered[c.end], pc = 1 + pieces[c.end];
      if (cov > bestCov || (cov === bestCov && (pc < bestPieces || (pc === bestPieces && rankOf(c.m) < rankOf(bestM))))) {
        bestCov = cov; bestPieces = pc; bestTo = c.end; bestEnd = c.end; bestM = c.m;
      }
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
  if (g.threshold && coverage < (g.minCov ?? MIN_COVERAGE)) return { parts: [], coverage };
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return { parts: [], coverage };
  if (g.leadGapStrict && parts.length && parts[0].start === 1) return { parts: [], coverage }; // 「直接禁止 gap=1」对照变体
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 2)) {
    const gap = mw.slice(0, parts[0].start);
    if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return { parts: [], coverage };
  }
  return { parts: parts.sort((a, b) => a.start - b.start), coverage };
}

/* 自检：默认开关下与官方完全一致（全 791 词，不是抽样） */
{
  let bad = 0; const ex = [];
  for (const w of R) {
    const a = core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}:${p.start}-${p.end}`).join('|');
    const b = breakdownEx(w, 'ru', GATES_STRICT).parts.map((p) => `${p.morpheme}:${p.start}-${p.end}`).join('|');
    if (a !== b) { bad++; if (ex.length < 3) ex.push(`${w} off=[${a}] mine=[${b}]`); }
  }
  console.log(`【自检】复刻版 vs 官方 breakdownWord（全 ${TOTAL} 词）：不一致 ${bad} 例 ${bad ? '⚠ 中止\n' + ex.join('\n') : '✔'}`);
  if (bad) { db.close(); process.exit(1); }
}

/* ===================== 2. 现有 244 条拆解的「质量」 ===================== */
const official = new Map();
for (const w of R) {
  let p = []; try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  official.set(w, p);
}
const hitList = R.filter((w) => official.get(w).length);
const missList = R.filter((w) => !official.get(w).length);
const q1 = hitList.filter((w) => official.get(w).length === 1);
const q2 = hitList.filter((w) => official.get(w).length >= 2);
const qAffix = hitList.filter((w) => official.get(w).some((p) => p.kind === 'prefix' || p.kind === 'suffix'));
const qRootOnly = hitList.filter((w) => official.get(w).every((p) => p.kind === 'root'));
const qWhole = hitList.filter((w) => official.get(w).length === 1 && official.get(w)[0].start === 0 && official.get(w)[0].end === w.length);

console.log('\n' + '='.repeat(74));
console.log(`【质量】现有 ${hitList.length} 条「有拆解」的构成（尺子 R 只判「非空」，不判质量）`);
console.log('='.repeat(74));
console.log(`  仅 1 个片段                      : ${q1.length}  (${pct(q1.length)})`);
console.log(`  ≥2 个片段（真·多语素拆解）        : ${q2.length}  (${pct(q2.length)})`);
console.log(`  含至少一个前缀或后缀              : ${qAffix.length}  (${pct(qAffix.length)})`);
console.log(`  全是词根（无词缀）                : ${qRootOnly.length}  (${pct(qRootOnly.length)})`);
console.log(`  整词=单个已知词根（等于"登记为词根"）: ${qWhole.length}  (${pct(qWhole.length)})`);

/* ---- 244 条命中里，有多少靠「词中空洞」通过 0.55？（与测试 agent 的 D2 缺陷类呼应） ---- */
{
  const gapsOf = (w) => {
    const ps = official.get(w);
    const runs = [];
    let cur = 0;
    for (let i = 0; i < w.length; i++) {
      const inside = ps.some((p) => i >= p.start && i < p.end);
      if (inside) { if (cur > 0) { runs.push(['internal', cur]); cur = 0; } }
      else cur++;
    }
    if (cur > 0) runs.push(['tail', cur]);
    return runs;
  };
  let clean = 0, intraHole = 0, tailOnly = 0;
  const ex = [];
  for (const w of hitList) {
    const runs = gapsOf(w);
    const hasInternal = runs.some(([k, n]) => k === 'internal' && n >= 2);
    const hasTail = runs.some(([k, n]) => k === 'tail' && n >= 1);
    if (hasInternal) { intraHole++; if (ex.length < 25) ex.push(`${w}{${official.get(w).map((p) => p.morpheme).join('+')}}`); }
    else if (hasTail) tailOnly++;
    else clean++;
  }
  console.log(`\n  覆盖结构：无空洞（片段铺满全词）           : ${clean}`);
  console.log(`            仅词尾有未覆盖字符             : ${tailOnly}`);
  console.log(`            ★词中有 ≥2 字符空洞仍被判命中   : ${intraHole}  (${pct(intraHole)})  ← 测试 agent D2 缺陷类`);
  console.log(`              → ${ex.join(' ')}`);
}

/* ===================== 3. 逐词分类 + 锚定语素分析 ===================== */
const OLD = /[іѣѳѵ]/;
const isCap = (w) => { const c = w[0]; return c !== c.toLowerCase() && c === c.toUpperCase(); };
const isHyphen = (w) => w.startsWith('-') || w.endsWith('-');

/** 词素库索引 */
const RU = MATCHERS.ru.all;
const PRE = RU.filter((e) => e.m.kind === 'prefix' && e.stem.length >= 3).sort((a, b) => b.stem.length - a.stem.length);
const SUF = RU.filter((e) => e.m.kind === 'suffix' && e.stem.length >= 3).sort((a, b) => b.stem.length - a.stem.length);
const ROOTS = RU.filter((e) => e.m.kind === 'root');
const ALLSTEMS3 = [...new Set(RU.map((e) => e.stem))].filter((s) => s.length >= 3);

/** 词首锚定前缀（≥3 字符） */
function anchorPre(w) {
  const mw = w.toLowerCase().replace(/ё/g, 'е');
  for (const e of PRE) if (mw.startsWith(e.stem)) return { stem: e.stem, morpheme: e.morpheme };
  return null;
}
/** 词尾锚定后缀（≥3 字符；core 形态允许吸收 ≤3 个屈折词尾） */
function anchorSuf(w) {
  const mw = w.toLowerCase().replace(/ё/g, 'е');
  let best = null;
  for (const e of SUF) for (const { pat, core } of e.patterns) {
    if (pat.length < 3) continue;
    let p = -1;
    if (!core) { if (mw.endsWith(pat)) p = mw.length - pat.length; }
    else {
      for (let q = mw.length - pat.length; q >= 0 && mw.length - (q + pat.length) <= 3; q--) {
        if (mw.startsWith(pat, q)) { p = q; break; }
      }
    }
    if (p < 0) continue;
    const consumed = mw.length - p;
    if (!best || consumed > best.consumed) best = { morpheme: e.morpheme, pat, patLen: pat.length, start: p, consumed, core };
  }
  return best;
}
const substrHits = (w) => { const mw = w.toLowerCase().replace(/ё/g, 'е'); return ALLSTEMS3.filter((s) => mw.includes(s)); };

const stmtForm = db.prepare('SELECT word, tags FROM i18n_forms WHERE form = ? AND lang = ?');
const stmtMorph = db.prepare("SELECT 1 FROM morphemes WHERE lang='ru' AND REPLACE(REPLACE(morpheme,'-',''),'ё','е') = ?");

const rec = [];
for (const w of R) {
  const hit = official.get(w).length > 0;
  const relaxed = breakdownEx(w, 'ru', { threshold: false });

  let baseWord = null, baseParts = 0;
  const fr = stmtForm.get(w, 'ru') ?? stmtForm.get(w.toLowerCase(), 'ru');
  if (fr && String(fr.word) !== w) { baseWord = String(fr.word); try { baseParts = core.breakdownWord(db, baseWord, 'ru').length; } catch { baseParts = 0; } }

  const ap = anchorPre(w), as = anchorSuf(w);
  const bare = w.replace(/^-+|-+$/g, '').toLowerCase().replace(/ё/g, 'е');
  const isMorphemeItself = !!stmtMorph.get(bare);
  const cap = isCap(w), oldO = OLD.test(w) || w.endsWith('ъ') || w.endsWith('Ъ'), hy = isHyphen(w);

  // 中段（前后缀之间的未知部分）
  let mid = null;
  if (!hit && (ap || as)) {
    const mw = w.toLowerCase().replace(/ё/g, 'е');
    const preLen = ap ? ap.stem.length : 0;
    const sufStart = as ? as.start : mw.length;
    mid = mw.slice(preLen, Math.max(preLen, sufStart));
  }

  rec.push({ w, hit, coverage: relaxed.coverage, ap, as, mid, isMorphemeItself, cap, oldO, hy, baseWord, baseParts, substr: substrHits(w) });
}

const miss = rec.filter((r) => !r.hit);
const klass = (r) => {
  if (r.isMorphemeItself || r.hy) return 'affixOnly';
  if (r.oldO) return 'oldOrtho';
  if (r.cap && !r.as) return 'proper';
  if (r.baseParts > 0) return 'formMerge';
  if (r.coverage >= MIN_COVERAGE) return 'gatedOut';
  if (r.ap || r.as) return 'anchored';        // 含真实锚定语素，缺另一侧词素
  if (r.substr.length) return 'substrOnly';
  return 'singleRoot';
};
for (const r of miss) r.cls = klass(r);
const B = {};
for (const r of miss) (B[r.cls] ??= []).push(r);

const LAB = {
  affixOnly: '纯词缀条目/裸词素（本身不是词）',
  oldOrtho: '旧正字法形（і/ѣ/ѳ/ѵ/词尾 ъ）',
  proper: '专名/地理名（首字母大写且无词缀锚）',
  formMerge: '屈折形（主词条可拆，缺词形归并）',
  gatedOut: `覆盖率已 ≥${MIN_COVERAGE}，仅被附加规则挡掉（零成本可修）`,
  anchored: '含真实锚定前缀/后缀，缺另一侧词素（★真·可提升空间）',
  substrOnly: '仅含非锚定语素子串（基本是巧合）',
  singleRoot: '无任何已知词素 → 纯单词根词（原理不可拆）',
};

console.log('\n' + '='.repeat(74));
console.log(`尺子 R 逐词分类（分母 ${TOTAL}）`);
console.log('='.repeat(74));
console.log(`  ${'已有拆解'.padEnd(52)}: ${String(hitList.length).padStart(4)}  ${pct(hitList.length)}`);
for (const k of Object.keys(LAB)) {
  const n = B[k]?.length ?? 0;
  console.log(`  ${LAB[k].padEnd(52)}: ${String(n).padStart(4)}  ${pct(n)}`);
}
console.log(`  ${'—— 无拆解合计'.padEnd(52)}: ${String(miss.length).padStart(4)}  ${pct(miss.length)}`);

/* ===================== 4. 门槛敏感性（覆盖率直方图） ===================== */
console.log('\n' + '='.repeat(74));
console.log('覆盖率分布（无拆解词的「最大可覆盖字符比」，门槛前）');
console.log('='.repeat(74));
const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.8, 1.01];
const hist = new Array(bins.length - 1).fill(0);
for (const r of miss) {
  if (r.coverage <= 0) { hist[0]++; continue; }
  for (let i = bins.length - 2; i >= 0; i--) if (r.coverage >= bins[i]) { hist[i]++; break; }
}
for (let i = 0; i < hist.length; i++) {
  console.log(`  [${bins[i].toFixed(2)}, ${bins[i + 1].toFixed(2)})  ${String(hist[i]).padStart(4)}`);
}
console.log('\n  若把门槛降到 T（其余规则不变），尺子 R 覆盖率为：');
const relaxAll = new Map();
for (const r of rec) relaxAll.set(r.w, breakdownEx(r.w, 'ru', { threshold: false, gapExplain: false, leadGap: false }));
for (const T of [0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.2, 0.0, -1]) {
  const set = new Set(hitList);
  for (const r of miss) {
    const rr = relaxAll.get(r.w);
    if (rr.parts.length && rr.coverage >= T) set.add(r.w);
  }
  const gain = set.size - hitList.length;
  const gen = [...set].filter((w) => !official.get(w).length)
    .map((w) => miss.find((r) => r.w === w))
    .filter((r) => r && (r.ap || r.as)).length;
  console.log(`    T=${T < 0 ? '0.00(任意)' : T.toFixed(2)} → ${String(set.size).padStart(4)} (${pct(set.size)}) ${set.size >= NEED45 ? '✅' : '  '}  (+${gain}，其中含真实锚定语素 ${gen} = ${((gen / Math.max(gain, 1)) * 100).toFixed(0)}%)`);
}
// 门槛降档的「新增救回词」质量
for (const [lo, hi] of [[0.5, 0.55], [0.45, 0.5], [0.4, 0.45]]) {
  const inBin = miss.filter((r) => r.coverage >= lo && r.coverage < hi);
  const gen = inBin.filter((r) => r.ap || r.as);
  console.log(`    [${lo},${hi}) 共 ${inBin.length} 词：含真实锚定语素 ${gen.length}（${((gen.length / Math.max(inBin.length, 1)) * 100).toFixed(0)}%）、纯碎片 ${inBin.length - gen.length}`);
  if (lo === 0.5) console.log(`      样例：${inBin.slice(0, 30).map((r) => `${r.w}(${r.coverage.toFixed(2)})`).join(' ')}`);
}

/* ===================== 5. 天花板情景 ===================== */
console.log('\n' + '='.repeat(74));
console.log(`天花板情景（45% 需要 ${NEED45} 词 / ${TOTAL}）—— 全部用集合并集计算，无重复计数`);
console.log('='.repeat(74));
const S1 = new Set(hitList);
for (const r of miss) { const rr = relaxAll.get(r.w); if (rr.parts.length && rr.coverage >= MIN_COVERAGE) S1.add(r.w); }
const S2 = new Set(S1); for (const r of miss) if (r.baseParts > 0) S2.add(r.w);
const S3 = new Set(S2); for (const r of B.anchored ?? []) S3.add(r.w);
const S4 = new Set(hitList); for (const r of miss) if (relaxAll.get(r.w).parts.length) S4.add(r.w);
const anchMids = [...new Set((B.anchored ?? []).map((r) => r.mid).filter((m) => m && m.length >= 3))];
const midCount0 = anchMids.length;
const midCount0b = anchMids.filter((m) => m.length >= 4).length;
const rows2 = [
  ['S0 现状', new Set(hitList), ''],
  ['S1 + 只松开 leadGap/gapExplain（零新增词素，门槛仍 0.55）', S1, '有 сегодня 式误拆风险'],
  ['S2 + 词形归并（用主词条拆解）', S2, '需 breakdownWord 内部做词形反查'],
  ['S3 + 把 174 个「锚定语素词」逐一补词根', S3, `需新增 ≈${midCount0} 条词根（其中 ≥4 字符 ${midCount0b} 条）`],
  ['S4 + 门槛降到 0（任何覆盖都算）', S4, '碎片式误拆，等于放弃 0.55 这条历史防线'],
  ['S5 + 把每个无拆解词登记为词根（数学极限）', new Set(R), '★自欺：尺子只判"非空"，无教学价值'],
];
for (const [name, set, note] of rows2) {
  console.log(`  ${name.padEnd(44)}: ${String(set.size).padStart(4)}  ${pct(set.size)}  ${set.size >= NEED45 ? '✅' : '❌'}  ${note}`);
}
console.log(`\n  → 45%（${NEED45} 词）需要 ` + (NEED45 - S1.size > 0
  ? `在 S1 基础上再补 ≈${NEED45 - S1.size} 个词根（R 上词根与被救词基本 1:1）`
  : `S1 即可达标`));

/* ===================== 6. 样例 ===================== */
console.log('\n' + '='.repeat(74));
console.log('分类样例');
console.log('='.repeat(74));
const show = (k, n, f = (r) => r.w) => {
  const a = B[k] ?? [];
  console.log(`\n--- ${LAB[k]}（共 ${a.length}）前 ${Math.min(n, a.length)} ---`);
  console.log(a.slice(0, n).map(f).join(' '));
};
show('proper', 20);
show('oldOrtho', 20);
show('affixOnly', 20);
show('formMerge', 20, (r) => `${r.w}→${r.baseWord}`);
show('gatedOut', 50, (r) => `${r.w}[${r.coverage.toFixed(2)}]`);
// 43 个 gatedOut 是被哪条规则挡的？
{
  const g = B.gatedOut ?? [];
  let onlyLead = 0, onlyGap = 0, either = 0, none = 0;
  for (const r of g) {
    // A = 只放开 leadGap（gapExplain 仍生效）；B = 只放开 gapExplain（leadGap 仍生效）
    const A = breakdownEx(r.w, 'ru', { threshold: false, leadGap: false }).parts.length;
    const Bx = breakdownEx(r.w, 'ru', { threshold: false, gapExplain: false }).parts.length;
    if (A && Bx) either++; else if (A) onlyLead++; else if (Bx) onlyGap++; else none++;
  }
  console.log(`\n  ↑ 被哪条规则挡掉：单靠放开 leadGap 即可 ${onlyLead} / 单靠放开 gapExplain 即可 ${onlyGap} / 两条任一即可 ${either} / 都不是 ${none}`);
  console.log(`    样例(首个被挡词的首片段): ${g.slice(0, 6).map((r) => { const rr = breakdownEx(r.w, 'ru', { threshold: false, gapExplain: false }); return `${r.w}[${rr.parts.map((p) => `${p.morpheme}@${p.start}`).join('+')}|cov${rr.coverage.toFixed(2)}|gap=${rr.parts[0] ? rr.parts[0].start : '-'}]`; }).join(' ')}`);
  // gapExplain 只说「首间隙必须精确等于某个前缀」。若改为「间隙长度 ≥3 即视为可解释的词根位」，
  // 这对 сегодня（gap=се，2 字符）依然是拒绝，但对 сущность（gap=сущ）应放行。量一下分布：
  const gaps = g.map((r) => { const rr = breakdownEx(r.w, 'ru', { threshold: false, gapExplain: false }); return rr.parts[0] ? rr.parts[0].start : -1; });
  const ge3 = gaps.filter((x) => x >= 3).length, e2 = gaps.filter((x) => x === 2).length, other = gaps.filter((x) => x < 2).length;
  console.log(`    首间隙长度分布：≥3 字符 ${ge3} / ==2 字符 ${e2} / <2 ${other}  → 若改成「gap 长度≥3 即放行」，可救 ${ge3} 词且不动 сегодня（gap=се）的防线`);
}
show('anchored', 70, (r) => `${r.w}{${r.ap ? '+' + r.ap.stem : ''}${r.as ? '-' + r.as.pat : ''}=${r.mid}}`);
show('substrOnly', 20, (r) => `${r.w}[${r.substr.join(',')}]`);
show('singleRoot', 90);
// 「库内无线索」桶里，有多少是【库外复合词】（有连接元音 о/е，如 курсомер = курс+о+мер）而非真单语素词？
{
  const sr = B.singleRoot ?? [];
  const interfix = (w) => {
    const mw = w.toLowerCase().replace(/ё/g, 'е');
    if (mw.length < 7) return false;
    for (let i = 3; i <= mw.length - 4; i++) if (mw[i] === 'о' || mw[i] === 'е') return true;
    return false;
  };
  const comp = sr.filter((r) => interfix(r.w));
  console.log(`\n  【库内无线索】${sr.length} 词中：`);
  console.log(`    保守启发式判为「库外复合词」（连接元音 о/е 位于 3..n-4 且长度≥7）: ${comp.length}`);
  console.log(`      → ${comp.slice(0, 25).map((r) => r.w).join(' ')}`);
  console.log(`    其余（更可能为真·单语素词，如 барабан/бокал/герб/клоп/коньяк）: ${sr.length - comp.length}`);
  console.log(`    ⚠ 该启发式仍会误判（инерция/дремучий 类仅含普通 о/е），精确切分需词源数据，本实验不做。`);
}

/* ===================== 7. 候选词素规模 ===================== */
console.log('\n' + '='.repeat(74));
console.log('候选词素规模估算');
console.log('='.repeat(74));
const anchored = B.anchored ?? [];
const mids = anchored.map((r) => r.mid).filter((m) => m && m.length >= 3);
const midCount = new Map();
for (const m of mids) midCount.set(m, (midCount.get(m) ?? 0) + 1);
console.log(`  锚定语素词 ${anchored.length} 个：`);
console.log(`    含前缀无后缀 : ${anchored.filter((r) => r.ap && !r.as).length}`);
console.log(`    含后缀无前缀 : ${anchored.filter((r) => r.as && !r.ap).length}`);
console.log(`    前后缀都有   : ${anchored.filter((r) => r.ap && r.as).length}`);
console.log(`    中段（未知词根）去重后 : ${midCount.size} 个（长度≥3）`);
console.log(`    中段长度分布 : 3字符 ${mids.filter((m) => m.length === 3).length} / 4字符 ${mids.filter((m) => m.length === 4).length} / ≥5字符 ${mids.filter((m) => m.length >= 5).length}`);
console.log(`    → 若每个中段登记为词根，需新增约 ${midCount.size} 条词根，可救回约 ${mids.length} 词`);
console.log(`    中段频次 top20: ${[...midCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}(${v})`).join(' ')}`);

// 候选词根的「真实回报」：把中段当词根加进去，在**全体俄语词条（尺子 A 分母）**上能覆盖多少词
{
  const allRuTmp = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word).toLowerCase().replace(/ё/g, 'е'));
  let covered = 0; const per = [];
  for (const m of anchMids) {
    if (m.length < 4) continue;
    const n = allRuTmp.filter((w) => w.includes(m)).length;
    covered += n; per.push([m, n]);
  }
  per.sort((a, b) => b[1] - a[1]);
  console.log(`\n  ★候选词根在尺子 A 上的回报（${per.length} 个长度≥4 的中段）：`);
  console.log(`    合计可命中 ${covered} 个俄语词条（去重前；平均 ${(covered / Math.max(per.length, 1)).toFixed(1)} 词/词根）`);
  console.log(`    回报 top20: ${per.slice(0, 20).map(([m, n]) => `${m}(${n})`).join(' ')}`);
  console.log(`    回报=1 的（只覆盖它自己，几乎无泛化价值）: ${per.filter(([, n]) => n <= 1).length} / ${per.length}`);
}

// 45% 的「词根成本」推算
console.log('\n  ★达到 45% 所需的词根数量推算（R：1 词根 ≈ 1 词）：');
console.log(`    现状 244 → 45% 需 356：缺口 ${NEED45 - hitList.length} 词`);
console.log(`    先做零成本规则修复（S1=289）后缺口 ${Math.max(NEED45 - S1.size, 0)} 词 → 约需 ${Math.max(NEED45 - S1.size, 0)} 条词根`);
console.log(`    若只补词根、不修规则：约需 ${NEED45 - hitList.length} 条词根`);
console.log(`    现有词素库 441 条，34500 条待拆词条 → 按此速度 45% 只是「把词干逐条登记为词根」的体力活`);

// 无锚定语素词 → 需要新前缀/后缀
const noAnchor = miss.filter((r) => !r.ap && !r.as && !r.isMorphemeItself && !r.hy);
const ngram = (kind) => {
  const map = new Map();
  for (const r of noAnchor) {
    const mw = r.w.toLowerCase().replace(/ё/g, 'е');
    for (let L = 3; L <= 6; L++) {
      if (mw.length - L < 2) continue;
      const frag = kind === 'pre' ? mw.slice(0, L) : mw.slice(-L);
      if (ALLSTEMS3.includes(frag)) continue;
      let s = map.get(frag); if (!s) { s = { frag, words: new Set() }; map.set(frag, s); }
      s.words.add(r.w);
    }
  }
  return [...map.values()].filter((x) => x.words.size >= 5).sort((a, b) => b.words.size - a.words.size);
};
for (const kind of ['pre', 'suf']) {
  const top = ngram(kind);
  console.log(`\n  无锚定词共 ${noAnchor.length} 个；${kind === 'pre' ? '前缀' : '后缀'}候选（≥5 词共享，前 25）：`);
  console.log('    ' + top.slice(0, 25).map((x) => `${x.frag}(${x.words.size})`).join(' '));
  const owned = new Set(); let added = 0;
  for (const x of top) { let g = 0; for (const w of x.words) if (!owned.has(w)) g++; if (g >= 5) { added++; for (const w of x.words) owned.add(w); } }
  console.log(`    → 覆盖 ${owned.size}/${noAnchor.length}，需新增约 ${added} 条${kind === 'pre' ? '前缀' : '后缀'}`);
}

/* ===================== 8. 尺子 A 旁证 ===================== */
console.log('\n' + '='.repeat(74));
console.log('旁证：尺子 A（全体 words_i18n(ru)，分母 101512）');
console.log('='.repeat(74));
const allRu = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
let aHit = 0, aLowCov = 0, aCap = 0, aOld = 0, aForm = 0, aAnchored = 0;
for (const w of allRu) {
  let h = false; try { h = core.breakdownWord(db, w, 'ru').length > 0; } catch { }
  if (h) { aHit++; continue; }
  const rl = breakdownEx(w, 'ru', { threshold: false });
  if (rl.parts.length) aLowCov++;
  if (isCap(w)) aCap++;
  if (OLD.test(w) || w.endsWith('ъ')) aOld++;
  const fr = stmtForm.get(w, 'ru');
  if (fr && String(fr.word) !== w) { try { if (core.breakdownWord(db, String(fr.word), 'ru').length) aForm++; } catch { } }
  if (anchorPre(w) || anchorSuf(w)) aAnchored++;
}
const ap = (n) => `${((n / allRu.length) * 100).toFixed(1)}%`;
console.log(`  现状有拆解 ${aHit} = ${ap(aHit)}`);
console.log(`  无拆解中：门槛放宽即有片段 ${aLowCov} (${ap(aLowCov)}) / 含锚定语素 ${aAnchored} (${ap(aAnchored)}) / 主词条可拆 ${aForm} (${ap(aForm)})`);
console.log(`  首字母大写 ${aCap} (${ap(aCap)}) / 旧正字法 ${aOld} (${ap(aOld)})`);
console.log(`  旁证上限（现状 ∪ 含锚定语素 ∪ 主词条可拆）≈ ${ap(aHit + aAnchored + aForm)}`);

/* ===================== 9. 交叉验证主管 exp_ru_recoverable2（244 / 310 / 34 / 203 / 70.0%） ===================== */
console.log('\n' + '='.repeat(74));
console.log('9. 交叉验证：主管 scripts/exp_ru_recoverable2.mjs 的口径（位置约束版）');
console.log('='.repeat(74));

const LIB2 = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }))
  .filter((m) => m.stem.length >= 2);
const L_PRE = LIB2.filter((m) => m.kind === 'prefix').sort((a, b) => b.stem.length - a.stem.length);
const L_SUF = LIB2.filter((m) => m.kind === 'suffix').sort((a, b) => b.stem.length - a.stem.length);
const L_ROOT = LIB2.filter((m) => m.kind === 'root');
const MIN_REST = 3;
const lPre = (w) => L_PRE.filter((m) => w.startsWith(m.stem) && w.length - m.stem.length >= MIN_REST);
const lSuf = (w) => L_SUF.filter((m) => w.endsWith(m.stem) && w.length - m.stem.length >= MIN_REST);
const anyRoot2 = (w) => L_ROOT.some((m) => m.stem.length >= 3 && w.includes(m.stem));

const pOnly = [];
const sOnly = [];
const both2 = [];
const rootOnly2 = [];
const none2 = [];
for (const w of missList) {
  const p = lPre(w);
  const s = lSuf(w);
  if (p.length && s.length) both2.push(w);
  else if (p.length) pOnly.push(w);
  else if (s.length) sOnly.push(w);
  else if (anyRoot2(w)) rootOnly2.push(w);
  else none2.push(w);
}
const legalWords = [...pOnly, ...sOnly, ...both2];
const legal = legalWords.length;
const ceil2 = hitList.length + legal;
const cmpRow = (label, mine, suo) =>
  console.log(`  ${label.padEnd(32)}: 我 ${String(mine).padStart(4)}   主管 ${String(suo).padStart(4)}   ${mine === suo ? '✔ 一致' : '⚠ 不一致'}`);
cmpRow('已有拆解', hitList.length, 244);
cmpRow('可剥离合法前缀或后缀', legal, 310);
cmpRow('  └ 仅前缀', pOnly.length, 53);
cmpRow('  └ 仅后缀', sOnly.length, 227);
cmpRow('  └ 前后缀均可', both2.length, 30);
cmpRow('仅含 3+ 词根（不构成合法剥离）', rootOnly2.length, 34);
cmpRow('完全无任何已知词素', none2.length, 203);
console.log(`  位置约束下上限               : ${ceil2}/${TOTAL} = ${((ceil2 / TOTAL) * 100).toFixed(1)}%   主管 554/791 = 70.0%`);

/* ---- ★ 关键修正：「可剥离合法后缀」≠「可提升空间」（词首缺口决定生死） ---- */
const GATES_OFF = { threshold: false, leadGap: false, gapExplain: false, suffixPos: false, prefixPos: false, oneCharPre: false };
let headHas = 0;
let headGap1 = 0;
let headGap2plus = 0;
const headGap2Ex = [];
for (const w of legalWords) {
  const r = breakdownEx(w, 'ru', GATES_OFF);
  const st = r.parts.length ? r.parts[0].start : 99;
  if (st === 0) headHas++;
  else if (st === 1) headGap1++;
  else {
    headGap2plus++;
    if (headGap2Ex.length < 12) headGap2Ex.push(w);
  }
}
console.log(`\n  ★ 关键修正：这 ${legal} 词在「全部规则关掉」的裸 DP 下，**最优首片段起点**分布：`);
console.log(`     start=0  词首本身就是已知词素  : ${headHas}   → 补后缀/补覆盖率**可能**救活`);
console.log(`     start=1  词首只空 1 字符（D1 模式）: ${headGap1}   → 放宽门槛可能救活，但那是假词根高发区`);
console.log(`     start>=2 词首缺词素（或无线索）  : ${headGap2plus}   → ★补**任何后缀**都救不活（index.ts:851 词首关卡）`);
console.log(`       例：${headGap2Ex.join(' ')}`);
console.log(`  ⇒ 「可剥离合法后缀」只是"词尾有个已知后缀"，不等于"能被拆出"；`);
console.log(`     后 ${headGap2plus + headGap1} 词（${(((headGap2plus + headGap1) / legal) * 100).toFixed(1)}% 的 310）的瓶颈在**词首**，不在词尾。`);

/* ===================== 10. 词素级频次表（310 词） + 不在库的候选词素 ===================== */
console.log('\n' + '='.repeat(74));
console.log('10. 词素级频次：哪些词素"看着能覆盖最多词"（含"是否已在库"标记）');
console.log('='.repeat(74));
{
  const cnt = new Map();
  const bump = (kind, stem, w) => {
    const k = `${kind}|${stem}`;
    let e = cnt.get(k);
    if (!e) cnt.set(k, (e = { kind, stem, n: 0, ex: [] }));
    e.n++;
    if (e.ex.length < 3) e.ex.push(w);
  };
  for (const w of legalWords) {
    for (const m of lPre(w)) bump('prefix', m.stem, w);
    for (const m of lSuf(w)) bump('suffix', m.stem, w);
  }
  const libStemSet = new Set(MATCHERS.ru.all.map((e) => e.stem));
  const show = (kind, title, topN) => {
    const arr = [...cnt.values()].filter((e) => e.kind === kind).sort((a, b) => b.n - a.n).slice(0, topN);
    console.log(`\n  【${title}】 词素 → 可覆盖词数 → 例词 3 个`);
    for (const e of arr) {
      const inLib = libStemSet.has(e.stem) ? '已在库' : '★不在库';
      console.log(`    ${('-' + e.stem).padEnd(12)} ${String(e.n).padStart(3)} 词  ${inLib}   ${e.ex.join(' ')}`);
    }
  };
  show('suffix', `后缀（在 ${legal} 词词尾出现，全部取自词素库）`, 24);
  show('prefix', `前缀（在 ${legal} 词词首出现，全部取自词素库）`, 18);
  console.log('\n  ★ 结论：上表所有前缀/后缀**按构造必然已在库**——它们是"库里已有的词素"出现在词首/词尾，');
  console.log('    所以「补齐这些高置信度词素」无从下手（补一个已在库的词素等于不补）。');
  console.log('    真正"不在库"的候选只能从词料里挖（下表）。');
}
{
  const libStemSet = new Set(MATCHERS.ru.all.map((e) => e.stem));
  const sufMine = new Map();
  const preMine = new Map();
  for (const w of missList) {
    for (let L = 3; L <= 6 && L < w.length; L++) {
      const s = w.slice(w.length - L);
      if (libStemSet.has(s)) continue;
      let e = sufMine.get(s);
      if (!e) sufMine.set(s, (e = { n: 0, ex: [] }));
      e.n++;
      if (e.ex.length < 3) e.ex.push(w);
      const p = w.slice(0, L);
      if (!libStemSet.has(p)) {
        let f = preMine.get(p);
        if (!f) preMine.set(p, (f = { n: 0, ex: [] }));
        f.n++;
        if (f.ex.length < 3) f.ex.push(w);
      }
    }
  }
  const dump = (map, title, minN) => {
    const arr = [...map.entries()].filter(([, e]) => e.n >= minN).sort((a, b) => b[1].n - a[1].n);
    console.log(`\n  【${title}】(覆盖 ≥${minN} 词，共 ${arr.length} 个候选)`);
    for (const [s, e] of arr.slice(0, 22)) console.log(`    ${s.padEnd(10)} ${String(e.n).padStart(3)} 词   ${e.ex.join(' ')}`);
  };
  dump(sufMine, '★不在库的词尾候选（可作后缀）', 3);
  dump(preMine, '★不在库的词首候选（可作前缀）', 3);
}

/* ===================== 11. 模拟「补词素」（不放宽任何阈值，STRICT） ===================== */
console.log('\n' + '='.repeat(74));
console.log('11. 补词素模拟：GATES_STRICT 不变（阈值 0.55、词首关卡全开），只往词素库加候选');
console.log('='.repeat(74));
{
  const libStemSet = new Set(MATCHERS.ru.all.map((e) => e.stem));
  const mine = (kind) => {
    const map = new Map();
    for (const w of missList) {
      const set = new Set();
      if (kind === 'root') {
        set.add(w.slice(0, 3));
        for (let L = 4; L <= 6; L++) for (let i = 0; i + L <= w.length; i++) set.add(w.slice(i, i + L));
      } else {
        for (let L = 3; L <= 6 && L < w.length; L++) set.add(w.slice(w.length - L));
      }
      for (const s of set) {
        if (libStemSet.has(s)) continue;
        let a = map.get(s);
        if (!a) map.set(s, (a = new Set()));
        a.add(w);
      }
    }
    return map;
  };
  const evaluate = (map, kind) => {
    const out = [];
    for (const [stem, words] of map) {
      const bundle = buildMatchers('ru', [{ morpheme: stem, kind }]);
      const got = [];
      for (const w of words) {
        if (breakdownEx(w, 'ru', GATES_STRICT, null, bundle).parts.length) got.push(w);
      }
      if (got.length) out.push({ stem, kind, got });
    }
    return out;
  };
  const t0 = Date.now();
  const rootC = evaluate(mine('root'), 'root');
  const sufC = evaluate(mine('suffix'), 'suffix');
  console.log(`  候选池：词根候选 ${rootC.length} 个有效（能单独救 ≥1 词）/ 后缀候选 ${sufC.length} 个（挖掘耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  const curve = (cands, label) => {
    const rest = cands.slice().map((c) => ({ ...c, got: new Set(c.got) }));
    const hit = new Set();
    let covered = hitList.length;
    const picked = [];
    const pts = [10, 30, 50, 70, 90, 99, 120, 150, 200, 300];
    const out = {};
    while (rest.length && picked.length < 300) {
      let bi = -1;
      let bg = 0;
      for (let i = 0; i < rest.length; i++) {
        let g = 0;
        for (const w of rest[i].got) if (!hit.has(w)) g++;
        if (g > bg) { bg = g; bi = i; }
      }
      if (bi < 0) break;
      const c = rest.splice(bi, 1)[0];
      for (const w of c.got) hit.add(w);
      covered += bg;
      picked.push(c);
      if (pts.includes(picked.length)) out[picked.length] = covered;
      if (covered >= 356 && picked.length >= 99) break;
    }
    console.log(`\n  【${label}】补 N 条 → 覆盖率（贪心，边际增益递减）`);
    for (const k of pts) if (out[k] !== undefined) console.log(`    补 ${String(k).padStart(3)} 条 → ${out[k]} 词 = ${pct(out[k])}`);
    const first45 = pts.find((k) => out[k] >= 356);
    console.log(`    ⇒ 达到 45%（356 词）需补 **${first45 ?? '>300（未达）'}** 条；共收敛于 ${picked.length} 条 / ${covered} 词`);
    return { picked, out, covered, hit };
  };
  const rootRes = curve(rootC, '补词根（零规则改动）');
  const sufRes = curve(sufC, '补后缀（零规则改动）');

  const multi = rootC.filter((c) => c.got.length >= 2);
  console.log(`\n  【保守口径】只接受「解锁 ≥2 词」的词根候选：${multi.length} 个（占 ${((multi.length / rootC.length) * 100).toFixed(1)}%）`);
  console.log(`    → 合计可解锁 ${new Set(multi.flatMap((c) => c.got)).size} 词；其余候选全是"一词一词根"。`);
  const multiSorted = multi.slice().sort((a, b) => b.got.length - a.got.length);
  console.log(`    多词共享 top12：${multiSorted.slice(0, 12).map((c) => `${c.stem}(${c.got.length})`).join(' ')}`);
  const multiRes = curve(multi, '保守口径：只补「多词共享」词根（高置信，有泛化价值）');
  console.log(`    ⇒ 保守口径即使把 61 个候选全补进去，上限也只有 ${multiRes.covered} 词 = ${pct(multiRes.covered)}${multiRes.covered >= 356 ? '' : `（距 45% 还差 ${356 - multiRes.covered} 词）`}`);

  const verify = (cands, n, label) => {
    const extra = cands.slice(0, n).map((c) => ({ morpheme: c.stem, kind: c.kind }));
    let hit = 0;
    for (const w of R) if (breakdownEx(w, 'ru', GATES_STRICT, extra).parts.length) hit++;
    console.log(`    [端到端复核] ${label} 补前 ${n} 条 → 实测 ${hit} 词 = ${pct(hit)}`);
    return hit;
  };
  console.log('');
  verify(rootRes.picked, Math.min(50, rootRes.picked.length), '词根');
  verify(rootRes.picked, Math.min(70, rootRes.picked.length), '词根');
  verify(rootRes.picked, Math.min(99, rootRes.picked.length), '词根');
  verify(rootRes.picked, Math.min(150, rootRes.picked.length), '词根');
  verify(sufRes.picked, Math.min(30, sufRes.picked.length), '后缀');
  verify(multiRes.picked, multiRes.picked.length, '保守(多词共享词根)');
  const mix = [...rootRes.picked, ...sufRes.picked];
  const mixHit = verify(mix, Math.min(129, mix.length), '词根+后缀混合');
  console.log(`\n  ★ 直接回答「不放宽任何阈值能到多少」：混合补法 ${mixHit} 词 = ${pct(mixHit)}`);
  console.log(`     达到 45% ：${mixHit >= 356 ? '可以（需补约 ' + mix.length + ' 条词素）' : '★不可以——即使把候选全部补进去也只到 ' + pct(mixHit)}`);
  console.log(`\n  贪心选出的前 20 条词根候选（★全部需用户逐条审定；含噪声）：`);
  console.log(`    ${rootRes.picked.slice(0, 20).map((c) => c.stem).join(' ')}`);
  {
    /* 候选成分剖析：真正的词根应出现在词首/词中；只出现在词尾的其实是后缀片段（应判为噪声被审定否决） */
    const head = [];
    const tailish = [];
    for (const c of rootRes.picked.slice(0, 70)) {
      let atHead = 0;
      for (const w of c.got) if (w.startsWith(c.stem)) atHead++;
      if (atHead >= c.got.size / 2) head.push(c.stem);
      else tailish.push(c.stem);
    }
    console.log(`  前 70 条候选成分剖析：`);
    console.log(`    以词首锚定为主（像真词根）: ${head.length} 条 → ${head.slice(0, 25).join(' ')}`);
    console.log(`    以词中/词尾为主（实为后缀片段，★应被人工审定否决）: ${tailish.length} 条 → ${tailish.slice(0, 25).join(' ')}`);
    console.log(`  ⇒ 贪心给的「70 条」是**成本下界**：人工审定会否决后缀片段与非词根噪声，实际所需条数必然 > 70。`);
  }
}

/* ===================== 12. 放宽阈值的误拆风险（具体例子） ===================== */
console.log('\n' + '='.repeat(74));
console.log('12. 放宽阈值/规则会引入哪些误拆（反例必须具体）');
console.log('='.repeat(74));
{
  const gapRuns = (w, ps) => {
    const runs = [];
    let cur = 0;
    for (let i = 0; i < w.length; i++) {
      const inside = ps.some((p) => i >= p.start && i < p.end);
      if (inside) { if (cur > 0) { runs.push(cur); cur = 0; } } else cur++;
    }
    if (cur > 0) runs.push(cur);
    return runs;
  };
  const scenario = (label, gates) => {
    const hits = [];
    let d1 = 0;
    let g3 = 0;
    const d1ex = [];
    for (const w of R) {
      const r = breakdownEx(w, 'ru', gates);
      if (!r.parts.length) continue;
      hits.push(w);
      if (r.parts[0].start === 1) { d1++; if (d1ex.length < 8) d1ex.push(`${w}{${r.parts.map((p) => p.morpheme).join('+')}}`); }
      if (gapRuns(w, r.parts).some((n) => n >= 3)) g3++;
    }
    const newly = hits.filter((w) => !official.get(w).length);
    console.log(`  ${label.padEnd(32)}: ${String(hits.length).padStart(3)} 词 = ${pct(hits.length)}  | D1型 ${String(d1).padStart(3)} | 空洞≥3 ${String(g3).padStart(3)} | 新增 ${newly.length}`);
    if (d1ex.length) console.log(`        D1 型样例：${d1ex.join(' ')}`);
    return { hits, newly };
  };
  scenario('基线（现状 STRICT）', GATES_STRICT);
  scenario('阈值 0.55→0.50', { minCov: 0.5 });
  scenario('阈值 0.55→0.45', { minCov: 0.45 });
  scenario('放开「单字符前缀支撑」规则', { oneCharPre: false });
  scenario('放开「词首 gap 解释」规则', { gapExplain: false });
  scenario('阈值 0.55→0.50 + 放开单字符支撑', { minCov: 0.5, oneCharPre: false });

  const probes = ['вода', 'страшный', 'принцип', 'сегодня', 'плескание', 'хлестаться', 'зверство', 'ателье', 'глетчерный', 'тлеться', 'арест', 'Краков', 'авалист', 'безаварийный', 'вдыхать', 'альпийский', 'алкоголизм'];
  console.log('\n  已知误拆反例 / 待救正例在各情景下的表现（— = 未拆出，{...} = 拆出的片段）：');
  const scen = [
    ['STRICT', GATES_STRICT],
    ['minCov0.50', { minCov: 0.5 }],
    ['oneCharPre off', { oneCharPre: false }],
    ['0.50+onepre off', { minCov: 0.5, oneCharPre: false }],
    ['全部放宽', GATES_OFF],
  ];
  for (const p of probes) {
    const cells = scen.map(([, g]) => {
      const r = breakdownEx(p, 'ru', g);
      return r.parts.length ? `{${r.parts.map((x) => x.morpheme).join('+')}}` : '—';
    });
    console.log(`    ${p.padEnd(14)} ${cells.map((c) => c.padEnd(22)).join('')}`);
  }
  console.log(`    情景列序：${scen.map(([n]) => n).join(' | ')}`);
}

/* ===================== 13. 词首词族的【语料级】挖掘（主管订正后的核心问题） ===================== */
console.log('\n' + '='.repeat(74));
console.log('13. 词首词族语料级挖掘：332 个「词首无已知词素」词，其候选词根本身覆盖多少库内词？');
console.log('='.repeat(74));
{
  const libStemSet = new Set(MATCHERS.ru.all.map((e) => e.stem));
  const RU_ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
  console.log(`  语料规模 words_i18n(ru) = ${RU_ALL.length.toLocaleString()} 词（含屈折形，故"覆盖词数"含屈折形，非严格词族）`);
  const corpHead = new Map();
  for (const w of RU_ALL) for (let L = 3; L <= 7 && L <= w.length; L++) { const s = w.slice(0, L); corpHead.set(s, (corpHead.get(s) ?? 0) + 1); }

  const headNone = missList.filter((w) => {
    const r = breakdownEx(w, 'ru', GATES_OFF);
    return !r.parts.length || r.parts[0].start >= 2;
  });
  console.log(`  词首无已知词素的词（裸 DP 首片段 start>=2 或全词无线索）: ${headNone.length}（主管归因 332）`);

  const startsWithMap = new Map();
  for (const w of headNone) {
    for (let L = 3; L <= 7 && L <= w.length; L++) {
      const s = w.slice(0, L);
      if (libStemSet.has(s)) continue;
      let a = startsWithMap.get(s);
      if (!a) startsWithMap.set(s, (a = []));
      a.push(w);
    }
  }
  const candMap = new Map();
  for (const [s, ws] of startsWithMap) {
    const bundle = buildMatchers('ru', [{ morpheme: s, kind: 'root' }]);
    const got = ws.filter((w) => breakdownEx(w, 'ru', GATES_STRICT, null, bundle).parts.length);
    if (got.length) candMap.set(s, new Set(got));
  }
  const allCand = [...candMap.entries()].map(([stem, got]) => ({ stem, got, corp: corpHead.get(stem) ?? 0 }));
  console.log(`  候选词首 n-gram（3-7 字符、不在库、且至少能解锁 1 词）: ${allCand.length}`);
  const bucket = (n) => allCand.filter((c) => c.got.size >= n).length;
  console.log(`    ├ 能解锁 ≥1 词（样本）: ${bucket(1)}   ├ ≥2 词: ${bucket(2)}   ├ ≥3 词: ${bucket(3)}`);
  const covBucket = (n) => allCand.filter((c) => c.corp >= n).length;
  console.log(`    └ 语料覆盖 ≥2 词: ${covBucket(2)}   ≥5: ${covBucket(5)}   ≥10: ${covBucket(10)}   ≥20: ${covBucket(20)}   ≥50: ${covBucket(50)}`);

  const hi = allCand.filter((c) => c.corp >= 5).sort((a, b) => b.corp - a.corp);
  console.log(`\n  【高价值候选词根表】语料覆盖 ≥5 词 且能解锁样本词（共 ${hi.length} 个，列前 28）`);
  console.log(`    候选词根   语料词数  解锁样本  例词（库内前 3）`);
  for (const c of hi.slice(0, 28)) {
    const ex = db
      .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND word LIKE ? || '%' LIMIT 3`)
      .all(c.stem.replace(/[%_]/g, ''))
      .map((r) => String(r.word));
    console.log(`    ${c.stem.padEnd(9)} ${String(c.corp).padStart(6)}  ${String(c.got.size).padStart(6)}    ${ex.join(' ')}  ← ${[...c.got].slice(0, 2).join(' ')}`);
  }

  const addAndMeasure = (pool, label) => {
    const extra = pool.map((c) => ({ morpheme: c.stem, kind: 'root' }));
    let hit = 0;
    const got = new Set();
    for (const w of R) if (breakdownEx(w, 'ru', GATES_STRICT, extra).parts.length) { hit++; got.add(w); }
    console.log(`  【${label}】补 ${pool.length} 条 → 实测 ${hit} 词 = ${pct(hit)}`);
    return { hit, got };
  };
  console.log('');
  const s5 = addAndMeasure(hi, '只补语料覆盖≥5 的高价值词根');
  const s2 = addAndMeasure(allCand.filter((c) => c.corp >= 2), '只补语料覆盖≥2 的词根');
  const sAll = addAndMeasure(allCand, '补全部候选（含"一词一词根"的滴水式）');

  const need = 356;
  for (const [label, res] of [['语料≥5', s5], ['语料≥2', s2], ['全部候选', sAll]]) {
    const missing = R.filter((w) => !res.got.has(w) && !official.get(w).length);
    console.log(`  ${label}: ${res.hit} 词，距 45%（356）${res.hit >= need ? '✅ 已达标' : `差 ${need - res.hit} 词`}`);
    if (res.hit < need) console.log(`      仍缺样例：${missing.slice(0, 14).join(' ')}`);
  }
  const oneWord = allCand.filter((c) => c.got.size === 1 && c.corp >= 5);
  console.log(`\n  ★ 交叉结论：语料覆盖 ≥5 词但**在尺子 R 上只解锁 1 词**的候选 = ${oneWord.length} / ${hi.length}`);
  console.log(`     ⇒ 语料里"看着有词族"的候选，落到 R 样本上多半仍是一词一词根（R 只有 791 词，稀释严重）。`);
}

/* ===================== 14. 单字符前缀支撑规则：вдыхать vs велюровый 判别实验 ===================== */
console.log('\n' + '='.repeat(74));
console.log('14. 路线乙关键实验：单字符前缀支撑规则能否救回 119 词而不误拆 велюровый？');
console.log('='.repeat(74));
{
  const modes = [
    ['strict（现行 startsWith）', { oneCharPreMode: 'strict' }],
    ['includes（历史失败版）', { oneCharPreMode: 'includes' }],
    ['consonant（裸辅音前缀→辅音起首词根）', { oneCharPreMode: 'consonant' }],
    ['consAny（只要辅音起首，不要词根证据）', { oneCharPreMode: 'consAny' }],
  ];
  const contrast = ['вдыхать', 'велюровый', 'вода', 'сегодня', 'ателье', 'область', 'увезти', 'охрана', 'вбежать', 'влезть'];
  console.log('  对照词在各模式下的拆解（括号内为覆盖率）：');
  for (const w of contrast) {
    const cells = modes.map(([, g]) => {
      const r = breakdownEx(w, 'ru', g);
      return r.parts.length ? `{${r.parts.map((x) => x.morpheme).join('+')}}${r.coverage.toFixed(2)}` : `—${r.coverage.toFixed(2)}`;
    });
    console.log(`    ${w.padEnd(12)} ${cells.map((c) => c.padEnd(24)).join('')}`);
  }
  console.log(`    列序：${modes.map(([n]) => n).join(' | ')}\n`);
  for (const [label, g] of modes) {
    let hit = 0;
    let d1 = 0;
    let g3 = 0;
    for (const w of R) {
      const r = breakdownEx(w, 'ru', g);
      if (!r.parts.length) continue;
      hit++;
      if (r.parts[0].start === 1) d1++;
      const runs = [];
      let cur = 0;
      for (let i = 0; i < w.length; i++) {
        const inside = r.parts.some((p) => i >= p.start && i < p.end);
        if (inside) { if (cur > 0) { runs.push(cur); cur = 0; } } else cur++;
      }
      if (cur > 0) runs.push(cur);
      if (runs.some((n) => n >= 3)) g3++;
    }
    console.log(`  ${label.padEnd(34)}: ${String(hit).padStart(3)} 词 = ${pct(hit)} | D1型 ${String(d1).padStart(2)} | 空洞≥3 ${String(g3).padStart(3)}`);
  }
}

/* ===================== 15. 覆盖率 0.50–0.55「差一点」区间核验 ===================== */
console.log('\n' + '='.repeat(74));
console.log('15. 覆盖率核验：有多少词落在 0.50–0.55「差 0.05」区间？（主管测得 75）');
console.log('='.repeat(74));
{
  const bins = new Map();
  const half = [];
  for (const w of missList) {
    const r = breakdownEx(w, 'ru', { threshold: false });
    if (!r.parts.length) continue;
    const b = (Math.floor(r.coverage * 20) / 20).toFixed(2);
    bins.set(b, (bins.get(b) ?? 0) + 1);
    if (r.coverage >= 0.5 && r.coverage < 0.55) half.push(w);
  }
  console.log('  无拆解词的覆盖率分布（其余守卫全开、只放开门槛）：');
  for (const [b, n] of [...bins.entries()].sort((x, y) => Number(x[0]) - Number(y[0]))) {
    console.log(`    [${b}, ${(Number(b) + 0.05).toFixed(2)}) : ${String(n).padStart(3)} ${'#'.repeat(Math.min(n, 60))}`);
  }
  console.log(`  ★ [0.50, 0.55) 区间词数 = ${half.length}（主管测 75）`);
  console.log(`    样例：${half.slice(0, 24).join(' ')}`);
  const saved = half.filter((w) => breakdownEx(w, 'ru', { minCov: 0.5 }).parts.length);
  console.log(`    实际把阈值降到 0.50 能救活其中 ${saved.length} 词（含新误拆）`);
}

/* ===================== 16. 独立复核主管的四类归因（119 / 83 / 11 / 332） ===================== */
console.log('\n' + '='.repeat(74));
console.log('16. 独立复核主管归因表（用自检通过的忠实复刻，非自写模型）');
console.log('='.repeat(74));
{
  const CAT = { noMorpheme: 0, headNone: 0, oneCharSupport: 0, covPrefix: 0, covRoot: 0, other: 0 };
  const ex = { headNone: [], oneCharSupport: [], covPrefix: [], covRoot: [] };
  for (const w of missList) {
    const r0 = breakdownEx(w, 'ru', GATES_OFF);
    if (!r0.parts.length) { CAT.noMorpheme++; continue; }
    if (r0.parts[0].start >= 2) { CAT.headNone++; if (ex.headNone.length < 10) ex.headNone.push(w); continue; }
    const rSup = breakdownEx(w, 'ru', { threshold: false, leadGap: false, gapExplain: false, oneCharPre: true });
    const supBites = !rSup.parts.length || rSup.coverage < r0.coverage - 1e-9;
    if (supBites) { CAT.oneCharSupport++; if (ex.oneCharSupport.length < 10) ex.oneCharSupport.push(`${w}(${r0.coverage.toFixed(2)})`); continue; }
    if (r0.coverage < MIN_COVERAGE) {
      if (r0.parts[0].kind === 'prefix') { CAT.covPrefix++; if (ex.covPrefix.length < 10) ex.covPrefix.push(`${w}(${r0.coverage.toFixed(2)})`); }
      else { CAT.covRoot++; if (ex.covRoot.length < 10) ex.covRoot.push(`${w}(${r0.coverage.toFixed(2)})`); }
      continue;
    }
    CAT.other++;
  }
  const bar = (label, mine, suo) => console.log(`  ${label.padEnd(30)}: 我 ${String(mine).padStart(4)}   主管 ${String(suo).padStart(4)}   ${mine === suo ? '✔' : '⚠ 不一致'}`);
  bar('④ 单字符前缀无紧邻支撑', CAT.oneCharSupport, 119);
  bar('⑥ 多字符前缀但覆盖率不足', CAT.covPrefix, 83);
  bar('⑥ 词首有词根但覆盖率不足', CAT.covRoot, 11);
  bar('词首完全无已知词素', CAT.headNone + CAT.noMorpheme, 332);
  console.log(`  （我自己再细分：词首无词素 ${CAT.headNone} + 全词无任何已知词素 ${CAT.noMorpheme} = ${CAT.headNone + CAT.noMorpheme}）`);
  console.log(`  其余/未归类 ${CAT.other}；无拆解总计 ${missList.length}`);
  console.log(`    单字符支撑样例：${ex.oneCharSupport.join(' ')}`);
  console.log(`    覆盖率不足(前缀)样例：${ex.covPrefix.join(' ')}`);
  const fixAll = { threshold: true, leadGap: false, gapExplain: false, suffixPos: true, prefixPos: true, oneCharPre: false };
  let h = 0;
  for (const w of R) if (breakdownEx(w, 'ru', fixAll).parts.length) h++;
  console.log(`  只修规则（上述四类全放开）端到端实测 → ${h} 词 = ${pct(h)}（主管 459 / 791 = 58.0%）`);
  console.log('\n  ★ 「58.0%」需要什么代价？逐步拆解（每步都是端到端实测）：');
  const step = (label, g) => {
    let n = 0;
    for (const w of R) if (breakdownEx(w, 'ru', g).parts.length) n++;
    console.log(`    ${label.padEnd(46)} → ${String(n).padStart(3)} 词 = ${pct(n)}`);
    return n;
  };
  step('① 现状', GATES_STRICT);
  step('② 只放开 词首gap解释(gapExplain)', { gapExplain: false });
  step('③ 只放开 单字符前缀支撑', { oneCharPre: false });
  step('④ 放开 gapExplain + 单字符支撑（阈值仍 0.55）', fixAll);
  step('⑤ ④ + 阈值 0.55→0.50', { ...fixAll, minCov: 0.5 });
  step('⑥ ④ + 阈值 0.55→0.45', { ...fixAll, minCov: 0.45 });
  step('⑦ ④ + 阈值 0.55→0.40', { ...fixAll, minCov: 0.4 });
  step('⑧ 全部放开（含阈值→0）', GATES_OFF);
  console.log('  ⇒ 「只修规则」若不含"降覆盖率阈值"，上限远低于 58.0%；58.0% 必须同时降阈值。');
}

/* ===================== 17. T12 判别实验：gapExplain 阈值 >=2 → >=1（D1 修复） ===================== */
console.log('\n' + '='.repeat(74));
console.log('17. T12 判别实验：把 index.ts:851 的 parts[0].start >= 2 改为 >= 1');
console.log('='.repeat(74));
{
  /* --- L4 口径：完全复刻 packages/core/test/ru_morph_defects.mjs:59-76 / 129-138 --- */
  const holeTotal = (w, parts) => {
    const cov = new Array(w.length).fill(false);
    for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
    let tot = 0;
    let run = -1;
    for (let i = 0; i <= w.length; i++) {
      if (i < w.length && !cov[i]) { if (run < 0) run = i; }
      else if (run >= 0) { tot += i - run; run = -1; }
    }
    return tot;
  };
  const kpi = (gate) => {
    let hit = 0, deep = 0, s2 = 0, zero = 0, le1 = 0;
    for (const w of R) {
      const r = breakdownEx(w, 'ru', gate);
      if (!r.parts.length) continue;
      hit++;
      const hl = holeTotal(w, r.parts);
      if (hl >= 3) deep++;
      if (hl >= 2) s2++;
      if (hl === 0) zero++;
      if (hl <= 1) le1++;
    }
    return { hit, deep, s2, zero, le1 };
  };

  /* --- 基线复核：官方 engine，应复现测试 agent 的 244/134/175/37/69 --- */
  let offHit = 0, offDeep = 0, offS2 = 0, offZero = 0, offLe1 = 0;
  for (const w of R) {
    const parts = core.breakdownWord(db, w, 'ru');
    if (!parts.length) continue;
    offHit++;
    const hl = holeTotal(w, parts.map((p) => ({ start: p.start, end: p.end })));
    if (hl >= 3) offDeep++;
    if (hl >= 2) offS2++;
    if (hl === 0) offZero++;
    if (hl <= 1) offLe1++;
  }
  const chk = [['覆盖率', offHit, 244], ['空洞≥3', offDeep, 134], ['空洞≥2', offS2, 175], ['零空洞', offZero, 37], ['空洞≤1', offLe1, 69]];
  console.log('  【基线复核】官方 breakdownWord（应与测试 agent KPI 一致）：');
  for (const [k, mine, theirs] of chk) console.log(`    ${k.padEnd(8)}: 我 ${String(mine).padStart(3)}  测试 agent ${String(theirs).padStart(3)}  ${mine === theirs ? '✔' : '⚠ 不一致'}`);

  /* --- 全库 D1 模式计数（定位测试 agent 说的 321 词）--- */
  const RU_ALL2 = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
  const d1Set = [];
  for (const w of RU_ALL2) {
    const parts = core.breakdownWord(db, w, 'ru');
    if (parts.length && parts[0].start === 1) d1Set.push(w);
  }
  console.log(`\n  【D1 模式集合】全库 words_i18n(ru) 中官方拆解 parts[0].start===1 的词 = ${d1Set.length} 词（测试 agent 说 321）`);
  console.log(`    样例：${d1Set.slice(0, 20).join(' ')}`);

  const before = kpi(GATES_STRICT);
  const after = kpi({ ...GATES_STRICT, gapMin: 1 });
  console.log(`\n  【修法A gapMin 2→1】尺子 R（分母 791）：`);
  console.log(`    指标              修前    修后    变化`);
  const row = (k, a, b) => console.log(`    ${k.padEnd(16)} ${String(a).padStart(4)}  ${String(b).padStart(6)}  ${(b - a >= 0 ? '+' : '') + (b - a)}`);
  row('覆盖率(非空)', before.hit, after.hit);
  row('★空洞≥3', before.deep, after.deep);
  row('空洞≥2', before.s2, after.s2);
  row('零空洞', before.zero, after.zero);
  row('空洞≤1', before.le1, after.le1);

  const d1After = d1Set.filter((w) => { const r = breakdownEx(w, 'ru', { ...GATES_STRICT, gapMin: 1 }); return r.parts.length && r.parts[0].start === 1; });
  const d1Gone = d1Set.filter((w) => !breakdownEx(w, 'ru', { ...GATES_STRICT, gapMin: 1 }).parts.length);
  const d1Re = d1Set.filter((w) => { const r = breakdownEx(w, 'ru', { ...GATES_STRICT, gapMin: 1 }); return r.parts.length && r.parts[0].start === 0; });
  console.log(`\n  【全库 ${d1Set.length} 词 D1 集的命运】`);
  console.log(`    ├ 仍以 gap=1 拆出（gap 被前缀解释）: ${d1After.length}`);
  console.log(`    ├ 不再拆出（误拆被消除）           : ${d1Gone.length}`);
  console.log(`    └ 改以 start=0 拆出（规则重排）    : ${d1Re.length}`);
  console.log(`    仍 gap=1 的样例：${d1After.slice(0, 20).join(' ')}`);

  const RAfter = new Map();
  for (const w of R) RAfter.set(w, breakdownEx(w, 'ru', { ...GATES_STRICT, gapMin: 1 }));
  const hurt = R.filter((w) => official.get(w).length && !RAfter.get(w).parts.length);
  console.log(`\n  【误伤检查】修前能拆、修后拆不了的尺子 R 词（n=${hurt.length}）：`);
  for (const w of hurt) {
    const p = official.get(w);
    console.log(`    ${w.padEnd(14)} 修前 {${p.map((x) => x.morpheme + '@' + x.start).join('+')}}  gap='${w.slice(0, p[0].start)}'`);
  }
  const unexplained = hurt.filter((w) => {
    const p = official.get(w);
    const gap = w.slice(0, p[0].start);
    return !MATCHERS.ru.all.some((x) => x.m.kind === 'prefix' && x.stem === gap);
  });
  console.log(`    其中 gap 无法被任何已知前缀解释（= 真·误拆，消除它正确）: ${unexplained.length}`);
  console.log(`    其中 gap 能被已知前缀解释（= 潜在误伤，需人工裁定）      : ${hurt.length - unexplained.length}`);

  console.log(`\n  【смекать 专项】`);
  for (const [label, g] of [['修前(gapMin=2)', GATES_STRICT], ['修法A(gapMin=1)', { ...GATES_STRICT, gapMin: 1 }], ['直接禁止gap=1', { ...GATES_STRICT, leadGapStrict: true }]]) {
    const r = breakdownEx('смекать', 'ru', g);
    console.log(`    ${label.padEnd(18)}: ${r.parts.length ? `{${r.parts.map((p) => p.morpheme + '@' + p.start).join('+')}} cov=${r.coverage.toFixed(2)}` : '—不可拆'}`);
  }
  console.log(`    （с- 是否为库内已知前缀：${MATCHERS.ru.all.some((x) => x.m.kind === 'prefix' && x.stem === 'с') ? '是 ⇒ gapExplain 自动放行 ✔' : '否'}）`);

  const afterB = kpi({ ...GATES_STRICT, leadGapStrict: true });
  console.log(`\n  【修法B 直接禁止 gap=1（无条件）】覆盖率 ${afterB.hit} / 空洞≥3 ${afterB.deep} / 空洞≥2 ${afterB.s2}`);
  const hurtB = R.filter((w) => official.get(w).length && !breakdownEx(w, 'ru', { ...GATES_STRICT, leadGapStrict: true }).parts.length);
  console.log(`    误伤 R 词数 = ${hurtB.length}（修法A 为 ${hurt.length}）`);
  const onlyB = hurtB.filter((w) => !hurt.includes(w));
  for (const w of onlyB) {
    const p = official.get(w);
    console.log(`      ✖ ${w} gap='${w.slice(0, p[0].start)}'（已知前缀）修前 {${p.map((x) => x.morpheme).join('+')}}`);
  }
  console.log(`\n  库内单字符前缀（gapExplain 可解释的 gap 字符集）: ${[...new Set(MATCHERS.ru.all.filter((x) => x.m.kind === 'prefix' && x.stem.length === 1).map((x) => x.stem))].sort().join(' ')}`);
  const gapChars = {};
  for (const w of R) { const p = official.get(w); if (p.length && p[0].start >= 1) { const c = w[0]; gapChars[c] = (gapChars[c] ?? 0) + 1; } }
  console.log(`  尺子 R 中 gap>=1 命中的词首字符分布: ${Object.entries(gapChars).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' ')}`);
}

db.close();
