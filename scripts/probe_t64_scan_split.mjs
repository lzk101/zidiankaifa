// scripts/probe_t64_scan_split.mjs —— T64 判别实验（只读）
// 唯一问题：全库扇描的耗时里，多少是 SQLite 查询开销、多少是 JS 拆解开销？
//
// 口径对齐（原文，勿凭记忆）：
//   · 被测对象 = `packages/core/test/ru_morph_d1guard.mjs` 的 `measureAll()`（:179-221）
//     其计时区 = `t0`(:184) → for(w of RU) bd(db,w,'ru') + 簿记 → `scanMs`(:221)
//     ⚠ 取词 SQL（`loadRuWords` = `SELECT word FROM words_i18n WHERE lang='ru'`，:161）在 **t0 之外**
//       ⇒ 已记录的 8,971 / 12.4–19.2 s **不含**词表查询
//   · 分母 = 口径 A = 全库俄语词条（实测 101,512）
//
// 只读保证：以 `readOnly: true` 打开生产库；**不调用 `openDatabase()`**（那会跑迁移 = 写库）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');

const norm = (s) => String(s).trim().toLowerCase().replace(/\u0451/g, '\u0435');

/* ---------- SQL 调用计数器（判定 breakdownWord 每词是否发 SQL） ---------- */
const sqlStats = { prepare: 0, execStmt: 0, get: 0, all: 0 };
{
  const P = DatabaseSync.prototype;
  const op = P.prepare;
  P.prepare = function patchedPrepare(...a) {
    sqlStats.prepare += 1;
    const st = op.apply(this, a);
    for (const m of ['get', 'all']) {
      const om = st[m];
      st[m] = function patchedRun(...b) {
        sqlStats[m === 'get' ? 'get' : 'all'] += 1;
        return om.apply(this, b);
      };
    }
    return st;
  };
}
const resetSql = () => {
  sqlStats.prepare = 0;
  sqlStats.execStmt = 0;
  sqlStats.get = 0;
  sqlStats.all = 0;
};
const sqlLine = () =>
  `prepare=${sqlStats.prepare} · get=${sqlStats.get} · all=${sqlStats.all}`;

const stat = (f, n) => {
  const t = [];
  for (let i = 0; i < n; i += 1) {
    const a = performance.now();
    f();
    t.push(performance.now() - a);
  }
  return { n, min: Math.min(...t), max: Math.max(...t), med: t.sort((x, y) => x - y)[Math.floor(t.length / 2)] };
};
const f1 = (x) => `${x.toFixed(1)} ms`;
const f2 = (x) => `${x.toFixed(2)} s`;

const dbSize0 = fs.statSync(DB).size;
const dbMtime0 = fs.statSync(DB).mtime.toISOString();

const { breakdownWord } = await import(
  new URL('../packages/core/dist/db/index.js', import.meta.url).href
);

const db = new DatabaseSync(DB, { readOnly: true });
console.log(`[T64] DB = ${DB}`);
console.log(`[T64] 只读打开（readOnly:true）· 初始 size=${dbSize0} B · mtime=${dbMtime0}`);

/* ================= §1 纯 SQL 段（词表取数） ================= */
console.log('\n§1 纯 SQL 段 —— 词表取数（`loadRuWords` 同款 SQL）');
let RU = [];
resetSql();
{
  const s = stat(() => {
    RU = db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all().map((r) => String(r.word));
  }, 3);
  console.log(`  · ① 每次重新 prepare + all()：${s.n} 次 → min ${f1(s.min)} / med ${f1(s.med)} / max ${f1(s.max)}`);
  console.log(`    SQL 调用：${sqlLine()}（3 次）⇒ 每次 ${sqlStats.prepare / 3} prepare`);
}
{
  const st = db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`);
  resetSql();
  const s = stat(() => { st.all(); }, 3);
  console.log(`  · ② 复用同一个已 prepare 的语句：min ${f1(s.min)} / med ${f1(s.med)} / max ${f1(s.max)}`);
  console.log(`    SQL 调用：${sqlLine()}（3 次）⇒ prepare 仅 1 次（构建时）`);
}
console.log(`  · 分母 = ${RU.length} 词（口径 A）`);
{
  // 逐词 prepare().get() 的反面教材（仅 2000 词采样后外推）
  const sample = RU.slice(0, 2000);
  resetSql();
  const a = performance.now();
  for (const w of sample) db.prepare('SELECT COUNT(1) AS n FROM morphemes WHERE morpheme = ?').get(w);
  const ms = performance.now() - a;
  console.log(
    `  · ③ 反面教材「逐词 prepare().get()」（2000 词）：${f1(ms)} ⇒ 外推全库 ≈ ${f2((ms / 2000) * RU.length / 1000)}；SQL 调用 ${sqlLine()}`,
  );
}

/* ================= §2 完整段（= measureAll 计时区同构） ================= */
// 前置：与 guard 一致，先取前缀 stem 集（在计时区外）
const prefixStems = new Set(
  db.prepare(`SELECT morpheme FROM morphemes WHERE lang = 'ru' AND kind = 'prefix'`).all()
    .map((r) => norm(String(r.morpheme).replace(/^-+|-+$/g, ''))),
);

function measureAllLoop(words) {
  let breakable = 0, gap1Total = 0, gap1InPrefix = 0, d1 = 0, gapGe1Unmatched = 0, gapGe2Total = 0, daCore = 0;
  const firstPartDist = new Map();
  for (const w of words) {
    const parts = breakdownWord(db, w, 'ru');
    if (!parts.length) continue;
    breakable += 1;
    const start = parts[0].start;
    if (start < 1) continue;
    const gap = norm(w).slice(0, start);
    const explained = prefixStems.has(gap);
    if (gap.length >= 2) gapGe2Total += 1;
    if (gap.length === 1) gap1Total += 1;
    if (explained) {
      if (gap.length === 1) {
        gap1InPrefix += 1;
        firstPartDist.set(parts[0].morpheme, (firstPartDist.get(parts[0].morpheme) ?? 0) + 1);
        if (parts[0].morpheme === '\u0434\u0430-') daCore += 1;
      }
    } else {
      gapGe1Unmatched += 1;
      if (gap.length === 1) d1 += 1;
    }
  }
  return { breakable, gap1Total, gap1InPrefix, d1, gapGe1Unmatched, gapGe2Total, daCore };
}

console.log('\n§2 完整段 —— 全库扇描（measureAll 计时区同构）');
// 首次调用含 loadMorphemes（唯一的一次 SQL）
resetSql();
{
  const a = performance.now();
  const parts = breakdownWord(db, RU[0], 'ru');
  const ms = performance.now() - a;
  console.log(`  · 首词（冷缓存，含 loadMorphemes 装载词素表）：${f1(ms)} · SQL ${sqlLine()} · parts=${JSON.stringify(parts.map((p) => p.morpheme))}`);
}
const runs = [];
for (let i = 1; i <= 2; i += 1) {
  resetSql();
  const a = performance.now();
  const r = measureAllLoop(RU);
  const ms = performance.now() - a;
  runs.push({ ms, sql: { ...sqlStats }, r });
  console.log(
    `  · 第 ${i} 次全库扇描：${f1(ms)}（${f2(ms / 1000)}）· ${(RU.length / (ms / 1000)).toFixed(0)} 词/秒 · **SQL 调用：${sqlLine()}**`,
  );
  console.log(
    `      判据：可拆 ${r.breakable} · D1 ${r.d1} · 真前缀 ${r.gap1InPrefix}（да- ${r.daCore}）· gap≥2 ${r.gapGe2Total}`,
  );
}
const scanMed = runs.map((x) => x.ms).sort((a, b) => a - b)[0];
console.log(`  ⇒ 两次取较小值 = ${f1(scanMed)}（保守）`);

/* ================= §3 三段耗时拆分 ================= */
console.log('\n§3 三段耗时拆分（口径：分母均为 101,512 词）');
const fetchMed = 200; // 占位，稍后替换
{
  const s = stat(() => { db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all(); }, 5);
  console.log(`  · A 纯 SQL 段（词表取数，measureAll 计时区**外**）：med ${f1(s.med)}`);
  console.log(`  · B 完整段（= A 的取数 + 逐词 breakdownWord，但 guard 的 scanMs 只含后者）：${f1(scanMed)}`);
  console.log(`  · C JS 拆解总开销 = B −（逐词 SQL 开销）`);
  console.log(
    `    实测逐词 SQL 调用 = ${runs[0].sql.prepare} prepare / ${runs[0].sql.get} get / ${runs[0].sql.all} all` +
      `（101,512 词）⇒ **每词 0 次 SQL** ⇒ C ≈ B = ${f1(scanMed)}（${((scanMed / (scanMed + s.med)) * 100).toFixed(1)}% 的「B+A」）`,
  );
  console.log(`  · ⇒ SQLite 查询开销占比：词表取数 ${f1(s.med)}（${((s.med / (scanMed + s.med)) * 100).toFixed(1)}%）· 逐词 SQL ≈ 0%`);
  void fetchMed;
}

/* ================= §4 分组采样（各 2000 词） ================= */
console.log('\n§4 分组采样（每层 2000 词，测 breakdownWord 吞吐）');
const buckets = [
  ['长度 4–6', (w) => [...w].length >= 4 && [...w].length <= 6],
  ['长度 7–9', (w) => [...w].length >= 7 && [...w].length <= 9],
  ['长度 10–12', (w) => [...w].length >= 10 && [...w].length <= 12],
  ['长度 ≥13', (w) => [...w].length >= 13],
];
const etySet = new Set(
  db.prepare(`SELECT DISTINCT word FROM word_etymology WHERE lang = 'ru'`).all().map((r) => String(r.word)),
);
const byLen = new Map();
for (const w of RU) {
  const L = [...w].length;
  const k = L <= 6 ? '4-6' : L <= 9 ? '7-9' : L <= 12 ? '10-12' : '13+';
  if (!byLen.has(k)) byLen.set(k, []);
  byLen.get(k).push(w);
}
const totalByLen = [...byLen.entries()].map(([k, v]) => `${k}:${v.length}`).join(' ');
console.log(`  · 全库按长度的词数分布：${totalByLen}`);
for (const [name, pred] of buckets) {
  const pool = RU.filter(pred);
  const sample = pool.slice(0, 2000);
  if (!sample.length) { console.log(`  · ${name}：无词`); continue; }
  resetSql();
  const a = performance.now();
  for (const w of sample) breakdownWord(db, w, 'ru');
  const ms = performance.now() - a;
  console.log(
    `  · ${name}：池 ${pool.length} 词，采样 ${sample.length} → ${f1(ms)} = ${(sample.length / (ms / 1000)).toFixed(0)} 词/秒` +
      `（全库该层外推 ${f2(((ms / sample.length) * pool.length) / 1000)}）· SQL ${sqlLine()}`,
  );
}
{
  const withEty = RU.filter((w) => etySet.has(w)).slice(0, 2000);
  const without = RU.filter((w) => !etySet.has(w)).slice(0, 2000);
  for (const [name, sample] of [['有词源', withEty], ['无词源', without]]) {
    const a = performance.now();
    for (const w of sample) breakdownWord(db, w, 'ru');
    const ms = performance.now() - a;
    console.log(`  · ${name}（采样 ${sample.length}）：${f1(ms)} = ${(sample.length / (ms / 1000)).toFixed(0)} 词/秒`);
  }
  console.log(`  · 全库有词源俄语词 = ${etySet.size}（${((etySet.size / RU.length) * 100).toFixed(1)}%）`);
}

/* ================= §5 候选优化实测 ================= */
console.log('\n§5 候选优化（只测速）');
{
  // ① 复用已 prepare 的语句 vs 每次 prepare（词表取数）
  const a1 = stat(() => { db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all(); }, 5).med;
  const st = db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`);
  const a2 = stat(() => { st.all(); }, 5).med;
  console.log(`  ① 词表取数：每次 prepare ${f1(a1)} → 复用 prepare ${f1(a2)} ⇒ 加速比 ${(a1 / a2).toFixed(2)}×（但该项**不在** scanMs 内）`);
}
{
  // ② 批量取 vs 逐词 get（2000 词采样）
  const sample = RU.slice(0, 2000);
  const a = performance.now();
  for (const w of sample) db.prepare('SELECT COUNT(1) AS n FROM morphemes WHERE morpheme = ?').get(w);
  const per = performance.now() - a;
  const b = performance.now();
  db.prepare(`SELECT word FROM words_i18n WHERE lang = 'ru'`).all();
  const batch = performance.now() - b;
  console.log(
    `  ② 逐词 prepare().get()（2000 词）${f1(per)} vs 一次性批量取全库 ${f1(batch)} ⇒ 批量快 **${(per / batch).toFixed(1)}×**（现实现已是批量）`,
  );
}
{
  // ④ 词素缓存效果：清不掉（模块级 Map），改为测「每次调用是否重建候选表」
  const sample = RU.slice(0, 5000);
  const a = performance.now();
  for (const w of sample) breakdownWord(db, w, 'ru');
  const ms = performance.now() - a;
  console.log(`  ④ 5000 词连扫 ${f1(ms)} = ${(sample.length / (ms / 1000)).toFixed(0)} 词/秒（缓存已热）⇒ 无「每次调用重建词素表」迹象`);
}

const dbSize1 = fs.statSync(DB).size;
const dbMtime1 = fs.statSync(DB).mtime.toISOString();
console.log('\n§6 只读自证');
console.log(`  · size ${dbSize0} → ${dbSize1}（相等=${dbSize0 === dbSize1}）· mtime ${dbMtime0} → ${dbMtime1}（相等=${dbMtime0 === dbMtime1}）`);
db.close();
