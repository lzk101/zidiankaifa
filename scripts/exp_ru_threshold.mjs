/**
 * 阈值判别实验（只读，不改代码）：无拆解的 547 词，其「DP 最优覆盖率」分布如何？
 *
 * 依据 packages/core/src/db/index.ts:841
 *   const rawCovered = parts.reduce((s, p) => s + (p.end - p.start), 0);
 *   if (rawCovered / n < BREAKDOWN_MIN_COVERAGE) return [];   // 0.55
 *
 * DP 允许「跳过」未知部分（碎片不计覆盖率），因此一个词能否被拆出，
 * 只取决于「已知词素覆盖的字符数占词长比例是否 ≥ 0.55」。
 * → 若大量词集中落在 0.40–0.55 区间，则降低阈值可直接提升覆盖率（但会引入误拆）。
 *
 * 本实验**复刻 breakdownWord 的 DP 打分逻辑**（只读复制，不 import 内部函数），
 * 计算每个无拆解词的「最优覆盖率」，从而量化阈值敏感度。
 *
 * 用法：node scripts/exp_ru_threshold.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const rows = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

// ---- 复刻 loadMorphemes 的俄语模式构建（见 index.ts:734-745）----
const morphemes = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ raw: String(r.morpheme), kind: String(r.kind) }));

const all = morphemes.map((m) => {
  const raw = m.raw.replace(/^-+|-+$/g, '');
  const stem = raw.replace(/ё/g, 'е');
  const patterns = [{ pat: stem, core: false }];
  if (m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
    const core = stem.slice(0, -1);
    if (core.length >= 3) patterns.push({ pat: core, core: true });
  }
  return { kind: m.kind, stem, patterns, morpheme: m.raw };
});

const byFirst = new Map();
for (const e of all) {
  for (const { pat } of e.patterns) {
    const c = pat[0];
    let arr = byFirst.get(c);
    if (!arr) { arr = []; byFirst.set(c, arr); }
    arr.push(e);
  }
}

/** 复刻 candidatesAt + DP，返回最优覆盖率 */
function bestCoverage(word) {
  const w = word;
  const n = w.length;
  if (n < 2) return { cov: 0, parts: 0 };
  const mw = w.replace(/ё/g, 'е');

  const candidatesAt = (pos) => {
    const out = [];
    const entries = byFirst.get(mw[pos]);
    if (!entries) return out;
    for (const { kind, stem, patterns } of entries) {
      for (const { pat, core } of patterns) {
        const minLen = kind === 'prefix' ? 1 : 2;
        if (pat.length < minLen || !mw.startsWith(pat, pos)) continue;
        if (kind === 'prefix' && pos !== 0 && !core) continue;
        let end = pos + (core ? w.length - pos : pat.length);
        if (core) {
          if (w.length - (pos + pat.length) > 3) continue;
          end = w.length;
        } else if (kind === 'prefix' && pat.length === 1) {
          const rest = mw.slice(pos + 1);
          const supported = all.some(
            (x) => x.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem),
          );
          if (!supported) continue;
        }
        if (kind === 'suffix' && pos < 3) continue;
        out.push({ start: pos, end, kind });
      }
    }
    return out;
  };

  const covered = new Int32Array(n + 1);
  let pieces = new Int32Array(n + 1);
  const stepEnd = new Int32Array(n + 1);
  const stepHas = new Uint8Array(n + 1);
  for (let i = n - 1; i >= 0; i--) {
    let bestCov = covered[i + 1];
    let bestPieces = pieces[i + 1];
    let bestEnd = i + 1;
    let has = 0;
    for (const c of candidatesAt(i)) {
      const cov = c.end - c.start + covered[c.end];
      const pc = 1 + pieces[c.end];
      if (cov > bestCov || (cov === bestCov && pc < bestPieces)) {
        bestCov = cov; bestPieces = pc; bestEnd = c.end; has = 1;
      }
    }
    covered[i] = bestCov; pieces[i] = bestPieces; stepEnd[i] = bestEnd; stepHas[i] = has;
  }
  return { cov: covered[0] / n, parts: pieces[0] };
}

// ---- 统计 ----
const withBreakdown = [];
const noBreakdown = [];
for (const w of rows) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (parts.length) withBreakdown.push(w);
  else noBreakdown.push(w);
}

const buckets = [
  { label: '≥0.55（本应拆出却未拆，异常）', lo: 0.55, hi: 1.01, items: [] },
  { label: '0.50–0.55（差一步）', lo: 0.5, hi: 0.55, items: [] },
  { label: '0.45–0.50', lo: 0.45, hi: 0.5, items: [] },
  { label: '0.40–0.45', lo: 0.4, hi: 0.45, items: [] },
  { label: '0.30–0.40', lo: 0.3, hi: 0.4, items: [] },
  { label: '0.20–0.30', lo: 0.2, hi: 0.3, items: [] },
  { label: '<0.20（几乎无词素）', lo: 0, hi: 0.2, items: [] },
];

const covOf = new Map();
for (const w of noBreakdown) {
  const { cov, parts } = bestCoverage(w);
  covOf.set(w, { cov, parts });
  for (const b of buckets) {
    if (cov >= b.lo && cov < b.hi) { b.items.push({ w, cov, parts }); break; }
  }
}

const total = rows.length;
const fmt = (n) => `${String(n).padStart(3)} (${((n / total) * 100).toFixed(1)}%)`;
console.log('='.repeat(78));
console.log('阈值判别：无拆解 547 词的最优覆盖率分布（BREAKDOWN_MIN_COVERAGE = 0.55）');
console.log('='.repeat(78));
console.log(`样本总数              : ${total}`);
console.log(`  已有拆解            : ${fmt(withBreakdown.length)}`);
console.log(`  无拆解              : ${fmt(noBreakdown.length)}`);
console.log('');
console.log('无拆解词的最优覆盖率分布：');
for (const b of buckets) {
  console.log(`  ${b.label.padEnd(30)}: ${fmt(b.items.length)}`);
}
console.log('');

// 阈值敏感度：把阈值从 0.55 降到 X，能多拆出多少词？
console.log('【阈值敏感度】把 BREAKDOWN_MIN_COVERAGE 从 0.55 下调：');
for (const T of [0.55, 0.52, 0.5, 0.48, 0.45, 0.4, 0.35, 0.3]) {
  // 需要同时满足：覆盖率≥T 且 不是「单片段起于位置1」
  let hits = 0;
  for (const w of noBreakdown) {
    const { cov } = covOf.get(w);
    if (cov >= T) hits++;
  }
  const rate = ((withBreakdown.length + hits) / total) * 100;
  const mark = rate >= 45 ? '  ✅ 达标' : '';
  console.log(`  阈值 ${T.toFixed(2)} → 可拆出 +${String(hits).padStart(3)} 词 → 尺子 R = ${rate.toFixed(1)}%${mark}`);
}
console.log('');
console.log('注意：下调阈值会同时放行「碎片式误拆」（index.ts:708 注释即为此设阈值的理由：');
console.log('      difficult→cul、business→-ness、сегодня→год-+-ня 均属此类）。');
console.log('      故阈值不是免费的杠杆，必须用正反例判别集验证副作用。');
console.log('');
console.log('【0.50–0.55 区间样例 50（差一步的词）】');
console.log(buckets[1].items.slice(0, 50).map((x) => `${x.w}(${x.cov.toFixed(2)})`).join(' '));
console.log('');
console.log('【≥0.55 却未拆出（异常，应重点排查）样例 30】');
console.log(buckets[0].items.slice(0, 30).map((x) => `${x.w}(${x.cov.toFixed(2)})`).join(' ') || '（无）');

db.close();
