/**
 * 只读探针（功能测试 agent · T15）：**比特级差分**复核 D1 修法。
 *
 * 方法（无建模、无复刻）：
 *   preEngine  = scripts/_tmp/prefix_engine（packages/core/dist 的整树副本，仅把 index.js 那一行改回 `>= 2`）
 *   postEngine = packages/core/dist（生产，修法后 `>= 1`）
 *   两引擎同源同字节，唯一差异 = 那一行 ⇒ 逐词输出差异**就是**修法的全部影响面。
 *
 * 只读、幂等。用法：node scripts/probe_t15_bitdiff.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as pre from './_tmp/prefix_engine/db/index.js';
import * as post from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
const sig = (p) => p.map((x) => `${x.morpheme}@${x.start}-${x.end}`).join('|');
const bdPre = (w) => pre.breakdownWord(db, w, 'ru');
const bdPost = (w) => post.breakdownWord(db, w, 'ru');
const bdEnPre = (w) => pre.breakdownWord(db, w, 'en');
const bdEnPost = (w) => post.breakdownWord(db, w, 'en');

const words = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

console.log('='.repeat(94));
console.log('§1 差分总览：修法到底改变了多少词的输出？');
console.log('='.repeat(94));

const changed = [];
const preD1 = [];
const preReject = [];
for (const w of words) {
  let a;
  let b;
  try {
    a = bdPre(w);
  } catch {
    a = [];
  }
  try {
    b = bdPost(w);
  } catch {
    b = [];
  }
  const isD1 = a.length >= 2 && a[0].start === 1;
  const gap = norm(w).slice(0, 1);
  if (isD1) {
    preD1.push(w);
    if (!RU1.has(gap)) preReject.push({ w, gap, pre: sig(a) });
  }
  if (sig(a) !== sig(b)) changed.push({ w, pre: sig(a), post: sig(b), gap, isD1 });
}
console.log(`  词条总数                        : ${words.length}`);
console.log(`  输出发生变化的词                : ${changed.length}`);
console.log(`  修法前 D1 模式（start==1 且≥2片段）: ${preD1.length}    ← 我 probe#1 实测 342，开发 agent 注释亦记 342`);
console.log(`  其中首字符 ∉ {в,о,с,у} 的拒绝组   : ${preReject.length}    ← 我 probe#1 实测 267`);
console.log(`  ⇒ 差分集合与预言的拒绝组是否一致 : ${changed.length === preReject.length ? '一致 ✅' : '不一致 ❌'}`);

/* 不变量：所有变化都必须满足「修法前非空 → 修法后空」且 gap ∉ 前缀 */
let invariantBad = [];
for (const c of changed) {
  const okShape = c.pre !== '' && c.post === '' && !RU1.has(c.gap) && c.isD1;
  if (!okShape) invariantBad.push(c);
}
console.log(`  ⇒ 全部变化均满足「非空→空 ∧ gap∉前缀 ∧ D1形态」：${invariantBad.length === 0 ? '是 ✅' : `否 ❌ 异常 ${invariantBad.length} 条`}`);
for (const b of invariantBad.slice(0, 10)) console.log(`      异常: ${b.w}  pre=${b.pre}  post=${b.post}`);

/* 反向不变量：修法后不得出现「空→非空」或任何新增拆解 */
const gained = changed.filter((c) => c.post !== '' && c.pre === '');
console.log(`  ⇒ 修法是否**新增**了任何拆解（应为 0）：${gained.length}`);
/* 不变量：放行组（gap∈前缀）输出必须完全不变 */
const changedAllowed = changed.filter((c) => RU1.has(c.gap));
console.log(`  ⇒ 放行组（gap∈{в,о,с,у}）输出被改动的词数（应为 0）：${changedAllowed.length}`);
for (const c of changedAllowed.slice(0, 10)) console.log(`      ${c.w}: ${c.pre} → ${c.post}`);

/* ---------- §2 误伤清单（真误伤 = 被拒绝但首字符语言学上是真前缀） ---------- */
console.log('');
console.log('='.repeat(94));
console.log('§2 误伤清单（假阴性）：被修法拒绝、但首字符**确为真前缀**的词');
console.log('='.repeat(94));

const harmed = [];
const byChar = new Map();
for (const r of preReject) {
  byChar.set(r.gap, (byChar.get(r.gap) ?? 0) + 1);
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(r.w)[0];
  const t = e ? String(e.text_en) : '';
  const realPrefix = new RegExp(`(?:^|[\\s,(])${r.gap}-\\s*\\(|surface analysis,\\s*${r.gap}-`, 'i').test(t);
  if (realPrefix) harmed.push({ ...r, t: t.slice(0, 88) });
}
console.log(`  拒绝组 ${preReject.length} 词，首字符分布：${[...byChar.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}${n}`).join(' ')}`);
console.log('');
console.log(`  ★ 词源明示「首字符确为前缀」的真误伤：${harmed.length} 词`);
for (const h of harmed) {
  console.log(`    ${h.w.padEnd(16)} gap='${h.gap}'  修法前=${h.pre}`);
  console.log(`       词源: ${h.t}`);
}
if (!harmed.length) {
  console.log('    ⇒ 零真误伤：被拒绝的词，其首字符在词源上均非前缀（本分析覆盖全部 267 词，非抽样）。');
}

/* 希腊源否定前缀 а- 专项（唯一可能的库外单字符前缀） */
console.log('');
console.log('  ── 希腊源否定前缀 а- 专项（库内单字符前缀只有 в/о/с/у，不含 а-）');
const aWords = preReject.filter((r) => r.gap === 'а');
let aReal = 0;
for (const r of aWords) {
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(r.w)[0];
  const t = e ? String(e.text_en) : '';
  const rest = norm(r.w).slice(1);
  const restWord = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND word=?`).get(rest).n > 0;
  const greek = /Ancient Greek|Late Latin|Greek/i.test(t);
  if (greek && restWord) aReal++;
  console.log(
    `    ${r.w.padEnd(20)} 修法前=${r.pre.padEnd(38)} 剩余'${rest}'是独立词=${restWord ? '是' : '否'} 希腊源=${greek ? '是' : '否'}`,
  );
}
console.log(`    ⇒ 其中「希腊源 ∧ 剩余部分是独立词」的真正 а- 前缀词：${aReal} 词`);
console.log('       这些词的正解是 а- + X，但 а- 不在库内 ⇒ 即便不修法，库也给不出正解；');
console.log('       修法前给出的是「跳过 а、拿后文巧合命中」的**错解**（如 аполярный → пол-「半」）。');
console.log('       故属「错解被移除、正解仍缺」⇒ 是**词素库缺口**，不是修法误杀。');

/* ---------- §3 尺子 R 精确影响 ---------- */
console.log('');
console.log('='.repeat(94));
console.log('§3 尺子 R 精确影响（比特级差分）');
console.log('='.repeat(94));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
let rPre = 0;
let rPost = 0;
const rFlip = [];
const rHole = { pre3: 0, post3: 0, pre2: 0, post2: 0, post0: 0 };
const holes = (w, p) => {
  const cov = new Array(w.length).fill(false);
  for (const x of p) for (let i = x.start; i < x.end && i < w.length; i++) cov[i] = true;
  return cov.filter((x) => !x).length;
};
for (const w of R) {
  const a = bdPre(w);
  const b = bdPost(w);
  if (a.length) rPre++;
  if (b.length) rPost++;
  if (a.length && !b.length) rFlip.push(w);
  if (a.length) {
    const h = holes(w, a);
    if (h >= 3) rHole.pre3++;
    if (h >= 2) rHole.pre2++;
  }
  if (b.length) {
    const h = holes(w, b);
    if (h >= 3) rHole.post3++;
    if (h >= 2) rHole.post2++;
    if (h === 0) rHole.post0++;
  }
}
console.log(`  R 样本 ${R.length} 词`);
console.log(`  修法前 ${rPre}/${R.length} = ${((rPre / R.length) * 100).toFixed(1)}%   （冻结基线 244 / 30.8%）`);
console.log(`  修法后 ${rPost}/${R.length} = ${((rPost / R.length) * 100).toFixed(1)}%   （主管预计 238 / 30.1%）`);
console.log(`  翻转词（${rFlip.length}）：${rFlip.join(' ')}`);
console.log(`  L1 守卫 ≥25%：${(rPost / R.length) * 100 >= 25 ? '安全 ✅' : '危险 ❌'}（余量 ${(((rPost / R.length) * 100) - 25).toFixed(1)}pp）`);
console.log(`  L4 空洞≥3：${rHole.pre3} → ${rHole.post3}（冻结值 134）· 空洞≥2：${rHole.pre2} → ${rHole.post2} · 零空洞：${rHole.post0}`);

/* ---------- §4 英语侧暴露面（851 行无 isRu 守卫） ---------- */
console.log('');
console.log('='.repeat(94));
console.log('§4 英语侧暴露面（index.ts:851 无 isRu 守卫；en 词素库有单字符前缀 a-/e-）');
console.log('='.repeat(94));
console.log('  words_i18n 中 en 词条 = 0 ⇒ 无法用词库语料扫描，只能用代表性英语词探针。');
const EN = [
  'achievement', 'acknowledge', 'unbelievable', 'principle', 'difficult', 'business', 'stethoscope',
  'orange', 'run', 'asleep', 'alive', 'arrest', 'amazing', 'atom', 'apple', 'animal', 'emit', 'event',
  'enough', 'around', 'aboard', 'away', 'apart', 'await', 'awake', 'aware',
];
const enChanged = [];
for (const w of EN) {
  const a = bdEnPre(w);
  const b = bdEnPost(w);
  const sa = sig(a);
  const sb = sig(b);
  const mark = sa === sb ? '不变' : '★变化';
  if (sa !== sb) enChanged.push({ w, a: sa, b: sb });
  console.log(`  ${w.padEnd(14)} 修法前 ${(sa || '[]').padEnd(40)} 修法后 ${(sb || '[]').padEnd(40)} ${mark}`);
}
console.log('');
console.log(`  ⇒ 代表性英语词中输出发生变化的：${enChanged.length} 个`);
if (enChanged.length) {
  for (const c of enChanged) console.log(`     ${c.w}: ${c.a || '[]'} → ${c.b || '[]'}`);
}
console.log('  风险判定：en 词素库含 a-/e- 单字符前缀 ⇒ 首字符为 a/e 的英语词仍会被放行；');
console.log('  首字符为其他字母的英语 D1 词则被拒。英语侧无词库语料，影响面无法全量量化（见回报「未覆盖项」）。');

db.close();
