/**
 * ★最终路线模型（只读）：用**挖掘得到的真实高价值词根**（而非表面词干）做候选，
 * 模拟"补 N 个词根 → 尺子 R 覆盖率 → 是否达标 45%"。
 *
 * 与 exp_ru_root_plan.mjs 的区别：那里候选 = 每个词"去掉词尾的表面词干"（天然各覆盖 1 词，
 * 得出"需补 112 个"的悲观结论）。这里候选 = 全库词首 n-gram 频次挖掘出的**共享词根**
 * （如 пер- 覆盖 1501 词、кон- 覆盖 451 词），才是真实可用的候选。
 *
 * 覆盖率模型要点（对应 index.ts:842 与 index.ts:851-855）：
 *   ① 词首须有词素（新词根算）
 *   ② 覆盖字符 = 词首词素长 + 词尾已知后缀长（后缀可为 core 模式，吸收 1 字符词尾）
 *   ③ 覆盖率 ≥ 0.55 才可拆
 *
 * 用法：node scripts/exp_ru_final_plan.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const sample = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const allWords = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 3 AND 14`)
  .all()
  .map((r) => String(r.word))
  .filter((w) => /^[а-яё-]+$/.test(w));

const ru = JSON.parse(readFileSync('packages/data-pipeline/roots_ru.json', 'utf8'));
const knownStems = new Set(ru.map((m) => m.morpheme.replace(/^-+|-+$/g, '').replace(/ё/g, 'е')));
const YO = '\u0451'; // ё
const IE = '\u0435'; // е
const knownRoots = ru
  .filter((m) => m.kind === 'root')
  .map((m) => m.morpheme.replace(/-+$/g, '').split(YO).join(IE))
  .filter((s) => s.length >= 3);
const suffixes = ru.filter((m) => m.kind === 'suffix').map((m) => m.morpheme.replace(/^-+/g, '').replace(/ё/g, 'е'));
const prefixes = ru.filter((m) => m.kind === 'prefix').map((m) => m.morpheme.replace(/-+$/g, '').replace(/ё/g, 'е'));

/** 后缀的匹配模式：原形 + core（去尾一字符，若原形≥5 且以屈折元音结尾） */
const suffixPatterns = [];
for (const s of suffixes) {
  suffixPatterns.push({ pat: s, core: false });
  if (s.length >= 5 && /[ьйоаяеыиую]$/.test(s)) {
    const c = s.slice(0, -1);
    if (c.length >= 3) suffixPatterns.push({ pat: c, core: true });
  }
}

/** 该词尾是否有合法后缀匹配（pos ≥3），返回覆盖字符数 */
function tailCover(w) {
  let best = 0;
  for (const { pat, core } of suffixPatterns) {
    if (pat.length < 2) continue;
    let pos;
    if (core) {
      // core 模式：从 pos 起到词尾，要求词尾剩余 ≤3
      pos = w.length - pat.length;
      if (pos < 3) continue;
      if (w.length - (pos + pat.length) > 3) continue;
      // core 必须真正对齐
      if (!w.startsWith(pat, pos)) continue;
      best = Math.max(best, w.length - pos);
    } else {
      if (!w.endsWith(pat)) continue;
      pos = w.length - pat.length;
      if (pos < 3) continue;
      best = Math.max(best, pat.length);
    }
  }
  return best;
}

/** 在给定候选词根集合下，该词的覆盖率（词首词素 + 词尾后缀，不重叠） */
function coverage(w, extraRoots) {
  const n = w.length;
  // 词首候选
  const heads = [];
  for (const r of knownRoots) if (w.startsWith(r)) heads.push(r.length);
  for (const p of prefixes) {
    if (!w.startsWith(p)) continue;
    if (p.length === 1) {
      // 单字符前缀需紧邻 ≥3 支撑
      const rest = w.slice(1);
      const ok = suffixPatterns.some(({ pat }) => pat.length >= 3 && rest.startsWith(pat))
        || knownRoots.some((r) => r.length >= 3 && rest.startsWith(r))
        || extraRoots.some((r) => r.length >= 3 && rest.startsWith(r));
      if (!ok) continue;
    }
    heads.push(p.length);
  }
  for (const r of extraRoots) if (w.startsWith(r)) heads.push(r.length);
  if (!heads.length) return 0;

  const tc = tailCover(w);
  let best = 0;
  for (const h of heads) {
    let cov = h;
    const tailStart = n - tc;
    if (tc > 0 && tailStart >= h) cov += tc;
    best = Math.max(best, cov / n);
  }
  return best;
}

// 基线：真实实现
const withBreakdown = [];
const noBreakdown = [];
for (const w of sample) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (p.length) withBreakdown.push(w); else noBreakdown.push(w);
}

// 校准：用我的模型对已拆出词校验（模型应给出 ≥0.55）
let modelOK = 0, modelBad = 0;
for (const w of withBreakdown) {
  if (coverage(w, []) >= 0.55) modelOK++; else modelBad++;
}

// 候选词根：词首 n-gram（3-4 字符），不在已知库中
const headFreq = new Map();
for (const w of allWords) {
  for (const L of [3, 4, 5]) {
    if (w.length <= L + 2) continue;
    const g = w.slice(0, L);
    headFreq.set(g, (headFreq.get(g) || 0) + 1);
  }
}
const candRoots = [...headFreq.entries()]
  .filter(([g]) => !knownStems.has(g))
  .map(([g, c]) => ({ g, corpus: c }));

console.log('='.repeat(86));
console.log('★最终路线模型：补真实高价值词根 → 尺子 R 覆盖率');
console.log('='.repeat(86));
console.log(`样本 ${sample.length} / 已有拆解 ${withBreakdown.length} (${((withBreakdown.length/sample.length)*100).toFixed(1)}%) / 无拆解 ${noBreakdown.length}`);
console.log(`模型校准：对 ${withBreakdown.length} 个已拆出词，模型判定覆盖率≥0.55 的 ${modelOK} 个` +
  (modelBad > 0 ? `，判错 ${modelBad} 个（模型偏严，结论取保守）` : '（完全吻合 ✅）'));
console.log(`候选词根（词首 n-gram，不在库中）: ${candRoots.length}`);
console.log('');

// 每个候选词根单独能解锁多少"无拆解词"
const sampleHeadless = noBreakdown;
const single = [];
for (const c of candRoots) {
  let gain = 0;
  const ex = [];
  for (const w of sampleHeadless) {
    if (!w.startsWith(c.g)) continue;
    if (coverage(w, [c.g]) >= 0.55) { gain++; if (ex.length < 3) ex.push(w); }
  }
  if (gain > 0) single.push({ root: c.g, gain, corpus: c.corpus, ex });
}
single.sort((a, b) => b.gain - a.gain || b.corpus - a.corpus);

console.log(`【有效候选（至少解锁 1 词）: ${single.length} 个】TOP 35：`);
console.log('词根      解锁词数  全库词数  例词');
for (const s of single.slice(0, 35)) {
  console.log(`  ${s.root.padEnd(8)} ${String(s.gain).padStart(4)}    ${String(s.corpus).padStart(6)}   ${s.ex.join(', ')}`);
}

const need = Math.ceil(sample.length * 0.45);
const gap = need - withBreakdown.length;
console.log('');
console.log(`【达标模拟】45% 需 ${need} 词，当前 ${withBreakdown.length}，缺口 ${gap} 词`);
console.log('');

// 贪心累加（去重：一个词只算一次）
const unlocked = new Set();
let used = 0;
const milestones = [];
for (const s of single) {
  used++;
  for (const w of sampleHeadless) {
    if (unlocked.has(w)) continue;
    if (!w.startsWith(s.root)) continue;
    if (coverage(w, [s.root]) >= 0.55) unlocked.add(w);
  }
  const rate = (withBreakdown.length + unlocked.size) / sample.length * 100;
  if (used <= 15 || used % 10 === 0 || (rate >= 45 && !milestones.some((m) => m.rate >= 45))) {
    milestones.push({ used, got: unlocked.size, rate });
  }
  if (rate >= 45) break;
}
for (const m of milestones) {
  console.log(`  补 ${String(m.used).padStart(3)} 个词根 → +${String(m.got).padStart(3)} 词 → ${(m.rate).toFixed(1)}%${m.rate >= 45 ? '  ✅ 达标' : ''}`);
}
console.log('');
const last = milestones[milestones.length - 1];
if (last && last.rate >= 45) {
  console.log(`⇒ **达到 45% 需补约 ${last.used} 个高价值词根**（vs 表面词干法的 112 个 —— 效率提升 ${(112/last.used).toFixed(1)}×）`);
} else {
  console.log(`⇒ 补完全部 ${single.length} 个有效候选仍未达标；累计解锁 ${unlocked.size} 词 → ${last ? last.rate.toFixed(1) : '?'}%`);
}

db.close();
