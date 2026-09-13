/**
 * 只读探针（功能测试 agent · T15）：D6 —— 修法「字母级」判定的残余漏洞量化。
 *
 * 修法把 `explained` 定义为「gap 恰好等于某个前缀的 stem」，即**只看单个字母**是否是前缀。
 * 于是任何以 в/о/с/у 开头的词，哪怕该字母其实是词根首字母，也照样放行。
 * 本探针用**词源反证**把这些漏网词挑出来（不是靠猜）。
 *
 * 只读、幂等。用法：node scripts/probe_t15_d6_residual.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const bd = (w) => breakdownWord(db, w, 'ru');
const RU1 = new Set(['в', 'о', 'с', 'у']);

const words = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

const pass = [];
for (const w of words) {
  let p;
  try {
    p = bd(w);
  } catch {
    p = [];
  }
  if (p.length >= 2 && p[0].start === 1 && RU1.has(String(w)[0])) pass.push({ w, p });
}
console.log(`放行组（首字符∈{в,о,с,у} 且 start===1）：${pass.length} 词`);
console.log('');

/* ---- 漏网族 1：суч- 词根（сучить/сучок，源自 *sučiti / сук「节、枝」），被拆成 с 跳过 + уч-（教/学） ---- */
console.log('── 漏网族 A：суч- 词根被拆成「跳过 с + уч-（教/学，假词根）」');
const suchFamily = pass.filter((x) => String(x.w).startsWith('суч') && x.p.some((q) => q.morpheme === 'уч-'));
const suchAll = words.filter((w) => String(w).startsWith('суч'));
console.log(`   含 'уч-' 假词根的 суч- 词：${suchFamily.length} / 全库 суч- 开头 ${suchAll.length} 词`);
for (const x of suchFamily) console.log(`     ${x.w.padEnd(18)} ${JSON.stringify(x.p.map((q) => `${q.morpheme}@${q.start}-${q.end}`))}`);
const ev = db.prepare(`SELECT word, text_en FROM word_etymology WHERE lang='ru' AND word LIKE 'сучит%'`).all();
for (const e of ev) console.log(`     词源 ${String(e.word)}: ${String(e.text_en).slice(0, 96)}`);
console.log('   ⇒ суч- 是词根（*sučiti），с 属词根；输出却把 с 当空洞、拿 уч-（教/学）当词根 —— 与 D1 同类用户可见错误。');

/* ---- 漏网族 2：однако（连词），被拆成 跳过 о + дн-（день「日」假词根） ---- */
console.log('');
console.log('── 漏网族 B：однако（连词）被拆成「跳过 о + дн-（день「日」，假词根）」');
console.log(`   однако 实测 = ${JSON.stringify(bd('однако').map((q) => `${q.morpheme}@${q.start}-${q.end}`))}`);
const dnk = pass.filter((x) => x.p.some((q) => q.morpheme === 'дн-'));
console.log(`   放行组中含 'дн-' 片段的词：${dnk.length} → ${dnk.map((x) => x.w).join(' ')}`);

/* ---- 全局量化：放行组里首片段「短于 4 字符且是常见假词根」的词 ---- */
console.log('');
console.log('── 全局量化：放行组 75 词的首片段分布');
const first = new Map();
for (const x of pass) first.set(x.p[0].morpheme, (first.get(x.p[0].morpheme) ?? 0) + 1);
const sorted = [...first.entries()].sort((a, b) => b[1] - a[1]);
console.log(`   ${sorted.map(([m, n]) => `${m}×${n}`).join('  ')}`);
console.log('   ⇒ 首片段高度集中在 да-（与 дать「给」同形）：这些词的真词根多为 дар-/дал-/дав- 等，');
console.log('     逐个是否成立需查词源，本次仅锁定有**硬词源反证**的两族（A/B）作为断言对象。');

/* ---- 残余漏洞规模与影响 ---- */
console.log('');
console.log('── 规模小结');
console.log(`   放行组 75 词（修法放行）· 其中词源可证为「假词根」的已锁定 ${suchFamily.length + dnk.length} 词`);
console.log('   修法**未**扩大此漏洞：比特级差分（probe_t15_bitdiff.mjs）显示放行组输出 0 改动，');
console.log('   即这批漏网词在修法前后完全一致 —— 属**既有**缺陷（D1 的近亲），非修法引入。');

db.close();
