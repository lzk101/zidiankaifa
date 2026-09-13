/**
 * 只读探针（功能测试 agent，2026-09-16）：尺子 R 的 791 词样本「卫生度」体检
 *
 * 起因：我在 probe_ru_gate2_reconcile.mjs 的样例里撞见 `вместе с тем`（含空格的多词短语）、
 *   `воен.`（含句点的缩写）、`Удмуртия`（首字母大写专名）出现在**同一个「俄语词」样本**里。
 *   若样本混入非词条目，则：
 *     · 分母 791 被灌水 → 拆解率被系统性低估
 *     · 它们永远不可能被拆解 → 被错误计入「硬地板 203」
 *     · 45% 目标的**分母与分子口径都不干净**
 *   这个必须先量清楚，再谈 45% 断言。
 *
 * 判据（保守，只标记无可争议的非词）：
 *   S1 含空格           —— 多词短语，不是词
 *   S2 含句点           —— 缩写（воен. / др.），不是标准词形
 *   S3 含连字符         —— 可能是复合词（可拆）或条目污染，单列观察不直接判定
 *   S4 首字母大写       —— 专名代理（主管 exp_ru_structure 记为 9 词）
 *   S5 含拉丁字母/数字  —— 混入非西里尔条目
 *
 * 只读。用法：node scripts/probe_ru_sample_hygiene.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const sample = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const bd = (w) => {
  try {
    return core.breakdownWord(db, w, 'ru').map((p) => p.morpheme);
  } catch {
    return [];
  }
};

const isSpace = (w) => /\s/.test(w);
const isDot = (w) => /[.·]/.test(w);
const isHyphen = (w) => /[-–—]/.test(w);
const isCap = (w) => /^[А-ЯЁ]/.test(w);
const isLatinOrDigit = (w) => /[A-Za-z0-9]/.test(w);

const flags = { S1: [], S2: [], S3: [], S4: [], S5: [] };
let withBd = 0;
for (const w of sample) {
  if (bd(w).length) withBd++;
  if (isSpace(w)) flags.S1.push(w);
  if (isDot(w)) flags.S2.push(w);
  if (isHyphen(w)) flags.S3.push(w);
  if (isCap(w)) flags.S4.push(w);
  if (isLatinOrDigit(w)) flags.S5.push(w);
}

/** 无争议的「非词」= 含空格 或 含句点 */
const isNonWord = (w) => isSpace(w) || isDot(w);
/** S6 含拉丁字母/数字（如 мешать1 —— 去重残留的编号后缀，明显不是词） */
const isArtifact = (w) => isLatinOrDigit(w);
/** S7 以连字符结尾（如 гор- / псевдо- —— 词根/前缀碎片混入词表） */
const isFragment = (w) => /-$/.test(w);
/** 严格非词 = S1∪S2∪S6∪S7 */
const isNonWordStrict = (w) => isNonWord(w) || isArtifact(w) || isFragment(w);
const nonWords = sample.filter(isNonWord);
const nonWordsStrict = sample.filter(isNonWordStrict);
const clean = sample.filter((w) => !isNonWord(w));
const cleanStrict = sample.filter((w) => !isNonWordStrict(w));

const rate = (words) => {
  const hit = words.filter((w) => bd(w).length).length;
  return `${hit}/${words.length} = ${((hit / words.length) * 100).toFixed(1)}%`;
};

console.log('='.repeat(80));
console.log('尺子 R 样本卫生度体检（原始样本 791 词）');
console.log('='.repeat(80));
console.log(`  S1 含空格（多词短语）      : ${flags.S1.length}   ${flags.S1.slice(0, 10).join(' | ')}`);
console.log(`  S2 含句点（缩写）          : ${flags.S2.length}   ${flags.S2.slice(0, 10).join(' | ')}`);
console.log(`  S3 含连字符                : ${flags.S3.length}   ${flags.S3.slice(0, 10).join(' | ')}`);
console.log(`  S4 首字母大写（专名代理）  : ${flags.S4.length}   ${flags.S4.slice(0, 10).join(' | ')}`);
console.log(`  S5 含拉丁字母/数字         : ${flags.S5.length}   ${flags.S5.slice(0, 10).join(' | ')}`);
console.log('');
console.log(`  ⇒ 无争议非词（S1∪S2）      : ${nonWords.length} 词`);
console.log('');
console.log('拆解率口径对比：');
console.log(`  原口径（791 全样本，含非词）      : ${rate(sample)}   ← 即 BASELINE 的 30.8%`);
console.log(`  清洗后（剔除 S1∪S2 非词，${clean.length} 词）: ${rate(clean)}`);
console.log(`  严格清洗（再剔 S6 编号残留 + S7 词缀碎片，${cleanStrict.length} 词）: ${rate(cleanStrict)}`);

console.log('');
console.log(`  S6 含数字/拉丁（去重编号残留）共 ${flags.S5.length} 词：`);
console.log(`    ${flags.S5.join(' | ')}`);
console.log(`  S7 以连字符结尾（词缀碎片混入）共 ${sample.filter(isFragment).length} 词：`);
console.log(`    ${sample.filter(isFragment).join(' | ')}`);

if (nonWords.length) {
  console.log('');
  console.log('  被误计入分母的非词全清单（S1∪S2）：');
  for (const w of nonWords) console.log(`    "${w}"  len=${w.length}  实测 ${JSON.stringify(bd(w))}`);
}
if (nonWordsStrict.length > nonWords.length) {
  console.log('');
  console.log('  严格口径下**额外**发现的非词（S6∪S7），共 ' + (nonWordsStrict.length - nonWords.length) + ' 词：');
  for (const w of nonWordsStrict.filter((w) => !isNonWord(w))) {
    console.log(`    "${w}"  实测 ${JSON.stringify(bd(w))}`);
  }
}

console.log('');
console.log('='.repeat(80));
console.log('对「203 硬地板」的影响');
console.log('='.repeat(80));
{
  const morph = db
    .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
    .all()
    .map((r) => ({ stem: String(r.morpheme).replace(/-/g, ''), kind: String(r.kind) }));
  const P = morph.filter((m) => m.kind === 'prefix' && m.stem.length >= 2);
  const S = morph.filter((m) => m.kind === 'suffix' && m.stem.length >= 2);
  const R = morph.filter((m) => m.kind === 'root' && m.stem.length >= 3);
  const nothingOf = (words) => {
    const unsolved = words.filter((w) => !bd(w).length);
    return unsolved.filter((w) => {
      const hasP = P.some((m) => w.startsWith(m.stem) && w.length - m.stem.length >= 3);
      const hasS = S.some((m) => w.endsWith(m.stem) && w.length - m.stem.length >= 3);
      const hasR = R.some((m) => w.includes(m.stem));
      return !hasP && !hasS && !hasR;
    });
  };
  const nAll = nothingOf(sample);
  const nNonWord = nAll.filter(isNonWord);
  const nNonWordStrict = nAll.filter(isNonWordStrict);
  const nClean = nAll.filter((w) => !isNonWord(w));
  const nCleanStrict = nAll.filter((w) => !isNonWordStrict(w));
  console.log(`  「完全无任何已知词素」总数        : ${nAll.length}   ← 复核目标 203`);
  console.log(`    其中无争议非词（S1∪S2）        : ${nNonWord.length}  ${nNonWord.slice(0, 8).join(' | ')}`);
  console.log(`    其中严格非词（S1∪S2∪S6∪S7）   : ${nNonWordStrict.length}  ${nNonWordStrict.slice(0, 8).join(' | ')}`);
  console.log(`    其中是真正的俄语词             : ${nClean.length}（宽松）/ ${nCleanStrict.length}（严格）`);
  console.log('');
  console.log(`  ⇒ 所谓「硬地板 203」里有 ${nNonWordStrict.length} 词根本不是词，`);
  console.log(`     真正语言学意义上的硬地板是 ${nCleanStrict.length} 词（占严格清洗后样本 ${((nCleanStrict.length / cleanStrict.length) * 100).toFixed(1)}%）。`);
  console.log('');
  console.log(`  ⚠ 但请注意：清洗只改变**分母**，不改变分子的绝对词数。`);
  console.log(`     因此「45% 目标」在严格清洗口径下等同于 ${Math.ceil(0.45 * cleanStrict.length)} 词命中（原口径 ${Math.ceil(0.45 * sample.length)} 词），`);
  console.log(`     即门槛反而**略微上升** —— 别指望靠剔除污染条目来达标。`);
}

db.close();
