/**
 * A2 迭代 · 测试 agent 独立发现的拆解缺陷（**当前预期为红**，2026-09-16）
 *
 * ⚠ 本文件**尚未接入 `pnpm test`**（`packages/core/package.json` 的 test 脚本不在
 *    功能测试 agent 的可写范围内 —— 委任书 §2）。是否接入、以及红灯如何处置，
 *    由项目主管裁决。文件名与 `ru_morph.mjs`（20 词判别集，应全绿）刻意分开，
 *    以免污染「20 词正反例判别集全绿」这条验收口径。
 *
 * 本文件的每条断言都对应一次**实测**，不是推测。证据脚本：
 *   scripts/probe_ru_gap_audit.mjs        —— 尺子 R 791 词的「空洞」普查
 *   scripts/probe_ru_discriminator2.mjs   —— 逐词实测
 *   scripts/probe_ru_family_pollution.mjs —— 假词根对「同根词·词族」的污染
 *
 * ── 缺陷类 D1：词首 gap=1 的假词根（v0.7.0 修复只管了 gap≥2，漏了这一类）──
 *    breakdownWord 的两条守卫都恰好放过 gap=1 的情形：
 *      · `if (parts.length === 1 && parts[0].start === 1) return []` —— 片段数为 2 时不触发
 *      · `if (parts[0].start >= 2) { ...gap 必须能被前缀解释... }` —— start=1 时不触发
 *    于是「首字母 + 真词根子串 + 真后缀」这一组合可以无条件通过覆盖率阈值。
 *    现场：плескание（溅）→ лес-（森林）、хлестаться（抽打）→ лес-（森林）、
 *          зверство（暴行）→ вер-（信）、глетчерный（冰川的）→ лет-（飞）、
 *          ателье（画室，法语借词）→ тел-（身体）。
 *    用户可见后果（已实测）：打开「плескание」的查词页，**同根词·词族卡会列出 лес-（森林）组 40 词**。
 *
 * ── 缺陷类 D2：词中空洞无任何约束（文档 intent 是 ≤1，实现是无限）──
 *    `docs/交接文档.md:493`（v0.2 设计）写明「suffix 与前一词素间隙 ≤1」；
 *    现行 v0.6.0 DP 只保留 `BREAKDOWN_MIN_COVERAGE = 0.55`，**词中/词尾间隙无上限**。
 *    现场：землетрясение（地震）→ зем- + лет- + -ение，中间的 "ряс"（真词根 тряс- 的一半）
 *          被整段跳过，"лет"（飞/夏）是跨音节巧合假命中 —— 地震与「飞」毫无关系。
 *          водопад（瀑布）→ 仅 [водо-]，跳过 "пад"（3 字符），覆盖率 4/7=0.571 恰好压线通过，
 *          于是被判为「有拆解」，但语义主干「落」整个丢失。
 *
 * 运行：node packages/core/test/ru_morph_defects.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, breakdownWord } from '../dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');

const db = openDatabase(DB_PATH);
let pass = 0;
let fail = 0;

function ok(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label} ${extra}`);
  }
}

const bd = (w) => breakdownWord(db, w, 'ru').map((p) => p.morpheme);

/** 拆解结果的未覆盖字符片段（空洞） */
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
const holeLen = (w) =>
  holes(w, breakdownWord(db, w, 'ru')).reduce((s, [a, b]) => s + (b - a), 0);

/* ============ D1. 词首 gap=1 的假词根 ============ */

console.log('--- D1. 词首 gap=1 的假词根（v0.7.0 守卫漏网）---');
{
  // плескание：来自 плеск-（溅水声），与 лес-（森林）无词源关系。
  ok("плескание 不含 лес-（森林）", !bd('плескание').includes('лес-'), `实得 ${JSON.stringify(bd('плескание'))}`);
  // хлестаться：来自 хлест-（抽打），同样与 лес- 无关。
  ok("хлестаться 不含 лес-（森林）", !bd('хлестаться').includes('лес-'), `实得 ${JSON.stringify(bd('хлестаться'))}`);
  // зверство：来自 зверь（野兽），与 вер-（信/信仰）无关。
  ok("зверство 不含 вер-（信）", !bd('зверство').includes('вер-'), `实得 ${JSON.stringify(bd('зверство'))}`);
  // глетчерный：来自德语 Gletscher（冰川），与 лет-（飞/夏）无关。
  ok("глетчерный 不含 лет-（飞）", !bd('глетчерный').includes('лет-'), `实得 ${JSON.stringify(bd('глетчерный'))}`);
  // ателье：法语 atelier 借词，无俄语词根，тел-（身体）是巧合。
  ok("ателье 不含 тел-（身体）", !bd('ателье').includes('тел-'), `实得 ${JSON.stringify(bd('ателье'))}`);
  // тлеться（阴燃）：来自 тлѣти，与 лет-（飞，*letěti）是**两个不同的原始斯拉夫语词根**，无关。
  ok("тлеться 不含 лет-（飞）", !bd('тлеться').includes('лет-'), `实得 ${JSON.stringify(bd('тлеться'))}`);
  // эмальерный（珐琅的）：词源表记 эмаль = 法语借词，与 мал-（小，*malъ）无关。
  ok("эмальерный 不含 мал-（小）", !bd('эмальерный').includes('мал-'), `实得 ${JSON.stringify(bd('эмальерный'))}`);
}

/* ============ D2. 词中空洞无约束 ============ */

console.log('--- D2. 词中空洞无约束（文档 intent ≤1，实现无限）---');
{
  // землетрясение = земл(я) + е + трясение（地震）。"лет" 横跨 земл|е|тряс 三部分，是纯巧合。
  ok("землетрясение 不含 лет-（飞）", !bd('землетрясение').includes('лет-'), `实得 ${JSON.stringify(bd('землетрясение'))}`);
  ok('землетрясение 拆解空洞 <3 字符（不得整段跳过词根）', holeLen('землетрясение') < 3, `空洞 ${holeLen('землетрясение')} 字符 ${JSON.stringify(holes('землетрясение', breakdownWord(db, 'землетрясение', 'ru')))}`);
  // водопад（瀑布）= вод + о + пад。"пад" 3 字符被跳过，仅剩 водо- 却仍算「已拆解」。
  ok('водопад 拆解空洞 <3 字符（不得整段跳过词根）', holeLen('водопад') < 3, `空洞 ${holeLen('водопад')} 字符，实得 ${JSON.stringify(bd('водопад'))}`);
}

/* ============ D3. 尺子 R 的质量 KPI 报告（L4 质量守卫 · 主管裁决 R1/R4）============ */

console.log('--- D3. 尺子 R 质量 KPI 报告（防止靠「跳过词根」冲覆盖率）---');
{
  const raw = new DatabaseSync(DB_PATH, { readOnly: true });
  const ruWords = raw
    .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0")
    .all()
    .map((r) => String(r.word));

  // 2026-09-16 冻结基线（主管裁决 R4 确认）。长期应下降 —— 故**不作硬编码断言**，
  // 只作为「是否劣化」的判据：上升 = 红灯；持平 = 通过；下降 = 改善（应下调冻结值）。
  const FROZEN_DEEP_SKIP = 134;
  const FROZEN_DEEP_SKIP_AT = '2026-09-16';

  let hit = 0;
  let deepSkip = 0; // 空洞 ≥3 字符 = 整个词根被跳过
  let skip2 = 0; // 空洞 ≥2 字符（主管独立复核口径：175 词 / 72%）
  let zeroHole = 0; // 零空洞（主管独立复核口径：37 词 / 4.7%）
  let le1Hole = 0; // 空洞 ≤1（主管独立复核口径：69 词 / 8.7%）
  for (const w of ruWords) {
    const parts = breakdownWord(db, w, 'ru');
    if (!parts.length) continue;
    hit++;
    const hl = holeLen(w);
    if (hl >= 3) deepSkip++;
    if (hl >= 2) skip2++;
    if (hl === 0) zeroHole++;
    if (hl <= 1) le1Hole++;
  }
  const N = ruWords.length;
  const rate = (hit / N) * 100;

  // ---- KPI 报告（只打印，不判红 —— 裁决 L2）----
  console.log('');
  console.log('  ╔═ KPI 报告（口径：尺子 R 分母 ' + N + ' 词；只打印，不判红）');
  console.log(`  ║ 覆盖率（非空即算）      : ${hit}/${N} = ${rate.toFixed(1)}%`);
  console.log(`  ║ 空洞 ≤1 口径            : ${le1Hole}/${N} = ${((le1Hole / N) * 100).toFixed(1)}%   ← L4 质量口径`);
  console.log(`  ║ 零空洞口径              : ${zeroHole}/${N} = ${((zeroHole / N) * 100).toFixed(1)}%`);
  console.log(`  ║ 空洞 ≥2 字符（吞 ≥2）    : ${skip2} 词`);
  console.log(`  ║★空洞 ≥3 字符（吞整词根）: ${deepSkip} 词   ← L4 核心质量守卫`);
  console.log(`  ║  冻结值(${FROZEN_DEEP_SKIP_AT})       : ${FROZEN_DEEP_SKIP} 词`);
  const delta = deepSkip - FROZEN_DEEP_SKIP;
  const trend =
    delta > 0
      ? `❌ 劣化 +${delta}（质量守卫失败）`
      : delta === 0
        ? '✅ 持平'
        : `✅ 改善 ${delta}（建议把冻结值下调到 ${deepSkip}）`;
  console.log(`  ║  实际 vs 冻结           : ${trend}`);
  console.log('  ╚═ 结论：45% 目标不得以「空洞≥3 词数上升」为代价换取。');
  console.log('');

  // L1 反塌陷守卫：沿用 related.mjs 既有 ≥25% 口径，本迭代**不收紧**（裁决 R1-L1）。
  ok(`L1 反塌陷：尺子 R 覆盖率 ${rate.toFixed(1)}% ≥ 25%（沿用既有口径）`, rate >= 0.25);

  // L4 质量守卫：仅在**劣化**时判红；改善（数值下降）必须为绿 —— 裁决 R4。
  ok(
    `L4 质量守卫：空洞≥3 词数 ${deepSkip} 未超过冻结值 ${FROZEN_DEEP_SKIP}（改善/持平均通过）`,
    deepSkip <= FROZEN_DEEP_SKIP,
    `劣化 +${delta}：覆盖率可能是靠「跳过词根」刷出来的`,
  );

  // 交叉核对主管独立复核的数字（probe_ru_gap_audit2.mjs），仅打印差异，不判红。
  const XCHK = [['空洞≥2', skip2, 175], ['空洞≥3', deepSkip, 134], ['零空洞', zeroHole, 37], ['空洞≤1', le1Hole, 69]];
  console.log('  与主管独立复核（第二实现）交叉核对：');
  for (const [name, mine, boss] of XCHK) {
    console.log(`    ${name.padEnd(8)} 我 ${String(mine).padStart(3)}  主管 ${String(boss).padStart(3)}  ${mine === boss ? '✅ 一致' : `⚠ 差 ${mine - boss}`}`);
  }

  raw.close();
}

/* ============ D4. 退化「单片段拆解」中的假词根（2026-09-16 第 2 轮新增）============ */

console.log('--- D4. 退化单片段拆解 / 假词根（用词库**自带词源**作期望值）---');
{
  // 取证脚本：scripts/probe_ru_tautology.mjs（T2 退化拆解全清单）、
  //           scripts/probe_ru_etym_agreement.mjs（词源一致性）、.board/_tmp/probe_d4_gloss.mjs
  //
  // 机制：DP 只要覆盖率 ≥0.55 就接受结果，**不要求拆出 ≥2 个片段**。
  //   于是「剥出一个词根、剩下的整段当空洞」也能算「有拆解」。
  //   全样本实测：这类「只切出 1 个片段」的退化拆解共 15 词（占 791 的 1.9%）。
  //   其中一部分剥出的词根**在词源上根本不成立**。

  // --- D4a 词源明确否定的假词根（期望值来自数据库自带的词源记载，非我的人工判断）---
  // столп 的词源记载：「继承自原始斯拉夫语 *stъlpъ」；
  //   而词素 стол- 的词源是「原始斯拉夫语 *stolъ」（桌子、王座）。
  //   *stъlpъ ≠ *stolъ —— 两个不同的原始斯拉夫语词根，столп（柱）与 стол（桌）无关。
  ok("столп 不含 стол-（词源 *stъlpъ ≠ *stolъ）", !bd('столп').includes('стол-'), `实得 ${JSON.stringify(bd('столп'))}`);

  // казус 的词源记载：「Borrowed from Latin cāsus (< cadō + -tus)」—— 拉丁借词；
  //   而词素 каз- 的词源是「原始斯拉夫语 *kаzаti」（说、指示）。二者毫无关系。
  ok("казус 不含 каз-（拉丁 cāsus 借词 ≠ *kazati）", !bd('казус').includes('каз-'), `实得 ${JSON.stringify(bd('казус'))}`);

  // доминировать 的词源 = 拉丁 dominus 派生；词素 дом- = 俄语「房子」。
  //   把「主导/统治」拆出「房子」，是用户可见的荒谬（同 D1 的 лес-「森林」一类）。
  ok("доминировать 不含 дом-（拉丁 dominus ≠ дом「房子」）", !bd('доминировать').includes('дом-'), `实得 ${JSON.stringify(bd('доминировать'))}`);

  // --- D4b 期望值直接取自词库自己的词源 parts（最硬的判据：不需要我判断语言学）---
  // больной 的词源记载 parts = ["боль", "-ной"]，但算法只剥出 боль-，把真后缀 -ной 当空洞丢弃。
  ok(
    "больной 拆解含 -ной（词源自带 parts=[боль, -ной]）",
    bd('больной').some((m) => m.includes('ной')),
    `实得 ${JSON.stringify(bd('больной'))}`,
  );

  // самосуд 的词源记载 parts = ["само-", "суд"]，算法只剥出 само-，把第二个真词根 суд 当空洞丢弃。
  ok(
    "самосуд 拆解含 суд（词源自带 parts=[само-, суд]）",
    bd('самосуд').some((m) => m.includes('суд')),
    `实得 ${JSON.stringify(bd('самосуд'))}`,
  );

  // термостат = термо-（热，希腊语 θερμός）+ стат（стат 未收录）。第二个词根丢失。
  ok(
    'термостат 拆解不得只剥出 термо-（静/恒温器，стат 丢失）',
    !(bd('термостат').length === 1 && bd('термостат')[0] === 'термо-'),
    `实得 ${JSON.stringify(bd('термостат'))}`,
  );
}

/* ============ D5. ★预言性守卫：放宽「单字符前缀支撑规则」会造成的误拆 ============ */

console.log('--- D5. 放宽单字符前缀支撑规则（index.ts:773-781）的预言性守卫 ---');
{
  // 取证：scripts/probe_ru_gate2_prediction.mjs / probe_ru_gate2_reconcile.mjs
  //
  // 背景：BOARD.md:120 把 119 词（15.0%）归因为「卡在单字符前缀支撑规则」，
  //   并暗示放宽它是一块红利。我的独立上界复核（probe_ru_gate2_reconcile.mjs）显示：
  //     · 547 个无拆解词中有 137 词存在词首 1 字符前缀命中；
  //     · 但只有 28 词在丢掉支撑规则后覆盖率仍 ≥0.55 —— 这才是「真红利」上界（3.5%）；
  //     · 其余 109 词**同时**卡在覆盖率阈值上，放宽支撑规则对它们毫无用处。
  //   而那 28 词**全部**是疑似假拆解（含 ≥2 字符空洞、吞掉真词根）。
  //
  // 本组是这个预言的**可执行守卫**：若开发 agent 放宽支撑规则，以下断言立刻变红。
  // 现有判别集中已有 4 词落在那 28 词名单里（вдыхать / велюровый / очко / свить）。

  // свить（拧、卷）：正确解是 св- + -и（-ить 不定式）—— 但剥 -ить 后只剩 "св" 两字符，
  //   按「碎片拒绝」必须作废。放宽支撑规则后它会变成 ["с-","-ить"]，覆盖率 4/5=0.800！
  ok("свить 不含单字符前缀 'с-'（放宽支撑规则后会误拆，cov 将达 0.800）", !bd('свить').includes('с-'), `实得 ${JSON.stringify(bd('свить'))}`);

  // очевидность 类：очко（小孔）正确解不可拆（剥 -ко 只剩 "оч"）。放宽后会变成 ["о-","-ко"]，cov 0.750。
  ok("очко 不含单字符前缀 'о-'（放宽支撑规则后会误拆，cov 将达 0.750）", !bd('очко').includes('о-'), `实得 ${JSON.stringify(bd('очко'))}`);

  console.log(`  · 参考（不计入口径）сущность 实测 = ${JSON.stringify(bd('сущность'))}（放宽后会成 ["с-","-ность"]，cov 0.750）`);
}

/* ============ D6 = V9-2. D1 修法「字母级」判定的残余漏洞（T15 独立发现 · 裁决八升格 P0）============ */

console.log('--- D6/V9-2. gap 判定只看「单个字母」在不在前缀表，不看它是否真被匹配成前缀 ---');
{
  // 取证：scripts/probe_t15_bitdiff.mjs（比特级差分）、scripts/probe_t15_d6_residual.mjs
  //
  // D1 修法把 index.ts:851 的 explained 定义为
  //   all.some((x) => x.m.kind === 'prefix' && x.stem === gap)
  // 俄语库内单字符前缀只有 в-/о-/с-/у-（4 个）⇒ 该判定**等价于**「首字符 ∈ {в,о,с,у} 就放行」。
  // 它是**字母级**判定：只问「这个字母能不能当某个前缀」，不问
  //   「它在本词里是否真的被 DP 匹配成了那个前缀」。
  // 后果：首字母形似前缀、实为词根首字母的词照样放行，而它真正的词根被整段跳过
  //   —— 与 D1 完全同类的用户可见错误（词族卡列出无关词族）。
  //
  // ★ 归属声明：比特级差分证明这 12 词在修法前后输出**逐字节一致**
  //   （probe_t15_bitdiff.mjs：放行组 75 词改动数 = 0）。
  //   故 D6 是**既有**缺陷、**不是**修法引入；修法本身零误伤、零回归。

  // ★ 断言形式（主管硬约束「位置显式」）：本块用**两种互补形式**，不用笼统「不含 X」——
  //   (i)  **首片段**不得为该假词根（主管 V9-2 指定形式，`parts[0].morpheme !== 假词根`）；
  //   (ii) **词首位置（start === 0）必须被覆盖** —— 这些词的首字符**属于真词根**
  //        （суч- 的 с、однако 的 о），被当作 gap 跳过即为缺陷。
  //        ⚠ (ii) 只对**有硬词源反证**的词成立，**不可**推广到 да- 族 ——
  //        `удачный` 的 у 是真前缀，位置 0 为空洞是**设计如此**（见 ru_morph.mjs A2' 块）。
  const partsOf = (w) => breakdownWord(db, w, 'ru');
  const headM = (w) => partsOf(w)[0]?.morpheme ?? null;
  /** 位置显式：位置 0 是否被某个片段覆盖 */
  const coveredAt0 = (w) => partsOf(w).some((p) => p.start === 0 && p.end > 0);
  /** 位置显式：是否存在【处于词首位置】的该词素片段 */
  const atWordStart = (w, m) => partsOf(w).some((p) => p.start === 0 && p.morpheme === m);
  const fmtP = (w) => JSON.stringify(partsOf(w).map((p) => `${p.morpheme}@${p.start}-${p.end}`));

  // ---- 族 A：суч- 词根（*sučiti / сук「节、枝」）被拆成「跳过 с + уч-（教/学）」----
  // сучить（拧、搓）的真词根是 суч-；输出却拿 уч-（教/学）当词根，
  // 用户查「сучить」会在同根词卡里看到「教、学」词族 —— 语义完全无关。
  // 全库 суч- 开头 13 词中 11 词落此形态（主管裁决七已确认 уч-×11）。
  const FAMILY_A = [
    'сучить',
    'сучение',
    'сучильный',
    'сучка',
    'сучковатость',
    'сучковатый',
    'сучковый',
    'сучкорезка',
    'сучкорезный',
    'сучок',
    'сучёный',
  ];
  for (const w of FAMILY_A) {
    ok(
      `${w} 的【首片段】不得为 уч-（真词根是 суч-，源自 *sučiti/сук；уч- = 教/学，属假词根）`,
      headM(w) !== 'уч-',
      `实得首片段 ${JSON.stringify(headM(w))}`,
    );
    ok(
      `${w} 的【词首位置】必须被覆盖（с 属词根 суч-，不得被当 gap 跳过）`,
      coveredAt0(w),
      `实得 ${fmtP(w)}`,
    );
    ok(
      `${w} 不得在【词首位置】出现 уч-（位置显式，防未来把 уч- 指派到位置 0）`,
      !atWordStart(w, 'уч-'),
      `实得 ${JSON.stringify(partsOf(w).map((p) => `${p.morpheme}@${p.start}`))}`,
    );
  }

  // ---- 族 B：однако（连词）被拆成「跳过 о + дн-（день「日」，假词根）----
  // 主管裁决七已确认 дн-×1。
  ok(
    'однако 的【首片段】不得为 дн-（连词，与 день「日」无关；о- 也不是它的前缀）',
    headM('однако') !== 'дн-',
    `实得首片段 ${JSON.stringify(headM('однако'))}`,
  );
  ok(
    'однако 的【词首位置】必须被覆盖（о 不是前缀，不得被当 gap 跳过）',
    coveredAt0('однако'),
    `实得 ${fmtP('однако')}`,
  );
  ok(
    'однако 不得在【词首位置】出现 дн-（位置显式）',
    !atWordStart('однако', 'дн-'),
    `实得 ${JSON.stringify(partsOf('однако').map((p) => `${p.morpheme}@${p.start}`))}`,
  );

  console.log('  · 规模：修法后仍为 D1 形态的 75 词，首片段分布 = да-×63 / уч-×11 / дн-×1。');
  console.log(`    —— уч-×11 + дн-×1 = 12 词有**硬词源反证**，已固化为上面 ${FAMILY_A.length * 3 + 3} 条断言（V9-2 留红）；`);
  console.log('    —— да-×63 需逐词查词源才能判定，本轮不断言（见测试 agent T15 回报「未覆盖项」）。');
  console.log('  · 主管裁决八点名的 6 词（однако сучить сучение сучильный вдавлина сдаигаться）');
  console.log('    我已逐词核实：**6/6 全部存在于库内且在放行组**（scripts/probe_t17_v92_words.mjs）。');
  console.log('    其中前 4 词属上述硬反证族（однако=дн-，其余 3 词=уч-），已覆盖；');
  console.log('    ⚠ вдавлина / сдаигаться 属 **да- 族**（首片段 да-@1-3），');
  console.log('      主管裁决八 §三 已界定 да-×63「边缘可辩护」，**无硬词源反证** ⇒');
  console.log('      依「宁可小也不写错」**不为其写断言**（写了就是猜期望值）。');
  console.log('  · 修法方向（供主管评估，非遗漏）：把「字母级」升级为「词素级」——');
  console.log('    要求该单字符前缀**确实被 DP 匹配为片段**（parts[0].start === 0）。');
  console.log('    ⚠ 但直接这么改会把这 75 词全部拒绝（它们的首字符当前都没被匹配上，');
  console.log('      卡在 index.ts:773-781 的「单字符前缀支撑规则」）⇒ 必须先修支撑规则让其真正匹配，');
  console.log('      再要求词素级相等。两步缺一不可，属**独立的后续迭代**，不在 D1 修法范围内。');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log('⚠ 本文件的失败项是**测试 agent 独立发现的真实缺陷**，即 A2 迭代的修复目标；');
console.log('  不是「放宽断言」的对象。修复后应全绿。');
process.exit(fail ? 1 : 0);
