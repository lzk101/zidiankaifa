/**
 * 只读探针（功能测试 agent · T16）：独立验证主管两条**机制性**论断，不照抄。
 *
 * 论断 1：`удачный` 是「真前缀组（gap ∈ {в,о,с,у}）里**唯一**落在尺子 R 内」的词。
 * 论断 2：`смекать` 不可拆是**被覆盖率 0.55 前置过滤**拦住，**不是**被词首 gap 守卫所杀。
 *
 * 方法（论断 2）：对生产 dist 做**文本级变体引擎**，逐关打开，看是哪一关杀死了它。
 *   V1 = 生产（gap 守卫 `>=1` + 覆盖率 0.55）
 *   V2 = 覆盖率关掉（0），gap 守卫保持 `>=1`
 *   V3 = 覆盖率关掉 + gap 守卫整条条件置 false（= 纯 DP 最优解，两道关全开）
 * 变体写进 scripts/_tmp/{v2,v3}/ 副本目录，**生产 dist 与 src 一字不改**。
 * 只读、幂等。用法：node scripts/probe_t16_mechanism.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'packages', 'core', 'dist');
const PRE = path.join(__dirname, '_tmp', 'prefix_engine', 'db', 'index.js');

const db = new DatabaseSync(path.join(ROOT, 'data', 'db', 'dict.db'), { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));

const pre = await import(pathToFileURL(PRE).href);
const prod = await import(pathToFileURL(path.join(DIST, 'db', 'index.js')).href);

/* ---------- 造变体引擎 ---------- */
const SRC = fs.readFileSync(path.join(DIST, 'db', 'index.js'), 'utf8');
const COV_LINE = 'const BREAKDOWN_MIN_COVERAGE = 0.55;';
const GAP_LINE = 'if (parts.length && parts[0].start >= 1) {';
if (!SRC.includes(COV_LINE)) throw new Error('覆盖率常量行未找到 —— dist 结构已变，探针需更新');
if (!SRC.includes(GAP_LINE)) throw new Error('gap 守卫行未找到 —— dist 结构已变，探针需更新');

function makeVariant(name, { noCov, noGap }) {
  let s = SRC;
  if (noCov) s = s.replace(COV_LINE, 'const BREAKDOWN_MIN_COVERAGE = 0;');
  if (noGap) s = s.replace(GAP_LINE, 'if (false) {');
  const dir = path.join(__dirname, '_tmp', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'db', 'index.js'), s);
  return pathToFileURL(path.join(dir, 'db', 'index.js')).href;
}

const v2 = await import(makeVariant('t16_nocov', { noCov: true, noGap: false }));
const v3 = await import(makeVariant('t16_nocov_nogap', { noCov: true, noGap: true }));
// V4 = ★决定性判别：保留覆盖率 0.55，只关掉 gap 守卫。
//     若 V4 能拆开 ⇒ 覆盖率闸放行了它、是 gap 守卫杀的；若 V4 仍空 ⇒ 覆盖率才是拦截者。
const v4 = await import(makeVariant('t16_nogap', { noCov: false, noGap: true }));

const bd = (mod, w) => {
  try {
    return mod.breakdownWord(db, w, 'ru') ?? [];
  } catch (e) {
    return [`<ERR ${e.message}>`];
  }
};
const fmt = (p) => JSON.stringify(p.map((x) => `${x.morpheme}@${x.start}-${x.end}`));

console.log('='.repeat(88));
console.log('论断 1：`удачный` 是否为「真前缀组里唯一落在尺子 R 内」的词');
console.log('='.repeat(88));

// 真前缀组 = 修法前 D1 形态（parts>=2, parts[0].start===1）且首字符 ∈ {в,о,с,у}
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const group = ALL.filter((w) => {
  const p = bd(pre, w);
  return p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0]);
});
const Rset = new Set(R);
const groupInR = group.filter((w) => Rset.has(w));
console.log(`  全库真前缀组规模            : ${group.length}`);
console.log(`  其中落在尺子 R 内的词        : ${groupInR.length}  → ${groupInR.join(' ')}`);
console.log(`  主管论断「удачный 是唯一」   : ${groupInR.length === 1 && groupInR[0] === 'удачный' ? '✅ 成立' : '❌ 不成立'}`);
const ua = bd(prod, 'удачный');
console.log(`  удачный 当前拆解            : ${fmt(ua)}`);
console.log(`  parts[0].start === 1        : ${ua.length ? ua[0].start === 1 : 'N/A'}`);

console.log('\n' + '='.repeat(88));
console.log('论断 2：`смекать` 是被「覆盖率 0.55」还是被「词首 gap 守卫」杀死？');
console.log('='.repeat(88));
const rows = [
  ['V1 生产（cov 0.55 + gap >=1）', prod],
  ['V0 修法前（cov 0.55 + gap >=2）', pre],
  ['V2 覆盖率关（cov 0 + gap >=1）', v2],
  ['V3 两关全开（cov 0 + gap off）', v3],
  ['V4 ★只关 gap（cov 0.55 + gap off）', v4],
];
for (const [label, mod] of rows) {
  const p = bd(mod, 'смекать');
  const cov = p.reduce((s, x) => s + (x.end - x.start), 0);
  console.log(`  ${label.padEnd(32)} : ${p.length ? fmt(p) : '[]'}   覆盖 ${cov}/7 = ${(cov / 7).toFixed(3)}`);
}
console.log('');
const v2p = bd(v2, 'смекать');
const v3p = bd(v3, 'смекать');
const v4p = bd(v4, 'смекать');
console.log('  ★决定性判别 V4（覆盖率闸保持 0.55，仅关 gap 守卫）：');
console.log(`     ${v4p.length ? fmt(v4p) : '[]'}  ⇒ ${v4p.length ? '覆盖率闸**放行了**它 ⇒ **是 gap 守卫杀的**，主管论断 2 不成立' : '仍空 ⇒ 覆盖率确实是拦截者，主管论断 2 成立'}`);
console.log('');
console.log(`  ⇒ V2（仅关覆盖率）仍空？ ${v2p.length === 0 ? '是 ⇒ 覆盖率**不是**唯一拦截者' : '否'}`);
console.log(`  ⇒ V3（两关全开）    : ${v3p.length ? fmt(v3p) : '[]'}`);
if (v3p.length) {
  const cov = v3p.reduce((s, x) => s + (x.end - x.start), 0);
  console.log(`     纯 DP 最优解覆盖 ${cov}/7 = ${(cov / 7).toFixed(3)} —— ${(cov / 7) < 0.55 ? '确实 <0.55 ⇒ 覆盖率会拦' : '其实 >=0.55 ⇒ **覆盖率不会拦**'}`);
  console.log(`     parts[0].start = ${v3p[0].start} ⇒ gap = '${norm('смекать').slice(0, v3p[0].start)}'`);
  console.log(`     gap ∈ {в,о,с,у}? ${RU1.has(norm('смекать').slice(0, v3p[0].start))}  ⇒ gap 守卫${RU1.has(norm('смекать').slice(0, v3p[0].start)) ? '会放行' : '**也会拒绝**'}`);
}

console.log('\n' + '='.repeat(88));
console.log('旁证：真前缀组在 R 内仅 1 词，但全库 75 词是否都存活？');
console.log('='.repeat(88));
let alive = 0;
const dead = [];
for (const w of group) {
  if (bd(prod, w).length) alive++;
  else dead.push(w);
}
console.log(`  修法后存活 ${alive}/${group.length}，被误杀 ${dead.length} ${dead.join(' ')}`);

db.close();
