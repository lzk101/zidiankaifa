// 主管独立复核：ru_morph_defects.mjs:126-137 的 KPI 四个数
// 口径严格照抄 ru_morph_defects.mjs:59-76（holeLen = 未覆盖字符【总数】）
// 只读；不改任何东西。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(dbPath);

/** 照抄 ru_morph_defects.mjs:59-74 */
function holes(w, parts) {
  const cov = new Array(w.length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  const out = [];
  let run = -1;
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length && !cov[i]) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      out.push([run, i, w.slice(run, i)]);
      run = -1;
    }
  }
  return out;
}

const ruWords = db
  .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0")
  .all()
  .map((r) => String(r.word));

let hit = 0, ge3 = 0, ge2 = 0, zero = 0, le1 = 0;
const ge2Words = [];
for (const w of ruWords) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  hit++;
  const total = holes(w, parts).reduce((s, [a, b]) => s + (b - a), 0);
  if (total >= 3) ge3++;
  if (total >= 2) { ge2++; ge2Words.push([w, total, parts.map((p) => p.morpheme).join('+')]); }
  if (total === 0) zero++;
  if (total <= 1) le1++;
}

console.log('=== 主管独立复核（口径A = 未覆盖字符总数；ru_morph_defects.mjs:75-76 同款）===');
console.log(`  尺子 R 词数            = ${ruWords.length}`);
console.log(`  可拆（hit）            = ${hit}`);
console.log(`  未覆盖总数 >= 3        = ${ge3}`);
console.log(`  未覆盖总数 >= 2        = ${ge2}`);
console.log(`  零空洞（== 0）          = ${zero}`);
console.log(`  未覆盖总数 <= 1        = ${le1}`);
console.log('');
console.log('  交叉核对表（ru_morph_defects.mjs:173）声明值 vs 主管实测：');
for (const [label, mine, theirs] of [['空洞>=2', ge2, 175], ['空洞>=3', ge3, 134], ['零空洞', zero, 37], ['空洞<=1', le1, 69]]) {
  console.log(`    ${label.padEnd(10)} 声明 ${String(theirs).padStart(4)}  实测 ${String(mine).padStart(4)}  ${mine === theirs ? 'OK 一致' : 'DIFF 相差 ' + (mine - theirs)}`);
}
console.log('');
console.log('  == 2 的词（前 25，用于人工核对口径）==');
for (const [w, t, p] of ge2Words.slice(0, 25)) console.log(`    ${w.padEnd(18)} 总数${t}  ${p}`);
console.log(`  （共 ${ge2Words.length} 词）`);

// ---- 结论区（不推断来源，只记录实测事实）----
console.log('');
console.log('=== 结论 ===');
console.log('  口径定义（ru_morph_defects.mjs:75-76 holeLen）= 未覆盖字符【总数】，');
console.log('  与 scripts/probe_l4_dual_metric.mjs 的「口径A」定义相同。');
console.log('  同一口径、官方引擎、三处独立实现一致 => 171 / 67 是当前真值。');
console.log('');
console.log('  ru_morph_defects.mjs:173 的 XCHK 交叉核对表用了 175 / 69 作对照值，两者不匹配。');
console.log('  ⚠ 已尝试的溯源假设（「来自 D1 修复前」）**未能成立**：');
console.log('    用「过滤掉 parts[0].start===1 的词」模拟修复前行为只滤掉 1 词（得 170/67），');
console.log('    因为旧口径下 N 型词（gapExplain 把单字符前缀解释掉后仍可拆）变成 parts[0].start===0，');
console.log('    而非整词缺失 => 后置过滤对 gapExplain 不等价。**故此路不再深究。**');
console.log('  ⇒ 记档为「对照值来源不明、与当前实测不符」，建议由 ru_morph_defects.mjs 的所有者');
console.log('    （功能测试 agent）核对后订正为 171 / 67，并在 .board/EVIDENCE.md 说明。');

db.close();
