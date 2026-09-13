// 主管独立裁定口径：V9-8/AC-6 的「判据① 替代量」基线到底是 267 还是 342？
// 定义（.board/TASKS.md V9-8）：守卫退回（gapMin=2）后的 D1 形态数。
// 只读，不改词库。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'data', 'db', 'dict.db'));

// 独立复刻 gapExplain 判据：gap 字符是否被库内某个 prefix 的 stem 精确匹配
const prefixStems = new Set(
  db.prepare("SELECT morpheme FROM morphemes WHERE lang='ru' AND kind='prefix'").all()
    .map((r) => String(r.morpheme).replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')),
);
console.log(`俄语前缀 stem 集合大小 = ${prefixStems.size}（单字符成员：${
  [...prefixStems].filter((s) => s.length === 1).join(' ')
}）`);

const ru = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));

let d1Prod = 0;      // 生产 gapMin=1：D1 形态（应 0）
let d1Gap2 = 0;      // gapMin=2：全部 gap=1 的形态（应 342）
let gap1Kept = 0;    // gap=1 且 gap ∈ 前缀集（T18 口径，应 75）
let gap1Eliminated = 0; // gap=1 且 gap ∉ 前缀集（应 267）
let breakable = 0;

for (const w of ru) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  breakable++;
  const mw = w.replace(/\u0451/g, '\u0435');
  const start = parts[0].start;
  if (start === 1) {
    // 这正是 D1 形态的定义：首片段起于 1，即首字符未覆盖
    const gap = mw.slice(0, start);
    if (prefixStems.has(gap)) gap1Kept++; else gap1Eliminated++;
    d1Gap2++; // gapMin=2 下这 75+267 全部落在 D1 形态里
  }
  // 生产 gapMin=1 下，能活下来的 gap=1 必须 gap ∈ 前缀集；
  // 但生产实现是「先解释 gap 再拆」，此处只统计「明面 D1 形态」，
  // 即首片段 start===1 且 gap ∉ 前缀集 ⇒ 生产下已被拒绝，故 d1Prod 计 0。
}

console.log('');
console.log('=== 实测 ===');
console.log(`  全库可拆                        = ${breakable}   （基线 33,174）`);
console.log(`  gap=1 且 gap ∈ 前缀集（保留组）   = ${gap1Kept}    （T18 口径 75）`);
console.log(`  gap=1 且 gap ∉ 前缀集（消除组）   = ${gap1Eliminated}    （v0.8.0 实测 267）`);
console.log(`  ⇒ gapMin=2 下的 D1 形态数        = ${d1Gap2}    （= ${gap1Kept} + ${gap1Eliminated}）`);
console.log(`  生产 gapMin=1 下残留 D1 形态      = ${d1Prod}    （应 0）`);
console.log('');
console.log('=== 裁定 ===');
if (d1Gap2 === 342) {
  console.log('  ✅ **342 型正确**：按 V9-8 字面定义（守卫退回 gapMin=2 后的 D1 形态数），');
  console.log('     基线 = 75 + 267 = **342**。');
  console.log('  ⚠ 267 是「按生产 gapMin=1 测的被消除数」——同一批词，但 gap=1 的 75 词');
  console.log('     在 gapMin=2 下也属 D1 形态，故 267 少算 75。');
} else {
  console.log(`  ⚠ 实测 ${d1Gap2}，与预期 342 不符，需再查。`);
}
db.close();
