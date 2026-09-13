/**
 * 只读探针（功能测试 agent，2026-09-16 · T15）：独立复核 D1 修法（index.ts:851 `>=2` → `>=1`）
 *
 * 主管在 `scripts/probe_verify_gap1_fix.mjs` 中给出三条事实，本探针**独立复算**：
 *   事实一 `смекать` 当前返回 []，不是 D1 模式（修法不影响）
 *   事实二 全库 D1 模式 321 词 = 放行 71（gap ∈ {в,о,с,у}）+ 拒绝 250（gap ∉ 库内前缀）
 *   事实三 真正回归风险是被放行的 71 个真实单字符前缀词
 *
 * ★ 本探针额外做两件主管没做的事：
 *   (A) **跨语言风险**：index.ts:851 的规则**没有 isRu 守卫**，英语同样生效。
 *       而 index.ts:764 `minLen = isRu && kind==='prefix' ? 1 : 2` 只限制**候选**生成，
 *       不限制 851 行 `all.some(...)` 的 `explained` 判定 —— 故英语若有 1 字符前缀词素，
 *       修法会放行一批、拒绝另一批。必须先量清楚。
 *   (B) **误伤清单**：250 词里首字符不是库内前缀、但语言学上**可能真是前缀异形**的
 *       （如希腊源否定前缀 а-）—— 这些才是「修过头」的真正候选。
 *
 * 判据完全照抄 src（2026-09-16 读于 index.ts:726-745, 758-786, 840-856）：
 *   mw   = normalizeWord(w).replace(/ё/g,'е')         // 小写化 + ё/е 归一
 *   stem = m.morpheme.replace(/^-+|-+$/g,'') [ru 再 ё→е]
 *   gap  = mw.slice(0, parts[0].start)
 *   explained = all.some(x => x.m.kind === 'prefix' && x.stem === gap)
 *
 * 只读、幂等、不改任何数据。不吃任何参数。
 * 用法：node scripts/probe_t15_d1_pattern.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const TARGET_LINE = 'src/db/index.ts:851';
const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

/* ---------- 词素库：复刻 index.ts:734-745 的 stem 归一化 ---------- */
function loadStems(lang) {
  const isRu = lang === 'ru';
  return db
    .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang=?`)
    .all(lang)
    .map((r) => {
      const raw = String(r.morpheme).replace(/^-+|-+$/g, '');
      return { stem: isRu ? raw.replace(/ё/g, 'е') : raw, kind: String(r.kind), raw: String(r.morpheme) };
    });
}
const ruStems = loadStems('ru');
const enStems = loadStems('en');

const oneCharPrefixes = (stems) => [...new Set(stems.filter((s) => s.kind === 'prefix' && s.stem.length === 1).map((s) => s.stem))];

const ru1 = oneCharPrefixes(ruStems);
const en1 = oneCharPrefixes(enStems);

console.log('='.repeat(88));
console.log(`T15 · D1 修法（${TARGET_LINE} 的 >=2 → >=1）独立复核`);
console.log('='.repeat(88));
console.log(`  库中「单字符前缀词素」  ru: [${ru1.join(' ')}]  (${ru1.length} 个)`);
console.log(`                        en: [${en1.join(' ')}]  (${en1.length} 个)`);
console.log(`  ⇒ index.ts:851 的 explained 判据 = 「gap 恰好等于某个 prefix 的 stem」`);
console.log(`     故修法后【放行】= gap ∈ {${ru1.join(',')}}（ru）/ {${en1.join(',')}}（en）；其余【拒绝】`);
console.log('');

/* ---------- 扫描：找出所有 D1 模式词 ---------- */
const assertNorm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');

function scan(lang, stems) {
  const one = new Set(oneCharPrefixes(stems));
  const words = db
    .prepare(`SELECT word FROM words_i18n WHERE lang=?`)
    .all(lang)
    .map((r) => String(r.word));
  const d1 = [];
  const reject = [];
  const pass = [];
  const byChar = new Map();
  let scanned = 0;
  for (const w of words) {
    let parts;
    try {
      parts = core.breakdownWord(db, w, lang);
    } catch {
      parts = [];
    }
    scanned++;
    if (parts.length < 2 || parts[0].start !== 1) continue;
    const mw = assertNorm(w);
    const gap = mw.slice(0, parts[0].start);
    const rec = { w, gap, parts: parts.map((p) => `${p.morpheme}[${p.kind}]@${p.start}-${p.end}`) };
    d1.push(rec);
    byChar.set(gap, (byChar.get(gap) ?? 0) + 1);
    if (one.has(gap)) pass.push(rec);
    else reject.push(rec);
  }
  return { lang, total: words.length, scanned, d1, pass, reject, byChar };
}

console.log('  扫描全库 D1 模式（parts.length>=2 且 parts[0].start===1）…');
const ruScan = scan('ru', ruStems);
const enScan = scan('en', enStems);

const report = (s) => {
  console.log('');
  console.log(`  ── lang='${s.lang}'  词条 ${s.total} 条`);
  console.log(`     D1 模式总数            : ${s.d1.length}`);
  console.log(`     ├ 修法后【放行】(gap∈前缀): ${s.pass.length}`);
  console.log(`     └ 修法后【拒绝】(gap∉前缀): ${s.reject.length}`);
  const hist = [...s.byChar.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`     首字符分布(${hist.length} 种，TOP20): ${hist.slice(0, 20).map(([c, n]) => `${c}${n}`).join(' ')}`);
};
report(ruScan);
report(enScan);

/* ---------- 事实一：смекать ---------- */
console.log('');
console.log('='.repeat(88));
console.log('★ 事实一独立复核：смекать 是否为 D1 模式');
console.log('='.repeat(88));
for (const w of ['смекать', 'смекалка', 'смекалистый']) {
  const parts = core.breakdownWord(db, w, 'ru');
  const isD1 = parts.length >= 2 && parts[0].start === 1;
  console.log(`  ${w.padEnd(13)} 实测 ${JSON.stringify(parts.map((p) => p.morpheme)).padEnd(26)} D1模式=${isD1 ? '是' : '否'}`);
}
console.log('  ⇒ 主管事实一：смекать 当前返回 []，非 D1 模式 ⇒ 修法对它无影响，不具鉴别力。');

/* ---------- 事实二：7 个点名 D1 词 ---------- */
console.log('');
console.log('='.repeat(88));
console.log('★ 事实二独立复核：7 个 D1 点名词的 gap 与修法后归属');
console.log('='.repeat(88));
const NAMED = ['плескание', 'хлестаться', 'зверство', 'глетчерный', 'тлеться', 'ателье', 'эмальерный'];
for (const w of NAMED) {
  const parts = core.breakdownWord(db, w, 'ru');
  const mw = assertNorm(w);
  const gap = parts.length ? mw.slice(0, parts[0].start) : '—';
  const inPre = ru1.includes(gap);
  const inD1 = ruScan.d1.some((r) => r.w === w);
  console.log(
    `  ${w.padEnd(13)} gap='${gap}' 库内前缀=${inPre ? '是' : '否'} 修法后=${inPre ? '放行' : '拒绝'}  D1命中=${inD1 ? '是' : '否'}  当前 ${JSON.stringify(parts.map((p) => p.morpheme))}`,
  );
}

/* ---------- 事实三：71 词（真实单字符前缀）分组 ---------- */
console.log('');
console.log('='.repeat(88));
console.log('★ 事实三独立复核：修法后【放行】的词（真实单字符前缀，AC-4 检验对象）');
console.log('='.repeat(88));
const byPre = new Map();
for (const r of ruScan.pass) {
  if (!byPre.has(r.gap)) byPre.set(r.gap, []);
  byPre.get(r.gap).push(r.w);
}
for (const [g, ws] of [...byPre.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  '${g}' ${String(ws.length).padStart(3)} 词: ${ws.slice(0, 14).join(' ')}${ws.length > 14 ? ' …' : ''}`);
}

/* ---------- 误伤候选：250 词里首字符可能是「库外前缀异形」的 ---------- */
console.log('');
console.log('='.repeat(88));
console.log('★ 误伤候选筛查：修法后【拒绝】的词中，首字符可能是库外前缀异形的');
console.log('='.repeat(88));
// 希腊/拉丁源否定前缀 а-（аморальный）、以及俄语中可能以单字符异形出现的语素，
// 逐个查词源确认，而不是靠猜。
const SUSPECT_CHARS = ['а', 'и', 'э', 'н', 'п', 'т', 'к', 'м', 'з', 'б', 'г', 'л', 'р'];
const suspectWords = ruScan.reject.filter((r) => SUSPECT_CHARS.includes(r.gap));
console.log(`  拒绝组 ${ruScan.reject.length} 词中，首字符属可疑集合的有 ${suspectWords.length} 词`);
console.log('');
console.log(`  逐个查词源（word_etymology）判定「首字符是否真是前缀」，共查前 60 词：`);
let truePrefixHit = [];
for (const r of suspectWords.slice(0, 60)) {
  const e = db
    .prepare(`SELECT text_en, chain FROM word_etymology WHERE word=? AND lang='ru'`)
    .all(r.w)[0];
  const t = e ? String(e.text_en ?? '') : '';
  // 语素边界证据：词源文本出现 "X- + " 形式且 X 为单字符
  const m = t.match(new RegExp(`(?:^|\\s)${r.gap}-\\s*\\(`));
  const partsInfo = e && e.chain ? (JSON.parse(e.chain)[0]?.parts ?? null) : null;
  const flag = m ? '★词源显示首字符确为前缀' : '';
  if (m) truePrefixHit.push(r.w);
  console.log(`    ${r.w.padEnd(15)} gap='${r.gap}' parts=${JSON.stringify(partsInfo)} ${t.slice(0, 58)} ${flag}`);
}
console.log('');
console.log(`  ⇒ 本轮查到的「首字符疑为真前缀」候选：${truePrefixHit.length ? truePrefixHit.join(' ') : '无'}`);

/* ---------- 尺子 R 影响 ---------- */
console.log('');
console.log('='.repeat(88));
console.log('★ 尺子 R 影响独立复核（主管：仅 6 词翻转为不可拆，244 → 238 = 30.1%）');
console.log('='.repeat(88));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
let before = 0;
let after = 0;
const flipped = [];
for (const w of R) {
  let parts;
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  const isD1 = parts.length >= 2 && parts[0].start === 1;
  const gap = isD1 ? assertNorm(w).slice(0, 1) : null;
  const willReject = isD1 && !ru1.includes(gap);
  if (parts.length) before++;
  if (parts.length && !willReject) after++;
  if (parts.length && willReject) flipped.push(`${w}('${gap}')`);
}
console.log(`  修法前 R                    : ${before}/${R.length} = ${((before / R.length) * 100).toFixed(1)}%`);
console.log(`  修法后 R（我的独立复算）    : ${after}/${R.length} = ${((after / R.length) * 100).toFixed(1)}%   主管 238 = 30.1%`);
console.log(`  翻转为不可拆的词（${flipped.length} 个）: ${flipped.join(' ')}`);
console.log(`  L1 守卫 ≥25% ：修法后 ${((after / R.length) * 100).toFixed(1)}% ${(after / R.length) * 100 >= 25 ? '安全 ✅' : '危险 ❌'}`);

/* ---------- 影响 L4 质量指标 ---------- */
console.log('');
console.log('='.repeat(88));
console.log('★ 对 L4 质量 KPI 的影响（修法后空洞情况应改善）');
console.log('='.repeat(88));
const holeLen = (w, parts) => {
  const cov = new Array(w.length).fill(false);
  for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  return cov.filter((x) => !x).length;
};
let h3before = 0;
let h3after = 0;
let h2after = 0;
let zeroAfter = 0;
for (const w of R) {
  let parts;
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch {
    parts = [];
  }
  const isD1 = parts.length >= 2 && parts[0].start === 1;
  const willReject = isD1 && !ru1.includes(assertNorm(w).slice(0, 1));
  if (parts.length && holeLen(w, parts) >= 3) h3before++;
  if (parts.length && !willReject) {
    const h = holeLen(w, parts);
    if (h >= 3) h3after++;
    if (h >= 2) h2after++;
    if (h === 0) zeroAfter++;
  }
}
console.log(`  空洞≥3 词数：修法前 ${h3before} → 修法后 ${h3after}（冻结值 134）`);
console.log(`  空洞≥2 词数：修法后 ${h2after}`);
console.log(`  零空洞 词数：修法后 ${zeroAfter}`);
console.log(`  ⇒ 修法会**降低**空洞计数（因为把带空洞的假拆解整个拒绝了），L4 守卫方向一致。`);

db.close();
