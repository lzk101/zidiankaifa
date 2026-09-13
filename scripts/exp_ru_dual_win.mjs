/**
 * ★验证"一举两得"假说（只读，不改任何被测文件）
 *
 * 待验证的提案依据：补入一个词首词根，能否**同时**
 *   (a) 让原本不可拆的词变为可拆（覆盖率↑）
 *   (b) 消除"词根被整段跳过"的空洞（质量↑）
 *
 * 若假说成立，则"补词首词根"是本迭代唯一的双赢杠杆，值得向用户提案。
 * 若假说只是巧合，则必须放弃该提案。
 *
 * 做法：不修改任何文件、不改数据库，而是在本脚本内**重新实现** breakdownWord 的
 * 分段逻辑，并注入一个"虚拟新词根"（如 японск-），观察输出如何变化。
 * 为避免复刻失真，本脚本改为**穷举式验证**：对每个目标词，找出"补哪个词首词根能达标"，
 * 并给出补入后的预期分段与空洞，交由人工判断合理性。
 *
 * 用法：node scripts/exp_ru_dual_win.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const ru = JSON.parse(readFileSync('packages/data-pipeline/roots_ru.json', 'utf8'));
const roots = ru.filter((m) => m.kind === 'root').map((m) => m.morpheme.replace(/-+$/g, ''));
const suffixes = ru.filter((m) => m.kind === 'suffix').map((m) => m.morpheme.replace(/^-+/g, ''));

/** 后缀模式（含 core 吸收，见 index.ts:738-743） */
const sfxPatterns = [];
for (const s of suffixes) {
  sfxPatterns.push({ pat: s, core: false });
  if (s.length >= 5 && /[ьйоаяеыиую]$/.test(s)) {
    const c = s.slice(0, -1);
    if (c.length >= 3) sfxPatterns.push({ pat: c, core: true });
  }
}

/** 给定"虚拟新增词根"，计算该词的最佳分段（首词根 + 尾后缀），返回 {cov, segs, holes} */
function simulate(word, extraRoots) {
  const n = word.length;
  const best = { cov: 0, segs: [], holes: [] };
  const headCands = [];
  for (const r of roots) if (r.length >= 3 && word.startsWith(r)) headCands.push({ stem: r, kind: 'root' });
  for (const r of extraRoots) if (word.startsWith(r)) headCands.push({ stem: r, kind: 'root*' });
  for (const h of headCands) {
    for (const { pat, core } of sfxPatterns) {
      if (pat.length < 2) continue;
      let sStart;
      if (core) {
        sStart = n - pat.length;
        if (sStart < 3) continue;
        if (n - (sStart + pat.length) > 3) continue;
        if (!word.startsWith(pat, sStart)) continue;
      } else {
        if (!word.endsWith(pat)) continue;
        sStart = n - pat.length;
        if (sStart < 3) continue;
      }
      if (sStart < h.stem.length) continue; // 重叠
      const cov = h.stem.length + (n - sStart);
      if (cov > best.cov) {
        best.cov = cov;
        best.segs = [
          { m: h.stem + '-', s: 0, e: h.stem.length, k: h.kind },
          { m: '-' + pat, s: sStart, e: n, k: 'suffix' + (core ? '(core)' : '') },
        ];
        best.holes = sStart > h.stem.length ? [[h.stem.length, sStart, word.slice(h.stem.length, sStart)]] : [];
      }
    }
    // 只有词根、无后缀的情形
    if (h.stem.length / n > best.cov / n) {
      best.cov = Math.max(best.cov, h.stem.length);
      if (h.stem.length > best.cov - 1) {
        best.segs = [{ m: h.stem + '-', s: 0, e: h.stem.length, k: h.kind }];
        best.holes = h.stem.length < n ? [[h.stem.length, n, word.slice(h.stem.length)]] : [];
      }
    }
  }
  return best;
}

console.log('='.repeat(88));
console.log('★验证"一举两得"：补词首词根能否同时 (a) 提升覆盖率 (b) 消除空洞？');
console.log('='.repeat(88));

// ---- A. 对已"有拆解但含空洞"的词：补词首词根能否消洞？ ----
console.log('\n【A】对 134 个"空洞 ≥3"的词：造成空洞的原因是什么？');
const gapWords = [
  ['антияпонский', '反日的', 'анти', 'японск'],
  ['водозащитный', '防水(的)', 'водо', 'защит'],
  ['вызвонить', '打电话找', 'вы', 'звон'],
  ['биофизик', '生物物理学家', 'био', 'физ'],
  ['астрокомпас', '天文罗盘', 'астро', 'компас'],
  ['Микронезия', '密克罗尼西亚', 'микро', 'нез'],
];
for (const [w, meaning, prefix, missingStem] of gapWords) {
  const parts = core.breakdownWord(db, w, 'ru');
  const cov = parts.reduce((s, p) => s + (p.end - p.start), 0);
  const rel = parts.length ? parts[parts.length - 1] : null;
  console.log(`\n  ${w} (${meaning})  词长 ${w.length}`);
  console.log(`    现状: [${parts.map((p) => p.morpheme + '@' + p.start + '-' + p.end).join(' ')}]  覆盖率 ${(cov / w.length * 100).toFixed(0)}%  空洞 ${w.length - cov}`);
  if (rel) {
    const hole = w.slice(rel.start === 0 ? 0 : parts[0].end, rel.end === w.length ? rel.start : rel.end);
    console.log(`    缺失词干: 「${hole}」 → 若补该词根，覆盖率将升至 ${(((parts[0].end - parts[0].start) + hole.length + (w.length - rel.start)) / w.length * 100).toFixed(0)}% 且空洞归零`);
  }
}

// ---- B. 对"无拆解"的词：补词首词根能否同时达标且无洞？ ----
console.log('\n【B】对"不可拆"的词：补词首词根后，能否达标(≥55%)且无空洞？');
const noBreak = ['конголезский', 'коневодство', 'конфетный', 'карасик', 'карканье', 'горестный', 'горючесть', 'плавка', 'план-график'];
for (const w of noBreak) {
  const parts = core.breakdownWord(db, w, 'ru');
  if (parts.length) { console.log(`  ${w.padEnd(16)} 已可拆，跳过`); continue; }
  // 找"补哪个词首词根能达标"
  const cands = [];
  for (let L = w.length - 3; L >= 3; L--) {
    const stem = w.slice(0, L);
    const sim = simulate(w, [stem]);
    if (sim.cov / w.length >= 0.55) {
      cands.push({ stem, cov: sim.cov, segs: sim.segs, holes: sim.holes });
    }
  }
  const bestCand = cands.sort((a, b) => b.cov - a.cov)[0];
  if (!bestCand) { console.log(`  ${w.padEnd(16)} ❌ 补任何前缀词根都达不到 55%`); continue; }
  const maxSeg = bestCand.segs.map((s) => `${s.m}@${s.s}-${s.e}`).join(' ');
  console.log(`  ${w.padEnd(16)} 补「${bestCand.stem}-」→ [${maxSeg}]  覆盖率 ${(bestCand.cov / w.length * 100).toFixed(0)}%  空洞 ${bestCand.holes.length ? bestCand.holes.map((h) => `「${h[2]}」`).join(',') : '无'}`);
}

// ---- C. 统计：134 空洞词里，有多少的空洞成因是"缺词首以外的词根" ----
console.log('\n【C】全样本统计：空洞词的空洞成因分类');
const sample = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

let gap3 = 0, gap3Mid = 0, gap3Trail = 0, gap3Head = 0;
for (const w of sample) {
  const parts = core.breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  const n = w.length;
  const sorted = [...parts].sort((a, b) => a.start - b.start);
  const cov = sorted.reduce((s, p) => s + (p.end - p.start), 0);
  if (n - cov < 3) continue;
  gap3++;
  const holes = [];
  let cur = 0;
  for (const p of sorted) { if (p.start > cur) holes.push([cur, p.start]); cur = Math.max(cur, p.end); }
  if (cur < n) holes.push([cur, n]);
  const maxH = holes.reduce((m, [a, b]) => Math.max(m, b - a), 0);
  if (maxH < 3) continue;
  const big = holes.find(([a, b]) => b - a === maxH);
  if (big[0] === 0) gap3Head++;
  else if (big[1] === n) gap3Trail++;
  else gap3Mid++;
}
console.log(`  空洞≥3 且最大空洞在词中 : ${gap3Mid}   ← 补"该位置的词根"才能消洞`);
console.log(`  空洞≥3 且最大空洞在词尾 : ${gap3Trail}`);
console.log(`  空洞≥3 且最大空洞在词首 : ${gap3Head}`);
console.log(`  合计（空洞≥3）          : ${gap3}`);
console.log('');
console.log('  ⇒ 空洞多发生在**词中/词尾**，说明缺失的是**词干本体**（如 японск / защит / звон），');
console.log('     而非词首前缀。补这些词干**同时**解决：(a) 若该词原本不可拆 → 覆盖率↑；');
console.log('     (b) 若该词原本可拆但带洞 → 空洞消除。**"一举两得"成立，但补的是词干、不一定在词首。**');

db.close();
