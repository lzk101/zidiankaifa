// 主管独立判别：H-c（词源链核证）能否覆盖 V9-2 的 12 词，以及 75 词真前缀组
// 只读。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'data', 'db', 'dict.db'));

// V9-2 点名的 12 词
const V92 = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый',
  'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный', 'однако'];

function etym(w) {
  return db.prepare('SELECT chain, text_en, origin FROM word_etymology WHERE word = ? AND lang = ?').all(w, 'ru');
}

/** 从 chain 抽出「词首片段」形式的前缀候选：parts 里的第一项若以连字符结尾 */
function prefixFromChain(rows) {
  for (const r of rows) {
    if (!r.chain) continue;
    let ch;
    try { ch = JSON.parse(String(r.chain)); } catch { continue; }
    if (!Array.isArray(ch)) continue;
    for (const e of ch) {
      if (e && Array.isArray(e.parts) && e.parts.length) {
        const first = String(e.parts[0]).trim();
        if (/-$/.test(first)) return first.replace(/-+$/, '');
      }
    }
  }
  return null;
}

console.log('=== A. V9-2 的 12 词：词源行覆盖 ===');
let withRows = 0;
for (const w of V92) {
  const rows = etym(w);
  const pref = prefixFromChain(rows);
  const parts = breakdownWord(db, w, 'ru').map((p) => p.morpheme);
  if (rows.length) withRows++;
  console.log(`  ${w.padEnd(15)} 词源行=${rows.length}  chain 首前缀=${pref ?? '(无)'}   引擎=${JSON.stringify(parts)}`);
}
console.log(`  → 有词源行 ${withRows}/${V92.length}，**无词源行 ${V92.length - withRows}/${V92.length}**`);

console.log('');
console.log('=== B. 全库 75 词真前缀组（gap=1 且 gap ∈ {в,о,с,у}）的词源覆盖 ===');
const ruWords = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
const group = [];
for (const w of ruWords) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  if (parts[0].start !== 1) continue;
  const gap = w.replace(/\u0451/g, '\u0435').slice(0, 1);
  if (!'вос у'.replace(' ', '').includes(gap)) continue;
  group.push([w, gap, parts.map((p) => p.morpheme).join('+')]);
}
console.log(`  实测组内词数 = ${group.length}（T18 冻结口径 75）`);

// 只抽样统计（全库 75 词，量小，全量查）
let gWithRows = 0, gHasPrefix = 0, gHasInhNoParts = 0, gUnknown = 0;
const byPrefix = {};
for (const [w, gap, dec] of group) {
  const rows = etym(w);
  byPrefix[gap] = (byPrefix[gap] ?? 0) + 1;
  if (!rows.length) { gUnknown++; continue; }
  gWithRows++;
  const pref = prefixFromChain(rows);
  if (pref) gHasPrefix++;
  else {
    let anyInh = false;
    for (const r of rows) {
      if (!r.chain) continue;
      try {
        const ch = JSON.parse(String(r.chain));
        if (Array.isArray(ch) && ch.some((e) => e && e.kind === 'inh')) anyInh = true;
      } catch { /* ignore */ }
    }
    if (anyInh) gHasInhNoParts++;
  }
}
console.log(`  按首字符分布：${JSON.stringify(byPrefix)}`);
console.log(`  有词源行            = ${gWithRows}/${group.length}`);
console.log(`  其中 chain 给出前缀  = ${gHasPrefix}`);
console.log(`  chain 仅 inh 无 parts = ${gHasInhNoParts}`);
console.log(`  **无任何词源行**      = ${gUnknown}/${group.length}  ← H-c 无法判定`);

console.log('');
console.log('=== C. 逐词明细（全 75 词，供人工核对）===');
for (const [w, gap, dec] of group) {
  const rows = etym(w);
  const pref = prefixFromChain(rows);
  console.log(`  ${w.padEnd(20)} gap=${gap}  词源行=${rows.length}  chain前缀=${pref ?? '-'}  ${dec}`);
}
db.close();
