/**
 * 最终路线度量（只读）：从 332 个"词首无已知词素"的词里提取候选词根，
 * 量化「补 N 个词根 → 覆盖率提升到 X%」，给出 45% 所需的最小补词根数。
 *
 * 方法：
 *   1. 对每个"词首无已知词素"的无拆解词，剥离最长已知后缀，得到候选词根
 *   2. 对候选词根做**归一化聚类**（去掉派生尾 -ий/-ый/-н- 等），识别词族
 *   3. 模拟：把候选词根加入词素库后，该词能否达到覆盖率 0.55 → 能否拆出
 *   4. 按"可解锁词数"排序，累加计算达到 45% 所需的最少词根数
 *
 * 用法：node scripts/exp_ru_root_plan.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const rows = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const ru = JSON.parse(readFileSync('packages/data-pipeline/roots_ru.json', 'utf8'));
const byKind = { prefix: [], suffix: [], root: [] };
for (const m of ru) {
  const stem = m.morpheme.replace(/^-+|-+$/g, '').replace(/ё/g, 'е');
  if (byKind[m.kind]) byKind[m.kind].push({ ...m, stem });
}
for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => b.stem.length - a.stem.length);

const NO = 'NONE';
const withBreakdown = [];
const noBreakdown = [];
for (const w of rows) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (p.length) withBreakdown.push(w); else noBreakdown.push(w);
}

/** 该词"词首无已知词素"吗？（root≥3 或 prefix） */
const headMor = (w) => {
  const r = byKind.root.find((m) => m.stem.length >= 3 && w.startsWith(m.stem));
  if (r) return r;
  const p = byKind.prefix.find((m) => w.startsWith(m.stem) && m.stem.length >= 2);
  return p ?? null;
};

/** 模拟：在给定"额外词根集合"下，该词能否被拆出（覆盖率 ≥0.55 且首片段合法） */
function canBreak(word, extraRoots) {
  const n = word.length;
  // 词首候选：已有 root（≥3）或 prefix（≥1，含单字符），或 extraRoots 中的新根
  const headCands = [];
  for (const r of byKind.root) if (r.stem.length >= 3 && word.startsWith(r.stem)) headCands.push({ stem: r.stem, kind: 'root' });
  for (const p of byKind.prefix) if (word.startsWith(p.stem)) headCands.push({ stem: p.stem, kind: 'prefix' });
  for (const e of extraRoots) if (word.startsWith(e)) headCands.push({ stem: e, kind: 'root' });
  if (!headCands.length) return null; // 仍无词首词素

  // 词尾候选：最长已知后缀，pos≥3
  const tail = byKind.suffix.find((s) => word.endsWith(s.stem) && word.length - s.stem.length >= 3);

  let best = 0;
  for (const h of headCands) {
    let cov = h.stem.length;
    if (tail) {
      const sPos = word.length - tail.stem.length;
      if (sPos >= h.stem.length) cov += tail.stem.length;
    }
    // 单字符前缀需紧邻支撑：新词根也算
    if (h.kind === 'prefix' && h.stem.length === 1) {
      const rest = word.slice(1);
      const supported =
        byKind.suffix.some((s) => s.stem.length >= 3 && rest.startsWith(s.stem)) ||
        byKind.root.some((s) => s.stem.length >= 3 && rest.startsWith(s.stem)) ||
        extraRoots.some((e) => e.length >= 3 && rest.startsWith(e));
      if (!supported) continue;
    }
    if (cov / n > best) best = cov / n;
  }
  return best >= 0.55 ? best : null;
}

// ---- 找"词首无词素"的词，提候选词根 ----
const headless = noBreakdown.filter((w) => !headMor(w));
const candidates = new Map(); // 候选词根 → Set(词)
for (const w of headless) {
  let stem = w;
  const tail = byKind.suffix.find((s) => w.endsWith(s.stem) && w.length - s.stem.length >= 3);
  if (tail) stem = w.slice(0, w.length - tail.stem.length);
  if (stem.length < 3) continue;
  if (!candidates.has(stem)) candidates.set(stem, new Set());
  candidates.get(stem).add(w);
}

console.log('='.repeat(80));
console.log('路线度量：补词根能到多少？（初始 ' + withBreakdown.length + '/' + rows.length + ' = ' + ((withBreakdown.length/rows.length)*100).toFixed(1) + '%）');
console.log('='.repeat(80));
console.log(`无拆解词            : ${noBreakdown.length}`);
console.log(`  其中"词首无已知词素": ${headless.length}`);
console.log(`  提取到候选词根      : ${candidates.size} 个`);
console.log(`  候选词根覆盖 >1 词的: ${[...candidates.values()].filter((s) => s.size > 1).length} 个`);
console.log('');

// ---- 贪心：按"新增可解锁词数"排序，累加 ----
const candList = [...candidates.keys()];
const unlockedBy = new Map();
for (const c of candList) unlockedBy.set(c, 0);

// 先算每个候选单独能解锁多少（含它自己）
const baseSet = new Set(withBreakdown);
const singleGain = [];
for (const c of candList) {
  let gain = 0;
  const ex = [];
  for (const w of candidates.get(c)) {
    if (baseSet.has(w)) continue;
    if (canBreak(w, [c])) { gain++; if (ex.length < 3) ex.push(w); }
  }
  singleGain.push({ root: c, gain, ex, words: [...candidates.get(c)] });
}
singleGain.sort((a, b) => b.gain - a.gain);

console.log('【按"新增可解锁词数"排序的候选词根 TOP 30】');
console.log('（gain = 单独补入该词根后，本样本中能由"不可拆"变为"可拆"的词数）');
console.log('候选词根             gain  例词');
for (const s of singleGain.slice(0, 30)) {
  console.log(`  ${s.root.padEnd(18)} ${String(s.gain).padStart(3)}   ${s.ex.join(', ')}`);
}

const multi = singleGain.filter((s) => s.gain >= 2);
console.log('');
console.log(`⇒ gain ≥2 的候选词根有 ${multi.length} 个，合计可解锁 ${multi.reduce((s, x) => s + x.gain, 0)} 词`);
console.log(`⇒ gain ==1 的候选词根有 ${singleGain.filter((s) => s.gain === 1).length} 个（滴水式，补一个换一个）`);

// ---- 累加：达到 45% 需要补多少个词根 ----
const need = Math.ceil(rows.length * 0.45); // 356
const have = withBreakdown.length;
const gap = need - have;
console.log('');
console.log(`【达标模拟】45% 需 ${need} 词，当前 ${have}，缺口 ${gap} 词`);
let acc = 0, used = 0;
const accumulated = [];
for (const s of singleGain) {
  if (s.gain === 0) continue;
  acc += s.gain; used++;
  accumulated.push({ used, acc, rate: ((have + acc) / rows.length) * 100 });
  if (have + acc >= need) break;
}
console.log('');
console.log('累加补词根 → 覆盖率：');
let printed = 0;
for (const a of accumulated) {
  if (a.used % 10 === 0 || a.rate >= 45 || a === accumulated[accumulated.length - 1]) {
    console.log(`  补 ${String(a.used).padStart(4)} 个词根 → ${(have + a.acc)}/${rows.length} = ${a.rate.toFixed(1)}%${a.rate >= 45 ? '  ✅ 达标' : ''}`);
    printed++;
  }
  if (a.rate >= 45) break;
}
if (!printed || accumulated[accumulated.length - 1].rate < 45) {
  console.log('  （全部候选累加后仍未达标）');
}
console.log('');
console.log(`⇒ 结论：达到 45% 需补约 **${accumulated.length ? accumulated[accumulated.length - 1].used : '?'} 个词根**（假设逻辑成立且全部通过人工审定）`);
console.log('   注意：gain≥2 的高价值词根只有 ' + multi.length + ' 个，其余全是"补一个换一个"。');
console.log('');
console.log('【为什么最多只能救一部分】');
console.log('   若一个词"词首无词素"且剥离后缀后剩余部分 <3 字符，或词本身无已知后缀，');
console.log('   则即使补词根也无法达到覆盖率 0.55。');

db.close();
