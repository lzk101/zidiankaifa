/**
 * T19 主实验 §0–§5：V9-1/V9-2 机制判别（只读；禁写 src/test/词库）
 *
 * 判别对象：
 *   H-a 词素级负向规则（禁用「某词素在某位置/某上下文」）
 *   H-b 词素级共现约束（词素须与已知词根共现）
 *   H-c 词源链交叉核证（word_etymology.chain.parts）
 *   H-d 不可行 ⇒ 文档化
 *
 * §0 复刻保真自检（**中止式**：不一致即 exit 1，绝不降级为警告 —— 主管 T17 教训）
 * §1 33 条红逐条复现 + 归因
 * §2 ★ 关键判别：把每条断言在「拒绝拆解（parts=[]）」下的真值算出来
 *      ⇒ 区分「否决可修（veto-fixable）」vs「必须产出覆盖（coverage-required）」
 * §3 真词素在库可用性（决定 coverage-required 类能否在本迭代内修）
 * §4 H-a 全库病理普查 + 规则条数 + 误杀
 * §5 H-b 共现约束可行性
 *
 * 用法：node scripts/exp_v9_mechanism.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const E = '\u0451'; // ё
const norm = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');

/* ===================== 复刻引擎（含 KIND_RANK tie-break） ===================== */
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);
const ROW_CACHE = new Map();
function libRows(lang) {
  let r = ROW_CACHE.get(lang);
  if (!r) { r = db.prepare('SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang = ?').all(lang); ROW_CACHE.set(lang, r); }
  return r;
}
function buildMatchers(lang, extra = []) {
  const list = libRows(lang).map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind), meaningZh: r.meaning_zh ?? '', origin: r.origin ?? null }));
  for (const x of extra) list.push({ morpheme: x.morpheme, kind: x.kind, meaningZh: '', origin: null });
  // 复刻 packages/core/src/db/index.ts:691：按 kind 分组 + 组内串长降序
  list.sort((a, b) => {
    const k = (RANK[a.kind] ?? 3) - (RANK[b.kind] ?? 3);
    return k !== 0 ? k : String(b.morpheme).length - String(a.morpheme).length;
  });
  const isRu = lang === 'ru';
  const all = list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/\u0451/g, '\u0435') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[\u044c\u0439\u043e\u0430\u044f\u0435\u044b\u0438\u0443\u044e]$/.test(stem)) {
      const c = stem.slice(0, -1);
      if (c.length >= 3) patterns.push({ pat: c, core: true });
    }
    return { m, stem, patterns };
  });
  return { all, isRu };
}
const MATCHERS = { ru: buildMatchers('ru'), en: buildMatchers('en') };
const GATES_STRICT = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1 };

/**
 * @param veto (morpheme, kind, word, pos, stem) => boolean  —— H-a 钩子：true = 禁用该匹配
 * @param acceptStep (step) => boolean —— 预留
 */
function breakdownEx(word, lang, gates, bundle = null, veto = null) {
  const g = { ...GATES_STRICT, ...gates };
  const { all, isRu } = bundle ?? MATCHERS[lang];
  const w = norm(word);
  if (w.length < 2) return { parts: [], coverage: 0 };
  const mw = isRu ? w.replace(/\u0451/g, '\u0435') : w;
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
      if (veto && veto(m.morpheme, m.kind, w, pos, stem)) continue;
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
const bdEx = (w) => breakdownEx(w, 'ru', {}).parts;

/* ===================== §0 复刻保真自检（中止式） ===================== */
const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
let bad = 0; const ex = [];
for (const w of R) {
  const a = core.breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
  const b = bdEx(w).map((p) => `${p.morpheme}@${p.start}-${p.end}`).join('|');
  if (a !== b) { bad++; if (ex.length < 5) ex.push(`${w}: 官方=${a} 复刻=${b}`); }
}
console.log('='.repeat(80));
console.log(`§0 复刻保真自检（尺子 R ${R.length} 词）：不一致 ${bad} 例 ${bad ? '✗' : '✔'}`);
for (const e of ex) console.log('   ' + e);
if (bad) { console.log('⇒ 复刻不可信，后续数字作废，中止。'); db.close(); process.exit(1); }

/* ===================== 真实断言集（逐条照抄 ru_morph_defects.mjs 的判据） ===================== */
const partsOf = (w) => core.breakdownWord(db, w, 'ru');
const names = (w) => partsOf(w).map((p) => p.morpheme);
function holesOf(w, parts) {
  const cov = new Array(w.length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  const out = []; let run = -1;
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length && !cov[i]) { if (run < 0) run = i; } else if (run >= 0) { out.push([run, i, w.slice(run, i)]); run = -1; }
  }
  return out;
}
const holeLenOf = (w, parts) => holesOf(w, parts).reduce((s, [a, b]) => s + (b - a), 0);

/** 每条断言：{ id, cls, word, pred(parts) } —— parts 为引擎输出的片段数组 */
const FAMILY_A = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', `суч${E}ный`];
const A = [];
/* D2 */
A.push({ id: 'D2.1', cls: 'D2', word: 'землетрясение', desc: "不含 лет-", pred: (p) => !p.map((x) => x.morpheme).includes('лет-') });
A.push({ id: 'D2.2', cls: 'D2', word: 'землетрясение', desc: '空洞<3', pred: (p) => holeLenOf('землетрясение', p) < 3 });
A.push({ id: 'D2.3', cls: 'D2', word: 'водопад', desc: '空洞<3', pred: (p) => holeLenOf('водопад', p) < 3 });
/* D4 */
A.push({ id: 'D4.1', cls: 'D4', word: 'столп', desc: "不含 стол-", pred: (p) => !p.map((x) => x.morpheme).includes('стол-') });
A.push({ id: 'D4.2', cls: 'D4', word: 'казус', desc: "不含 каз-", pred: (p) => !p.map((x) => x.morpheme).includes('каз-') });
A.push({ id: 'D4.3', cls: 'D4', word: 'доминировать', desc: "不含 дом-", pred: (p) => !p.map((x) => x.morpheme).includes('дом-') });
A.push({ id: 'D4.4', cls: 'D4', word: 'больной', desc: '含 -ной', pred: (p) => p.map((x) => x.morpheme).some((m) => m.includes('ной')) });
A.push({ id: 'D4.5', cls: 'D4', word: 'самосуд', desc: '含 суд', pred: (p) => p.map((x) => x.morpheme).some((m) => m.includes('суд')) });
A.push({ id: 'D4.6', cls: 'D4', word: 'термостат', desc: "不得仅剥 термо-", pred: (p) => !(p.length === 1 && p[0].morpheme === 'термо-') });
/* V9-2 */
for (const w of FAMILY_A) {
  A.push({ id: `V92.${w}.i`, cls: 'V9-2', word: w, desc: "首片段≠уч-", pred: (p) => (p[0]?.morpheme ?? null) !== 'уч-' });
  A.push({ id: `V92.${w}.ii`, cls: 'V9-2', word: w, desc: '词首位置须被覆盖', pred: (p) => p.some((x) => x.start === 0 && x.end > 0) });
  A.push({ id: `V92.${w}.iii`, cls: 'V9-2', word: w, desc: "词首不得出现 уч-", pred: (p) => !p.some((x) => x.start === 0 && x.morpheme === 'уч-') });
}
A.push({ id: 'V92.однако.i', cls: 'V9-2', word: 'однако', desc: "首片段≠дн-", pred: (p) => (p[0]?.morpheme ?? null) !== 'дн-' });
A.push({ id: 'V92.однако.ii', cls: 'V9-2', word: 'однако', desc: '词首位置须被覆盖', pred: (p) => p.some((x) => x.start === 0 && x.end > 0) });
A.push({ id: 'V92.однако.iii', cls: 'V9-2', word: 'однако', desc: '词首不得出现 дн-', pred: (p) => !p.some((x) => x.start === 0 && x.morpheme === 'дн-') });

/* ===================== §1 现状复现 ===================== */
console.log('\n' + '='.repeat(80));
console.log('§1 现状：33 条红逐条复现（官方 engine）');
console.log('='.repeat(80));
const rows = A.map((a) => {
  const p = partsOf(a.word);
  return { ...a, parts: p, pass: a.pred(p) };
});
const reds = rows.filter((r) => !r.pass);
const byCls = {};
for (const r of rows) { byCls[r.cls] ??= { pass: 0, fail: 0 }; byCls[r.cls][r.pass ? 'pass' : 'fail']++; }
for (const r of rows) {
  if (r.pass) continue;
  console.log(`  ✗ ${r.id.padEnd(22)} ${r.desc.padEnd(18)} 实得=${JSON.stringify(r.parts.map((x) => `${x.morpheme}@${x.start}-${x.end}`))}`);
}
console.log(`\n  分类统计：${Object.entries(byCls).map(([k, v]) => `${k} ${v.pass}通过/${v.fail}失败`).join(' · ')}`);
// 本清单只含 D2(3) + D4(6) + V9-2(36) = 45 条；另 11 条绿断言（D1 7 + D3 2 + D5 2）不在本清单内。
// 主管口径的 56 = 45 + 11；红的 33 = 本清单的红 33 ⇒ 红集完全一致。
console.log(`  合计：${rows.length - reds.length} 通过 / ${reds.length} 失败（本清单 ${rows.length} 条 = D2 3 + D4 6 + V9-2 36；另 11 条常绿断言不在清单内）`);
console.log(`  对照主管口径：「23 通过 / 33 失败」中的 33 红 = 本清单 ${reds.length} 红 ${reds.length === 33 ? '✔ 完全一致' : '⚠ 不一致'}`);

/* ===================== §2 ★ 关键判别：REFUSE 测试 ===================== */
console.log('\n' + '='.repeat(80));
console.log('§2 ★ REFUSE 测试：若该词被「拒绝拆解」（返回 []），这条断言会不会变绿？');
console.log('   意义：任何「防假拆解」机制的本质都是**否决**（返回 [] 或抑制片段）。');
console.log('        被否决不掉的断言 = 必须**产出真实覆盖**才能绿 = 否决类机制原理上做不到。');
console.log('='.repeat(80));
let vetoFixable = 0, coverageReq = 0;
const vetoList = [], covList = [];
for (const r of reds) {
  const under = r.pred([]);
  if (under) { vetoFixable++; vetoList.push(r); } else { coverageReq++; covList.push(r); }
}
console.log(`\n  ★ 否决可修（parts=[] 即变绿）：${vetoFixable} 条`);
for (const r of vetoList) console.log(`      · ${r.id.padEnd(22)} ${r.desc}`);
console.log(`\n  ★ 必须产出覆盖（parts=[] 仍红）：${coverageReq} 条`);
for (const r of covList) console.log(`      · ${r.id.padEnd(22)} ${r.desc}  ← 需要引擎真的匹配出片段`);
console.log(`\n  ⇒ 结构上界：任何纯否决型机制最多消除 ${vetoFixable}/${reds.length} 条红；`);
console.log(`     余下 ${coverageReq} 条**只能靠「引擎新增可匹配的词素」**（=补词素，本迭代已排除）或改位置规则。`);

/* ===================== §3 真词素在库可用性 ===================== */
console.log('\n' + '='.repeat(80));
console.log('§3 相关词素在 morphemes(lang=ru) 中的可用性');
console.log('='.repeat(80));
const moStmt = db.prepare(`SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang='ru' AND morpheme = ?`);
const moLike = db.prepare(`SELECT morpheme, kind, meaning_zh FROM morphemes WHERE lang='ru' AND morpheme LIKE ?`);
const probe = ['суч-', 'уч-', 'дн-', 'суд-', 'суд', '-ной', '-ный', 'пад-', 'тряс-', 'зем-', 'земл-',
  'стол-', 'столп-', 'каз-', 'дом-', 'боль-', 'боль', 'термо-', 'стат-', 'само-', 'вод-', 'водо-', 'лет-', 'мал-', 'вер-', 'лес-', 'тел-'];
for (const m of probe) {
  const exact = moStmt.all(m);
  const like = exact.length ? [] : moLike.all(`%${m.replace(/^-+|-+$/g, '')}%`).slice(0, 4);
  if (exact.length) console.log(`  ✔ ${m.padEnd(9)} 在库  kind=${exact[0].kind}  义=${exact[0].meaning_zh ?? ''}  origin=${exact[0].origin ?? ''}`);
  else console.log(`  ✗ ${m.padEnd(9)} **不在库**${like.length ? `   近形: ${like.map((x) => x.morpheme + '(' + x.kind + ')').join(' ')}` : ''}`);
}

/* ===================== §4 H-a 全库病理普查 ===================== */
console.log('\n' + '='.repeat(80));
console.log('§4 H-a（词素级负向规则）可行性：全库病理普查');
console.log('='.repeat(80));
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const headDist = new Map();
const leadGap1 = [];
for (const w of ALL) {
  const p = bdEx(w);
  if (p.length >= 2 && p[0].start === 1) {
    leadGap1.push(w);
    const k = p[0].morpheme;
    headDist.set(k, (headDist.get(k) ?? 0) + 1);
  }
}
console.log(`  全库俄语词条            : ${ALL.length}`);
console.log(`  gap=1 且片段≥2 的词     : ${leadGap1.length}   ← 「字母级」判定的残余`);
console.log(`  首片段词素分布（全部）  :`);
[...headDist.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`      ${String(k).padEnd(10)} ×${v}`));

/* H-a 候选规则：禁用「该词素在某字符之后起于位置 1」
   度量：若禁用 (уч-@pos1 当 w[0]='с') 与 (дн-@pos1 当 w[0]='о')，R 与全库如何变 */
const rules = [
  { morpheme: 'уч-', afterFirst: 'с' },
  { morpheme: 'дн-', afterFirst: 'о' },
];
const vetoHa = (morph, kind, w, pos) => pos === 1 && rules.some((r) => r.morpheme === morph && r.afterFirst === w[0]);
let haChanged = 0; const haSamples = [];
for (const w of leadGap1) {
  const after = breakdownEx(w, 'ru', {}, null, vetoHa).parts;
  const before = bdEx(w);
  if (after.map((x) => x.morpheme).join('|') !== before.map((x) => x.morpheme).join('|')) {
    haChanged++;
    if (haSamples.length < 6) haSamples.push(`${w}: ${JSON.stringify(before.map((x) => x.morpheme))} → ${JSON.stringify(after.map((x) => x.morpheme))}`);
  }
}
console.log(`\n  H-a 候选规则 ${rules.length} 条：${rules.map((r) => `${r.morpheme} 不得在 '${r.afterFirst}' 之后起于 pos=1`).join('；')}`);
console.log(`  受影响词数（相对现状改变输出）: ${haChanged}`);
for (const s of haSamples) console.log(`      ${s}`);
let haFix = 0, haStill = 0;
for (const r of reds) {
  const p = breakdownEx(r.word, 'ru', {}, null, vetoHa).parts;
  if (r.pred(p)) haFix++; else haStill++;
}
console.log(`  ⇒ H-a 后仍红的断言: ${haStill}/${reds.length}（消除 ${haFix}）`);
console.log(`  ★ 规则条数问题：全库首片段词素共 ${headDist.size} 种；若每种的误判都需单独规则 → 规则数 ~${headDist.size}`);
console.log(`     但『哪些是误判』本身需要外部知识（词源）才能判定 ⇒ 规则表 = 人工枚举，无法自动生成`);

/* ===================== §5 H-b 共现约束 ===================== */
console.log('\n' + '='.repeat(80));
console.log('§5 H-b（词素级共现约束）可行性');
console.log('='.repeat(80));
for (const w of ['сучить', 'однако']) {
  const p = bdEx(w);
  console.log(`  ${w}: 现输出 ${JSON.stringify(p.map((x) => `${x.morpheme}@${x.start}`))}`);
  const need = w === 'сучить' ? 'суч-' : 'дн-';
  console.log(`     真词根候选 '${need}' 在库？ ${moStmt.all(need).length ? '在' : '**不在**'}`);
}
console.log('  ⇒ 若真词根不在库，H-b「要求与已知词根共现」等价于「把该词根加进库」');
console.log('     = 补词素（T17 已判定合法候选上限 33.88% 不可达 45%，本迭代已排除）');

db.close();
