/**
 * 高价值词根挖掘（只读）：对**全部俄语词条**做词首 n-gram 挖掘，
 * 找出"不在词素库中、但能覆盖大量词"的高价值词根。
 *
 * 动机：上一实验（exp_ru_root_plan.mjs）按"去掉词尾的表面词干"提取候选，
 * 导致 453 个候选各覆盖 1 词、需补 112 个才达标。但那是**提取方法**的问题：
 * 正确的选根标准是「该词根在词库中能作为词首覆盖多少词」，而非"某词的表面词干"。
 *
 * 用法：node scripts/exp_ru_root_mine.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

// 全部俄语主词条（长度 3-14，排除明显非词条目）
const allWords = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 3 AND 14`,
  )
  .all()
  .map((r) => String(r.word))
  .filter((w) => /^[а-яё-]+$/.test(w)); // 只留纯小写西里尔（去专名/旧正字法/带注释条目）

const sample = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

const ru = JSON.parse(readFileSync('packages/data-pipeline/roots_ru.json', 'utf8'));
const knownStems = new Set(ru.map((m) => m.morpheme.replace(/^-+|-+$/g, '').replace(/ё/g, 'е')));
const knownRoots = ru.filter((m) => m.kind === 'root').map((m) => m.morpheme.replace(/-$/g, ''));
const knownSuffixes = ru.filter((m) => m.kind === 'suffix').map((m) => m.morpheme.replace(/^-/g, ''));
const knownPrefixes = new Set(ru.filter((m) => m.kind === 'prefix').map((m) => m.morpheme.replace(/-$/g, '')));

console.log('='.repeat(84));
console.log('高价值词根挖掘：词首 n-gram 全库频次');
console.log('='.repeat(84));
console.log(`全库俄语词条（纯小写西里尔，len 3-14）: ${allWords.length}`);
console.log(`尺子 R 样本                           : ${sample.length}`);
console.log(`已知词素 stem                         : ${knownStems.size}（root ${knownRoots.length} / suffix ${knownSuffixes.length} / prefix ${knownPrefixes.size}）`);
console.log('');

// ---- 词首 n-gram 挖掘（3-5 字符）----
const headCount = new Map(); // ngram → {total, sampleHits}
for (const w of allWords) {
  for (const L of [3, 4, 5]) {
    if (w.length <= L + 2) continue; // 词根后至少要留 2 字符
    const g = w.slice(0, L);
    if (!headCount.has(g)) headCount.set(g, { total: 0, sampleHits: 0 });
    headCount.get(g).total++;
  }
}
for (const w of sample) {
  for (const L of [3, 4, 5]) {
    if (w.length <= L + 2) continue;
    const g = w.slice(0, L);
    if (headCount.has(g)) headCount.get(g).sampleHits++;
  }
}

// 过滤：不在词素库中、且未被任何已知前缀覆盖
const candidates = [...headCount.entries()]
  .filter(([g]) => !knownStems.has(g) && !knownPrefixes.has(g))
  .map(([g, v]) => ({ g, ...v }))
  .sort((a, b) => b.total - a.total);

console.log('【不在词素库中的词首 n-gram TOP 40（按全库覆盖词数排序）】');
console.log('n-gram     全库词数  样本命中  是否像前缀');
for (const c of candidates.slice(0, 40)) {
  const likePrefix = knownPrefixes.has(c.g || '') ? 'prefix' : (['без','бес','пере','под','над','пред','про','раз','рас','взо','воз','вос','изо','ис','недо','около','полу','после','сверх','через','меж','междо'].includes(c.g) ? '≈前缀' : '');
  console.log(`  ${c.g.padEnd(8)} ${String(c.total).padStart(6)}   ${String(c.sampleHits).padStart(4)}    ${likePrefix}`);
}

// ---- 只看"样本命中 ≥1"的，才是对尺子 R 有用的 ----
const useful = candidates.filter((c) => c.sampleHits >= 1).sort((a, b) => b.sampleHits - a.sampleHits);
console.log('');
console.log(`【对尺子 R 样本有用（样本命中 ≥1）的候选 TOP 40 / 共 ${useful.length}】`);
console.log('n-gram     样本命中  全库词数  例词（样本内）');
for (const c of useful.slice(0, 40)) {
  const ex = sample.filter((w) => w.startsWith(c.g)).slice(0, 3);
  console.log(`  ${c.g.padEnd(8)} ${String(c.sampleHits).padStart(4)}   ${String(c.total).padStart(6)}    ${ex.join(', ')}`);
}

console.log('');
console.log('【关键对比】');
console.log(`  候选总数（样本命中≥1）: ${useful.length}`);
console.log(`  其中全库词数 ≥10 的    : ${useful.filter((c) => c.total >= 10).length}`);
console.log(`  其中全库词数 ≥50 的    : ${useful.filter((c) => c.total >= 50).length}`);
console.log(`  其中全库词数 ≥100 的   : ${useful.filter((c) => c.total >= 100).length}`);
console.log('');
const totalUsefulHits = useful.reduce((s, c) => s + c.sampleHits, 0);
console.log(`  ⇒ 若补入全部 ${useful.length} 个候选，样本内词首命中合计 ${totalUsefulHits} 次`);
console.log('     （注意：多候选可能命中同一词，实际解锁数需去重）');

// ---- 去重后：补入 TOP N 能覆盖样本中多少"无拆解且词首无词素"的词 ----
const noBreakdown = [];
for (const w of sample) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (!p.length) noBreakdown.push(w);
}
const headless = noBreakdown.filter((w) => {
  const hasRoot = knownRoots.some((r) => r.length >= 3 && w.startsWith(r));
  const hasPfx = [...knownPrefixes].some((p) => w.startsWith(p));
  return !hasRoot && !hasPfx;
});

console.log('');
console.log(`【去重后的真实解锁】无拆解且词首无已知词素的词: ${headless.length}`);
console.log('补入候选 n-gram（取能作为词首覆盖该词的）后：');
let covered = new Set();
for (const c of useful) {
  for (const w of headless) if (w.startsWith(c.g) && w.length >= c.g.length + 2) covered.add(w);
}
console.log(`  可作为词首覆盖的无词首词素词: ${covered.size} / ${headless.length}`);
console.log('');
console.log('⇒ 但"能覆盖词首"≠"能拆出"：还须满足覆盖率 ≥0.55（见 exp_ru_root_plan.mjs）。');
console.log(`   样本 791 中，${headless.length} 词的词首缺口若要全部补齐，至少需 ${useful.length} 个新词素。`);

db.close();
