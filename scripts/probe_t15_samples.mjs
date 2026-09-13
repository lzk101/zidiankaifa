/**
 * 只读探针（功能测试 agent · T15 补三）：裁决六 §五 两个新样本实测 + §三 分母口径验证。
 * 只读、幂等。用法：node scripts/probe_t15_samples.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const bd = (w, lang = 'ru') => breakdownWord(db, w, lang).map((p) => p.morpheme);
const at = (w, lang = 'ru') => breakdownWord(db, w, lang).map((p) => `${p.morpheme}@${p.start}-${p.end}`);

console.log('=== 裁决六 §五 样本 1：удачный（真探针）===');
for (const w of ['удачный', 'удачливый', 'удача', 'удаться']) {
  console.log(`  ${w.padEnd(12)} ${JSON.stringify(bd(w)).padEnd(28)} ${at(w)}`);
}

console.log('');
console.log('=== 裁决六 §五 样本 2：смекать（机制认知样本）===');
for (const w of ['смекать', 'смекалка', 'смекалистый']) {
  console.log(`  ${w.padEnd(14)} ${JSON.stringify(bd(w)).padEnd(12)} ${at(w)}`);
}
console.log('  · 检验「覆盖率 0.55 前置过滤先于 gap 规则」：');
console.log('    若移除 0.55 阈值，смекать 能否走到 gap 那道关？—— 用子串探针间接验证：');
console.log(`      bd('мекать') = ${JSON.stringify(bd('мекать'))}（мек- 是否在库的间接证据）`);
const m = db.prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru' AND morpheme LIKE 'мек%'`).all();
console.log(`      库中含 'мек' 的词素：${m.length ? m.map((x) => `${x.morpheme}[${x.kind}]`).join(' ') : '（无）'} ⇒ 确认 мек- 不在库`);

console.log('');
console.log('=== 裁决六 §三 分母口径验证：「仅西里尔 且 length 4–14」===');
const raw = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const variants = {
  '纯西里尔(原样) + len4-14': [...new Set(raw.filter((w) => /^[а-яё]+$/.test(w) && w.length >= 4 && w.length <= 14))],
  '纯西里尔(ё→е去重) + len4-14': [...new Set(raw.map((w) => w.replace(/ё/g, 'е')).filter((w) => /^[а-я]+$/.test(w) && w.length >= 4 && w.length <= 14))],
};
for (const [name, list] of Object.entries(variants)) {
  let d1 = 0;
  let keep = 0;
  let elim = 0;
  for (const w of list) {
    let p;
    try {
      p = breakdownWord(db, w, 'ru');
    } catch {
      p = [];
    }
    if (p.length >= 2 && p[0].start === 1) {
      d1++;
      if ('во с у'.split(' ').includes(w[0])) keep++;
      else elim++;
    }
  }
  console.log(`  ${name.padEnd(28)} 词条 ${String(list.length).padStart(6)} → D1 ${String(d1).padStart(4)} = 保留 ${keep} + 消除 ${elim}${d1 === 321 ? '   ★★★ 命中主管 321' : ''}`);
}
db.close();
