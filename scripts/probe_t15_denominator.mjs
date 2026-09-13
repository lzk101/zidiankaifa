/**
 * 只读探针（功能测试 agent · T15 补）：主管分母 86,697 的取数假设检验。
 * 假设：主管管线做了「ё→е 归一 + 去尾部去重编号 + 去复合连字符」后去重。
 * 只读、幂等。用法：node scripts/probe_t15_denominator.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const TARGET = 86697;
const words = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
console.log(`原始 lang='ru' 词条数 = ${words.length}（主管分母 ${TARGET}，差 ${words.length - TARGET}）`);
console.log('');

const variants = {
  '原样去重': (w) => w,
  'ё→е': (w) => w.replace(/ё/g, 'е'),
  'ё→е + 小写': (w) => w.replace(/ё/g, 'е').toLowerCase(),
  'ё→е + 去尾数字': (w) => w.replace(/ё/g, 'е').replace(/\d+$/, ''),
  'ё→е + 去尾数字 + 去连字符段': (w) => w.replace(/ё/g, 'е').replace(/\d+$/, '').replace(/-.*$/, ''),
  'ё→е + 去连字符段': (w) => w.replace(/ё/g, 'е').replace(/-.*$/, ''),
  'ё→е + 仅西里尔': (w) => (w.replace(/ё/g, 'е').match(/^[а-я]+$/) ? w.replace(/ё/g, 'е') : null),
  'ё→е + 仅西里尔 + 非空': (w) => {
    const n = w.replace(/ё/g, 'е');
    return /^[а-я]+$/.test(n) ? n : null;
  },
  '去尾数字': (w) => w.replace(/\d+$/, ''),
};
for (const [name, fn] of Object.entries(variants)) {
  const s = new Set();
  for (const w of words) {
    const v = fn(w);
    if (v === null) continue;
    s.add(v);
  }
  const n = s.size;
  const mark = n === TARGET ? '   ★★★ 命中主管分母 86,697' : '';
  console.log(`  ${name.padEnd(30)} = ${String(n).padStart(7)}${mark}`);
}

// 顺带：这些变体下 у 组会变成多少词（主管记 32，我记 36）
const RU1 = ['в', 'о', 'с', 'у'];
const { breakdownWord } = await import('../packages/core/dist/db/index.js');
const passU = [];
for (const w of words) {
  let p;
  try {
    p = breakdownWord(db, w, 'ru');
  } catch {
    p = [];
  }
  if (p.length >= 2 && p[0].start === 1 && w[0] === 'у') passU.push(w);
}
console.log('');
console.log(`  у 组（start===1）原始 = ${passU.length} 词（主管记 32）`);
for (const [name, fn] of Object.entries(variants)) {
  const s = new Set(passU.map(fn).filter((x) => x !== null));
  const mark = s.size === 32 ? '   ★★★ 命中主管 у32' : '';
  console.log(`    ${name.padEnd(30)} = ${String(s.size).padStart(3)}${mark}`);
}
console.log('');
console.log('  ⇒ 若某变体同时命中 86,697 与 у32，则两处分歧同源 = 主管管线做过该归一/去重。');
console.log(`     （我测量用的口径 = «原样去重» = ${words.length}，即未做任何归一。）`);

db.close();
