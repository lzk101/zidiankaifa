/**
 * ru_morph_goals.mjs —— A2 迭代目标断言（**从 ru_morph.mjs 拆出** · 功能测试 agent · 2026-09-16）
 *
 * 拆分依据：.board/BOARD.md ★裁决六 §四 采纳方案 (b)。
 *
 * 为什么拆出：
 *   `ru_morph.mjs` 已按 T10 接入 `packages/core/package.json` 的 test 链，
 *   而本文件的两条目标**在 v0.8.0 原理上不可能绿** —— 它们都靠**补词素**
 *   （`дых-` / `аварий-`），而补词素已被用户拍板移入 **v0.9.0**。
 *   若留在 test 链里，`pnpm --filter @zidiankaifa/core test` 会恒为 exit 2，
 *   永久卡住 AC-1（226 全绿），并与「防日常套件变红」的初衷正面相撞。
 *   ⇒ 拆出后：`ru_morph.mjs` 只留 52 条恒绿回归护栏（exit 0），本文件允许 exit 2。
 *
 * ⚠ 本文件**不接入** `pnpm test`，由主管在 v0.9.0 手动跑：
 *     node packages/core/test/ru_morph_goals.mjs
 *
 * 退出码：
 *   0 = 两条目标**均已达成**（A2/v0.9.0 完成）
 *   2 = 目标未达成（这是 v0.8.0 的**预期**状态，不是回归）
 *
 * 需要本地 data/db/dict.db（可用 ZIDIANKAIFA_DB 覆盖）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../dist/db/index.js';

// ⚠ AGENTS.md 铁律 6：路径与 cwd 无关（pnpm --filter 的 cwd 是包目录）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');

/* ★ 必须只读打开冻结词库：`openDatabase()` 会跑 `book` 迁移（migrateBookLang → migrateBookUserId →
 * migrateBookCompositeKey → 后置校验），而迁移**开始前先落一份 `VACUUM INTO` 整库快照** ⇒ 每跑一次本文件
 * 就写一次 `data/db/dict.db`（冻结库）并多出一个 ~493 MB 的 `dict.db.bak-<ISO>`（实测曾无界膨胀到 1.700 GiB）。
 * 本文件全程只读取数（`bookAdd`/`bookRemove`/`bookUpdate`/`db.exec`/`.run(` 实测各 **0** 次）⇒ `readOnly` 完全够用。 */
const db = new DatabaseSync(DB_PATH, { readOnly: true });
let pass = 0;
let fail = 0;

function eq(label, got, want) {
  const isOk = JSON.stringify(got) === JSON.stringify(want);
  if (isOk) {
    pass++;
    console.log(`  ○ ${label}`);
  } else {
    fail++;
    console.log(
      `  ✗ ${label}\n      实得 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}` +
        '\n      （v0.9.0 迭代目标，未达成；未破坏任何已有行为）',
    );
  }
}

const bd = (w, lang = 'ru') => breakdownWord(db, w, lang).map((p) => p.morpheme);

console.log('='.repeat(88));
console.log('ru_morph_goals.mjs —— A2 迭代目标断言（v0.9.0 首批验收项，v0.8.0 预期为红）');
console.log('='.repeat(88));

console.log('\n--- A2. 迭代目标正例 2 词（主管点名，v0.8.0 当前应为红 = A2 待完成）---');
{
  // 理由：вдыхать（吸入）= в-（进入）+ дых-（呼吸）+ -ать（不定式）。词素库**当前缺 `дых-`**。
  // 判别价值（见 .board/EVIDENCE.md §A2-预测）：此词的 в-@0 与 -ать@4 均已在**规范位**，
  // 覆盖率算术 4/7 = 0.571 已过 0.55；今天返回 [] 的唯一原因是 index.ts:773-781 的
  // **单字符前缀支撑规则**（в- 要求紧邻 ≥3 字符已知词素，而 `дых` 不在库中）。
  // ⇒ 若 A2 靠**放宽该支撑规则**来解锁 BOARD.md:120 记录的 119 词（15.0%），
  //    本词会变成 ["в-","-ать"]（3 字符空洞吞掉真词根 дых-）——**假拆解**。
  //    正确解法是补词根 `дых-`，而不是放宽规则。ru_morph.mjs 的 B6 有对应的反向护栏断言。
  eq('вдыхать = в- + дых- + -ать（需补词根 дых-）', bd('вдыхать'), ['в-', 'дых-', '-ать']);

  // 理由：безаварийный（无事故的）= без-（无）+ аварий-（事故）+ -ный。词素库**当前缺 `аварий-`**。
  // 判别价值：без-@0 与 -ный@9 均在规范位，不涉及单字符前缀规则；
  // ⇒ 这是一条**纯补词根**即可解锁的目标，与 вдыхать 分属两种不同的达成机制，
  //    并列可判别开发 agent 是否把「补词素」与「放宽规则」两条路混为一谈。
  eq('безаварийный = без- + аварий- + -ный（需补词根 аварий-）', bd('безаварийный'), ['без-', 'аварий-', '-ный']);

  // 附带判别：补 `аварий-` 后，同族词 аварийный 也必须成立（验证补的是词根而非单点特判）。
  // 注：本词今天是否已绿未知，故不作为红/绿口径，仅打印实测值供开发 agent 参考。
  console.log(`  · 参考（不计入口径）аварийный 实测 = ${JSON.stringify(bd('аварийный'))}`);
}

console.log('\n' + '='.repeat(88));
console.log(`迭代目标（A2/v0.9.0）：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('⇒ 退出码 2：目标未达成。**这是 v0.8.0 的预期状态，不是回归。**');
  console.log('   本文件不接入 pnpm test，由主管在 v0.9.0 手动跑。');
} else {
  console.log('⇒ 退出码 0：A2 目标已全部达成（v0.9.0 可据此处验收）。');
}
console.log('='.repeat(88));

process.exit(fail > 0 ? 2 : 0);
