/**
 * 需求管理 agent 一次性探针：核实 A2 的两把尺子口径 + 天花板量化
 * 只读 data/db/dict.db。用毕可删。
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../../packages/core/dist/db/index.js';

const DB_PATH = 'D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db';
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const cdb = core.openDatabase(DB_PATH);

const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%';

/* ---------- 0. 基数 ---------- */
const totalRu = db.prepare("SELECT COUNT(1) c FROM words_i18n WHERE lang='ru'").get().c;
const etymRu = db
  .prepare("SELECT COUNT(1) c FROM words_i18n w WHERE w.lang='ru' AND EXISTS(SELECT 1 FROM word_etymology e WHERE e.word=w.word AND e.lang='ru')")
  .get().c;
const mor = db.prepare("SELECT kind, COUNT(1) c FROM morphemes WHERE lang='ru' GROUP BY kind").all();
console.log('== 0. 基数 ==');
console.log('俄语主词条 words_i18n(ru) =', totalRu);
console.log('其中有俄语词源的 =', etymRu, pct(etymRu, totalRu));
console.log('俄语词素 morphemes(ru) =', JSON.stringify(mor));

/* ---------- 1. 尺子 A：related.mjs §E 原样复刻 ---------- */
const rowsA = db
  .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0")
  .all().map((r) => String(r.word));
let hitA = 0;
for (const w of rowsA) if (core.breakdownWord(cdb, w, 'ru').length) hitA++;
console.log('\n== 1. 尺子 A（core/test/related.mjs:144 原样复刻）==');
console.log('分母（length 4-12 且 rowid%97==0）=', rowsA.length);
console.log('命中 =', hitA, '→', pct(hitA, rowsA.length));

/* ---------- 2. 尺子 B：measure_ru_breakdown.mjs 原样复刻 ---------- */
const pool = db
  .prepare("SELECT w.word AS word FROM words_i18n w WHERE w.lang='ru' AND EXISTS (SELECT 1 FROM word_etymology e WHERE e.word=w.word AND e.lang='ru')")
  .all().map((r) => String(r.word));
let seed = 20260913;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const p2 = pool.slice();
for (let i = p2.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [p2[i], p2[j]] = [p2[j], p2[i]];
}
const sampleB = p2.slice(0, 800);
let hitB = 0;
for (const w of sampleB) if (core.breakdownWord(cdb, w, 'ru').length) hitB++;
console.log('\n== 2. 尺子 B（measure_ru_breakdown.mjs 原样复刻，seed 20260913, N=800）==');
console.log('分母（有词源的俄语词）=', pool.length);
console.log('命中 =', hitB, '→', pct(hitB, sampleB.length));

/* ---------- 3. 尺子 C（参考）：全俄语词条 rowid%97==0，无长度过滤 ---------- */
const rowsC = db
  .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND rowid % 97 = 0")
  .all().map((r) => String(r.word));
let hitC = 0;
for (const w of rowsC) if (core.breakdownWord(cdb, w, 'ru').length) hitC++;
console.log('\n== 3. 尺子 C（参考：全俄语词条 rowid%97==0，无长度过滤）==');
console.log('分母 =', rowsC.length, '命中 =', hitC, '→', pct(hitC, rowsC.length));

/* ---------- 4. 词长分布：长度过滤把谁排除掉了 ---------- */
const buckets = { '2-3': 0, '4-12': 0, '13+': 0 };
for (const r of db.prepare("SELECT length(word) L FROM words_i18n WHERE lang='ru'").all()) {
  const L = r.L;
  if (L <= 3) buckets['2-3']++;
  else if (L <= 12) buckets['4-12']++;
  else buckets['13+']++;
}
console.log('\n== 4. 俄语词条词长分布 ==', JSON.stringify(buckets), '（尺子 A 只看 4-12）');

/* ---------- 5. 天花板量化：当前 441 词素库的理论上界 ---------- */
const ms = db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru'").all();
const entries = [];
for (const m of ms) {
  const raw = String(m.morpheme).replace(/^-+|-+$/g, '');
  const stem = raw.replace(/ё/g, 'е');
  const pats = [stem];
  if (m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
    const c = stem.slice(0, -1);
    if (c.length >= 3) pats.push(c);
  }
  entries.push({ kind: m.kind, pats });
}
/** 宽松上界：词内存在任一可放置的词素（忽略 55% 阈值与全部间隙规则） */
function anyMatch(w) {
  const mw = w.replace(/ё/g, 'е');
  for (const e of entries) {
    for (const pat of e.pats) {
      const minLen = e.kind === 'prefix' ? 1 : 2;
      if (pat.length < minLen) continue;
      if (e.kind === 'prefix') {
        if (mw.startsWith(pat)) return true;
      } else if (mw.includes(pat)) return true;
    }
  }
  return false;
}
/** 近似上界：不重叠贪心最长切分后覆盖 ≥55%（比 DP 保守，作为「规则完美时」的代理） */
function greedy55(w) {
  const mw = w.replace(/ё/g, 'е');
  const n = mw.length;
  let i = 0;
  let cov = 0;
  while (i < n) {
    let best = 0;
    for (const e of entries) {
      for (const pat of e.pats) {
        const minLen = e.kind === 'prefix' ? 1 : 2;
        if (pat.length < minLen || pat.length <= best) continue;
        if (!mw.startsWith(pat, i)) continue;
        if (e.kind === 'prefix' && i !== 0) continue;
        best = pat.length;
      }
    }
    if (best) { cov += best; i += best; } else i += 1;
  }
  return cov / n >= 0.55;
}
let ubAny = 0;
let ubGreedy = 0;
for (const w of rowsA) {
  if (anyMatch(w)) ubAny++;
  if (greedy55(w)) ubGreedy++;
}
console.log('\n== 5. 天花板（样本同尺子 A，' + rowsA.length + ' 词）==');
console.log('当前命中 =', hitA, pct(hitA, rowsA.length));
console.log('宽松上界（词内有任一词素即可，忽略阈值/间隙规则）=', ubAny, pct(ubAny, rowsA.length));
console.log('近似上界（不重叠贪心覆盖≥55%）=', ubGreedy, pct(ubGreedy, rowsA.length));

/* ---------- 6. 未命中词的样例（看 A6 单词根现象占比） ---------- */
const missA = [];
for (const w of rowsA) if (!core.breakdownWord(cdb, w, 'ru').length) missA.push(w);
const missNoMor = missA.filter((w) => !anyMatch(w));
console.log('\n== 6. 尺子 A 未命中 ' + missA.length + ' 词 ==');
console.log('其中「词内不存在任何已知词素」（无法靠调算法改善，只能加库）=', missNoMor.length, pct(missNoMor.length, rowsA.length));
console.log('样例(前 40):', missNoMor.slice(0, 40).join(' '));
console.log('样例(未命中全部 前 40):', missA.slice(0, 40).join(' '));

/* ---------- 7. A6 点名词是否真的拆不出 ---------- */
console.log('\n== 7. A6 点名词实测 ==');
for (const w of ['луна', 'небо', 'река', 'гора', 'тоска', 'стол', 'садовник', 'рассказать', 'путешествие']) {
  const parts = core.breakdownWord(cdb, w, 'ru').map((p) => p.morpheme);
  console.log(`  ${w}: ${parts.length ? parts.join(' + ') : '（无拆解）'}  词素可及=${anyMatch(w)}`);
}

/* ---------- 8. roots_ru.json 条数 vs 库内一致 ---------- */
db.close();
console.log('\n== 8. done ==');
