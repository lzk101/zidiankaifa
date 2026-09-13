/**
 * 只读探针（功能测试 agent · T15）：修法后
 *   §A 放行组 75 词全量体检：首字符**真的是**该词的前缀吗？（找出「因首字母恰好是 в/о/с/у 而漏网」的）
 *   §B 误伤清单：修法后变 [] 的词里，是否有「本应可拆」的（假阴性）
 *
 * 误伤重建法（无需旧代码）：D1 词的 parts 全部落在 [1,n)，故修法前 parts ≡ breakdownWord(w.slice(1)) 平移 1。
 * 只读、幂等。用法：node scripts/probe_t15_leak_and_harm.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const bd = (w, lang = 'ru') => core.breakdownWord(db, w, lang);
const RU1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');

const words = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

/* ---------- §A 放行组全量体检 ---------- */
console.log('='.repeat(94));
console.log('§A 放行组全量体检：首字符真的是前缀吗？（修法只做「字母级」判定，非「词素级」）');
console.log('='.repeat(94));

const pass = [];
for (const w of words) {
  let p;
  try {
    p = bd(w);
  } catch {
    p = [];
  }
  if (p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0])) pass.push({ w, p });
}
console.log(`  修法后仍为 D1 形态（start===1 且首字符∈в/о/с/у）的词：${pass.length}`);

const leaks = [];
for (const { w, p } of pass) {
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(w)[0];
  const t = e ? String(e.text_en) : '';
  const c = norm(w)[0];
  // 「真前缀」证据：词源文本出现 `c- (c-) +` 形式，或 "surface analysis, c-"
  const realPrefix = new RegExp(`(?:^|[\\s,(])${c}-\\s*\\(|surface analysis,\\s*${c}-`, 'i').test(t);
  // 「首字母属于词根」证据：Proto-Slavic / 拉丁 / 希腊借词，且无前缀记号
  const inherited = /Inherited from Proto-Slavic|From Proto-Slavic|Borrowed from|From Latin|Ancient Greek/i.test(t);
  if (!realPrefix && (inherited || !t)) leaks.push({ w, p: p.map((x) => `${x.morpheme}@${x.start}`), t: t.slice(0, 72) || '(无词源)' });
}
console.log('');
console.log(`  ★ 疑似「首字符实为词根首字母、却被当作前缀字母放行」的：${leaks.length} 词`);
for (const l of leaks) console.log(`    ${l.w.padEnd(16)} ${JSON.stringify(l.p).padEnd(44)} ${l.t}`);
console.log('');
console.log('  放行组里**有**明确前缀证据的（抽样）：');
let withEvidence = 0;
for (const { w } of pass) {
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(w)[0];
  const t = e ? String(e.text_en) : '';
  const c = norm(w)[0];
  if (new RegExp(`(?:^|[\\s,(])${c}-\\s*\\(|surface analysis,\\s*${c}-`, 'i').test(t)) {
    withEvidence++;
    if (withEvidence <= 8) console.log(`    ${w.padEnd(16)} ${t.slice(0, 78)}`);
  }
}
console.log(`    …共 ${withEvidence}/${pass.length} 词有明确前缀证据`);

/* ---------- §B 误伤清单 ---------- */
console.log('');
console.log('='.repeat(94));
console.log('§B 误伤清单（假阴性）：修法后变 [] 但「本应可拆」的词');
console.log('='.repeat(94));

// 重建修法前形态：仅对现在为 [] 的词，取其尾部子串做拆解
const harmed = [];
let checked = 0;
for (const w of words) {
  let p;
  try {
    p = bd(w);
  } catch {
    p = [];
  }
  if (p.length) continue;
  const mw = norm(w);
  if (mw.length < 4) continue;
  const head = mw[0];
  const tail = mw.slice(1);
  let tp;
  try {
    tp = bd(tail);
  } catch {
    tp = [];
  }
  if (!tp.length) continue; // 尾部拆不开 ⇒ 修法前也不是 D1
  checked++;
  // 修法前覆盖率 = 尾部覆盖字符数 / 全词长度
  const cov = tp.reduce((s, x) => s + (x.end - x.start), 0);
  if (cov / mw.length < 0.55) continue; // 修法前也过不了阈值
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(w)[0];
  const t = e ? String(e.text_en) : '';
  // 假阴性判据：词源明示首字符是前缀（`head- (head-) +`）
  const realPrefix = new RegExp(`(?:^|[\\s,(])${head}-\\s*\\(|surface analysis,\\s*${head}-`, 'i').test(t);
  if (realPrefix) harmed.push({ w, head, tail, tailParts: tp.map((x) => x.morpheme), t: t.slice(0, 90) });
}
console.log(`  重建检查：${checked} 个现为 [] 的词其尾部可拆（≈修法前的 D1 候选）`);
console.log(`  ★ 其中词源明示「首字符确为前缀」= 真误伤：${harmed.length} 词`);
for (const h of harmed) {
  console.log(`    ${h.w.padEnd(16)} gap='${h.head}' 尾部 '${h.tail}' 可拆为 ${JSON.stringify(h.tailParts)}`);
  console.log(`       词源: ${h.t}`);
}
console.log('');
console.log('  ── 希腊源否定前缀 а- 专项（аполитизм/аполярный/атравматический 类）：');
for (const w of ['аполитизм', 'аполярный', 'аполярность', 'атравматический', 'аметропия', 'анестезия']) {
  const tail = norm(w).slice(1);
  const tp = bd(tail);
  const nowP = bd(w);
  console.log(
    `    ${w.padEnd(18)} 修法后=${nowP.length ? JSON.stringify(nowP.map((x) => x.morpheme)) : '[]'}  尾部'${tail}'拆解=${tp.length ? JSON.stringify(tp.map((x) => x.morpheme)) : '[]'}`,
  );
}
console.log('  ⇒ а- 是希腊源否定前缀（合法语素）但**不在库内**（库内单字符前缀只有 в/о/с/у）:');
console.log('    修法前它们的拆解是「跳过 а、拿后文巧合命中」（如 аполярный → пол-「半」）——本身即误拆；');
console.log('    修法后归零。故属「错误拆解被移除」，**不是**正确拆解被误杀；但也**没有**得到正确拆解。');

db.close();
