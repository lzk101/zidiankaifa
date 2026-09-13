// scripts/probe_sup_v9_decide.mjs
// 主管侧【决策集最终判分】探针（只读）
//
// 背景：T27 §H-1 的合并包数字与我手上旧记录不一致（口径A 实测 -50 而非 +71），
//       且「率下降 0.1087pp」无法在我的绝对量/分母上复现 ⇒ 一切数字由本探针自算。
//
// 复刻 scripts/exp_ru_ceiling.mjs:44-120 的引擎（该文件无 export 且顶层即执行 ⇒ 不能 import）。
// 内存注入 extra 词素，完全不碰 data/db/dict.db。
//
// 用法: node scripts/probe_sup_v9_decide.mjs
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB);

// ---------------- 引擎复刻 ----------------
const BREAKDOWN_MIN_COVERAGE = 0.55;
const KIND_RANK = { prefix: 0, suffix: 1, root: 2 };
function libRows(lang) {
  return db
    .prepare('SELECT morpheme, kind, meaning_zh, meaning_en, origin FROM morphemes WHERE lang = ?')
    .all(lang)
    .map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind), meaningZh: r.meaning_zh, meaningEn: r.meaning_en, origin: r.origin }));
}
function buildMatchers(lang, extra = []) {
  const isRu = lang === 'ru';
  const all = [...libRows(lang), ...extra];
  const list = all.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/ё/g, 'е') : raw;
    const patterns = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
      // 复刻 index.ts:738-743：后缀吸收屈折词尾（-ость → -ости/-остью），核心须 ≥3 字符
      const core = stem.slice(0, -1);
      if (core.length >= 3) patterns.push({ pat: core, core: true });
    }
    return { m, stem, patterns };
  });
  // tie-break 复刻 index.ts:691：kind 分组 + 组内串长降序（prefix 0 / suffix 1 / root 2）
  list.sort((a, b) => {
    const k = (KIND_RANK[a.m.kind] ?? 9) - (KIND_RANK[b.m.kind] ?? 9);
    if (k !== 0) return k;
    return b.stem.length - a.stem.length;
  });
  const byFirst = new Map();
  for (const e of list) {
    for (const { pat } of e.patterns) {
      const c = pat[0];
      if (!byFirst.has(c)) byFirst.set(c, []);
      byFirst.get(c).push(e);
    }
  }
  return { byFirst, all, list };
}
function matchersWith(lang, extra) {
  return buildMatchers(lang, extra);
}
const GATES_STRICT = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1 };

function breakdownEx(word, lang, g, extra = [], bundle = null) {
  const { byFirst, list } = bundle ?? matchersWith(lang, extra);
  const isRu = lang === 'ru';
  const w = word.trim().toLowerCase(); // 复刻 index.ts normalizeWord（JS toLowerCase 处理西里尔且等长）
  if (w.length < 2) return { parts: [], coverage: 0 };
  const mw = isRu ? w.replace(/ё/g, 'е') : w;
  const n = w.length;

  const candidatesAt = (pos) => {
    const out = [];
    const entries = byFirst.get(mw[pos]);
    if (!entries) return out;
    for (const { m, stem, patterns } of entries) {
      for (const { pat, core } of patterns) {
        const minLen = isRu && m.kind === 'prefix' ? 1 : 2;
        if (pat.length < minLen || !mw.startsWith(pat, pos)) continue;
        if (m.kind === 'prefix' && pos !== 0 && !core) continue;
        let end = pos + (core ? w.length - pos : pat.length);
        if (core) {
          if (w.length - (pos + pat.length) > 3) continue;
          end = w.length;
        } else if (isRu && m.kind === 'prefix' && pat.length === 1) {
          const rest = mw.slice(pos + 1);
          if (!list.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem))) continue;
        }
        // ② 后缀左侧须有 ≥3 字符词干
        if (m.kind === 'suffix' && pos < 3) continue;
        out.push({ m, start: pos, end });
      }
    }
    return out;
  };

  const covered = new Int32Array(n + 1);
  const pieces = new Int32Array(n + 1);
  const stepTo = new Int32Array(n + 1);
  const stepM = new Array(n + 1).fill(null);
  stepTo[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    let bestCov = covered[i + 1];
    let bestPieces = pieces[i + 1];
    let bestTo = i + 1;
    let bestM = null;
    for (const c of candidatesAt(i)) {
      const cov = c.end - c.start + covered[c.end];
      const pc = 1 + pieces[c.end];
      const better =
        cov > bestCov ||
        (cov === bestCov && (pc < bestPieces || (pc === bestPieces && (KIND_RANK[c.m.kind] ?? 9) < (KIND_RANK[bestM?.kind] ?? 9))));
      if (better) { bestCov = cov; bestPieces = pc; bestTo = c.end; bestM = c.m; }
    }
    covered[i] = bestCov;
    pieces[i] = bestPieces;
    stepTo[i] = bestTo;
    stepM[i] = bestM;
  }
  const parts = [];
  let i = 0;
  while (i >= 0 && i < n && parts.length < 8) {
    const m = stepM[i];
    const to = stepTo[i];
    if (m) parts.push({ m, start: i, end: to });
    i = to;
  }
  const rawCovered = parts.reduce((s, p) => s + (p.end - p.start), 0);
  if (rawCovered / n < BREAKDOWN_MIN_COVERAGE) return { parts: [], coverage: rawCovered / n };
  if (parts.length === 1 && parts[0].start === 1) return { parts: [], coverage: rawCovered / n };
  if (parts.length && parts[0].start >= g.gapMin) {
    const gap = mw.slice(0, parts[0].start);
    if (!list.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return { parts: [], coverage: rawCovered / n };
  }
  return { parts, coverage: rawCovered / n };
}
const bd = (w, lang, extra, bundle) => breakdownEx(w, lang, GATES_STRICT, extra, bundle).parts;

// ---------------- 数据集 ----------------
const R = db
  .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0 ORDER BY rowid")
  .all()
  .map((r) => String(r.word));
const ALL = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
console.log(`【分母】尺子 R ${R.length} · 全库 ${ALL.length}`);

const baseAll = matchersWith('ru', []);
const prefixStems = new Set(baseAll.list.filter((e) => e.m.kind === 'prefix').map((e) => e.stem));
console.log(`【库】俄语词素 ${baseAll.all.length} · 前缀 ${prefixStems.size} · 单字符前缀 ${[...prefixStems].filter((s) => s.length === 1).join(' ')}`);
console.log(`【★ эко-类检查】'экс' 是库内前缀吗？ ${prefixStems.has('экс') ? '是' : '否'} · 'термо' ${prefixStems.has('термо') ? '是' : '否'} · 'водо' ${prefixStems.has('водо') ? '是' : '否'} · 'само' ${prefixStems.has('само') ? '是' : '否'}`);

function emptyParts(p, n) {
  const cov = new Array(n).fill(false);
  for (const x of p) for (let i = x.start; i < x.end && i < n; i++) cov[i] = true;
  let tot = 0, cur = 0, mx = 0;
  for (let i = 0; i < n; i++) { if (!cov[i]) { tot++; cur++; if (cur > mx) mx = cur; } else cur = 0; }
  return { tot, mx, lead: (() => { let g = 0; while (g < n && !cov[g]) g++; return g; })() };
}

function measure(extra, label) {
  const bundle = matchersWith('ru', extra);
  let brk = 0, h3A = 0, h3B = 0, h2A = 0, tp = 0, da = 0, d1 = 0;
  for (const w of ALL) {
    const p = bd(w, 'ru', extra, bundle);
    if (!p.length) continue;
    brk++;
    const e = emptyParts(p, w.length);
    if (e.tot >= 3) h3A++;
    if (e.tot >= 2) h2A++;
    if (e.mx >= 3) h3B++;
    const mw = w.replace(/ё/g, 'е').toLowerCase();
    if (e.lead === 1) { if (prefixStems.has(mw[0])) tp++; else d1++; }
    if (p[0].start === 1 && mw.slice(1, 3) === 'да') da++;
  }
  let rn = 0, rL4 = 0, rL4B = 0;
  for (const w of R) {
    const p = bd(w, 'ru', extra, bundle);
    if (!p.length) continue;
    rn++;
    const e = emptyParts(p, w.length);
    if (e.tot >= 3) rL4++;
    if (e.mx >= 3) rL4B++;
  }
  const ra = brk ? (h3A / brk) * 100 : 0;
  const rb = brk ? (h3B / brk) * 100 : 0;
  return { label, brk, h3A, h3B, h2A, tp, da, d1, rn, rL4, rL4B, ra, rb, rRate: (rn / R.length) * 100 };
}

const M = (mor, kind, zh, en, origin) => ({ morpheme: mor, kind, meaningZh: zh, meaningEn: en, origin });

// ---------------- §0 保真自检：复刻 vs 官方生产实现（不一致即中止） ----------------
{
  const official = await import(new URL('../packages/core/dist/db/index.js', import.meta.url).href);
  const { breakdownWord } = official;
  const b = matchersWith('ru', []);
  let mism = 0;
  const sample = [];
  for (const w of R) {
    const mine = bd(w, 'ru', [], b).map((x) => `${x.m.morpheme}@${x.start}-${x.end}`).join('+');
    const off = (breakdownWord(db, w, 'ru') ?? []).map((x) => `${x.morpheme}@${x.start}-${x.end}`).join('+');
    if (mine !== off) { mism++; if (sample.length < 8) sample.push(`  ${w}: 复刻[${mine}] vs 官方[${off}]`); }
  }
  console.log(`\n§0 保真自检（尺子 R ${R.length} 词）：不一致 ${mism} 例 ${mism === 0 ? '✔' : '⚠ 中止'}`);
  if (mism) { sample.forEach((s) => console.log(s)); process.exit(1); }
}

// ---------------- 候选集 ----------------
const REAL = [
  M('суч-', 'root', '节、枝节', 'knot, branch', '原始斯拉夫语 *sǫkъ（сук 的软腭交替形）'),
  M('суд-', 'root', '审判、判断', 'judge, court', '原始斯拉夫语 *sǫdъ'),
  M('домин-', 'root', '支配、统治', 'dominate', '拉丁语 dominari（经德语 dominieren）'),
];
const SUF = [M('-ной', 'suffix', '形容词（具有…性质的，重音变体）', 'adj. (stressed -noj)', '原始斯拉夫语 *-ьnъ（-ный 的重音变体）')];
const FALLBACK = [
  M('столп-', 'root', '柱（整词兜底：抑制假词根 стол-）', 'pillar (whole-word guard)', '兜底条目·非语义切分：抑制 столп→стол- 假词根'),
  M('казус-', 'root', '案例（整词兜底：抑制假词根 каз-）', 'case (whole-word guard)', '兜底条目·非语义切分：抑制 казус→каз- 假词根（拉丁 cāsus 单词素）'),
  M('однако-', 'root', '然而（整词兜底：抑制假词根 дн-）', 'however (whole-word guard)', '兜底条目·非语义切分：抑制 однако→дн- 假词根（单词素）'),
  M('термостат-', 'root', '恒温器（整词兜底：抑制 термо-+стат 半截拆解）', 'thermostat (whole-word guard)', '兜底条目·非语义切分：该词为 терм-+-о-+стат 复合，但 стат- 入库会污染 достать/застать 等 68 词'),
];
const OPTIONAL = [
  M('пад-', 'root', '落、坠', 'fall', '原始斯拉夫语 *pasti'),
  M('тряс-', 'root', '抖、震', 'shake, quake', '原始斯拉夫语 *tręsti'),
  M('стат-', 'root', '站、状态', 'stand, state', '拉丁语 status / 希腊语 statos'),
  M('долж-', 'root', '应当、债务', 'owe, duty', '原始斯拉夫语 *dьlgъ'),
  M('казн-', 'root', '处决、刑罚', 'execute', '原始斯拉夫语 *kaznь'),
  M('одн-', 'root', '一、单', 'one', '原始斯拉夫语 *edinъ'),
];

const CONFIGS = [
  ['V0 = H-a 基线（生产现状）', []],
  ['A: 真3(суч суд домин)', REAL],
  ['B: A + -ной', [...REAL, ...SUF]],
  ['C: B + 兜底3(столп казус однако)', [...REAL, ...SUF, ...FALLBACK.slice(0, 3)]],
  ['★D: C + 兜底(термостат)  ← 决定集', [...REAL, ...SUF, ...FALLBACK]],
  ['E: B + стат-（改用真词素替代兜底）', [...REAL, ...SUF, OPTIONAL[2]]],
  ['F: D + пад-', [...REAL, ...SUF, ...FALLBACK, OPTIONAL[0]]],
  ['G: D + пад- + тряс-', [...REAL, ...SUF, ...FALLBACK, OPTIONAL[0], OPTIONAL[1]]],
  ['H: D + пад- тряс- долж- казн-', [...REAL, ...SUF, ...FALLBACK, OPTIONAL[0], OPTIONAL[1], OPTIONAL[3], OPTIONAL[4]]],
  ['✗X: D + дав- дар- дал-（预期破护栏）', [...REAL, ...SUF, ...FALLBACK, M('дав-', 'root', '压', 'press', '原始斯拉夫语 *daviti'), M('дар-', 'root', '赠', 'give', '原始斯拉夫语 *darъ'), M('дал-', 'root', '远', 'far', '伪候选')]],
];

const results = CONFIGS.map(([, extra]) => measure(extra, ''));
const B = results[0];
console.log(`\n${'配置'.padEnd(42)} ${'可拆'.padStart(7)} ${'空洞≥3A'.padStart(8)} ${'ΔA'.padStart(6)} ${'ΔB'.padStart(6)} ${'率A%'.padStart(8)} ${'Δ率A'.padStart(8)} ${'率B%'.padStart(8)} ${'真前缀'.padStart(6)} ${'да-'.padStart(4)} ${'R'.padStart(4)} ${'R率%'.padStart(6)} ${'L4'.padStart(4)} ${'D1'.padStart(3)}`);
CONFIGS.forEach(([label], i) => {
  const m = results[i];
  const mark = (v, base, lowerBetter = true) => (lowerBetter ? (v <= base ? '✅' : '❌') : v >= base ? '✅' : '❌');
  console.log(
    `${label.padEnd(42)} ${String(m.brk).padStart(7)} ${String(m.h3A).padStart(8)} ${String(m.h3A - B.h3A).padStart(6)} ${String(m.h3B - B.h3B).padStart(6)} ${m.ra.toFixed(4).padStart(8)} ${(m.ra - B.ra).toFixed(4).padStart(8)} ${m.rb.toFixed(4).padStart(8)} ${String(m.tp).padStart(6)} ${String(m.da).padStart(4)} ${String(m.rn).padStart(4)} ${m.rRate.toFixed(2).padStart(6)} ${String(m.rL4).padStart(4)} ${String(m.d1).padStart(3)}`
  );
});

// ---------------- 决定集逐词 ----------------
console.log('\n【★ 决定集（真3 + -ной + 兜底4）逐词输出】');
const DEC = [...REAL, ...SUF, ...FALLBACK];
const DECB = matchersWith('ru', DEC);
const WORDS = ['сучок', 'сучить', 'засучивать', 'самосуд', 'суд', 'судить', 'правосудие', 'доминировать', 'доминиканец',
  'больной', 'внеземной', 'головной', 'столп', 'казус', 'однако', 'термостат', 'статика', 'статический',
  'экстатический', 'достать', 'застать', 'поднаковальня', 'поднакопить', 'вдаваться', 'одалживать', 'сдабривать',
  'удачный', 'смекать', 'вода', 'землетрясение', 'водопад', 'уч-本尊=учить', 'учитель', 'ученик'];
for (const w of WORDS) {
  if (w.includes('=')) continue;
  const p = bd(w, 'ru', DEC, DECB);
  console.log(`   ${w.padEnd(16)} ${(p.length ? p.map((x) => `${x.m.morpheme}@${x.start}-${x.end}`).join(' + ') : '[]').padEnd(56)} 空洞A=${emptyParts(p, w.length).tot}`);
}

// ---------------- 与 H-a 相比的 loses / gains / becameEmpty ----------------
console.log('\n【★ 决定集 vs H-a：loses / becameEmpty / gains 计数】');
const HAB = matchersWith('ru', []);
let loses = 0, gains = 0, becameEmpty = 0, changed = 0;
const loseList = [], emptyList = [];
for (const w of ALL) {
  const a = bd(w, 'ru', [], HAB);
  const b = bd(w, 'ru', DEC, DECB);
  if (a.length && !b.length) { loses++; becameEmpty++; emptyList.push(w); }
  else if (!a.length && b.length) { gains++; if (gains <= 10) loseList.push(`+${w}`); }
  else if (a.length && b.length && a.map((x) => `${x.m.morpheme}@${x.start}`).join() !== b.map((x) => `${x.m.morpheme}@${x.start}`).join()) changed++;
}
console.log(`   becomes-empty ${becameEmpty} · gains ${gains} · partsChanged ${changed}`);
if (emptyList.length) console.log(`   ⚠ 由可拆变不可拆：${emptyList.join(' ')}`);

// ---------------- -ной 的率对照（决定集内部 A/B 分解） ----------------
console.log('\n【★ -ной 的净效应（在真3 之上）】');
const R3 = measure(REAL, '');
const R3S = measure([...REAL, ...SUF], '');
console.log(`   真3      : 可拆 ${R3.brk} · A ${R3.h3A} (率 ${R3.ra.toFixed(4)}%) · B ${R3.h3B} (率 ${R3.rb.toFixed(4)}%)`);
console.log(`   真3+-ной : 可拆 ${R3S.brk} · A ${R3S.h3A} (率 ${R3S.ra.toFixed(4)}%) · B ${R3S.h3B} (率 ${R3S.rb.toFixed(4)}%)`);
console.log(`   Δ可拆 ${R3S.brk - R3.brk} · ΔA ${R3S.h3A - R3.h3A} · Δ率A ${(R3S.ra - R3.ra).toFixed(4)}pp · ΔB ${R3S.h3B - R3.h3B} · Δ率B ${(R3S.rb - R3.rb).toFixed(4)}pp`);

// ---------------- -ной 的逐词定性（AC-11(c) 须证「不使任何词变差」） ----------------
{
  const b3 = matchersWith('ru', REAL);
  const b3s = matchersWith('ru', [...REAL, ...SUF]);
  let worse = 0, better = 0, same = 0, newBrk = 0;
  const worseList = [], betterList = [];
  for (const w of ALL) {
    const a = bd(w, 'ru', REAL, b3);
    const b = bd(w, 'ru', [...REAL, ...SUF], b3s);
    const ea = a.length ? emptyParts(a, w.length).tot : null;
    const eb = b.length ? emptyParts(b, w.length).tot : null;
    if (ea === null && eb !== null) { newBrk++; if (eb === 0) better++; else same++; continue; }
    if (ea !== null && eb === null) { worse++; worseList.push(`${w}(失去拆解)`); continue; }
    if (ea === null && eb === null) continue;
    if (eb > ea) { worse++; if (worseList.length < 12) worseList.push(`${w}(${ea}→${eb})`); }
    else if (eb < ea) { better++; if (betterList.length < 12) betterList.push(`${w}(${ea}→${eb})`); }
    else same++;
  }
  console.log(`\n【★ -ной 逐词定性】新增可拆 ${newBrk}（其中空洞=0 者 ${better - betterList.length >= 0 ? '' : ''}）· 空洞变少 ${better} · 空洞不变 ${same} · 变差 ${worse}`);
  if (worseList.length) console.log(`   ⚠ 变差样例：${worseList.join(' ')}`);
  if (betterList.length) console.log(`   改善样例：${betterList.join(' ')}`);
}

// ---------------- 决定集：全库空洞分布对照 ----------------
console.log('\n【★ 决定集 vs 基线：全库空洞分布】');
{
  const dist = (extra) => {
    const b = matchersWith('ru', extra);
    const d = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let brk = 0;
    for (const w of ALL) {
      const p = bd(w, 'ru', extra, b);
      if (!p.length) continue;
      brk++;
      const t = emptyParts(p, w.length).tot;
      d[Math.min(t, 5)]++;
    }
    return { d, brk };
  };
  const a = dist([]);
  const c = dist(DEC);
  console.log(`   基线   可拆 ${a.brk} · 空洞 0=${a.d[0]} 1=${a.d[1]} 2=${a.d[2]} 3=${a.d[3]} 4=${a.d[4]} ≥5=${a.d[5]}`);
  console.log(`   决定集 可拆 ${c.brk} · 空洞 0=${c.d[0]} 1=${c.d[1]} 2=${c.d[2]} 3=${c.d[3]} 4=${c.d[4]} ≥5=${c.d[5]}`);
  console.log(`   Δ      可拆 ${c.brk - a.brk} · 0=${c.d[0] - a.d[0]} 1=${c.d[1] - a.d[1]} 2=${c.d[2] - a.d[2]} 3=${c.d[3] - a.d[3]} 4=${c.d[4] - a.d[4]} ≥5=${c.d[5] - a.d[5]}`);
}

// =====================================================================================
// ★★ 终案判分：加不加 стат- / пад- / тряс-（复合词第二词根）
//    语义判别集 ru_morph_semantic.mjs 现余 4 条目标红：термостат / землетрясение×2 / водопад
//    四条同源 —— 复合词第二词根不在库，被整段跳过。三条都有 {{морфо-ru}} 硬词源。
// =====================================================================================
const FINAL_CANDS = [
  M('стат-', 'root', '站、状态', 'stand, state', '希腊语 στᾰτός / 拉丁 status；来源 https://ru.wiktionary.org/w/index.php?oldid=5359108 {{морфо-ru|терм|-о-|стат|и=т}}'),
  M('пад-', 'root', '落、坠', 'fall', '原始斯拉夫语 *pasti；来源 https://ru.wiktionary.org/wiki/водопад {{морфо-ru|вод|-о-|пад|и=т}}'),
  M('тряс-', 'root', '抖、震', 'shake, quake', '原始斯拉夫语 *tręsti；来源 https://ru.wiktionary.org/w/index.php?oldid=13948603 {{морфо-ru|земл|-е-|тряс|-ениj|+е|и=т}}'),
];
const FINAL = [...REAL, ...SUF, ...FALLBACK, ...FINAL_CANDS];
console.log('\n\n' + '='.repeat(120));
console.log('★★ 终案判分：D + стат- + пад- + тряс-（复合词第二词根三条）');
console.log('='.repeat(120));
const FM = measure(FINAL, '');
const DM = measure(DEC, '');
console.log(`  ${'配置'.padEnd(30)} ${'可拆'.padStart(7)} ${'空洞≥3A'.padStart(8)} ${'ΔB'.padStart(7)} ${'率A%'.padStart(9)} ${'Δ率A'.padStart(9)} ${'率B%'.padStart(9)} ${'真前缀'.padStart(6)} ${'да-'.padStart(4)} ${'R'.padStart(4)} ${'R率%'.padStart(6)} ${'L4'.padStart(4)} ${'D1'.padStart(3)}`);
for (const [lbl, m] of [['D（不含三条复合词根）', DM], ['★终案 D + стат пад тряс', FM]]) {
  console.log(`  ${lbl.padEnd(30)} ${String(m.brk).padStart(7)} ${String(m.h3A).padStart(8)} ${String(m.h3B).padStart(7)} ${m.ra.toFixed(4).padStart(9)} ${(m.ra - B.ra).toFixed(4).padStart(9)} ${m.rb.toFixed(4).padStart(9)} ${String(m.tp).padStart(6)} ${String(m.da).padStart(4)} ${String(m.rn).padStart(4)} ${m.rRate.toFixed(2).padStart(6)} ${String(m.rL4).padStart(4)} ${String(m.d1).padStart(3)}`);
}
console.log(`  判据：全库可拆 ≥33162 ${FM.brk >= 33162 ? '✅' : '❌'} · 真前缀组 ≥63 ${FM.tp >= 63 ? '✅' : '❌'} · да- =63 ${FM.da === 63 ? '✅' : '❌'} · R ≥238 ${FM.rn >= 238 ? '✅' : '❌'} · L4 ≤134 ${FM.rL4 <= 134 ? '✅' : '❌'} · D1 =0 ${FM.d1 === 0 ? '✅' : '❌'}`);
console.log(`  口径A/B 率不得上升：Δ率A ${(FM.ra - B.ra).toFixed(4)}pp ${FM.ra <= B.ra ? '✅' : '❌'} · Δ率B ${(FM.rb - B.rb).toFixed(4)}pp ${FM.rb <= B.rb ? '✅' : '❌'}`);

// 终案 loses / gains
{
  const fb = matchersWith('ru', FINAL);
  let becameEmpty = 0, gains = 0, changed = 0;
  const emptyList = [];
  for (const w of ALL) {
    const a = bd(w, 'ru', [], HAB);
    const b = bd(w, 'ru', FINAL, fb);
    if (a.length && !b.length) { becameEmpty++; emptyList.push(w); }
    else if (!a.length && b.length) gains++;
    else if (a.length && b.length && a.map((x) => x.m.morpheme).join() !== b.map((x) => x.m.morpheme).join()) changed++;
  }
  console.log(`\n  【终案 loses/gains】becomes-empty ${becameEmpty} · gains ${gains} · partsChanged ${changed}`);
  if (emptyList.length) console.log(`   ⚠ 由可拆变不可拆：${emptyList.join(' ')}`);
}

// 终案：语义判别集 4 条目标词 + термо-@0 断言实测
console.log('\n  【终案：语义判别集 4 条目标红逐条实测】');
{
  const fb = matchersWith('ru', FINAL);
  const p = (w) => bd(w, 'ru', FINAL, fb).map((x) => `${x.m.morpheme}@${x.start}-${x.end}`);
  const t = p('термостат');
  console.log(`   термостат       ${t.join(' + ')}`);
  console.log(`     └ 断言「必须出现 термо-@0」= ${t.some((s) => s.startsWith('термо-@0')) ? '✅ 通过' : '❌ 失败'}`);
  console.log(`     └ 断言「[5,9) стат 不得整段成空洞」= ${(() => { const parts = bd('термостат', 'ru', FINAL, fb); const cov = new Array(9).fill(false); for (const x of parts) for (let i = x.start; i < x.end; i++) cov[i] = true; return [5, 6, 7, 8].every((i) => cov[i]) ? '✅ 通过' : '❌ 失败'; })()}`);
  for (const w of ['землетрясение', 'водопад']) {
    console.log(`   ${w.padEnd(16)} ${p(w).join(' + ')}`);
    const parts = bd(w, 'ru', FINAL, fb);
    const cov = new Array(w.length).fill(false);
    for (const x of parts) for (let i = x.start; i < x.end; i++) cov[i] = true;
    const rng = w === 'землетрясение' ? [5, 6, 7, 8] : [4, 5, 6];
    console.log(`     └ 断言「[${rng[0]},${rng[rng.length - 1] + 1}) 不得整段成空洞」= ${rng.every((i) => cov[i]) ? '✅ 通过' : '❌ 失败'}`);
    if (w === 'землетрясение') console.log(`     └ 断言「不得出现 лет-@3」= ${parts.some((x) => `${x.m.morpheme}@${x.start}` === 'лет-@3') ? '❌ 失败' : '✅ 通过'}`);
  }
}

// 终案：экстатический 是否失去拆解
console.log('\n  【终案：экстатический 逐案对照】');
for (const [lbl, extra] of [['基线', []], ['决定集 D', DEC], ['★终案', FINAL]]) {
  const bb = matchersWith('ru', extra);
  const pp = bd('экстатический', 'ru', extra, bb);
  console.log(`   ${lbl.padEnd(10)} ${(pp.length ? pp.map((x) => `${x.m.morpheme}@${x.start}-${x.end}`).join(' + ') : '[]').padEnd(48)} 空洞A=${emptyParts(pp, 'экстатический'.length).tot}`);
}

// =====================================================================================
// ★★ 落库终案（无 стат-）：真3 + -ной + 兜底3 + пад- + тряс-
// =====================================================================================
const LANDED = [...REAL, ...SUF, ...FALLBACK.slice(0, 3), FINAL_CANDS[1], FINAL_CANDS[2]];
console.log('\n\n' + '='.repeat(120));
console.log('★★ 落库终案：真3(суч/суд/домин) + -ной + 兜底3(столп/казус/однако) + пад- + тряс-   （不含 стат-）');
console.log('='.repeat(120));
const LM = measure(LANDED, '');
console.log(`  可拆 ${LM.brk} (Δ${LM.brk - B.brk}) · 空洞≥3A ${LM.h3A} (Δ${LM.h3A - B.h3A}) · 空洞≥3B ${LM.h3B} (Δ${LM.h3B - B.h3B})`);
console.log(`  率A ${LM.ra.toFixed(4)}% (Δ${(LM.ra - B.ra).toFixed(4)}pp) · 率B ${LM.rb.toFixed(4)}% (Δ${(LM.rb - B.rb).toFixed(4)}pp)`);
console.log(`  真前缀组 ${LM.tp} · да- ${LM.da} · 尺子R ${LM.rn}=${LM.rRate.toFixed(2)}% · L4 ${LM.rL4} · D1 ${LM.d1}`);
console.log(`  六护栏：可拆≥33162 ${LM.brk >= 33162 ? '✅' : '❌'} · 真前缀≥63 ${LM.tp >= 63 ? '✅' : '❌'} · да-=63 ${LM.da === 63 ? '✅' : '❌'} · R≥238 ${LM.rn >= 238 ? '✅' : '❌'} · L4≤134 ${LM.rL4 <= 134 ? '✅' : '❌'} · D1=0 ${LM.d1 === 0 ? '✅' : '❌'}`);
console.log(`  口径A/B 率不得上升：${LM.ra <= B.ra ? '✅' : '❌'} / ${LM.rb <= B.rb ? '✅' : '❌'}`);
{
  const lb = matchersWith('ru', LANDED);
  let em = 0, gn = 0, ch = 0;
  const emList = [];
  for (const w of ALL) {
    const a = bd(w, 'ru', [], HAB);
    const b = bd(w, 'ru', LANDED, lb);
    if (a.length && !b.length) { em++; emList.push(w); }
    else if (!a.length && b.length) gn++;
    else if (a.length && b.length && a.map((x) => x.m.morpheme).join() !== b.map((x) => x.m.morpheme).join()) ch++;
  }
  console.log(`  loses/becameEmpty ${em} · gains ${gn} · partsChanged ${ch}`);
  if (emList.length) console.log(`   ⚠ 由可拆变不可拆：${emList.join(' ')}`);
  const pp = (w) => bd(w, 'ru', LANDED, lb).map((x) => `${x.m.morpheme}@${x.start}-${x.end}`);
  console.log(`  验收靶词：термостат=${pp('термостат').join('+')} · землетрясение=${pp('землетрясение').join('+')} · водопад=${pp('водопад').join('+')}`);
  console.log(`  D4/D2 断言：сучить=${pp('сучить').join('+')} · сучок=${pp('сучок').join('+')} · однако=${pp('однако').join('+')} · больной=${pp('больной').join('+')} · самосуд=${pp('самосуд').join('+')} · доминировать=${pp('доминировать').join('+')} · столп=${pp('столп').join('+')} · казус=${pp('казус').join('+')}`);
  console.log(`  哨兵：вдаваться=${pp('вдаваться').join('+')} · удачный=${pp('удачный').join('+')} · смекать=${pp('смекать').join('+') || '[]'} · вода=${pp('вода').join('+')}`);
}
