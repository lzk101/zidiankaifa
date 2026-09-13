/**
 * ru_morph_d1guard.mjs —— V9-3：**全库 D1 双向守卫**（功能测试 agent · T18）
 *
 * 被测对象：packages/core/dist/db/index.js（非 src）
 * 判据来源：packages/core/src/db/index.ts:848-863 的词首 gap 关卡
 *   if (parts.length && parts[0].start >= 1) {
 *     const gap = mw.slice(0, parts[0].start);
 *     const explained = all.some((x) => x.m.kind === 'prefix' && x.stem === gap);
 *     if (!explained) return [];
 *   }
 *
 * ------------------------------------------------------------------ *
 * 1. 为什么必须另立本文件（`ru_morph_d1fix.mjs` 194 条不够）
 * ------------------------------------------------------------------ *
 * `ru_morph_d1fix.mjs` 只覆盖 **27 词样本 + 尺子 R 子集（791 词）**。
 * 而 D1 缺陷的**权威口径是全库**（342 = 75 保留 + 267 消除），因为灵敏度差一个量级：
 *   · 尺子 R（791 词）内 D1 词仅 **6 个** ⇒ 空洞≥3 灵敏度 6/267 ≈ **2.2%**（几乎无鉴别力）；
 *   · **全库**口径灵敏度 96/267 = **36.0%**。
 * ⇒ 只有全库守卫才真能拦住 D1 复发。D1 是 v0.8.0 修好的最严重**用户可见**缺陷
 *   （`плескание`「溅水」被拆出 `лес-`「森林」，词族污染 40 个词），
 *   一旦回退而测试不报，就是**静默假绿**。
 *
 * ------------------------------------------------------------------ *
 * 2. ★★ 守卫必须双向：只断言「D1 计数 == 0」会被第二种错误静默骗过
 * ------------------------------------------------------------------ *
 * | 错误方向 | 表现 | 单靠计数断言 |
 * | --- | --- | --- |
 * | A. 回退（重新放过 gap=1 非前缀） | D1 计数 > 0 | 能拦住 ✅ |
 * | B. 修过头（无条件禁止 gap=1） | D1 计数**仍为 0**，但误杀真前缀词 | **完全拦不住** ❌ |
 *
 * ⇒ 方向 B 由**三个独立锚点**覆盖：
 *   (i) **点名哨兵 `удачный`** —— `{да-@1 + -ный@4}`，词源 `удача` = `у- + дача`，`у-` 是真前缀；
 *       它是**真前缀组里唯一落在尺子 R 内的词**（75 词中恰 1 个）；
 *   (ii) **四字母哨兵**（`в`/`о`/`с`/`у` 各一）—— 抓「只禁某个字母」型部分修过头；
 *   (iii) **真前缀组计数地板 63** + **`да-` 核心子集地板 63**。
 *
 * ⚠ 为什么真前缀组地板写 **63** 而非当前值 75（容差 = 12，依据如下）：
 *   当前 75 词的首片段分布 = `да-`×63 + `уч-`×11 + `дн-`×1。
 *   其中 `уч-`×11 + `дн-`×1 = **12 词**已被 `.board/TASKS.md` 立为 **v0.9.0 的 P0（V9-2）**，
 *   属**已登记的合法消除目标**（`сучить`→`уч-` 是假词根，与 D4 同类）。
 *   ⇒ 地板取 75 − 12 = **63**，既能容忍 V9-2 的合法消除，又能拦住「修过头」（实测 75→0）。
 *   ⇒ `да-` 子集（63 词）**不在**任何已登记 P0 的消除目标内 ⇒ 该子集地板取**严格 0 容差 63**。
 * ⚠ `33,174` 与 `238/791` 是 **v0.8.0 冻结真值**；若 v0.9.0 经主管裁定的词素语义核证
 *   合法改变了它们，**须由主管裁定改常量并记档**，开发 agent 不得自行放宽（`test-agent.md` 铁律 5）。
 *   ★ **主管裁决十二（2026-09-16）已就此预先裁定 `breakableMin`**：
 *     v0.9.0 的 V9-2 会**合法**消除 12 词真前缀假词根（`уч-`×11 + `дн-`×1，`сучить`→`уч-` 等），
 *     全库可拆将由 33,174 **降至 33,162** ⇒ 原 0 容差地板会对**合法工作**误报（功能测试 agent 主动指出此风险）。
 *     故 `breakableMin` 已下调为 **33,162**（= 33,174 − 12），与 `truePrefixMin` 的 12 容差**同源同因**、口径一致。
 *   ⚠ 这是**唯一**因 V9-2 而下调的常量；`238/791`、`daCoreMin 63`、`l4Hole3Max 134` **保持 0 容差**
 *     —— 补词素的方向是**上升**，它们不该下降；若因 v0.9.0 合法上升，须由主管裁定**上调**并记档。
 *
 * ------------------------------------------------------------------ *
 * 3. 反同义反复（本文件自身的假绿防线）
 * ------------------------------------------------------------------ *
 * 「D1 计数 == 0」单独是**可被平凡满足**的：把整库拆解关掉（可拆 = 0）也满足它。
 * ⇒ 必须同时锚定**分母与地板**，本文件为此设了 4 道：
 *   ① 全库俄语词条 ≥ 101,000（口径 A 分母不得缩水）；
 *   ② 全库可拆俄语词条 ≥ 33,174；
 *   ③ 真前缀组 ≥ 63（gap=1 通道不得整体失效）；
 *   ④ 尺子 R 覆盖率 ≥ 238 且率 ≥ 30.0%。
 *
 * ------------------------------------------------------------------ *
 * 4. 口径声明（本项目已因口径混淆产生多轮互指错误 —— 每个数字必须带口径）
 * ------------------------------------------------------------------ *
 *   · **口径 A（全库俄语）** = `words_i18n WHERE lang='ru'` 全量，**无长度/字符过滤**。
 *     D1 计数、可拆总数、真前缀组均取此口径。
 *   · **口径 R（尺子 R）** = 口径 A + `length BETWEEN 4 AND 12 AND rowid % 97 = 0`（791 词）。
 *     仅用于覆盖率与 L4 护栏。
 *   · **L4 = 口径 A「未覆盖字符【总数】」≥3**（唯一权威口径，裁决六§二）= **134**。
 *   · D1 规模引用**全库口径 342**（75 保留 + 267 消除）。
 *   三把尺子分母不同，**不可互比**。
 *
 * 退出码：0=全绿（D1 未回退且未修过头）· 1=回归（须回退/修正修法）
 * 只读、幂等：不写任何数据，可反复运行。
 *
 * 运行（**两种 cwd 都必须 exit 0**，见 `AGENTS.md` 铁律 6）：
 *   cd <仓库根>                && node packages/core/test/ru_morph_d1guard.mjs
 *   cd <仓库根>/packages/core  && node test/ru_morph_d1guard.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../dist/db/index.js';

// ⚠ AGENTS.md 铁律 6：词库路径必须与 cwd 无关，且支持 ZIDIANKAIFA_DB 覆盖。
// `pnpm --filter @zidiankaifa/core test` 的 cwd 是 packages/core（不是仓库根），
// 写成 new DatabaseSync('data/db/dict.db') 会在 pnpm test 下崩 errcode 14 ⇒ 假绿。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH =
  process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');

/* ================================================================== *
 * 冻结真值（v0.8.0，全部为功能测试 agent 独立实测值，非转述）
 * ================================================================== */
export const FROZEN = {
  ruTotalMin: 101000, // 口径 A 分母地板（实测 101,512）
  ruPrefixMin: 185, // 俄语前缀词素数（实测 185）
  singleCharPrefixes: ['в', 'о', 'с', 'у'], // 实测恰为这 4 个
  d1Count: 0, // 全库 D1 模式计数（主断言）
  breakableMin: 33162, // 全库可拆俄语词条（实测 33,174；容差 12 = V9-2 已登记合法消除，见文件头裁决十二）
  truePrefixMin: 63, // 真前缀组地板（实测 75，容差 12 = V9-2 已登记目标）
  daCoreMin: 63, // 其中 `да-` 首片段子集（实测 63，0 容差）
  rSizeMin: 700, // 尺子 R 样本地板（实测 791）
  rNonEmptyMin: 238, // 尺子 R 可拆数（实测 238 / 791 = 30.09%）
  rRateMin: 0.3, // 覆盖率率地板（拦单字级修过头：237/791 = 29.96% < 30.0%）
  l4Hole3Max: 134, // L4 空洞≥3（口径 A 总数），辅助护栏
};

/** D1 口径下点名的用户可见症状词（消除组代表，修法后必须全空） */
export const D1_NAMED = [
  'плескание', // 溅水 → 曾拆出 лес-（森林），污染 40 个词族
  'хлестаться',
  'зверство',
  'глетчерный',
  'тлеться',
  'ателье',
  'эмальерный',
];

/** 方向 B 四字母哨兵：每个库内单字符前缀各取 1 词 */
export const LETTER_SENTINELS = { в: 'вдаваться', о: 'одалживать', с: 'сдабривать', у: 'удачный' };

/** 点名哨兵（方向 B 唯一点名实证：选 `>=1` 而非「无条件禁止 gap=1」的理由） */
export const NAMED_SENTINEL = 'удачный';

/** 与实现同构的归一化（`index.ts:265` normalizeWord + 俄语 ё/е 等价，`index.ts:732`） */
export const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');

/** 独立复刻实现侧的前缀 stem 集：morpheme 去首尾连字符 + ё→е（`index.ts:735-736`） */
export function loadPrefixStems(db) {
  return new Set(
    db
      .prepare(`SELECT morpheme FROM morphemes WHERE lang = 'ru' AND kind = 'prefix'`)
      .all()
      .map((r) => norm(String(r.morpheme).replace(/^-+|-+$/g, ''))),
  );
}

/** 口径 A：全库俄语词条（index.ts 用 normalizeWord 小写化，这里保留原形，比对时归一化） */
export function loadRuWords(db) {
  return db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all().map((r) => String(r.word));
}

/** 口径 R：尺子 R（related.mjs:144 同款 SQL） */
export function loadRulerR(db) {
  return db
    .prepare(
      `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`,
    )
    .all()
    .map((r) => String(r.word));
}

/**
 * ★ 核心度量：一次全库扫描产出全部双向判据。
 * 参数化 `bd`（breakdown 函数）是为了让 `scripts/probe_t18_guard_power.mjs` 的
 * **变体判别实验**复用**同一份度量代码**（否则「用别的东西测出结论」是无效证据）。
 */
export function measureAll(db, bd = breakdownWord, log = () => {}) {
  const prefixStems = loadPrefixStems(db);
  const singleCharPrefixes = [...prefixStems].filter((s) => s.length === 1).sort();
  const RU = loadRuWords(db);

  const t0 = Date.now();
  let breakable = 0;
  let gap1Total = 0; // 可拆 且 parts[0].start === 1（D1 全集口径）
  let gap1InPrefix = 0; // 其中 gap ∈ 前缀 stem 集（= AC-4 真前缀组）
  let d1 = 0; // 其中 gap ∉ 前缀 stem 集（= D1 缺陷）
  let gapGe1Unmatched = 0; // gap ≥1 且 gap ∉ 前缀集（含 gap≥2，自洽性检验）
  let gapGe2Total = 0; // gap ≥2（记录用：现任实现该通道应为 0）
  let daCore = 0; // 真前缀组中首片段为 `да-` 的子集
  const d1Words = [];
  const truePrefixWords = [];
  const firstPartDist = new Map();

  for (const w of RU) {
    const parts = bd(db, w, 'ru');
    if (!parts.length) continue;
    breakable++;
    const start = parts[0].start;
    if (start < 1) continue;
    const gap = norm(w).slice(0, start);
    const explained = prefixStems.has(gap);
    if (gap.length >= 2) gapGe2Total++;
    if (gap.length === 1) gap1Total++;
    if (explained) {
      if (gap.length === 1) {
        gap1InPrefix++;
        truePrefixWords.push(w);
        firstPartDist.set(parts[0].morpheme, (firstPartDist.get(parts[0].morpheme) ?? 0) + 1);
        if (parts[0].morpheme === 'да-') daCore++;
      }
    } else {
      gapGe1Unmatched++;
      if (gap.length === 1) {
        d1++;
        d1Words.push(w);
      }
    }
  }
  const scanMs = Date.now() - t0;
  log(`  全库扫描（口径 A = ${RU.length} 词）耗时 ${scanMs} ms`);

  // ---- 尺子 R：覆盖率 + L4 空洞≥3（口径 A 未覆盖字符总数） ----
  const R = loadRulerR(db);
  const t1 = Date.now();
  let rNonEmpty = 0;
  let rHole3 = 0;
  for (const w of R) {
    const parts = bd(db, w, 'ru');
    if (!parts.length) continue;
    rNonEmpty++;
    const cov = new Array(norm(w).length).fill(false);
    for (const p of parts) for (let i = p.start; i < p.end && i < cov.length; i++) cov[i] = true;
    if (cov.filter((x) => !x).length >= 3) rHole3++;
  }
  const rMs = Date.now() - t1;

  // ---- 点名哨兵 ----
  const sentinel = (w) => {
    const parts = bd(db, w, 'ru');
    const start = parts.length ? parts[0].start : null;
    return {
      word: w,
      parts,
      at: parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' + '),
      nonEmpty: parts.length > 0,
      start,
      gap: start === null ? null : norm(w).slice(0, start),
      gapInPrefix: start === null ? false : prefixStems.has(norm(w).slice(0, start)),
    };
  };

  return {
    prefixStems,
    singleCharPrefixes,
    ruTotal: RU.length,
    breakable,
    gap1Total,
    gap1InPrefix,
    d1,
    d1Words,
    gapGe1Unmatched,
    gapGe2Total,
    daCore,
    firstPartDist,
    truePrefixWords,
    scanMs,
    scanWordsPerSec: Math.round(RU.length / (scanMs / 1000)),
    R,
    rNonEmpty,
    rHole3,
    rMs,
    sentinels: {
      [NAMED_SENTINEL]: sentinel(NAMED_SENTINEL),
      ...Object.fromEntries(Object.entries(LETTER_SENTINELS).map(([k, w]) => [k, sentinel(w)])),
    },
    namedD1: D1_NAMED.map((w) => ({ word: w, at: sentinel(w).at, parts: sentinel(w).parts })),
  };
}

/**
 * ★ 双向断言集（**唯一实现**：主入口与变体判别实验共用，保证「测的是同一批判据」）。
 * 返回 [{ name, pass, detail }]。
 */
export function evaluate(m) {
  const out = [];
  const ok = (name, pass, detail = '') => out.push({ name, pass: !!pass, detail });
  const rate = m.rNonEmpty / m.R.length;

  /* §0 分母与词素表完整性（反同义反复：分母缩水 ⇒ 后面全会假绿） */
  ok(
    `§0 口径A 分母地板：全库俄语词条 ≥ ${FROZEN.ruTotalMin}（实测 ${m.ruTotal}）`,
    m.ruTotal >= FROZEN.ruTotalMin,
    `实测 ${m.ruTotal} < ${FROZEN.ruTotalMin}，分母缩水则 D1=0 无意义`,
  );
  ok(
    `§0 词素表：俄语前缀词素数 ≥ ${FROZEN.ruPrefixMin}（实测 ${m.prefixStems.size}）`,
    m.prefixStems.size >= FROZEN.ruPrefixMin,
    `实测 ${m.prefixStems.size}`,
  );
  ok(
    `§0 词素表：单字符前缀 ⊇ {${FROZEN.singleCharPrefixes.join(',')}}（实测 {${m.singleCharPrefixes.join(',')}}）`,
    FROZEN.singleCharPrefixes.every((c) => m.prefixStems.has(c)),
    `实测 {${m.singleCharPrefixes.join(',')}}，缺少 ${FROZEN.singleCharPrefixes.filter((c) => !m.prefixStems.has(c)).join(',')}`,
  );

  /* §1 方向 A：回退检测（全库口径） */
  ok(
    `§1【方向A·主断言】全库 D1 模式计数 === ${FROZEN.d1Count}（口径A ${m.ruTotal} 词；实测 ${m.d1}）`,
    m.d1 === FROZEN.d1Count,
    `实测 ${m.d1} 词复发：${m.d1Words.slice(0, 8).join(', ')}${m.d1Words.length > 8 ? ' …' : ''}`,
  );
  ok(
    `§1 自洽性：gap≥1 且 gap ∉ 前缀集 的可拆词 === 0（实测 ${m.gapGe1Unmatched}；含 gap≥2 共 ${m.gapGe2Total} 词）`,
    m.gapGe1Unmatched === 0,
    `实测 ${m.gapGe1Unmatched} 词泄漏`,
  );
  for (const n of m.namedD1) {
    ok(`§1 点名 D1 症状词 ${n.word} 必须 []（实测 ${n.at || '[]'}）`, n.parts.length === 0);
  }

  /* §2 方向 B：修过头检测 */
  const s = m.sentinels[NAMED_SENTINEL];
  ok(
    `§2【方向B·点名哨兵】${NAMED_SENTINEL} 必须非空（实测 ${s.at || '[]'}）`,
    s.nonEmpty,
    '真前缀词被误杀 ⇒ 修过头',
  );
  ok(
    `§2【方向B·点名哨兵】${NAMED_SENTINEL}.parts[0].start === 1（实测 ${s.start}）`,
    s.start === 1,
    `实测 ${s.at || '[]'}`,
  );
  ok(
    `§2【方向B·点名哨兵】${NAMED_SENTINEL} gap='у' ∈ 前缀集（实测 '${s.gap}'）`,
    s.gap === 'у' && s.gapInPrefix,
    `实测 '${s.gap}'`,
  );
  for (const [letter, w] of Object.entries(LETTER_SENTINELS)) {
    const t = m.sentinels[letter];
    ok(
      `§2 四字母哨兵 '${letter}' → ${w} 非空 且 parts[0].start === 1（实测 ${t.at || '[]'}）`,
      t.nonEmpty && t.start === 1,
      `实测 ${t.at || '[]'}（gap='${t.gap}'）`,
    );
  }
  ok(
    `§2【方向B·防多杀】真前缀组（gap=1 且 gap ∈ 前缀集）≥ ${FROZEN.truePrefixMin}（当前实测 ${m.gap1InPrefix}；地板列明：v0.9.0 V9-2 已登记合法目标 75−12=63）`,
    m.gap1InPrefix >= FROZEN.truePrefixMin,
    `实测 ${m.gap1InPrefix} < ${FROZEN.truePrefixMin}`,
  );
  ok(
    `§2【方向B·防多杀】其中首片段 'да-' 核心子集 ≥ ${FROZEN.daCoreMin}（实测 ${m.daCore}；该子集不在任何已登记 P0 消除目标内 ⇒ 0 容差）`,
    m.daCore >= FROZEN.daCoreMin,
    `实测 ${m.daCore} < ${FROZEN.daCoreMin}`,
  );

  /* §3 计数地板（防「多杀」型回退 + 反同义反复） */
  ok(
    `§3【防多杀】全库可拆俄语词条 ≥ ${FROZEN.breakableMin}（实测 ${m.breakable}）`,
    m.breakable >= FROZEN.breakableMin,
    `实测 ${m.breakable} < ${FROZEN.breakableMin}（修过头会大规模不可拆）`,
  );
  ok(
    `§3 尺子 R 样本量 ≥ ${FROZEN.rSizeMin}（实测 ${m.R.length}）`,
    m.R.length >= FROZEN.rSizeMin,
    `实测 ${m.R.length}`,
  );
  ok(
    `§3 尺子 R 覆盖率 ≥ ${FROZEN.rNonEmptyMin}/${791}（实测 ${m.rNonEmpty}/${m.R.length} = ${(rate * 100).toFixed(2)}%）`,
    m.rNonEmpty >= FROZEN.rNonEmptyMin,
    `实测 ${m.rNonEmpty} < ${FROZEN.rNonEmptyMin}（修过头单字级即掉到 237）`,
  );
  ok(
    `§3 尺子 R 覆盖率率 ≥ ${(FROZEN.rRateMin * 100).toFixed(1)}%（实测 ${(rate * 100).toFixed(2)}%）`,
    rate >= FROZEN.rRateMin,
    `实测 ${(rate * 100).toFixed(2)}%；237/791 = 29.96% 即被判红`,
  );
  ok(
    `§3 L4 辅助护栏：空洞≥3（口径A 总数，R 样本内）≤ ${FROZEN.l4Hole3Max}（实测 ${m.rHole3}）`,
    m.rHole3 <= FROZEN.l4Hole3Max,
    `实测 ${m.rHole3} > ${FROZEN.l4Hole3Max}，质量劣化`,
  );

  return out;
}

/* ================================================================== *
 * CLI 主入口（被 import 时不执行断言 —— 变体判别实验依赖此性质）
 * ================================================================== */
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  console.log('='.repeat(96));
  console.log('ru_morph_d1guard.mjs —— V9-3 全库 D1 双向守卫（功能测试 agent · T18）');
  console.log('='.repeat(96));
  console.log(`词库：${DB_PATH}`);
  console.log('口径：A=全库俄语（无过滤）· R=尺子 R（A + len 4..12 且 rowid%97=0，791 词）· L4=口径A未覆盖字符总数≥3');
  console.log('被测产物：packages/core/dist/db/index.js（D1 修法 = src/db/index.ts:859 `>=1`）');

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const tStart = Date.now();

  console.log('\n§A 全库度量（一次扫描，双向判据共用）');
  const m = measureAll(db, breakdownWord, (s) => console.log(s));
  console.log(`  全库俄语词条（口径A）  = ${m.ruTotal}`);
  console.log(`  可拆俄语词条           = ${m.breakable}`);
  console.log(`  gap=1 且可拆（D1 全集） = ${m.gap1Total}   ← 权威口径 342 = 75 保留 + 267 消除`);
  console.log(`    ├─ gap ∈ 前缀集（保留）= ${m.gap1InPrefix}   ← AC-4 真前缀组`);
  console.log(`    └─ gap ∉ 前缀集（D1）  = ${m.d1}   ← 须为 0`);
  console.log(`  gap≥2 且可拆           = ${m.gapGe2Total} · 其中 gap ∉ 前缀集 = ${m.gapGe1Unmatched - m.d1}`);
  console.log(`  真前缀组首片段分布：`);
  for (const [k, v] of [...m.firstPartDist].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(8)} × ${v}`);
  }
  console.log(`  尺子 R：${m.rNonEmpty}/${m.R.length} = ${((m.rNonEmpty / m.R.length) * 100).toFixed(2)}%（耗时 ${m.rMs} ms）· L4 空洞≥3 = ${m.rHole3}`);
  console.log(`  方向 B 哨兵：`);
  for (const [k, t] of Object.entries(m.sentinels)) {
    console.log(`    ${(k === NAMED_SENTINEL ? k : `${k} → ${t.word}`).padEnd(20)} ${t.at || '[]'}${t.start !== null ? `  start=${t.start} gap='${t.gap}' ∈前缀=${t.gapInPrefix}` : ''}`);
  }
  console.log(
    `  ⓘ 灵敏度（引用主管裁决九，非本守卫实测）：R 内空洞≥3 灵敏度 6/267 ≈ 2.2%；全库 96/267 = 36.0%` +
      ` ⇒ 本守卫取全库口径。`,
  );

  console.log('\n§B 双向断言');
  const results = evaluate(m);
  let pass = 0;
  const failures = [];
  for (const r of results) {
    if (r.pass) {
      pass++;
      console.log(`  ✓ ${r.name}`);
    } else {
      failures.push(r.name + (r.detail ? `  —— ${r.detail}` : ''));
      console.log(`  ✗ ${r.name}${r.detail ? `  —— ${r.detail}` : ''}`);
    }
  }

  const totalMs = Date.now() - tStart;
  console.log('\n' + '='.repeat(96));
  console.log(`结果：${pass} 通过 / ${failures.length} 失败（共 ${results.length} 条断言）`);
  if (failures.length) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(`耗时：${totalMs} ms（全库扫描 ${m.scanMs} ms = ${m.scanWordsPerSec} 词/秒；尺子 R ${m.rMs} ms）`);
  console.log('退出码语义：0=全绿（D1 未回退且未修过头）· 1=回归（须回退/修正修法）');
  console.log('='.repeat(96));

  db.close();
  process.exit(failures.length > 0 ? 1 : 0);
}
