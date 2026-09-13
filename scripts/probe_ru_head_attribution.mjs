/**
 * 只读探针（功能测试 agent，2026-09-16 · 第 3 轮）：词首误拆 + 547 归因表独立复核
 *
 * 主管要求（verbatim 要点）：
 *   ① 找 3–5 个「首字母恰好是单字符前缀 в/с/у/о、但实为词根首字母」的俄语词；
 *   ② 独立确认 `difficult` / `business` 的覆盖率 < 0.55（主管称这是阈值存在的理由）；
 *   ③ 独立复核 547 无拆解词的词首归因表：④119 / ⑥83 / 词首有词根但覆盖率不足 11 /
 *      词首完全无已知词素 332 / 「覆盖率够却未拆」异常 0，以及「只修规则上限 58.0%」。
 *      **主管明确授权：数字不同就如实报告，不迁就。**
 *
 * 只读。用法：node scripts/probe_ru_head_attribution.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const THRESHOLD = 0.55; // index.ts:709 BREAKDOWN_MIN_COVERAGE
const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const loadMorph = (lang) =>
  db
    .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang=?`)
    .all(lang)
    .map((r) => ({ raw: String(r.morpheme), stem: String(r.morpheme).replace(/-/g, '').toLowerCase(), kind: String(r.kind) }));

const ru = loadMorph('ru');
const en = loadMorph('en');

/** 规范位命中：prefix→词首；suffix→词尾；root→任意位置
 *  ⚠ 长度约束照抄 index.ts:764 `minLen = isRu && m.kind === 'prefix' ? 1 : 2`
 *    （非前缀词素最短 2 字符）—— 我第一版漏了这条，导致 1 字符词根/后缀虚增覆盖率。 */
function canonicalHits(w, morph, isRu = true) {
  const lw = w.toLowerCase();
  const hits = [];
  for (const m of morph) {
    if (!m.stem.length) continue;
    const minLen = isRu && m.kind === 'prefix' ? 1 : 2;
    if (m.stem.length < minLen) continue;
    for (let i = 0; i + m.stem.length <= lw.length; i++) {
      if (lw.slice(i, i + m.stem.length) !== m.stem) continue;
      const end = i + m.stem.length;
      if (m.kind === 'prefix' && i !== 0) continue;
      if (m.kind === 'suffix' && end !== lw.length) continue;
      hits.push({ raw: m.raw, kind: m.kind, start: i, end, len: m.stem.length });
    }
  }
  return hits;
}

function maxCovered(hits) {
  const byStart = new Map();
  for (const h of hits) {
    if (!byStart.has(h.start)) byStart.set(h.start, []);
    byStart.get(h.start).push(h);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const memo = new Map();
  const solve = (from) => {
    if (from >= starts.length) return { covered: 0, picked: [] };
    if (memo.has(from)) return memo.get(from);
    let best = solve(from + 1);
    for (const h of byStart.get(starts[from])) {
      const nxt = starts.findIndex((s) => s >= h.end);
      const sub = nxt < 0 ? { covered: 0, picked: [] } : solve(nxt);
      const cand = { covered: h.len + sub.covered, picked: [h, ...sub.picked] };
      if (cand.covered > best.covered) best = cand;
    }
    memo.set(from, best);
    return best;
  };
  return solve(0);
}

const bd = (w, lang = 'ru') => {
  try {
    return core.breakdownWord(db, w, lang).map((p) => p.morpheme);
  } catch {
    return [];
  }
};

/* ==========================================================================
 * ① 新反例候选：「首字母是单字符前缀 в/с/у/о，但实为词根首字母」
 * ========================================================================*/
console.log('='.repeat(84));
console.log('① 新反例候选核验（首字母形似单字符前缀，实为词根首字母）');
console.log('='.repeat(84));

// 先确认单字符前缀在库中的登记
const oneChar = ru.filter((m) => m.kind === 'prefix' && m.stem.length === 1);
console.log(`  库中单字符前缀（俄语）: ${[...new Set(oneChar.map((m) => m.raw))].join(' ')}`);

const CAND = [
  'велюровый', 'сущность', 'винище', 'санировать', 'оптимальный', 'смекать', 'воитель',
  'вокзал', 'вагон', 'уксус', 'сентябрь', 'солнце', 'собака', 'улица', 'вишня', 'утро',
  'огонь', 'суббота', 'стилоскоп', 'очередность',
];
console.log('');
console.log('  词            当前输出            若放宽支撑规则(cov)   词源记载(取自库)');
for (const w of CAND) {
  const cur = bd(w);
  const hits = canonicalHits(w, ru);
  const { covered, picked } = maxCovered(hits);
  const cov = (covered / w.length).toFixed(3);
  const sorted = [...picked].sort((a, b) => a.start - b.start);
  const used1char = sorted.some((p) => p.kind === 'prefix' && p.len === 1);
  const ety = db
    .prepare(`SELECT text_en, chain, origin FROM word_etymology WHERE word=? AND lang='ru'`)
    .all(w)[0];
  const etyBrief = ety ? String(ety.text_en ?? ety.origin ?? '').slice(0, 62) : '— 无词源记录 —';
  const isPrefixAt0 = sorted.length && sorted[0].start === 0;
  console.log(
    `  ${w.padEnd(13)} ${JSON.stringify(cur).padEnd(22)} ${(used1char && Number(cov) >= THRESHOLD ? `★会拆 ${sorted.map((p) => p.raw).join('+')} (${cov})` : isPrefixAt0 ? `前缀@0 但 cov ${cov}` : `无词首命中 (cov ${cov})`).padEnd(28)} ${etyBrief}`,
  );
}

/* ==========================================================================
 * ② difficult / business 覆盖率独立复核（英语侧）
 * ========================================================================*/
console.log('');
console.log('='.repeat(84));
console.log('② difficult / business 覆盖率独立复核（主管称皆 <0.55，是阈值存在的理由）');
console.log('='.repeat(84));
for (const w of ['difficult', 'business']) {
  const n = w.length;
  const hits = canonicalHits(w, en);
  const { covered, picked } = maxCovered(hits);
  const cov = covered / n;
  const sorted = [...picked].sort((a, b) => a.start - b.start);
  console.log(`  ${w} (len=${n})`);
  console.log(`    规范位词素命中 : ${hits.map((h) => `${h.raw}[${h.kind}]@${h.start}-${h.end}`).join(' ') || '（无）'}`);
  console.log(`    最优覆盖       : ${covered}/${n} = ${cov.toFixed(3)}  ${cov < THRESHOLD ? '< 0.55 ⇒ 覆盖率阈值拦住 ✓' : '≥ 0.55 ⇒ **阈值拦不住**'}`);
  console.log(`    最优选择集     : ${sorted.map((p) => p.raw).join(' + ') || '（无）'}`);
  console.log(`    当前实测输出   : ${JSON.stringify(bd(w, 'en'))}`);
  console.log('');
}

/* ==========================================================================
 * ③ 547 无拆解词的词首归因表 —— 独立复核主管数字
 * ========================================================================*/
console.log('='.repeat(84));
console.log('③ 547 无拆解词的词首归因（独立复核 119/83/11/332/0 与 58.0%）');
console.log('='.repeat(84));

const sample = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const unsolved = sample.filter((w) => !bd(w).length);
const R3 = ru.filter((m) => m.kind === 'root' && m.stem.length >= 3);

const cat = {
  singleNoSupport: [],      // ④ 单字符前缀无紧邻支撑（全部，含覆盖率已够的子集）
  singleCoverageOkNoSupport: [], // ④ 的子集：覆盖率已 ≥0.55，**只差支撑规则** ← 放宽支撑规则的净红利
  singleWithSupportCovLow: [], // 单字符前缀有支撑但覆盖率不足
  multiCovLow: [],          // ⑥ 多字符前缀但覆盖率不足
  rootHeadCovLow: [],       // 词首有词根但覆盖率不足
  noHead: [],               // 词首完全无已知词素
  anomalyHeadCovOk: [],     // 词首有词素 且 覆盖率≥0.55，却仍未拆 ← 主管称此为 0
  anomalySingleOk: [],      // 单字符前缀**有支撑**且覆盖率≥0.55，却仍未拆 ⇒ 真异常
};

for (const w of unsolved) {
  const n = w.length;
  const lw = w.toLowerCase();
  const hits = canonicalHits(w, ru);
  const { covered, picked } = maxCovered(hits);
  const cov = covered / n;

  // ---- 先判词首（index.ts 的第一关就是词首，故分类必须以词首优先）----
  const headPrefixes = ru.filter((m) => m.kind === 'prefix' && lw.startsWith(m.stem));
  const headRoots = R3.filter((m) => lw.startsWith(m.stem));
  const maxPrefixLen = headPrefixes.length ? Math.max(...headPrefixes.map((m) => m.stem.length)) : 0;
  const hasHead = maxPrefixLen > 0 || headRoots.length > 0;

  // 覆盖率够却未拆 = 异常（主管口径）
  if (hasHead && cov >= THRESHOLD && picked.length) {
    const sortedP = [...picked].sort((a, b) => a.start - b.start);
    if (sortedP[0].start !== 0) {
      // 覆盖最优解的首片段不在词首 → 被 index.ts:851 首片段规则拦下，属正常
      cat.noHead.push(w);
      continue;
    }
    // 首片段是词首的 1 字符前缀时，还要看**支撑规则**是否满足；
    // 不满足则它不是「异常」，而是 ④ 的一个子类（覆盖率已够、只差支撑规则）。
    if (maxPrefixLen === 1 && sortedP.some((p) => p.kind === 'prefix' && p.len === 1)) {
      const rest = lw.slice(1);
      const supported = ru.some(
        (m) => m.kind !== 'prefix' && m.stem.length >= 3 && rest.startsWith(m.stem),
      );
      if (!supported) {
        cat.singleNoSupport.push(w); // ← 归入 ④（这正是「只差支撑规则」的 28 词）
        cat.singleCoverageOkNoSupport.push(w);
      } else {
        cat.anomalySingleOk.push(w); // 有支撑、覆盖率也够，却仍未拆 ⇒ 真异常
      }
      continue;
    }
    cat.anomalyHeadCovOk.push(w);
    continue;
  }

  if (maxPrefixLen === 1) {
    const rest = lw.slice(1);
    const supported = ru.some((m) => m.kind !== 'prefix' && m.stem.length >= 3 && rest.startsWith(m.stem));
    if (supported) cat.singleWithSupportCovLow.push(w);
    else cat.singleNoSupport.push(w);
    continue;
  }
  if (maxPrefixLen >= 2) {
    cat.multiCovLow.push(w);
    continue;
  }
  if (headRoots.length) {
    cat.rootHeadCovLow.push(w);
    continue;
  }
  cat.noHead.push(w);
}

const T = (n) => `${String(n).padStart(3)} (${((n / 791) * 100).toFixed(1)}%)`;
console.log(`  无拆解总数                              : ${unsolved.length}`);
console.log(`  ④ 单字符前缀无紧邻支撑                  : ${T(cat.singleNoSupport.length)}   主管 119`);
console.log(`     └ 其中覆盖率已 ≥0.55，**只差支撑规则** : ${T(cat.singleCoverageOkNoSupport.length)}   ← 放宽支撑规则的**净红利**`);
console.log(`     └ 其中覆盖率也 <0.55（还须降阈值）    : ${T(cat.singleNoSupport.length - cat.singleCoverageOkNoSupport.length)}`);
console.log(`     单字符前缀有支撑但覆盖率仍不足        : ${T(cat.singleWithSupportCovLow.length)}`);
console.log(`  ⑥ 多字符前缀但覆盖率不足                : ${T(cat.multiCovLow.length)}   主管 83`);
console.log(`  ⑥ 词首有词根但覆盖率不足                : ${T(cat.rootHeadCovLow.length)}   主管 11`);
console.log(`  词首完全无已知词素（含覆盖最优首片段不在词首者）: ${T(cat.noHead.length)}   主管 332`);
console.log(`  「覆盖率够却未拆」异常 · 词首有词素      : ${T(cat.anomalyHeadCovOk.length)}   主管 0`);
console.log(`  「覆盖率够却未拆」异常 · 单字符前缀有支撑: ${T(cat.anomalySingleOk.length)}   主管 0`);
const total = Object.values(cat).reduce((s, a) => s + a.length, 0) - cat.singleCoverageOkNoSupport.length;
console.log(`  ---- 分类合计（去重复计数的子集）        : ${total}`);
console.log('');
console.log(`  「只修规则、不新增词素」上限（我的口径）:`);
const fixable = cat.singleNoSupport.length + cat.singleWithSupportCovLow.length + cat.multiCovLow.length + cat.rootHeadCovLow.length;
console.log(`    = 244 + ④${cat.singleNoSupport.length} + ⑥${cat.multiCovLow.length} + 词根${cat.rootHeadCovLow.length} = ${244 + fixable} / 791 = ${(((244 + fixable) / 791) * 100).toFixed(1)}%   主管 459 = 58.0%`);
console.log(`    （我第一版误算成 433=54.7%，错因：分类前置顺序 + 漏抄 index.ts:764 的 minLen=2）`);

console.log('');
console.log(`  ④ 样例: ${cat.singleNoSupport.slice(0, 18).join(' ')}`);
console.log(`  ④「只差支撑规则」28 词全清单: ${cat.singleCoverageOkNoSupport.join(' ')}`);
console.log(`  异常·词首有词素 样例: ${cat.anomalyHeadCovOk.slice(0, 18).join(' ')}`);
console.log(`  异常·单字符前缀有支撑 样例: ${cat.anomalySingleOk.slice(0, 18).join(' ')}`);
console.log(`  ⑥多字符前缀 cov<0.55 样例: ${cat.multiCovLow.slice(0, 18).join(' ')}`);
console.log(`  词首无词素 样例: ${cat.noHead.slice(0, 18).join(' ')}`);

// 异常词逐个实测复核（若确为 [] 则说明归因模型不完备）
console.log('');
console.log('  异常词逐词实测（前 12，用于判定是「模型不完备」还是「归因遗漏」）：');
for (const w of [...cat.anomalyHeadCovOk, ...cat.anomalySingleOk].slice(0, 12)) {
  const hits = canonicalHits(w, ru);
  const { covered, picked } = maxCovered(hits);
  const sorted = [...picked].sort((a, b) => a.start - b.start);
  console.log(
    `    ${w.padEnd(15)} len=${w.length} cov=${(covered / w.length).toFixed(3)} 最优集 ${sorted.map((p) => `${p.raw}@${p.start}-${p.end}`).join(' + ')}  实测 ${JSON.stringify(bd(w))}`,
  );
}

db.close();
