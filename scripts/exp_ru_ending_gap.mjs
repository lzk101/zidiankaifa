/**
 * 词尾缺口分析（只读）：roots_ru.json 缺少哪些高频屈折词尾？
 *
 * 假设：-ый / -ий / -ов / -ев 等主流俄语形容词/所有格词尾缺失，
 *       导致 index.ts:773-781 的"单字符前缀紧邻支撑"规则找不到支撑词素，
 *       进而使 119 个"单字符前缀无支撑"词被拒。
 *
 * 本脚本统计：把候选词尾加入后，791 词样本中「有多少词会因此获得新支撑 / 新覆盖率」。
 * 只做统计，不改任何文件。
 *
 * 用法：node scripts/exp_ru_ending_gap.mjs
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
const existing = new Set(ru.map((m) => m.morpheme.replace(/^-+|-+$/g, '').replace(/ё/g, 'е')));

// 全部无拆解词
const noBreakdown = [];
const withBreakdown = [];
for (const w of rows) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (p.length) withBreakdown.push(w); else noBreakdown.push(w);
}

// ---- ① 无拆解词里，各"词尾 2-4 字符"的频次（找缺失的高频词尾）----
const endingFreq = new Map();
for (const w of noBreakdown) {
  for (const L of [2, 3, 4]) {
    if (w.length <= L) continue;
    const e = w.slice(w.length - L);
    if (!endingFreq.has(e)) endingFreq.set(e, new Set());
    endingFreq.get(e).add(w);
  }
}

console.log('='.repeat(78));
console.log('词尾缺口：无拆解 547 词的高频词尾，以及它们是否已在词素库中');
console.log('='.repeat(78));
console.log(`样本 ${rows.length} / 已有拆解 ${withBreakdown.length} / 无拆解 ${noBreakdown.length}`);
console.log('');
console.log('【无拆解词的高频词尾 TOP 30】');
console.log('词尾        覆盖词数   是否已在词素库');
const topEndings = [...endingFreq.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 30);
for (const [e, ws] of topEndings) {
  const inLib = existing.has(e) ? '✓ 已有' : '❌ 缺失';
  console.log(`  -${e.padEnd(8)} ${String(ws.size).padStart(4)}    ${inLib}   例: ${[...ws].slice(0, 3).join(', ')}`);
}

// ---- ② 缺失词尾的"总爆发力"：一个词尾能直接补齐多少词的覆盖率 ----
// 覆盖率补齐 = 该词尾长度 / 词长，加上词首前缀长度
const prefixStems = ru.filter((m) => m.kind === 'prefix').map((m) => m.morpheme.replace(/^-+|-+$/g, '').replace(/ё/g,'е'));

console.log('');
console.log('【"补一个词尾"能救多少词：计算 (词首前缀长 + 词尾长) / 词长 ≥ 0.55 的词数】');
console.log('（假设词首有一个已知前缀、词尾补上该词尾，两者不重叠且中间允许碎片）');
console.log('词尾      可救词数   例词');
const savedByEnding = [];
for (const [e, ws] of topEndings.slice(0, 40)) {
  if (existing.has(e)) continue;
  let cnt = 0;
  const ex = [];
  for (const w of ws) {
    const pfx = prefixStems.filter((p) => p.length >= 1 && w.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    if (!pfx) continue;
    const overlap = pfx.length + e.length > w.length;
    if (overlap) continue;
    const cov = (pfx.length + e.length) / w.length;
    if (cov >= 0.55) { cnt++; if (ex.length < 3) ex.push(w); }
  }
  if (cnt > 0) savedByEnding.push({ e, cnt, ex });
}
savedByEnding.sort((a, b) => b.cnt - a.cnt);
for (const s of savedByEnding.slice(0, 25)) {
  console.log(`  -${s.e.padEnd(8)} ${String(s.cnt).padStart(4)}     ${s.ex.join(', ')}`);
}

console.log('');
const totalSaved = savedByEnding.reduce((s, x) => s + x.cnt, 0);
console.log(`⇒ 补齐这些缺失词尾，理论上可影响的词数合计 ≈ ${totalSaved}（存在重复计数，非精确值）`);
console.log('');
console.log('【关键对照：单字符前缀无支撑的 119 词，其词尾分布】');
const singleCharPfx = prefixStems.filter((p) => p.length === 1);
const noSupport = noBreakdown.filter((w) => {
  if (!w.startsWith('в') && !w.startsWith('с') && !w.startsWith('у') && !w.startsWith('о')) return false;
  const rest = w.slice(1);
  return !ru.some((m) => m.kind !== 'prefix' && m.morpheme.replace(/^-+|-+$/g, '').length >= 3 && rest.startsWith(m.morpheme.replace(/^-+|-+$/g, '')));
});
console.log(`  实际统计到 ${noSupport.length} 词（单字符前缀 ${singleCharPfx.join('/')} 开头且无紧邻支撑）`);
const nsEndFreq = new Map();
for (const w of noSupport) {
  const e = w.slice(-3);
  nsEndFreq.set(e, (nsEndFreq.get(e) || 0) + 1);
}
console.log('  其 3 字符词尾 TOP 12:', [...nsEndFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([e,c])=>`-${e}×${c}`).join('  '));
console.log('  样例 30:', noSupport.slice(0, 30).join(' '));

db.close();
