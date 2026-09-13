// T28 · 变体探针：用「dist 副本 + 内存注入 + 候选生成期阻断规则」独立复现 T24 的 V0 / H-a / P1 / P2 / P3。
// 与开发 agent 的实现独立：我不复刻算法，直接复用编译产物（仅加两个钩子，见 scripts/_tmp/patch_eng_t28.mjs）。
// 口径全部显式；每个变体都同时算：全库可拆 / 口径A / 口径B / 真前缀组 / да- 子集 / 尺子R / L4 / 判据①替代量 / 30 条红。
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const dbPath = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');

const FIX = await import('./_tmp/eng_t28/db/index.js');
const PRE = await import('./_tmp/eng_t28_pre/db/index.js');

const db = new DatabaseSync(dbPath);
const P1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => w.trim().toLowerCase().replace(/ё/g, 'е');

/* ---------------- 注入件（照 T24 的候选定义） ---------------- */
const mk = (morpheme, kind, zh, en, origin, examples) => ({ morpheme, kind, meaningZh: zh, meaningEn: en, origin, examples });
const INJ_P1 = [
  mk('суч-', 'root', '节，枝；搓', 'knot, twig', 'Proto-Slavic *sučiti / *sǫkъ', ['сучок', 'сучковатый', 'сучковый']),
  mk('суд-', 'root', '审判；判断', 'judgement', 'Proto-Slavic *sǫdъ', ['самосуд', 'суд']),
  mk('стат-', 'root', '站立的，稳定的', 'standing, stable', 'Ancient Greek στᾰτός', ['термостат']),
  mk('домин-', 'root', '支配', 'dominate', 'Latin dominus', ['доминировать']),
];
const INJ_BOOT = [
  mk('столп-', 'root', '柱，塔', 'pillar', 'Proto-Slavic *stъlpъ', ['столп']),
  mk('казус-', 'root', '案件；怪事', 'case', 'Latin cāsus', ['казус']),
  mk('однако-', 'root', '然而', 'however', '-', ['однако']),
];
const INJ_NOI = [
  mk('-ной', 'suffix', '……的（形容词后缀）', '-', 'Proto-Slavic *-ьnъ', ['больной']),
];
const P2 = [...INJ_P1, ...INJ_BOOT];
const P3 = [...P2, ...INJ_NOI];

/* H-a：两条人工负向规则（候选生成期生效） */
const HA = (mw, pos, pat) => {
  if (pos !== 1) return false;
  if (mw[0] === 'с' && pat === 'уч') return true;   // уч- 不得在 с 后起于 pos=1
  if (mw[0] === 'о' && pat === 'дн') return true;   // дн- 不得在 о 后起于 pos=1
  return false;
};

/* ---------------- 空洞 ---------------- */
function holes(parts, n) {
  if (!parts.length) return { total: n, max: n };
  const iv = parts.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
  const runs = [];
  let cur = 0;
  for (const [s, e] of iv) { if (s > cur) runs.push(s - cur); cur = Math.max(cur, e); }
  if (cur < n) runs.push(n - cur);
  return { total: runs.reduce((a, b) => a + b, 0), max: runs.length ? Math.max(...runs) : 0 };
}

const key = (parts) => parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');

/* ---------------- 30 条红（v0.9.0 目标口径：D4 6 + V9-2 24） ---------------- */
const SENT = ['удачный', 'вдаться', 'вдавить', 'ударить', 'сдабривать', 'одалживать', 'смекать', 'вода', 'экстатический', 'поднаковальня', 'поднакопить', 'столп', 'казус', 'доминировать', 'больной', 'самосуд', 'термостат', 'сучок', 'однако', 'астатизм', 'гигростат'];
const SUCH = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный'];
const D4A = [['столп', 'стол-'], ['казус', 'каз-'], ['доминировать', 'дом-']];
const D4B = [['больной', '-ной'], ['самосуд', 'суд-'], ['термостат', 'стат-']];
const RED_WORDS = [...SUCH, 'однако', ...D4A.map((x) => x[0]), ...D4B.map((x) => x[0])];

function redsOf(bdOf) {
  const P = (w) => bdOf(w);
  const head = (w) => P(w)[0]?.morpheme ?? null;
  const cov0 = (w) => P(w).some((p) => p.start === 0 && p.end > 0);
  const has = (w, m) => P(w).some((p) => p.morpheme === m);
  const reds = [];
  for (const w of SUCH) {
    if (head(w) === 'уч-') reds.push(`${w} .i 首片段=уч-`);
    if (!cov0(w)) reds.push(`${w} .ii 词首未覆盖`);
  }
  if (head('однако') === 'дн-') reds.push('однако .i 首片段=дн-');
  if (!cov0('однако')) reds.push('однако .ii 词首未覆盖');
  for (const [w, m] of D4A) if (has(w, m)) reds.push(`${w} 含巧合词根 ${m}`);
  for (const [w, m] of D4B) if (!has(w, m)) reds.push(`${w} 缺真词素 ${m}`);
  return reds;
}

/* ---------------- 一次完整评估 ---------------- */
const allWords = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' ORDER BY rowid").all().map((r) => r.word);
const R = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0").all().map((r) => r.word);

function evaluate(name, inject, block) {
  FIX.__setInjected(inject); FIX.__setBlock(block);
  PRE.__setInjected(inject); PRE.__setBlock(block);
  const bd = (w) => FIX.breakdownWord(db, w, 'ru');
  const bdPre = (w) => PRE.breakdownWord(db, w, 'ru');

  let split = 0, A = 0, B = 0, realPrefix = 0, da = 0, preGap1 = 0, zero = 0, le1 = 0, ge2 = 0;
  const partsByWord = new Map();
  const holeByWord = new Map();
  for (const w of allWords) {
    const p = bd(w);
    partsByWord.set(w, key(p));
    const n = norm(w).length;
    holeByWord.set(w, p.length ? holes(p, n).total : n);
    if (p.length) {
      split++;
      const h = holes(p, n);
      if (h.total >= 3) A++;
      if (h.max >= 3) B++;
      if (h.total === 0) zero++;
      if (h.total <= 1) le1++;
      if (h.total >= 2) ge2++;
      if (p.length >= 2 && p[0].start === 1 && P1.has(norm(w)[0])) {
        realPrefix++;
        if (p[0].morpheme === 'да-') da++;
      }
    }
    const pp = bdPre(w);
    if (pp.length >= 2 && pp[0].start === 1) preGap1++;
  }
  let rSplit = 0, rA = 0, rB = 0, rZero = 0, rLe1 = 0;
  for (const w of R) {
    const p = bd(w); const n = norm(w).length;
    if (!p.length) continue;
    rSplit++;
    const h = holes(p, n);
    if (h.total >= 3) rA++;
    if (h.max >= 3) rB++;
    if (h.total === 0) rZero++;
    if (h.total <= 1) rLe1++;
  }
  const reds = redsOf(bd);
  const samples = {};
  for (const w of [...SENT, ...RED_WORDS]) samples[w] = key(bd(w)) || '[]';
  return { name, inject: inject.length, split, A, B, realPrefix, da, rSplit, rA, rB, rZero, rLe1, zero, le1, ge2, preGap1, reds, samples, partsByWord, holeByWord };
}

const VARIANTS = [
  ['V0   生产态', [], null],
  ['H-a  两条负向规则', [], HA],
  ['P1   H-a+суч/суд/стат/домин', INJ_P1, HA],
  ['P2   P1+3 整词兜底', P2, HA],
  ['P3   P2+-ной', P3, HA],
  ['P2-n  P2 但不加 H-a', P2, null],
  ['P3-n  P3 但不加 H-a', P3, null],
];

const res = VARIANTS.map(([n, i, b]) => evaluate(n, i, b));
const V0 = res[0];

console.log('════ T28 §3-debug res 数组身份核验 ════');
res.forEach((r, i) => console.log(`  res[${i}] name=${JSON.stringify(r.name)} inject=${r.inject} split=${r.split} A=${r.A} B=${r.B} R=${r.rSplit} L4A=${r.rA} 判据①=${r.preGap1} 红=${r.reds.length} 同对象?res[0]=${r === res[0]}`));
console.log('  互异对象数 = ' + new Set(res).size + ' / ' + res.length);

console.log('════ T28 §3 变体全指标（我的独立注入引擎）════');
console.log('变体'.padEnd(30) + '可拆    口径A   A率%     口径B   B率%     真前缀 да-  R   R率%    L4A L4B  零空洞 ≤1  ≥2  判据① 30红');
for (const r of res) {
  console.log(
    r.name.padEnd(28) +
    String(r.split).padStart(6) + ' ' +
    String(r.A).padStart(6) + ' ' +
    (100 * r.A / r.split).toFixed(4).padStart(8) + ' ' +
    String(r.B).padStart(6) + ' ' +
    (100 * r.B / r.split).toFixed(4).padStart(8) + ' ' +
    String(r.realPrefix).padStart(5) + ' ' +
    String(r.da).padStart(4) + ' ' +
    String(r.rSplit).padStart(4) + ' ' +
    (100 * r.rSplit / R.length).toFixed(4).padStart(7) + ' ' +
    String(r.rA).padStart(4) + ' ' +
    String(r.rB).padStart(4) + ' ' +
    String(r.zero).padStart(5) + ' ' +
    String(r.le1).padStart(3) + ' ' +
    String(r.ge2).padStart(4) + ' ' +
    String(r.preGap1).padStart(5) + ' ' +
    String(r.reds.length).padStart(3),
  );
}

console.log('\n── 逐词差分（相对 V0，parts 逐项比对全库 ' + allWords.length + ' 词）──');
for (const r of res.slice(1)) {
  const loses = [], gains = [], changed = [];
  for (const w of allWords) {
    const a = V0.partsByWord.get(w), b = r.partsByWord.get(w);
    if (a === b) continue;
    if (a !== '' && b === '') loses.push(w);
    else if (a === '' && b !== '') gains.push(w);
    else changed.push(w);
  }
  console.log(`\n【${r.name}】loses=${loses.length} gains=${gains.length} parts变但仍有拆解=${changed.length}`);
  if (loses.length) console.log('  ★ loses（真回归）：' + loses.map((w) => `${w}: ${V0.partsByWord.get(w)} → []`).join(' | '));
  if (gains.length && gains.length <= 60) console.log('  gains：' + gains.join(' '));
  else if (gains.length) console.log(`  gains（${gains.length} 个，前 40）：` + gains.slice(0, 40).join(' '));
  if (r.reds.length) console.log('  余红：' + r.reds.join(' / '));
  else console.log('  余红：0 ✔');
}

console.log('\n── 关键哨兵逐词（各变体，取自各变体自身评估）──');
console.log('词'.padEnd(18) + res.map((r) => r.name.split(' ')[0].padEnd(24)).join(''));
for (const w of SENT) {
  console.log(w.padEnd(18) + res.map((r) => (r.samples[w] ?? '[]').padEnd(24)).join(''));
}

/* ================= §4 H-a 在注入后是否仍起作用（全量逐词） ================= */
// 按 VARIANTS 位置索引取记录（V0=0 H-a=1 P1=2 P2=3 P3=4 P2-n=5 P3-n=6），不用名字索引。
console.log('\n════ T28 §4 「H-a 是否被注入包完全吸收」全量逐词判定 ════');
{
  const iHyphenP2 = res[3], iP2n = res[5], iP3 = res[4], iP3n = res[6];
  for (const [a, A, B] of [['P2', iHyphenP2, iP2n], ['P3', iP3, iP3n]]) {
    const diff = [];
    for (const w of allWords) if (A.partsByWord.get(w) !== B.partsByWord.get(w)) diff.push(w);
    console.log(`${a}（含 H-a） vs ${a}-n（不含 H-a）：逐词差异 = ${diff.length} 词 ${diff.length === 0 ? '⇒ H-a 被完全吸收 ✔' : '⇒ H-a 仍起作用'}`);
    if (diff.length) console.log('   ' + diff.slice(0, 40).map((w) => `${w}: ${A.partsByWord.get(w)} | ${B.partsByWord.get(w)}`).join('\n   '));
    const metrics = ['split', 'A', 'B', 'realPrefix', 'da', 'rSplit', 'rA', 'rB', 'preGap1'];
    const bad = metrics.filter((k) => A[k] !== B[k]);
    console.log(`   八项指标差异字段 = ${bad.length ? bad.join(',') : '无（全部相同）'}  [${a}: split=${A.split} A=${A.A} B=${A.B} R=${A.rSplit} L4A=${A.rA} 判据①=${A.preGap1}]`);
  }
}

/* ================= §5 P2 → P3（加 -ной）高危面逐词 ================= */
console.log('\n════ T28 §5 P2 → P3（加 -ной）高危面逐词 ════');
{
  const P2r = res[3], P3r = res[4];
  console.log(`（自检：P2.A=${P2r.A} P2.split=${P2r.split} | P3.A=${P3r.A} P3.split=${P3r.split}）`);
  const loses = [], gains = [], changed = [];
  for (const w of allWords) {
    const a = P2r.partsByWord.get(w), b = P3r.partsByWord.get(w);
    if (a === b) continue;
    if (a !== '' && b === '') loses.push([w, a]);
    else if (a === '' && b !== '') gains.push([w, b]);
    else changed.push([w, a, b]);
  }
  console.log(`loses=${loses.length}  gains=${gains.length}  parts变但仍有拆解=${changed.length}`);
  console.log(`口径A 绝对：${P2r.A} → ${P3r.A}  (Δ ${P3r.A - P2r.A >= 0 ? '+' : ''}${P3r.A - P2r.A})`);
  console.log(`口径B 绝对：${P2r.B} → ${P3r.B}  (Δ ${P3r.B - P2r.B >= 0 ? '+' : ''}${P3r.B - P2r.B})`);
  console.log(`口径A 率：${(100 * P2r.A / P2r.split).toFixed(4)}% → ${(100 * P3r.A / P3r.split).toFixed(4)}%  (Δ ${(100 * P3r.A / P3r.split - 100 * P2r.A / P2r.split).toFixed(4)}pp)`);
  console.log(`口径B 率：${(100 * P2r.B / P2r.split).toFixed(4)}% → ${(100 * P3r.B / P3r.split).toFixed(4)}%  (Δ ${(100 * P3r.B / P3r.split - 100 * P2r.B / P2r.split).toFixed(4)}pp)`);
  console.log(`⇒ 绝对 ΔA=${P3r.A - P2r.A} · ΔB=${P3r.B - P2r.B}（升=违反 AC-11(c)）；率变化方向相反——汇报口径异议。`);
  console.log(`\n  changed 样例（前 25，最多 26 条）：`);
  for (const [w, a, b] of changed.slice(0, 25)) console.log(`    ${w}: ${a}  →  ${b}`);
  console.log(`\n  gains（新增可拆，共 ${gains.length} 个，前 30）：`);
  for (const [w, b] of gains.slice(0, 30)) console.log(`    ${w}: [] → ${b}`);
  console.log(`\n  ★ loses（-ной 造成的真回归）：${loses.length ? '' : '无'}`);
  for (const [w, a] of loses) console.log(`    ${w}: ${a} → []`);
  // -ной 高危面：P3 中含 -ной 的词的空洞分布
  let nHasNoi = 0, n0 = 0, nPos = 0, listNoi = [];
  for (const w of allWords) {
    const p = P3r.partsByWord.get(w) ?? '';
    if (!p.includes('-ной@')) continue;
    nHasNoi++;
    const h = P3r.holeByWord.get(w);
    if (h === 0) n0++; else nPos++;
    if (listNoi.length < 12) listNoi.push(`${w}[空洞${h}](${p})`);
  }
  console.log(`\n  P3 中含 -ной 的词数 = ${nHasNoi}（零空洞 ${n0} / 有空洞 ${nPos}）`);
  console.log('  样例：' + listNoi.join('\n        '));
}
