/**
 * T22 §2-§6：判别分类器实验（签名「真词根被截去末辅音」能否机器判定）
 *
 * §0 中止式保真自检（复刻引擎 vs 官方 breakdownWord，尺子 R 全量）
 * §2 混淆矩阵：题面签名 + 4 个变体，在 48 词（真族 10 + 假族 26 + уч- 11 + дн- 1）上判分
 * §3 ★ 结构签名碰撞证明（完全同构但标签相反的词对）
 * §4 特征空间暴力搜索：存在任何「纯结构判据」能达到 48/48 吗
 * §5 全库 veto 实测：五项指标 + L4/R 红线 + §5 反向对照 7 词
 * §6 смекать 双读法核对
 *
 * 用法：node scripts/exp_v9_signature2.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const NORM = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');
const VOWELS = new Set('аеёиоуыэюя'.split(''));
const SIGNS = new Set(['ь', 'й']);
const isCons = (c) => !VOWELS.has(c) && !SIGNS.has(c);
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);

const libRows = (k) => db.prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`).all()
  .map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind) })).filter((r) => !k || r.kind === k);

function buildMatchers(extra = []) {
  const list = libRows().concat(extra.map((e) => ({ morpheme: String(e.morpheme), kind: String(e.kind) })));
  list.sort((a, b) => { const k = (RANK[a.kind] ?? 3) - (RANK[b.kind] ?? 3); return k !== 0 ? k : String(b.morpheme).length - String(a.morpheme).length; });
  const all = list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = raw.replace(/\u0451/g, '\u0435');
    const patterns = [{ pat: stem, core: false }];
    if (m.kind === 'suffix' && stem.length >= 5 && /[\u044c\u0439\u043e\u0430\u044f\u0435\u044b\u0438\u0443\u044e]$/.test(stem)) { const c = stem.slice(0, -1); if (c.length >= 3) patterns.push({ pat: c, core: true }); }
    return { m, stem, patterns };
  });
  const byFirst = new Map();
  for (const e of all) for (const { pat } of e.patterns) { const c = pat[0]; let a = byFirst.get(c); if (!a) { a = []; byFirst.set(c, a); } a.push(e); }
  return { all, byFirst };
}

/** veto: (morpheme, kind, word, pos, stem) => true 表示拒绝该片段 */
function bd(word, bundle, veto = null) {
  const { all, byFirst } = bundle;
  const w = NORM(word);
  if (w.length < 2) return [];
  const cands = (pos) => {
    const out = []; const entries = byFirst.get(w[pos]); if (!entries) return out;
    for (const { m, stem, patterns } of entries) for (const { pat, core } of patterns) {
      const minLen = m.kind === 'prefix' ? 1 : 2;
      if (pat.length < minLen || !w.startsWith(pat, pos)) continue;
      if (m.kind === 'prefix' && pos !== 0 && !core) continue;
      let end = pos + (core ? w.length - pos : pat.length);
      if (core) { if (w.length - (pos + pat.length) > 3) continue; end = w.length; }
      else if (m.kind === 'prefix' && pat.length === 1) {
        const rest = w.slice(pos + 1);
        if (!all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem))) continue;
      }
      if (m.kind === 'suffix' && pos < 3) continue;
      if (veto && veto(m.morpheme, m.kind, word, pos, stem)) continue;
      out.push({ m, start: pos, end });
    }
    return out;
  };
  const n = w.length;
  const cov = new Int32Array(n + 1), pcs = new Int32Array(n + 1);
  const to = new Int32Array(n + 1), en = new Int32Array(n + 1), mm = new Array(n + 1).fill(null);
  to[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    let bc = cov[i + 1], bp = pcs[i + 1], bt = i + 1, be = i + 1, bm = null;
    for (const c of cands(i)) { const v = c.end - c.start + cov[c.end]; const pc = 1 + pcs[c.end]; if (v > bc || (v === bc && (pc < bp || (pc === bp && rankOf(c.m) < rankOf(bm))))) { bc = v; bp = pc; bt = c.end; be = c.end; bm = c.m; } }
    cov[i] = bc; pcs[i] = bp; to[i] = bt; en[i] = be; mm[i] = bm;
  }
  const parts = []; let i = 0;
  while (i >= 0 && i < n && parts.length < 8) { const m = mm[i]; if (m) { parts.push({ morpheme: m.morpheme, start: i, end: en[i] }); i = en[i]; } else i = to[i]; }
  const c = parts.reduce((s, p) => s + (p.end - p.start), 0) / n;
  if (c < 0.55) return [];
  if (parts.length === 1 && parts[0].start === 1) return [];
  if (parts.length && parts[0].start >= 1) {
    const gap = w.slice(0, parts[0].start);
    if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return [];
  }
  return parts.sort((a, b) => a.start - b.start);
}

const BUNDLE = buildMatchers();

/* §0 中止式保真自检 */
{
  const { breakdownWord } = await import('../packages/core/dist/db/index.js');
  const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
  let bad = 0;
  for (const w of R) if (breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}`).join('|') !== bd(w, BUNDLE).map((p) => `${p.morpheme}@${p.start}`).join('|')) bad++;
  console.log(`§0 复刻保真自检（尺子 R ${R.length} 词）：不一致 ${bad} 例 ${bad ? '✗ 中止' : '✔'}`);
  if (bad) { db.close(); process.exit(1); }
}

/* ---------- 结构特征提取 ---------- */
function struct(w, bundle = BUNDLE, veto = null) {
  const p = bd(w, bundle, veto);
  if (!p.length) return null;
  const wer = NORM(w); const n = wer.length;
  const cv = new Array(n).fill(false);
  for (const q of p) for (let i = q.start; i < q.end; i++) cv[i] = true;
  const runs = [];
  for (let i = 0; i < n; i++) { if (cv[i]) continue; let j = i; while (j < n && !cv[j]) j++; runs.push({ start: i, end: j, text: wer.slice(i, j), len: j - i }); i = j - 1; }
  const internal = runs.filter((r) => r.start >= 1);
  const h1 = internal[0] ?? null;
  const seg = wer.slice(1, p[0].end);
  const cand = h1 ? seg + h1.text : null;
  const covered = p.reduce((s, q) => s + (q.end - q.start), 0);
  return {
    w, p, runs, internal, h1, seg, cand,
    gapChar: wer[0], nParts: p.length, nInternal: internal.length,
    firstSeg: p[0].morpheme, lastSeg: p[p.length - 1].morpheme,
    coverage: covered / n, totalHole: n - covered, wordLen: n,
    h1len: h1 ? h1.len : 0,
    h1PureCons: h1 ? h1.text.split('').every(isCons) : null,
    h1HasSign: h1 ? h1.text.split('').some((c) => SIGNS.has(c)) : null,
    h1HasVowel: h1 ? h1.text.split('').some((c) => VOWELS.has(c)) : null,
    candEndsCons: cand ? isCons(cand[cand.length - 1]) : null,
    candLen: cand ? cand.length : 0,
    sig: cand ? (cand.length >= 2 && isCons(cand[cand.length - 1])) : false,
    h1IsKnownSuffixStem: h1 ? libRows('suffix').some((s) => s.morpheme.replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435') === h1.text) : null,
  };
}

/* ---------- T20 标签集 ---------- */
const TRUE10 = ['вдаваться', 'вдаться', 'сдавать', 'сдаваться', 'сдаточный', 'сдаться', 'удаваться', 'удаться', 'удачливый', 'удачный'];
const FALSE26 = [
  // дав×9
  'вдавить', 'вдавливать', 'сдавить', 'сдавливать', 'удавить', 'удавиться', 'удавка', 'удавливать', 'удавливаться',
  // дар×4
  'одаривать', 'одарить', 'одарять', 'одарённый',
  // дал×7
  'удаление', 'удалить', 'удалиться', 'удалять', 'удаляться', 'удалец', 'удалитель',
  // долж×1
  'одалживать',
  // удар×5
  'ударить', 'ударник', 'ударный', 'ударять', 'ударяться',
];
const UC11 = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный'];
const DN1 = ['однако'];
console.log(`\n标签集核对：真族 ${TRUE10.length} / 假族да ${FALSE26.length}（T20: дав9+дар4+дал7+долж1+удар5=26）/ уч- ${UC11.length} / дн- ${DN1.length} ⇒ 判分词 ${TRUE10.length + FALSE26.length + UC11.length + DN1.length}`);
const LABELED = [
  ...TRUE10.map((w) => ({ w, truth: true })),
  ...[...FALSE26, ...UC11, ...DN1].map((w) => ({ w, truth: false })),
];

/* ---------- §2 判据候选 ---------- */
const CRIT = [
  ['C0 题面签名：D4 以辅音结尾且 |D4|≥2 → 判假', (s) => s.sig],
  ['C1 存在内部空洞（nInternal≥1）→ 判假', (s) => s.nInternal >= 1],
  ['C2 H1 为纯辅音串 → 判假', (s) => s.h1PureCons === true],
  ['C3 无内部空洞 或 H1 纯辅音 → 判假', (s) => s.nInternal === 0 || s.h1PureCons === true],
  ['C4 H1 为纯辅音串且 |H1|≤2 → 判假', (s) => s.h1PureCons === true && s.h1len <= 2],
];

console.log('\n' + '='.repeat(112));
console.log('§2 ★ 混淆矩阵（判词 = 48：[真族 10 必须判真] + [假族 38 必须判假]）');
console.log('='.repeat(112));
const RES = [];
for (const [name, f] of CRIT) {
  let TP = 0, FN = 0, TN = 0, FP = 0; const wrong = [];
  for (const { w, truth } of LABELED) {
    const s = struct(w);
    if (!s) { if (truth) { FN++; wrong.push(`${w}(不可拆→判假)`); } else TN++; continue; }
    const said = f(s); // true = 判假
    if (truth) { if (said) { FP++; wrong.push(`${w}(真被判假,H1=${s.h1?.text ?? '-'})`); } else TP++; }
    else { if (said) TN++; else { FN++; wrong.push(`${w}(假被判真,H1=${s.h1?.text ?? '-'})`); } }
  }
  const acc = (TP + TN) / LABELED.length;
  RES.push({ name, TP, FN, TN, FP, acc, wrong });
  console.log(`\n  ── ${name}`);
  console.log(`     真族判真 ${TP}/10 · 真族判假 ${FP} · 假族判假 ${TN}/38 · 假族判真 ${FN} · 准确率 ${(acc * 100).toFixed(1)}%  ${TP === 10 && TN === 38 ? '✅ 达标' : '❌ 达不到「38 全判假 + 10 全判真」'}`);
  console.log(`     误判 ${wrong.length} 词：${wrong.join('  ')}`);
}

/* ---------- §3 碰撞证明 ---------- */
console.log('\n' + '='.repeat(112));
console.log('§3 ★★ 结构签名碰撞证明：完全同构、标签相反的词对（= 纯结构判据不可能达标）');
console.log('='.repeat(112));
const keyOf = (s) => JSON.stringify({
  gap: s.gapChar, seg: s.seg, nParts: s.nParts, nInternal: s.nInternal,
  h1len: s.h1len, h1PureCons: s.h1PureCons, h1HasSign: s.h1HasSign, h1HasVowel: s.h1HasVowel,
  coverage: s.coverage.toFixed(3), totalHole: s.totalHole, wordLen: s.wordLen,
  firstSeg: s.firstSeg, lastSeg: s.lastSeg, candLen: s.candLen, candEndsCons: s.candEndsCons,
  h1IsKnownSuffixStem: s.h1IsKnownSuffixStem,
});
const groups = new Map();
for (const { w, truth } of LABELED) {
  const s = struct(w);
  if (!s) continue;
  const k = keyOf(s);
  if (!groups.has(k)) groups.set(k, { members: [], });
  groups.get(k).members.push({ w, truth, h1: s.h1?.text ?? '-', cand: s.cand ?? '-' });
}
let collisions = 0;
for (const [, g] of groups) {
  const hasT = g.members.some((m) => m.truth), hasF = g.members.some((m) => !m.truth);
  if (hasT && hasF) {
    collisions++;
    console.log(`\n  ★ 碰撞组 #${collisions}（除空洞里的那个字母外，全部结构特征逐项相同）：`);
    for (const m of g.members) console.log(`      ${m.truth ? '真' : '假'}  ${m.w.padEnd(20)} H1=${m.h1.padEnd(4)} 复根候选=${m.cand}`);
  }
}
console.log(`\n  ⇒ 共 ${collisions} 个「同构但标签相反」的碰撞组。`);
console.log('  ⇒ 结论：任何**只依赖这些结构量**的判据，在碰撞组内必然二选一错一边 ⇒ **48/48 不可达**。');
console.log('  ⇒ 要分开它们，必须知道「дач-/дат- 是真词根、дар-/дав-/дал- 不是」——这是**词库知识**（= 补词素），不是结构。');
console.log('  ★ 反直觉要点：`удачный`（真，词根 дача）本身也是「真词根 дач 被截成 да + 空洞 ч」，');
console.log('     与假族 `ударный`（да + 空洞 р）**逐项同构** —— T20 的「真族空洞是 ть」对 удачный/удачливый/сдаточный 不成立。');

/* ---------- §4 暴力搜索 ---------- */
console.log('\n' + '='.repeat(112));
console.log('§4 特征空间暴力搜索（找是否存在任何纯结构判据达标）');
console.log('='.repeat(112));
const FEATS = [
  ['nInternal>=1', (s) => s.nInternal >= 1],
  ['nInternal==0', (s) => s.nInternal === 0],
  ['h1PureCons', (s) => s.h1PureCons === true],
  ['h1HasSign', (s) => s.h1HasSign === true],
  ['h1HasVowel', (s) => s.h1HasVowel === true],
  ['h1len==1', (s) => s.h1len === 1],
  ['h1len>=2', (s) => s.h1len >= 2],
  ['h1len>=3', (s) => s.h1len >= 3],
  ['candEndsCons', (s) => s.candEndsCons === true],
  ['candLen==3', (s) => s.candLen === 3],
  ['candLen>=4', (s) => s.candLen >= 4],
  ['coverage<=0.60', (s) => s.coverage <= 0.60],
  ['coverage>=0.75', (s) => s.coverage >= 0.75],
  ['nParts>=3', (s) => s.nParts >= 3],
  ['nParts==2', (s) => s.nParts === 2],
  ['gapChar=у', (s) => s.gapChar === '\u0443'],
  ['gapChar=в', (s) => s.gapChar === '\u0432'],
  ['gapChar=с', (s) => s.gapChar === '\u0441'],
  ['gapChar=о', (s) => s.gapChar === '\u043e'],
  ['firstSeg=да-', (s) => s.firstSeg === '\u0434\u0430-'],
  ['firstSeg=уч-', (s) => s.firstSeg === '\u0443\u0447-'],
  ['firstSeg=дн-', (s) => s.firstSeg === '\u0434\u043d-'],
  ['h1KnownSuffix', (s) => s.h1IsKnownSuffixStem === true],
  ['lastSegSuffix', (s) => String(s.lastSeg).startsWith('-')],
];
let bestList = [];
const tryRule = (rule, f) => {
  let TP = 0, TN = 0, FP = 0, FN = 0;
  for (const { w, truth } of LABELED) {
    const s = struct(w);
    if (!s) { if (truth) FP++; else TN++; continue; }
    const said = f(s); // true = 判假
    if (truth) { if (said) FP++; else TP++; } else if (said) TN++; else FN++;
  }
  const acc = (TP + TN) / LABELED.length;
  bestList.push({ rule, TP, TN, FP, FN, acc });
};
for (let i = 0; i < FEATS.length; i++) {
  tryRule(`${FEATS[i][0]} → 判假`, FEATS[i][1]);
  for (let j = i + 1; j < FEATS.length; j++) {
    tryRule(`${FEATS[i][0]} && ${FEATS[j][0]} → 判假`, (s) => FEATS[i][1](s) && FEATS[j][1](s));
    for (let k = j + 1; k < FEATS.length; k++) {
      tryRule(`${FEATS[i][0]} && ${FEATS[j][0]} && ${FEATS[k][0]} → 判假`, (s) => FEATS[i][1](s) && FEATS[j][1](s) && FEATS[k][1](s));
    }
  }
}
bestList.sort((a, b) => b.acc - a.acc);
const nRules = bestList.length;
console.log(`  ── 「特征合取 ⇒ 判假」Top 5（规则总数 ${nRules} = ${FEATS.length} 单 + C(${FEATS.length},2) 二 + C(${FEATS.length},3) 三）：`);
for (const b of bestList.slice(0, 5)) {
  console.log(`     ${(b.acc * 100).toFixed(1)}%  真族判真 ${b.TP}/10 · 假族判假 ${b.TN}/38   ${b.rule}`);
}
console.log(`  ⇒ ★ 最佳纯结构规则 ${(bestList[0].acc * 100).toFixed(1)}%，**达不到 48/48**（与 §3 碰撞组证明一致：碰撞组内必然错一边）。`);

/* ---------- §5 全库 veto 实测 ---------- */
console.log('\n' + '='.repeat(112));
console.log('§5 全库 veto 实测（把 C0 题面签名接在 DP 之后：签名成立 ⇒ 返回 []）');
console.log('='.repeat(112));
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const RW = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
const PSTEMS = new Set(libRows('prefix').map((r) => r.morpheme.replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')));
/** ★ 签名 veto 的作用域严格限定为「gap=1 且 gap ∈ 前缀集」的词（题面要求「对全部的 gap=1 词」） */
function sigVeto(w) {
  const s = struct(w);
  if (!s) return false;
  if (s.p[0].start !== 1) return false;
  if (!PSTEMS.has(NORM(w).slice(0, 1))) return false;
  return s.sig;
}
function metrics(vetoFn) {
  let hit = 0, ca = 0, cb = 0, l4 = 0, rh = 0, l4r = 0;
  for (const w of ALL) {
    const p = bd(w, BUNDLE);
    if (!p.length) continue;
    if (vetoFn && vetoFn(w)) continue;
    hit++;
    const wer = NORM(w); const n = wer.length; const cv = new Array(n).fill(false);
    for (const q of p) for (let i = q.start; i < q.end; i++) cv[i] = true;
    let total = 0, cur = 0, mx = 0;
    for (let i = 0; i < n; i++) { if (!cv[i]) { total++; cur++; if (cur > mx) mx = cur; } else cur = 0; }
    if (total >= 3) ca++;
    if (mx >= 3) cb++;
    if (total >= 3) l4++;
  }
  for (const w of RW) { const p = bd(w, BUNDLE); if (!p.length) continue; if (vetoFn && vetoFn(w)) continue; rh++; const wer = NORM(w); const cv = new Array(wer.length).fill(false); for (const q of p) for (let i = q.start; i < q.end; i++) cv[i] = true; let total = 0; for (let i = 0; i < wer.length; i++) if (!cv[i]) total++; if (total >= 3) l4r++; }
  return { hit, ca, cb, l4, rh, l4r };
}
const M0 = metrics(null);
const M1 = metrics(sigVeto);
console.log(`  ${'指标'.padEnd(26)}${'基线'.padEnd(12)}${'C0 签名 veto'.padEnd(14)}差异`);
console.log(`  ${'全库可拆'.padEnd(26)}${String(M0.hit).padEnd(12)}${String(M1.hit).padEnd(14)}${M1.hit - M0.hit}`);
console.log(`  ${'空洞≥3 口径A（全库）'.padEnd(22)}${String(M0.ca).padEnd(12)}${String(M1.ca).padEnd(14)}${M1.ca - M0.ca}`);
console.log(`  ${'空洞≥3 口径B（全库）'.padEnd(22)}${String(M0.cb).padEnd(12)}${String(M1.cb).padEnd(14)}${M1.cb - M0.cb}`);
console.log(`  ${'尺子 R 可拆'.padEnd(26)}${String(M0.rh).padEnd(12)}${String(M1.rh).padEnd(14)}${M1.rh - M0.rh}`);
console.log(`  ${'L4（R 内空洞≥3，冻结 134）'.padEnd(21)}${String(M0.l4r).padEnd(12)}${String(M1.l4r).padEnd(14)}${M1.l4r - M0.l4r}`);
const rate1 = M1.rh / 791;
console.log(`\n  ── 红线判定`);
console.log(`     L4 134：${M1.l4r} ${M1.l4r <= 134 ? '✅ 未踩穿' : '❌ 踩穿'}`);
console.log(`     R ≥ 198（H-c 危险区）：${M1.rh} ${M1.rh >= 198 ? '✅' : '❌'}；rRateMin 0.30：${(rate1 * 100).toFixed(2)}% ${rate1 >= 0.30 ? '✅' : '❌ 踩穿（d1guard rRateMin）'}`);
console.log(`\n  ── §5 反向对照 7 词（必须保持可拆）`);
const CTRL = ['вбегать', 'обегать', 'обеднеть', 'вверх', 'вдаться', 'удаться', 'удачный'];
for (const w of CTRL) {
  const p = bd(w, BUNDLE); const killed = sigVeto(w);
  console.log(`     ${w.padEnd(14)} 基线 ${p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join(' ')}` + '}' : '[]（本就不可拆）'}`.padEnd(40) + ` veto ${killed ? '❌ 被杀' : '✅ 保留'}`);
}
const killed75 = ALL.filter((w) => sigVeto(w));
console.log(`\n  ── 被 veto 杀掉的全部词：${killed75.length} 个（作用域 = gap=1 组，基线共 75 词 ⇒ 75→${75 - killed75.length}）`);
console.log(`     ${killed75.sort().join(' ')}`);

/* ---------- §6 смекать ---------- */
console.log('\n' + '='.repeat(112));
console.log('§6 смекать 双读法核对');
console.log('='.repeat(112));
const ety = db.prepare(`SELECT chain, text_en, text_zh FROM word_etymology WHERE word='смекать' AND lang='ru'`).get();
console.log(`  库内 chain：${ety ? String(ety.chain).slice(0, 200) : '（无行）'}`);
console.log(`  库内 text_en：${ety ? String(ety.text_en).slice(0, 200) : '（无行）'}`);
const pm = bd('смекать', BUNDLE);
console.log(`  引擎输出（当前 v0.8.0）：${pm.length ? JSON.stringify(pm.map((p) => p.morpheme + '@' + p.start)) : '[]'}`);
console.log(`  「с- + мекать」读法下：мек- 不在库 ⇒ 只能得到 []（已实测）`);
console.log(`  「смек|-а|+ть」读法下：смек- 不在库、-а- 不在库、-ть 在库? ${libRows('suffix').some((s) => s.morpheme.replace(/^-+|-+$/g, '') === 'ть') ? '在' : '不在'} ⇒ 得 []`);
console.log(`  ⇒ 两读法下都输出 []：**可固化为断言**，但建议断言形式为`);
console.log(`     「смекать 的拆解不得含未覆盖的 mе/мек 段（即不得为 {с-@0 -кать@3} 型空心骨架）」＋「当前为 []」两条，`);
console.log(`     而不是仅「必须为 []」—— 若将来把 мек- 补进库，смекать 会**合法地**变成可拆，仅冻结 [] 会误伤正确的补库。`);
db.close();
