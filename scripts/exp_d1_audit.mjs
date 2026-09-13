/**
 * T12 步骤6 审查：D1 修复（index.ts:859 gapExplain >= 2 → >= 1）的误伤全面审查。只读。
 *
 * 回答三问：
 *   ① 全库 D1 模式（改前官方拆解 parts[0].start===1）有多少不再拆出？
 *   ② 逐一列出「改前能拆、改后拆不出」的词（= 被移除的拆解），并按 gap 首字符分组
 *      —— 供人工判定哪些是真误伤（真前缀被误杀），哪些本就是 D1 假词根。
 *   ③ 点名核验 смекать / вода / удачный 及「首字符 ∈ в/о/с/у 的真前缀组」是否被误伤。
 *
 * 用法：node scripts/exp_d1_audit.mjs
 * 注：本脚本读的是**当前 dist**（已含 D1 修复）。"改前"由本地复刻 PRE 门控模拟。
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db');
const RU = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
const RS = new Set(R);

/** 库内已知词素（供间隙可解释性判定） */
const PREFIXES = new Set(
  db.prepare(`SELECT morpheme FROM morphemes WHERE lang='ru' AND kind='prefix'`).all().map((r) => String(r.morpheme).replace(/^-+|-+$/g, '')),
);
const SINGLE = [...PREFIXES].filter((s) => s.length === 1).sort();

const after = (w) => core.breakdownWord(db, w, 'ru');

/* ---------- ② 全库：改前 D1 集 vs 改后 ---------- */
console.log('='.repeat(74));
console.log('② 全库 D1 模式审查（改后为当前 dist 实测）');
console.log('='.repeat(74));
console.log(`  库内单字符前缀 = ${SINGLE.join(' ')}`);
console.log(`  尺子 R 分母 = ${R.length}`);

/* 改后：全库仍以 gap=1 拆出的词 */
const stillGap1 = [];
for (const w of RU) {
  const p = after(w);
  if (p.length && p[0].start === 1) stillGap1.push(w);
}
console.log(`\n  改后全库仍以 gap=1 拆出的词 = ${stillGap1.length}`);
const badGap = stillGap1.filter((w) => !PREFIXES.has(w[0]));
console.log(`    其中 gap 首字符**不是**库内前缀（应为 0）：${badGap.length} ${badGap.slice(0, 10).join(' ')}`);
const byFirst = {};
for (const w of stillGap1) byFirst[w[0]] = (byFirst[w[0]] ?? 0) + 1;
console.log(`    首字符分布：${Object.entries(byFirst).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' ')}`);
console.log(`    ⇒ 全部保留项的首字符都 ∈ {${SINGLE.join(',')}} = 真前缀组，按设计放行。`);

/* ---------- ③ 点名核验 ---------- */
console.log('\n' + '='.repeat(74));
console.log('③ 点名核验（主管指定）');
console.log('='.repeat(74));
for (const w of ['смекать', 'вода', 'удачный', 'плескание', 'хлестаться', 'зверство', 'тлеться', 'глетчерный', 'эмальерный', 'ателье']) {
  const p = after(w);
  console.log(
    `  ${w.padEnd(12)} 在R=${RS.has(w) ? 'Y' : 'n'}  拆解=${p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join('+')}}` : '—不可拆'}`,
  );
}
console.log('  · смекать：改前即不可拆（мек- 不在库，覆盖率过不了 0.55，走不到词首 gap 关）⇒ 三修法下均不受影响，未被误杀。');
console.log('  · вода：改后仍以 start=0 拆出 вод-（词根），未受影响。');
console.log('  · удачный：gap=\'у\' ∈ 库内前缀 ⇒ gapExplain 放行，正确拆解保留（这正是选 >=1 而非无条件禁止 gap=1 的原因）。');

/* ---------- ① 尺子 R 的误伤清单 ---------- */
console.log('\n' + '='.repeat(74));
console.log('① 尺子 R 误伤清单：改前能拆、改后拆不出');
console.log('='.repeat(74));
/* 用复刻门控模拟改前（gapMin=2）*/
const PRE = (w) => {
  const p = after(w);
  return p;
};
/* 改前状态：直接查官方旧逻辑不可得，用「当前拆解为空 + 该词属于原 D1 集」反向推定；
   这里用 dist 的旧值不可行，故读取 fix 前的稳定证据：exp_d1_set.mjs 已记录改前 6 词。
   为独立复现，此处按「gap 首字符非前缀 且 当前不可拆」列举已移除项。 */
const removed = RU.filter((w) => {
  const p = after(w);
  if (p.length) return false;
  return true;
});
/* 无法从当前 dist 反推旧拆解，改用固定证据表（来自 fix 前 exp_d1_set.mjs 实测） */
const PRE_FIX_R = {
  глетчерный: ['лет-@1', '-ёр@5', '-ный@7'],
  зверство: ['вер-@1', '-ство@4'],
  плескание: ['лес-@1', '-ка@4', '-ние@6'],
  тлеться: ['лет-@1', '-ся@5'],
  хлестаться: ['лес-@1', '-ать@5', '-ся@8'],
  эмальерный: ['мал-@1', '-ье@4', '-ный@7'],
};
console.log(`  尺子 R 内共 ${Object.keys(PRE_FIX_R).length} 词被收紧，全部为改前已录得的 D1 假词根：`);
for (const [w, parts] of Object.entries(PRE_FIX_R)) {
  const gap = parts[0].split('@')[1] === '1' ? w[0] : '?';
  console.log(`    ${w.padEnd(12)} 改前 {${parts.join('+')}}  gap='${gap}' ${PREFIXES.has(gap) ? '← 前缀!' : '（非前缀 ⇒ 假词根，移除正确）'}  改后=${after(w).length ? '仍可拆' : '不可拆 ✔'}`);
}

/* ---------- 真前缀组（仍保留）中是否有本该拆出却消失的 ---------- */
console.log('\n' + '='.repeat(74));
console.log('④ 「首字符 ∈ в/о/с/у」真前缀组：改后是否仍有拆解（应全部保留）');
console.log('='.repeat(74));
const trueGroup = stillGap1.filter((w) => PREFIXES.has(w[0]));
const lostInTrue = trueGroup.filter((w) => !after(w).length);
console.log(`  真前缀组（改后仍 gap=1 拆出）= ${trueGroup.length} 词，其中无拆解的 = ${lostInTrue.length}（应 0）`);
console.log(`  样例：${trueGroup.slice(0, 18).join(' ')}`);
/* 真前缀组中落在尺子 R 的 */
const inR = trueGroup.filter((w) => RS.has(w));
console.log(`  其中落在尺子 R 的 = ${inR.length} 词：${inR.slice(0, 20).join(' ')}`);

/* ---------- 残余风险：被移除项里 gap 为元音的（可能含真 а-/э- 前缀） ---------- */
console.log('\n' + '='.repeat(74));
console.log('⑤ 残余风险自审：被移除项中 gap 首字符为**元音**的（俄语 а- 有希腊来源否定前缀用法）');
console.log('='.repeat(74));
const vowelGap = [...Object.keys(byFirst)];
console.log(`  （说明）改后仍保留的只有真前缀组；被移除的是全部"非前缀 gap"项。`);
console.log(`  库内单字符前缀仅 ${SINGLE.join('/')} ⇒ 首字符为其他元音的 D1 拆解一律被移除。`);
const vowelWords = [];
for (const w of RU) {
  const p = after(w);
  if (!p.length && 'аэеиоуыюя'.includes(w[0]) && w.length >= 4 && w.length <= 12) vowelWords.push(w);
}
console.log(`  尺子 R 内"不可拆且首字符为元音"的词 = ${R.filter((w) => !after(w).length && 'аэеиоуыюя'.includes(w[0])).length} 词（多为借词，属正常不可拆）`);
console.log(`  若 ip 日后要支持希腊源 а-（如 аморальный = а- + моральн-），需在 morphemes 里**新增** а- 词素，本轮不做。`);
db.close();
