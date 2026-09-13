/**
 * 只读探针（功能测试 agent，2026-09-16）：后缀剥离风险 + 「203 硬地板」独立复核
 *
 * 目的（对应主管派单补充情报）：
 *   1. 独立确认「547 个无拆解词中，完全无任何已知词素 = 203」这一硬地板数字。
 *      主管要求两个独立来源 —— 本脚本**不复用** exp_ru_recoverable2.mjs 的任何函数，
 *      从头实现同一定义，并额外给出**阈值敏感度**（该数字对 MIN_REST / rootMin 的依赖）。
 *   2. 后缀剥离误拆风险的量化：A2 冲 45% 的主力是「仅后缀 227 词」，
 *      即必须靠词尾剥离 —— 而 AGENTS.md §4.1 记录 hasRootBefore 曾使 61.6%→17.1%。
 *   3. 主管点名的 4 个假命中（арест/Краков/Лена/Эдем）在当前实现下的**实际输出**，
 *      以及这些词的**词素命中位置**（用于设计「位置约束」型断言）。
 *   4. 本次迭代的两个正例目标 вдыхать / безаварийный 的实际输出（预期为红）。
 *
 * 只读：不写任何文件、不改数据库、不调用任何写 API。
 * 用法：node scripts/probe_ru_suffix_risk.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const SAMPLE_SQL = `SELECT word FROM words_i18n
  WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`;

const sample = db.prepare(SAMPLE_SQL).all().map((r) => String(r.word));

// ---- 词素库（与 exp_ru_recoverable2 同源数据，但本脚本自行读、自行算） ----
const allMorph = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({ raw: String(r.morpheme), stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }));

const byKind = (k) => allMorph.filter((m) => m.kind === k);
console.log('='.repeat(78));
console.log('词素库 ru 规模：');
console.log(`  prefix ${byKind('prefix').length} / root ${byKind('root').length} / suffix ${byKind('suffix').length} / 合计 ${allMorph.length}`);

const bd = (w) => {
  try {
    return core.breakdownWord(db, w, 'ru').map((p) => p.morpheme);
  } catch (e) {
    return [`<THROW:${e.message}>`];
  }
};
const bdFull = (w) => {
  try {
    return core.breakdownWord(db, w, 'ru');
  } catch {
    return [];
  }
};

/* ============================================================================
 * §1 独立复核「203 硬地板」
 * 定义（与 exp_ru_recoverable2.mjs 一致，但本脚本独立实现）：
 *   在「无拆解」词中，同时满足以下三条者计为「完全无任何已知词素」：
 *     (a) 不存在合法前缀剥离 —— 前缀在**词首**，且剥离后剩余 >= MIN_REST
 *     (b) 不存在合法后缀剥离 —— 后缀在**词尾**，且剥离后剩余 >= MIN_REST
 *     (c) 不含任何长度 >= rootMin 的词根（词根位置不限）
 * ==========================================================================*/
function classify(words, MIN_REST, rootMin) {
  const P = byKind('prefix').filter((m) => m.stem.length >= 2);
  const S = byKind('suffix').filter((m) => m.stem.length >= 2);
  const R = byKind('root').filter((m) => m.stem.length >= rootMin);
  let legalP = 0;
  let legalS = 0;
  let both = 0;
  let rootOnly = 0;
  let nothing = 0;
  const nothingWords = [];
  for (const w of words) {
    const hasP = P.some((m) => w.startsWith(m.stem) && w.length - m.stem.length >= MIN_REST);
    const hasS = S.some((m) => w.endsWith(m.stem) && w.length - m.stem.length >= MIN_REST);
    if (hasP && hasS) both++;
    else if (hasP) legalP++;
    else if (hasS) legalS++;
    else if (R.some((m) => w.includes(m.stem))) rootOnly++;
    else {
      nothing++;
      nothingWords.push(w);
    }
  }
  return { legalP, legalS, both, rootOnly, nothing, nothingWords, legal: legalP + legalS + both };
}

const withBd = [];
const noBd = [];
for (const w of sample) (bd(w).length ? withBd : noBd).push(w);

console.log('');
console.log('='.repeat(78));
console.log(`§1 独立复核「203 硬地板」  （样本 ${sample.length} 词，与尺子 R 同口径）`);
console.log(`  已有拆解 ${withBd.length}  无拆解 ${noBd.length}`);
const base = classify(noBd, 3, 3);
console.log('');
console.log('  主管口径 (MIN_REST=3, rootMin=3)：');
const pct = (n) => (n / sample.length * 100).toFixed(1);
console.log(`    可剥离合法前缀或后缀 : ${base.legal}  (${pct(base.legal)}%)  [仅P ${base.legalP} / 仅S ${base.legalS} / 两者 ${base.both}]`);
console.log(`    仅含词根不构成合法剥离: ${base.rootOnly}  (${pct(base.rootOnly)}%)`);
console.log(`    完全无任何已知词素   : ${base.nothing}  (${pct(base.nothing)}%)   ← 复核目标 203`);
console.log(`    ⇒ 位置约束下可达上限  : ${withBd.length + base.legal} / ${sample.length} = ${pct(withBd.length + base.legal)}%`);

console.log('');
console.log('  阈值敏感度（"完全无任何已知词素" 的取值随参数变化）：');
console.log('    MIN_REST \\ rootMin |   2     3     4');
for (const mr of [2, 3, 4]) {
  const cells = [2, 3, 4].map((rk) => String(classify(noBd, mr, rk).nothing).padStart(4));
  console.log(`    ${String(mr).padStart(17)}  | ${cells.join('  ')}`);
}

/* ============================================================================
 * §2 后缀剥离误拆风险：词尾剥离的「碎片陷阱」与「仅后缀」空间
 * ==========================================================================*/
console.log('');
console.log('='.repeat(78));
console.log('§2 后缀剥离误拆风险量化');
{
  const S = byKind('suffix').filter((m) => m.stem.length >= 2);
  // 2a. 仅后缀空间：MODERATE —— 单剥一个后缀即可解释的词（当前未拆）
  const suffixSolo = [];
  const fragmentTrap = []; // 词尾确有已知后缀，但剥离后剩余 <=2 字符 → 必须被拒绝
  const suffixShort = []; // 词长 <=5 且词尾有已知后缀 → 短词后缀剥离高危区
  for (const w of noBd) {
    const hits = S.filter((m) => w.endsWith(m.stem));
    if (!hits.length) continue;
    const legal = hits.filter((m) => w.length - m.stem.length >= 3);
    if (legal.length) {
      suffixSolo.push({ w, s: legal.map((m) => m.stem) });
      if (w.length <= 5) suffixShort.push({ w, s: legal.map((m) => m.stem) });
    } else {
      fragmentTrap.push({ w, s: hits.map((m) => `${m.stem}→余${w.length - m.stem.length}`) });
    }
  }
  console.log(`  无拆解词中「词尾含已知后缀」总数         : ${suffixSolo.length + fragmentTrap.length}`);
  console.log(`    ├ 剥离后剩余 >=3（合法剥离空间）      : ${suffixSolo.length}`);
  console.log(`    └ 剥离后剩余 <=2（**碎片陷阱**，须拒绝）: ${fragmentTrap.length}`);
  console.log('');
  console.log(`  碎片陷阱样例（这些词**不该**因为"词尾像后缀"就被拆）：`);
  for (const f of fragmentTrap.slice(0, 24)) console.log(`    ${f.w.padEnd(12)} 词尾候选 ${f.s.join(' ')}`);
  console.log('');
  console.log(`  短词高危区（词长<=5 但剩余>=3 → 极易被误剥）共 ${suffixShort.length} 词，样例：`);
  for (const s of suffixShort.slice(0, 24)) console.log(`    ${s.w.padEnd(10)} -${s.s.join(' -')}`);
}

/* ============================================================================
 * §3 主管点名 4 个假命中 + 专名 + 本轮正例目标：实际输出与命中位置
 * ==========================================================================*/
console.log('');
console.log('='.repeat(78));
console.log('§3 目标词在当前实现下的实际输出（只读实测）');
const TARGETS = [
  ['арест', '外来词 逮捕 · 主管点名不该剥 -ре'],
  ['Краков', '专名 克拉科夫 · 主管点名不该剥 -ко'],
  ['Лена', '专名 勒拿河/人名 · 主管点名不该剥 -на'],
  ['Эдем', '专名 伊甸 · 主管点名不该剥 -де'],
  ['Мальта', '专名 马耳他'],
  ['Абакан', '专名 阿巴坎'],
  ['Австралия', '专名 澳大利亚'],
  ['велюровый', 'BOARD.md:145 反例 · в- 是词根首字母不是前缀'],
  ['вдыхать', 'BOARD.md:145 正例目标 · 应为 в-+дых-+-ать'],
  ['безаварийный', 'BOARD.md:145 正例目标 · 应为 без-+аварий-+-ный'],
  ['сегодня', '历史误拆回归'],
  ['ателье', 'D1 缺陷 · 误拆出 тел-(身体)'],
  ['плескание', 'D1 缺陷 · 误拆出 лес-(森林)'],
];
for (const [w, note] of TARGETS) {
  const parts = bdFull(w);
  const got = parts.map((p) => p.morpheme);
  const detail = parts.map((p) => `${p.morpheme}[${p.kind ?? '?'}]@${p.start}-${p.end}`).join(' ');
  console.log(`  ${w.padEnd(14)} ${JSON.stringify(got).padEnd(38)} ${detail}`);
  console.log(`  ${' '.repeat(14)} ↳ ${note}`);
}

/* ============================================================================
 * §4 位置约束体检：主管点名的假命中，其词素究竟落在哪个位置
 *    （用于把断言写成「不含**处于词首位置的** X-」而非笼统「不含 X」）
 * ==========================================================================*/
console.log('');
console.log('='.repeat(78));
console.log('§4 位置约束体检：候选词素在词中的**所有**出现位置与 kind');
const CHECK = ['арест', 'Краков', 'Лена', 'Эдем', 'Мальта', 'велюровый', 'вдыхать', 'безаварийный'];
for (const w of CHECK) {
  const lw = w.toLowerCase();
  const hits = [];
  for (const m of allMorph) {
    for (let i = 0; i + m.stem.length <= lw.length; i++) {
      if (lw.slice(i, i + m.stem.length) === m.stem) {
        const end = i + m.stem.length;
        const canonical =
          (m.kind === 'prefix' && i === 0) ||
          (m.kind === 'suffix' && end === lw.length) ||
          m.kind === 'root';
        const rest = m.kind === 'prefix' ? lw.length - end : i;
        hits.push(`${m.raw}[${m.kind}]@${i}-${end}${canonical ? ' ✓规范位' : ' ✗非规范位'}${m.kind !== 'root' && rest < 3 ? ` ✗剩余${rest}<3` : ''}`);
      }
    }
  }
  console.log(`  ${w.padEnd(13)} ${hits.length ? hits.join('\n' + ' '.repeat(15)) : '（无任何词素子串命中）'}`);
}

/* ============================================================================
 * §5 词素存在性：主管点名的 -ре/-ко/-на/-де 到底在不在库里的哪个 kind
 * ==========================================================================*/
console.log('');
console.log('='.repeat(78));
console.log('§5 关键词素在 morphemes 表中的登记情况（kind 决定位置约束）');
for (const s of ['ре', 'ко', 'на', 'де', 'ст', 'велюр', 'дых', 'аварий', 'авария', 'мал', 'лес', 'тел', 'лет', 'вер', 'тряс', 'пад']) {
  const found = allMorph.filter((m) => m.stem === s);
  console.log(`  ${s.padEnd(9)} ${found.length ? found.map((m) => `${m.raw}[${m.kind}]`).join(' ') : '— 库中无此词素 —'}`);
}

db.close();
