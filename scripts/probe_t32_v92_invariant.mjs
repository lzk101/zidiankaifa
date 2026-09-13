/**
 * probe_t32_v92_invariant.mjs —— 全库扫描：V9-2 假词根是否还有残留
 * 功能测试 agent · T32 · 只读
 * 目的：`уч-@1` / `дн-@1` 作为**首片段**的模式 = 字母巧合（*sučiti≠*učiti、单词素 однако），
 *       在 v0.9.0 后应当为 0。为 0 则固化为护栏；不为 0 则是我发现的残留缺陷，须报。
 * 附带：统计 `да-@1` 首片段数（已知 63，属登记不处理项），以及首片段位置分布。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = openDatabase(DB_PATH);

const t0 = Date.now();
const rows = db.prepare("SELECT word FROM words_i18n WHERE lang = 'ru'").all();
console.log(`全库 ru 词条 = ${rows.length}（读取耗时 ${Date.now() - t0} ms）`);

const byFirst = new Map(); // "morpheme@start" -> [words]
let decomposable = 0;

for (const { word } of rows) {
  const parts = breakdownWord(db, word, 'ru');
  if (!parts.length) continue;
  decomposable++;
  const f = parts[0];
  const key = `${f.morpheme}@${f.start}`;
  if (!byFirst.has(key)) byFirst.set(key, []);
  byFirst.get(key).push(word);
}

console.log(`可拆 = ${decomposable}（耗时 ${Date.now() - t0} ms 累计）`);

const pos1 = [...byFirst.entries()]
  .filter(([k]) => k.endsWith('@1'))
  .sort((a, b) => b[1].length - a[1].length);

console.log('\n=== 首片段 start === 1 的全部模式（= 词首 1 字符空洞）===');
for (const [k, ws] of pos1) {
  console.log(`  ${k.padEnd(10)} ${String(ws.length).padStart(4)} 词   ${ws.slice(0, 4).join(' ')}${ws.length > 4 ? ' …' : ''}`);
}

const uch = byFirst.get('уч-@1') ?? [];
const dn = byFirst.get('дн-@1') ?? [];
const da = byFirst.get('да-@1') ?? [];
console.log(`\n★ уч-@1 首片段 = ${uch.length} 词 ${JSON.stringify(uch)}`);
console.log(`★ дн-@1 首片段 = ${dn.length} 词 ${JSON.stringify(dn)}`);
console.log(`★ да-@1 首片段 = ${da.length} 词（T28/T29 口径 63，属登记不处理）`);

// 另查：全库任意位置出现 уч-/дн- 的（不限首片段），供对照
let anyUch = 0;
let anyDn = 0;
for (const { word } of rows) {
  const parts = breakdownWord(db, word, 'ru');
  if (parts.some((p) => p.morpheme === 'уч-')) anyUch++;
  if (parts.some((p) => p.morpheme === 'дн-')) anyDn++;
}
console.log(`\n参考：全库任一位置含 уч- 的词 = ${anyUch}；含 дн- 的词 = ${anyDn}`);
console.log(`总耗时 ${Date.now() - t0} ms`);
