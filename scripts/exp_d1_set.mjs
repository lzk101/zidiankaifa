/**
 * T12 辅助探针：定位测试 agent 所说的「全库 321 词 D1 模式」的确切定义
 * 并核验 смекать / ателье 在尺子 R 中的归属与修法前后状态。只读。
 *
 * 用法：node scripts/exp_d1_set.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db');
const RU = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const R = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`)
  .all()
  .map((r) => String(r.word));
const RS = new Set(R);

const bd = (w) => core.breakdownWord(db, w, 'ru');

/* 候选定义：全库中「官方拆解首片段 start===1」的词的几种口径 */
const defs = {
  'start===1（全部）': (w, p) => p.length && p[0].start === 1,
  'start===1 且 片段数>=2': (w, p) => p.length >= 2 && p[0].start === 1,
  'start===1 且 长度4-12': (w, p) => p.length && p[0].start === 1 && w.length >= 4 && w.length <= 12,
  'start===1 且 片段数>=2 且 长度4-12': (w, p) => p.length >= 2 && p[0].start === 1 && w.length >= 4 && w.length <= 12,
  'start===1 且 空洞>=1': (w, p) => p.length && p[0].start === 1,
};
console.log('【D1 集合定义探测】目标：找到 = 321 的定义');
const sets = {};
for (const [name, f] of Object.entries(defs)) {
  const s = RU.filter((w) => f(w, bd(w)));
  sets[name] = new Set(s);
  console.log(`  ${name.padEnd(34)}: ${String(s.length).padStart(4)} 词  ${s.length === 321 ? '← ✔ 命中 321' : ''}`);
}

/* 关键样本核验 */
console.log('\n【关键样本】');
const probes = ['смекать', 'ателье', 'плескание', 'хлестаться', 'зверство', 'тлеться', 'глетчерный', 'эмальерный', 'удачный'];
for (const w of probes) {
  const p = bd(w);
  const inR = RS.has(w);
  const inD1 = [...Object.entries(sets)].filter(([, s]) => s.has(w)).map(([n]) => n);
  console.log(
    `  ${w.padEnd(12)} 在R=${inR ? 'Y' : 'n'}  拆解=${p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join('+')}}` : '—不可拆'}  D1集归属=${inD1.length ? inD1.map((n) => n.split(' ')[0]).join(',') : '无'}`,
  );
}
const inRProbes = probes.filter((w) => RS.has(w));
console.log(`  ⇒ 上述探针中落在尺子 R 里的: ${inRProbes.join(' ') || '（无）'}`);

/* 321 集（若已命中）里 gap 字符分布 */
const target = sets['start===1 且 片段数>=2'];
if (target) {
  const gapChars = {};
  for (const w of target) { const p = bd(w); gapChars[w[0]] = (gapChars[w[0]] ?? 0) + 1; }
  console.log(`\n【start===1 且 片段数>=2 集】词首字符分布: ${Object.entries(gapChars).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' ')}`);
  const single = new Set(['в', 'о', 'с', 'у']);
  const bySingle = [...target].filter((w) => single.has(w[0]));
  console.log(`  首字符恰好是库内单字符前缀 в/о/с/у 的: ${bySingle.length} 词（这些是「真前缀组」候补）`);
  console.log(`  其余（首字符非前缀 ⇒ 必然是被消除的假词根）: ${target.size - bySingle.length} 词`);
}
db.close();
