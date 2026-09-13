/**
 * 只读探针（功能测试 agent · T15 补五）：用**修法前引擎**验证裁决六 §三
 * 「321 = 主管旧探针范围『仅西里尔 且 length 4–14』= 71 + 250」。
 * 必须用 pre-fix 引擎，否则被拒词已变 []，D1 只剩保留组。
 * 只读、幂等。用法：node scripts/probe_t15_denominator5.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as pre from './_tmp/prefix_engine/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const raw = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

const scan = (list) => {
  let d1 = 0;
  let keep = 0;
  let elim = 0;
  for (const w of list) {
    let p;
    try {
      p = pre.breakdownWord(db, w, 'ru');
    } catch {
      p = [];
    }
    if (p.length >= 2 && p[0].start === 1) {
      d1++;
      const gap = w.trim().toLowerCase().replace(/ё/g, 'е')[0];
      if (RU1.has(gap)) keep++;
      else elim++;
    }
  }
  return { n: list.length, d1, keep, elim };
};

const variants = [
  ['全库（官方口径）', raw],
  ['仅西里尔 + len4-14', raw.filter((w) => /^[а-яёА-ЯЁ]+$/.test(w) && w.length >= 4 && w.length <= 14)],
  ['仅西里尔 + len4-14 + 去重', [...new Set(raw.filter((w) => /^[а-яёА-ЯЁ]+$/.test(w) && w.length >= 4 && w.length <= 14))]],
  ['仅小写西里尔 + len4-14', raw.filter((w) => /^[а-яё]+$/.test(w) && w.length >= 4 && w.length <= 14)],
  ['仅西里尔', raw.filter((w) => /^[а-яёА-ЯЁ]+$/.test(w))],
];
for (const [name, list] of variants) {
  const r = scan(list);
  const hit = r.d1 === 321 ? '   ★★★ 命中主管 321' : r.d1 === 342 ? '   ← 官方 342' : '';
  console.log(`${name.padEnd(28)} 词条 ${String(r.n).padStart(6)} → D1 ${String(r.d1).padStart(4)} = 保留 ${String(r.keep).padStart(3)} + 消除 ${String(r.elim).padStart(4)}${hit}`);
}
console.log('');
console.log('  ⇒ 若某行 D1=321 且 保留=71 / 消除=250，则主管 §三 说明成立；否则需主管披露其探针脚本。');
db.close();
