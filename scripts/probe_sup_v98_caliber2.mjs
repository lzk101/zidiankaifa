// 主管裁定 267 vs 342：用 exp_ru_ceiling.mjs 的复刻引擎，直接切 gapMin
// 定义（.board/TASKS.md V9-8）：守卫退回 gapMin=2 后的 D1 形态数。
// 只读。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ceil = await import('./exp_ru_ceiling.mjs');

// exp_ru_ceiling.mjs 是脚本式模块；若它不导出，我们改用其内部函数名试探
const names = Object.keys(ceil);
console.log(`exp_ru_ceiling.mjs 导出：${names.length ? names.join(', ') : '(无导出 —— 它是纯脚本)'}`);
if (!names.length) {
  console.log('（跳过：需另写内联复刻）');
  process.exit(0);
}

const G = ceil.GATES_STRICT ?? { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1 };
const breakdownEx = ceil.breakdownEx;

const db = new DatabaseSync(path.resolve(__dirname, '..', 'data', 'db', 'dict.db'));
const ru = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
const prefixStems = new Set(
  db.prepare("SELECT morpheme FROM morphemes WHERE lang='ru' AND kind='prefix'").all()
    .map((r) => String(r.morpheme).replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')),
);

function measure(gates, label) {
  let breakable = 0, d1 = 0, g1 = 0;
  for (const w of ru) {
    const p = breakdownEx(w, 'ru', gates).parts;
    if (!p.length) continue;
    breakable++;
    const mw = w.replace(/\u0451/g, '\u0435');
    if (p.length >= 2 && p[0].start === 1) {
      g1++;
      const gap = mw.slice(0, p[0].start);
      if (!prefixStems.has(gap)) d1++;   // D1 形态 = gap=1 且 gap ∉ 前缀集
    }
  }
  console.log(`  ${label.padEnd(26)} 可拆=${String(breakable).padStart(6)}  gap=1残余=${String(g1).padStart(4)}  D1形态=${String(d1).padStart(4)}`);
  return { breakable, g1, d1 };
}

console.log('');
console.log('=== 实测（同一复刻引擎，只切 gapMin）===');
const prod = measure({ ...G, gapMin: 1 }, 'gapMin=1（生产现值）');
const pre = measure({ ...G, gapMin: 2 }, 'gapMin=2（修复前守卫）');

console.log('');
console.log('=== 裁定 ===');
console.log(`  生产 gapMin=1：D1 形态 = ${prod.d1}   ← 应为 0（v0.8.0 修复目标）`);
console.log(`  退回 gapMin=2：D1 形态 = ${pre.d1}   ← V9-8/AC-6 的「判据① 替代量」基线`);
console.log('');
if (pre.d1 === 342) {
  console.log('  ✅ **342 型正确**：V9-8 字面定义（守卫退回 gapMin=2 后的 D1 形态数）基线 = 342。');
  console.log(`     构成：gap=1 残余 ${pre.g1}（保留组 75 + 修复前被放行者）+ 修复前可拆但现行被拒者。`);
  console.log('  ⚠ 267 是「按生产 gapMin=1 测的被消除数」，不是 gapMin=2 下的形态数 —— 少算 gap=1 那部分。');
} else {
  console.log(`  ⚠ 实测 ${pre.d1}，与 342/267 均不符，需再查。`);
}
db.close();
