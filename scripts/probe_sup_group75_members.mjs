// 主管独立校验：75 词真前缀组的首片段分布（我方此前记为 да-×63 / уч-×11 / дн-×1）
// 只读。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'data', 'db', 'dict.db'));
const ru = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));

const tally = {};
const members = {};
let n = 0;
for (const w of ru) {
  const parts = breakdownWord(db, w, 'ru');
  if (!parts.length) continue;
  if (parts[0].start !== 1) continue;
  const gap = w.replace(/\u0451/g, '\u0435').slice(0, 1);
  if (!'вос у'.replace(' ', '').includes(gap)) continue;
  n++;
  const first = parts[0].morpheme;
  tally[first] = (tally[first] ?? 0) + 1;
  (members[first] ??= []).push(w);
}

console.log(`=== 75 词真前缀组：首片段分布（实测 n=${n}）===`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(8)} × ${String(v).padStart(2)}   ${members[k].slice(0, 6).join(' ')}${v > 6 ? ' …' : ''}`);
}
console.log('');
console.log('  主管此前记：да-×63 / уч-×11 / дн-×1 = 75');
const da = tally['да-'] ?? 0, uc = tally['уч-'] ?? 0, dn = tally['дн-'] ?? 0;
console.log(`  实测：      да-×${da} / уч-×${uc} / дн-×${dn} = ${da + uc + dn}  ${da === 63 && uc === 11 && dn === 1 ? '✅ 吻合' : '⚠ 不符'}`);
console.log('');
console.log('=== уч- 全族明细（应恰为 V9-2 的 11 词）===');
for (const w of members['уч-'] ?? []) console.log(`  ${w}`);
console.log('=== дн- 全族明细（应恰为 однако）===');
for (const w of members['дн-'] ?? []) console.log(`  ${w}`);
db.close();
