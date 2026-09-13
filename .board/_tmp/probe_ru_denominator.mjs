/**
 * 探针 9：尺子 R（related.mjs:144，791 词）分母的成分污染量化
 * 主管 BASELINE.md §5.2 指出 words_i18n 含「纯词缀条目」与「专名」——量化其对 45% 的影响
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../../packages/core/dist/db/index.js';

const db = new DatabaseSync('D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db', { readOnly: true });
const cdb = core.openDatabase('D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db');
const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%';

const words = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0").all().map((r) => String(r.word));
const total = words.length;

function rateOf(list) {
  let hit = 0;
  for (const w of list) if (core.breakdownWord(cdb, w, 'ru').length) hit++;
  return { n: list.length, hit, pct: list.length ? hit / list.length : 0 };
}

const isAffix = (w) => w.startsWith('-') || w.endsWith('-');
const isProper = (w) => /^[А-ЯЁ]/.test(w.trim());

const affix = words.filter(isAffix);
const proper = words.filter((w) => !isAffix(w) && isProper(w));
const plain = words.filter((w) => !isAffix(w) && !isProper(w));

console.log('== 尺子 R 分母成分（791 词）==');
const rAll = rateOf(words), rAff = rateOf(affix), rPro = rateOf(proper), rPla = rateOf(plain);
console.log(`全部        : ${rAll.n} 词，命中 ${rAll.hit} → ${pct(rAll.hit, rAll.n)}`);
console.log(`纯词缀条目  : ${rAff.n} 词（${pct(rAff.n, total)}），命中 ${rAff.hit} → ${pct(rAff.hit, rAff.n)}   例: ${affix.slice(0, 12).join(' ')}`);
console.log(`专名(首大写): ${rPro.n} 词（${pct(rPro.n, total)}），命中 ${rPro.hit} → ${pct(rPro.hit, rPro.n)}   例: ${proper.slice(0, 12).join(' ')}`);
console.log(`普通词      : ${rPla.n} 词（${pct(rPla.n, total)}），命中 ${rPla.hit} → ${pct(rPla.hit, rPla.n)}`);

/* 若把「纯词缀条目」与「专名」排除出分母，覆盖率会变成多少 */
console.log('\n== 分母治理情景（改分母＝改尺子，须用户拍板）==');
const s1 = rateOf(plain.concat(proper));
console.log(`剔除纯词缀条目后（${s1.n} 词）        : ${pct(s1.hit, s1.n)}`);
console.log(`再剔除专名后（${rPla.n} 词）          : ${pct(rPla.hit, rPla.n)}`);
console.log(`剔除纯词缀条目所增百分点 = ${((rAll.hit / (total - rAff.n) - rAll.hit / total) * 100).toFixed(1)}pp`);
console.log(`口径复原（不剔任何词）            : ${pct(rAll.hit, rAll.n)}  ← 现行尺子 R`);

/* 全量核对：纯词缀条目与专名在 101,512 中的规模 */
const allRu = db.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => String(r.word));
const allAff = allRu.filter((w) => w.startsWith('-') || w.endsWith('-'));
const allPro = allRu.filter((w) => !w.startsWith('-') && /^[А-ЯЁ]/.test(w.trim()));
console.log('\n== 全量规模（101,512）==');
console.log(`纯词缀条目 = ${allAff.length}（${pct(allAff.length, allRu.length)}）`);
console.log(`首字母大写 = ${allPro.length}（${pct(allPro.length, allRu.length)}）`);
console.log(`旧正字法形（含 ъ/ѣ/і） = ${allRu.filter((w) => /[ъѣіѳ]/.test(w)).length}`);
db.close();
