/**
 * 俄语拆解覆盖率「双尺子」基线探针（只读，不改库、不改代码）
 *
 * 项目里存在**三把互不相同的尺子**，分母各不相同，百分数不可互相比较：
 *
 *   尺子 R（权威）：packages/core/test/related.mjs:144 的下限断言口径
 *        SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0
 *        —— 带长度与行号取模三重过滤的抽样，即「俄语拆解覆盖率 30.8% ≥ 25%」那条断言的真实尺子。
 *        这是**迭代验收应采用的尺子**，因为它是唯一被自动化断言固化、可防回归的尺子。
 *   尺子 A（参考）：全体俄语主词条 words_i18n(lang='ru')，分母 101,512。
 *   尺子 B（参考）：仅「有词源」的俄语词条 + 固定种子 LCG 抽样
 *        —— packages/data-pipeline/measure_ru_breakdown.mjs 的口径（seed 20260913, N=800）。
 *        注意该脚本当前**已损坏**：其 import 为 './packages/core/dist/db/index.js'（按 repo 根目录书写），
 *        但它位于 packages/data-pipeline/ 下，实际应为 '../../packages/core/dist/db/index.js'。
 *
 * 本脚本把三把尺子同时打出来，作为 A2 迭代的冻结基线。
 *
 * 用法：node scripts/probe_ru_coverage.mjs [sampleN]
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const N = Number(process.argv[2] ?? 800);
const DB_PATH = 'data/db/dict.db';
const db = new DatabaseSync(DB_PATH);

// ---------- 尺子 R（权威）：related.mjs:144 的三重过滤抽样 ----------
const ruSampleR = db
  .prepare(
    `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
  )
  .all()
  .map((r) => String(r.word));

let rHit = 0;
const rEmpty = [];
for (const w of ruSampleR) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (parts.length) rHit++;
  else rEmpty.push(w);
}
const rRate = (rHit / ruSampleR.length) * 100;

// ---------- 尺子 A：全体俄语主词条 ----------
const allRu = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

let aHit = 0;
const aEmpty = [];
for (const w of allRu) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (parts.length) aHit++;
  else aEmpty.push(w);
}
const aRate = (aHit / allRu.length) * 100;

// ---------- 尺子 B：有词源的俄语词条 + 固定种子抽样 ----------
const withEtym = db
  .prepare(
    `SELECT w.word AS word FROM words_i18n w
     WHERE w.lang='ru' AND EXISTS (SELECT 1 FROM word_etymology e WHERE e.word=w.word AND e.lang='ru')`,
  )
  .all()
  .map((r) => String(r.word));

let seed = 20260913;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pool = withEtym.slice();
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const sample = pool.slice(0, N);

let bHit = 0;
const bEmpty = [];
const kindCount = { root: 0, prefix: 0, suffix: 0 };
for (const w of sample) {
  let parts = [];
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  if (parts.length) {
    bHit++;
    for (const p of parts) kindCount[p.kind] = (kindCount[p.kind] ?? 0) + 1;
  } else {
    bEmpty.push(w);
  }
}
const bRate = (bHit / sample.length) * 100;

// ---------- 词素库现状 ----------
const morphemes = db
  .prepare(`SELECT kind, COUNT(1) AS n FROM morphemes WHERE lang='ru' GROUP BY kind ORDER BY n DESC`)
  .all();
const morphemeTotal = db.prepare(`SELECT COUNT(1) AS n FROM morphemes WHERE lang='ru'`).get();
const enTotal = db.prepare(`SELECT COUNT(1) AS n FROM morphemes WHERE lang='en'`).get();

// ---------- 输出 ----------
const pct = (x) => `${x.toFixed(1)}%`;
console.log('='.repeat(64));
console.log('俄语拆解覆盖率 · 冻结基线（只读探针）');
console.log('='.repeat(64));
console.log(`词库: ${DB_PATH}`);
console.log('');
console.log('【尺子 R】★权威★ related.mjs:144 三重过滤抽样（length 4-12 且 rowid%97=0）');
console.log(`  抽样规模                   : ${ruSampleR.length}`);
console.log(`  有拆解                     : ${rHit}`);
console.log(`  >>> 覆盖率 R               : ${pct(rRate)}   （related.mjs 下限断言当前为 ≥25%）`);
console.log('');
console.log('【尺子 A】全体俄语主词条（参考口径）');
console.log(`  分母 words_i18n(lang='ru') : ${allRu.length.toLocaleString()}`);
console.log(`  有拆解                     : ${aHit.toLocaleString()}`);
console.log(`  >>> 覆盖率 A               : ${pct(aRate)}`);
console.log('');
console.log('【尺子 B】有词源俄语词条 + 固定种子抽样（= measure_ru_breakdown.mjs 口径）');
console.log(`  有词源词条总数             : ${withEtym.length.toLocaleString()}`);
console.log(`  抽样 N                     : ${sample.length}`);
console.log(`  有拆解                     : ${bHit}`);
console.log(`  >>> 覆盖率 B               : ${pct(bRate)}`);
console.log(`  词素类型分布               : ${JSON.stringify(kindCount)}`);
console.log('');
console.log('【词素库现状】');
for (const m of morphemes) console.log(`  ru ${String(m.kind).padEnd(8)}: ${m.n}`);
console.log(`  ru 合计                    : ${morphemeTotal.n}`);
console.log(`  en 合计                    : ${enTotal.n}`);
console.log(`  全库合计                   : ${morphemeTotal.n + enTotal.n}`);
console.log('');
console.log(`【尺子 R 无拆解样例（前 60 / 共 ${rEmpty.length}）】`);
console.log(rEmpty.slice(0, 60).join(' '));
console.log('');
console.log(`【尺子 B 无拆解样例（前 60 / 共 ${bEmpty.length}）】`);
console.log(bEmpty.slice(0, 60).join(' '));
console.log('');
console.log(`【尺子 A 无拆解样例（前 60 / 共 ${aEmpty.length}）】`);
console.log(aEmpty.slice(0, 60).join(' '));
console.log('');
console.log('提示：若要把「覆盖率」提升到某个目标值，必须先声明用的是 A 还是 B。');
db.close();
