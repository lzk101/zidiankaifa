/**
 * 只读探针（功能测试 agent，2026-09-16）：★「放宽单字符前缀支撑规则」的误拆预言
 *
 * 背景：BOARD.md:120 记录，547 个无拆解词里有 **119 词（15.0%）** 卡在
 *   index.ts:773-781 的「单字符前缀支撑规则」上（例：вдыхать 覆盖率已 0.57）。
 *   ⇒ A2 若走「修规则」路线（BOARD.md:134 路线乙），最自然的动作就是放宽这条规则。
 *
 * 本探针要回答：**放宽它会付出什么代价？**
 *
 * 方法（刻意**不**复刻 breakdownWord 的 DP）：
 *   主管已栽过一次「自己写的复刻脚本不忠实于原码」（BOARD.md:95）。
 *   因此本探针**不做全算法复刻**，只做两件可确定性验证的事：
 *     ① 对 2 个点名词做**唯一解**算术 —— 先枚举该词在「规范位置」下的**全部**已知词素命中，
 *        若候选集唯一，则 DP 无选择余地，结果由覆盖率算术**唯一确定**，无需复刻。
 *     ② 对全样本做**上界**统计 —— 用「规范位置命中的最大覆盖字符数」判断某词是否
 *        *有可能*在丢掉支撑规则后过 0.55 阈值。这是**上界**（实际可能更少），
 *        故结论只会保守，不会虚高。
 *
 * 只读。用法：node scripts/probe_ru_gate2_prediction.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const THRESHOLD = 0.55; // packages/core/src/db/index.ts:709 BREAKDOWN_MIN_COVERAGE

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const morph = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ raw: String(r.morpheme), stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }));

/** 枚举词中**处于规范位**的全部词素命中（prefix→词首；suffix→词尾；root→任意位置） */
function canonicalHits(w) {
  const lw = w.toLowerCase();
  const hits = [];
  for (const m of morph) {
    if (!m.stem.length) continue;
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

/** 不重叠区间调度的最大覆盖字符数（= 最优覆盖率上界） */
function maxCovered(hits) {
  if (!hits.length) return { covered: 0, picked: [] };
  const pts = [...new Set(hits.flatMap((h) => [h.start, h.end]))].sort((a, b) => a - b);
  const best = new Map();
  const pick = new Map();
  const solve = (idxIn) => {
    // 在 pts 前缀上前进
    let i = idxIn;
    const key = i;
    if (best.has(key)) return best.get(key);
    while (i < pts.length && pts[i] < 0) i++;
    if (i >= pts.length - 1) {
      best.set(key, 0);
      return 0;
    }
    const pos = pts[i];
    // 选项 A：跳过 pos
    const skip = solve(i + 1);
    // 选项 B：选一个从 pos 开始的区间
    let takeBest = 0;
    let takePick = null;
    for (const h of hits) {
      if (h.start !== pos) continue;
      const nxt = pts.findIndex((p) => p >= h.end);
      const sub = nxt < 0 ? 0 : solve(nxt);
      const val = h.len + sub;
      if (val > takeBest) {
        takeBest = val;
        takePick = h;
      }
    }
    const res = Math.max(skip, takeBest);
    best.set(key, res);
    pick.set(key, takeBest > skip ? takePick : null);
    return res;
  };
  const covered = solve(0);
  // 回溯取出选择集（用于打印）
  const picked = [];
  let i = 0;
  while (i < pts.length - 1) {
    const p = pick.get(i);
    if (!p) {
      i += 1;
      continue;
    }
    picked.push(p);
    const nxt = pts.findIndex((q) => q >= p.end);
    i = nxt < 0 ? pts.length : nxt;
  }
  return { covered, picked };
}

console.log('='.repeat(80));
console.log('① 点名词唯一解算术（规范位候选集唯一 ⇒ DP 无选择余地 ⇒ 结果由算式唯一确定）');
console.log('='.repeat(80));
for (const w of ['вдыхать', 'велюровый', 'безаварийный']) {
  const n = w.length;
  const hits = canonicalHits(w);
  const { covered, picked } = maxCovered(hits);
  const cov = covered / n;
  const inLib = hits.map((h) => `${h.raw}[${h.kind}]@${h.start}-${h.end}`).join(' ');
  const cur = core.breakdownWord(db, w, 'ru').map((p) => p.morpheme);
  const needsSupportRule = picked.some((p) => p.kind === 'prefix' && p.len === 1);
  console.log('');
  console.log(`  ${w}  (len=${n})`);
  console.log(`    当前实测输出                      : ${JSON.stringify(cur)}`);
  console.log(`    规范位已知词素命中（全部候选）    : ${inLib || '（无）'}`);
  console.log(`    最优不重叠覆盖                    : ${covered}/${n} = ${cov.toFixed(3)}  (阈值 ${THRESHOLD})`);
  console.log(`    最优选择集                        : ${picked.map((p) => p.raw).join(' + ')}`);
  console.log(`    是否用到 1 字符前缀（受支撑规则管）: ${needsSupportRule ? '是 ← 支撑规则是唯一拦阻' : '否'}`);
  console.log(`    ⇒ 若去掉支撑规则：覆盖率 ${cov.toFixed(3)} ${cov >= THRESHOLD ? '≥' : '<'} ${THRESHOLD} ⇒ ${cov >= THRESHOLD ? '★会拆出来（假拆解）' : '仍不会拆'}`);
}

console.log('');
console.log('='.repeat(80));
console.log('② 全样本上界：丢掉支撑规则后**最多**有多少词会新增拆解，其中多少吞掉词根');
console.log('='.repeat(80));
const sample = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

let curWith = 0;
const newlyBreakable = [];
const rootSwallowers = [];
for (const w of sample) {
  const n = w.length;
  let cur = [];
  try {
    cur = core.breakdownWord(db, w, 'ru');
  } catch {
    cur = [];
  }
  if (cur.length) {
    curWith++;
    continue;
  }
  const hits = canonicalHits(w);
  const { covered, picked } = maxCovered(hits);
  const cov = covered / n;
  if (cov < THRESHOLD) continue;
  // 是否依赖 1 字符前缀
  if (!picked.some((p) => p.kind === 'prefix' && p.len === 1)) continue;
  const sorted = [...picked].sort((a, b) => a.start - b.start);
  const holes = [];
  let cursor = 0;
  for (const p of sorted) {
    if (p.start > cursor) holes.push(w.slice(cursor, p.start));
    cursor = p.end;
  }
  if (cursor < n) holes.push(w.slice(cursor));
  const maxHole = holes.reduce((m, h) => Math.max(m, h.length), 0);
  const rec = { w, cov, picked: sorted.map((p) => p.raw).join('+'), holes: holes.join('|'), maxHole };
  newlyBreakable.push(rec);
  if (maxHole >= 2) rootSwallowers.push(rec);
}
const pct = (x, y) => ((x / y) * 100).toFixed(1);
console.log(`  样本 ${sample.length} 词，当前有拆解 ${curWith}`);
console.log(`  丢掉支撑规则后**最多**新增拆解      : ${newlyBreakable.length} 词（上界，实得可能更少）`);
console.log(`    其中拆解含 ≥2 字符空洞（吞词根/吞音节）: ${rootSwallowers.length} 词`);
console.log(`  ⇒ 覆盖率上界可从 ${pct(curWith, sample.length)}% 抬到 ${pct(curWith + newlyBreakable.length, sample.length)}%`);
console.log('');
console.log(`  含 ≥2 字符空洞的样例（**每一项都是疑似假拆解，需人工审定**）：`);
for (const r of rootSwallowers.slice(0, 30)) {
  console.log(`    ${r.w.padEnd(14)} cov=${r.cov.toFixed(3)}  ${r.picked.padEnd(18)} 空洞="${r.holes}"(max ${r.maxHole})`);
}

console.log('');
console.log('='.repeat(80));
console.log('结论：放宽支撑规则 = 用「疑似假拆解」换覆盖率。必须先补词根（дых- 等），再谈放宽。');
console.log('='.repeat(80));

db.close();
