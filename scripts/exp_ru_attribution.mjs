/**
 * 归因实验（只读）：215 个「词首已有已知词素却仍未被拆出」的词，各自卡在哪条规则上？
 *
 * 依据 packages/core/src/db/index.ts 的四道关：
 *   ① index.ts:765  前缀须 ≥1 字符（俄语），后缀须 ≥2
 *   ② index.ts:767  前缀只能起于词首
 *   ③ index.ts:771  core 模式要求词尾剩余 ≤3
 *   ④ index.ts:773-781 单字符前缀需有【紧邻】的词根/后缀支撑（rest.startsWith(x.stem)，stem≥3）
 *   ⑤ index.ts:783  后缀左侧须有 ≥3 字符词干
 *   ⑥ index.ts:842  覆盖率 ≥ 0.55
 *   ⑦ index.ts:846  单片段且 start===1 → 拒绝
 *   ⑧ index.ts:851-855 首片段 start≥2 且 gap 无前缀精确解释 → 拒绝
 *
 * 用法：node scripts/exp_ru_attribution.mjs
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

const morphemes = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({
    raw: String(r.morpheme),
    kind: String(r.kind),
    stem: String(r.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е'),
  }));

const byKind = { prefix: [], suffix: [], root: [] };
for (const m of morphemes) if (byKind[m.kind]) byKind[m.kind].push(m);
for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => b.stem.length - a.stem.length);

const allNonPrefix = [...byKind.root, ...byKind.suffix];

const noBreakdown = [];
const withBreakdown = [];
for (const w of rows) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (p.length) withBreakdown.push(w); else noBreakdown.push(w);
}

const reasons = {
  singleCharPrefixNoSupport: [],
  suffixCoverageTooLow: [],
  multiCharPrefixButNoSuffix: [],
  headRootOnlyNoSuffix: [],
  other: [],
  headNone: [],
};
const detail = [];

for (const w of noBreakdown) {
  const n = w.length;
  // 词首命中的前缀（按长度降序，取最长）
  const headPfx = byKind.prefix.filter((p) => w.startsWith(p.stem));
  const rootAt0 = byKind.root.filter((r) => r.stem.length >= 3 && w.startsWith(r.stem));

  if (!headPfx.length && !rootAt0.length) { reasons.headNone.push(w); continue; }

  // 取最长的词首前缀
  const pfx = headPfx[0];
  // 该词尾是否有已知后缀（合法：pos>=3）
  const tailSuffix = byKind.suffix.find(
    (s) => w.endsWith(s.stem) && w.length - s.stem.length >= 3,
  );

  // 计算「前缀 + 后缀」的覆盖率上界
  let cov = 0;
  if (rootAt0.length) cov += rootAt0[0].stem.length;
  else if (pfx) cov += pfx.stem.length;
  if (tailSuffix) {
    const sPos = w.length - tailSuffix.stem.length;
    // 后缀不得与前缀重叠
    if (sPos >= (rootAt0[0]?.stem.length ?? pfx?.stem.length ?? 0)) cov += tailSuffix.stem.length;
  }
  const covRatio = cov / n;

  const rec = {
    w, n,
    head: rootAt0[0] ? `root:${rootAt0[0].stem}` : `pfx:${pfx.stem}`,
    tail: tailSuffix ? `-${tailSuffix.stem}` : '无',
    cov: covRatio,
  };

  if (pfx && pfx.stem.length === 1 && !rootAt0.length) {
    // 单字符前缀：检查紧邻支撑
    const rest = w.slice(1);
    const supported = allNonPrefix.some((x) => x.stem.length >= 3 && rest.startsWith(x.stem));
    if (!supported) { reasons.singleCharPrefixNoSupport.push(w); rec.why = '④单字符前缀无紧邻支撑'; }
    else if (covRatio < 0.55) { reasons.suffixCoverageTooLow.push(w); rec.why = '⑥覆盖率不足'; }
    else { reasons.other.push(w); rec.why = '其他'; }
  } else if (rootAt0.length && covRatio < 0.55) {
    reasons.headRootOnlyNoSuffix.push(w); rec.why = '⑥词首有根但覆盖率不足';
  } else if (pfx && pfx.stem.length >= 2 && covRatio < 0.55) {
    reasons.multiCharPrefixButNoSuffix.push(w); rec.why = '⑥多字符前缀但覆盖率不足';
  } else if (covRatio >= 0.55) {
    reasons.other.push(w); rec.why = '覆盖率够却未拆（需深查）';
  } else {
    reasons.suffixCoverageTooLow.push(w); rec.why = '⑥覆盖率不足';
  }
  detail.push(rec);
}

const total = rows.length;
const fmt = (n) => `${String(n).padStart(3)} (${((n / total) * 100).toFixed(1)}%)`;
console.log('='.repeat(80));
console.log('归因：215 个「词首已有已知词素却未拆出」的词，各卡在哪条规则？');
console.log('='.repeat(80));
console.log(`样本 ${total} / 已有拆解 ${withBreakdown.length} / 无拆解 ${noBreakdown.length}`);
console.log('');
console.log(`④ 单字符前缀无紧邻支撑（index.ts:773-781） : ${fmt(reasons.singleCharPrefixNoSupport.length)}`);
console.log(`⑥ 覆盖率 < 0.55（index.ts:842）            : ${fmt(reasons.suffixCoverageTooLow.length)}`);
console.log(`⑥ 词首有词根但覆盖率不足                   : ${fmt(reasons.headRootOnlyNoSuffix.length)}`);
console.log(`⑥ 多字符前缀但覆盖率不足                   : ${fmt(reasons.multiCharPrefixButNoSuffix.length)}`);
console.log(`? 覆盖率够却未拆（异常）                   : ${fmt(reasons.other.length)}`);
console.log(`— 词首无任何已知词素（另一类）             : ${fmt(reasons.headNone.length)}`);
console.log('');
console.log('【无拆解且词首有词素 · 样例 60（词 词首 词尾 覆盖率 卡点）】');
for (const d of detail.slice(0, 60)) {
  console.log(`  ${d.w.padEnd(15)} ${d.head.padEnd(14)} ${d.tail.padEnd(10)} cov=${d.cov.toFixed(2)}  ${d.why ?? ''}`);
}
console.log('');
console.log('【"覆盖率够却未拆"的异常词 30 个】');
console.log(reasons.other.slice(0, 30).join(' ') || '（无）');
console.log('');
console.log('【④ 单字符前缀无支撑 · 样例 30】');
console.log(reasons.singleCharPrefixNoSupport.slice(0, 30).join(' '));

db.close();
