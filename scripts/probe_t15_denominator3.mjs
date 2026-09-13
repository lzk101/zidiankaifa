/**
 * 只读探针（功能测试 agent · T15 补三）：验证主管裁决六 §三 的口径
 * 「321 = 主管旧探针范围『仅西里尔 且 length 4–14』= 71 + 250」。
 * 只读、幂等。用法：node scripts/probe_t15_denominator3.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const raw = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

const candidates = {
  '纯西里尔 + len4-14（原样）': [...new Set(raw.filter((w) => /^[а-яё]+$/.test(w) && w.length >= 4 && w.length <= 14))],
  '纯西里尔 + len4-14（ё→е 去重）': [...new Set(raw.map((w) => w.replace(/ё/g, 'е')).filter((w) => /^[а-я]+$/.test(w) && w.length >= 4 && w.length <= 14))],
};
for (const [name, list] of Object.entries(candidates)) {
  let d1 = 0;
  let keep = 0;
  let reject = 0;
  for (const w of list) {
    let p;
    try {
      p = breakdownWord(db, w, 'ru');
    } catch {
      p = [];
    }
    if (p.length >= 2 && p[0].start === 1) {
      d1++;
      if (RU1.has(w[0])) keep++;
      else reject++;
    }
  }
  const hit = d1 === 321 ? '   ★★★ 命中主管 321' : '';
  console.log(`${name.padEnd(32)} 词条 ${String(list.length).padStart(6)} → D1 ${String(d1).padStart(4)} = 保留 ${keep} + 消除 ${reject}${hit}`);
  if (d1 === 321) console.log(`   ⇒ 该口径下词条总数 = ${list.length}（主管写 86,697 ⇒ ${list.length === 86697 ? '精确命中 ✅' : `差 ${list.length - 86697}`}）`);
}
db.close();
