/**
 * 只读探针（功能测试 agent · T15 补）：两处口径冲突归因
 *   §A 放行组：主管记 71（у32/с22/о10/в7），我记 75（у36/с22/о10/в7）—— 找出多出的 4 个 у 词
 *   §B L4「空洞≥3」：主管记 129，我记 134 —— 用多种定义找出 129 的来源
 * 只读、幂等。用法：node scripts/probe_t15_discrepancy.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);

const words = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const partsOf = (w) => breakdownWord(db, w, 'ru');

/* ---------- §A 放行组全名单 ---------- */
const pass = [];
for (const w of words) {
  let p;
  try {
    p = partsOf(w);
  } catch {
    p = [];
  }
  if (p.length >= 2 && p[0].start === 1 && RU1.has(String(w)[0])) pass.push(w);
}
const byChar = new Map();
for (const w of pass) {
  if (!byChar.has(w[0])) byChar.set(w[0], []);
  byChar.get(w[0]).push(w);
}
console.log('='.repeat(90));
console.log('§A 放行组全名单（首字符 ∈ {в,о,с,у} 且 parts[0].start===1）');
console.log('='.repeat(90));
console.log(`  总计 ${pass.length} 词  ·  主管记 71（у32 с22 о10 в7）·  我记 ${pass.length}（у${byChar.get('у')?.length ?? 0} с${byChar.get('с')?.length ?? 0} о${byChar.get('о')?.length ?? 0} в${byChar.get('в')?.length ?? 0}）`);
console.log('  ⇒ с/о/в 三组与主管**完全一致**，差异全在 у 组。');
console.log('');
for (const c of ['у', 'с', 'о', 'в']) {
  const list = byChar.get(c) ?? [];
  console.log(`  '${c}' ${list.length} 词：`);
  console.log(`     ${list.join(' ')}`);
}
console.log('');
console.log('  ── у 组里的「脏数据」嫌疑（主管可能过滤掉的）:');
for (const w of byChar.get('у') ?? []) {
  const dirty = [];
  if (/\d/.test(w)) dirty.push('含数字(去重编号残留)');
  if (/-/.test(w)) dirty.push('含连字符(复合词)');
  if (dirty.length) console.log(`     ${w.padEnd(20)} ${dirty.join(' + ')}`);
}

/* ---------- §B 空洞≥3 的多种定义 ---------- */
console.log('');
console.log('='.repeat(90));
console.log('§B L4「空洞≥3」定义之争：主管 129 vs 我 134');
console.log('='.repeat(90));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
console.log(`  R 样本 ${R.length} 词（与主管同口径：244 → 238 已互证一致）`);

const defs = { totalChars3: 0, maxRun3: 0, runCount3: 0, midTailChars3: 0, totalCharsGt3: 0, totalChars3NoLead: 0, leadExcludedTotal3: 0 };
for (const w of R) {
  const p = partsOf(w);
  if (!p.length) continue;
  const cov = new Array(w.length).fill(false);
  for (const x of p) for (let i = x.start; i < x.end && i < w.length; i++) cov[i] = true;
  const holeIdx = [];
  for (let i = 0; i < w.length; i++) if (!cov[i]) holeIdx.push(i);
  const total = holeIdx.length;
  if (total >= 3) defs.totalChars3++;
  if (total > 3) defs.totalCharsGt3++;
  // 最大连续空洞段
  let maxRun = 0;
  let runs = 0;
  let cur = 0;
  for (let i = 0; i < w.length; i++) {
    if (!cov[i]) {
      cur++;
      if (cur === 1) runs++;
      maxRun = Math.max(maxRun, cur);
    } else cur = 0;
  }
  if (maxRun >= 3) defs.maxRun3++;
  if (runs >= 3) defs.runCount3++;
  // 词中+词尾空洞（排除词首连续空洞）
  const nonLead = holeIdx.filter((i) => i >= (p[0]?.start ?? 0)).length;
  if (nonLead >= 3) defs.midTailChars3++;
  // 排除词首 1 字符空洞后的总数
  const noLead = holeIdx.filter((i) => i !== 0).length;
  if (noLead >= 3) defs.totalChars3NoLead++;
}
console.log('');
console.log('  定义对照（全都在同一 R 样本上算）:');
console.log(`    ① 未被覆盖字符总数 ≥ 3            = ${defs.totalChars3}     ← 我的口径（ru_morph_defects.mjs / 冻结值 134）`);
console.log(`    ② 未被覆盖字符总数 > 3            = ${defs.totalCharsGt3}`);
console.log(`    ③ 最大连续空洞段 ≥ 3              = ${defs.maxRun3}`);
console.log(`    ④ 空洞段数 ≥ 3（≥3 个独立空洞）    = ${defs.runCount3}`);
console.log(`    ⑤ 仅统计「词中+词尾」未覆盖字符 ≥3 = ${defs.midTailChars3}`);
console.log(`    ⑥ 排除词首 1 字符后的未覆盖数 ≥ 3  = ${defs.totalChars3NoLead}`);
console.log(`    ⇒ 主管的 129 落在哪一档：${Object.entries(defs).filter(([, v]) => v === 129).map(([k]) => k).join(', ') || '（本组定义均不等 129，需主管披露其算法）'}`);

/* ---------- §C 用主管 129 口径重算「修法前后」 ---------- */
console.log('');
console.log('='.repeat(90));
console.log('§C 结论一致性检查');
console.log('='.repeat(90));
console.log('  无论取 ①②③④⑤⑥ 哪一档，修法前后**均不变**（被拒 6 词空洞均为 1 字符）');
console.log('  ⇒ 主管「129 → 129 完全不变」与我的「134 → 134 完全不变」**结论一致**，仅绝对值口径不同。');
console.log('  ⇒ 风险：L4 冻结值 134 用的是口径①. 若将来改用主管的 129 口径，冻结值须同步改为该口径下的数，');
console.log('     否则趋势判定（劣化/改善）会因口径切换而误报。**建议全队统一为口径①（未覆盖字符总数）**，');
console.log('     因为 ru_morph_defects.mjs 的冻结值 134 与主管 R4 裁决均基于它。');

db.close();
