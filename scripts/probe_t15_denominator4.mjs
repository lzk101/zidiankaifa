/**
 * 只读探针（功能测试 agent · T15 补四）：裁决六 §三「321 = 仅西里尔 且 length 4–14」口径验证。
 * 我的首轮复现（小写西里尔 + len4-14，84,701 词）只得到 D1=71，与 321 不符 ——
 * 怀疑差在**大小写**（专名如 Аделаида 首字母大写，会被小写正则排除）。逐个试探。
 * 只读、幂等。用法：node scripts/probe_t15_denominator4.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const raw = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));

const isCyr = {
  '仅小写西里尔': (w) => /^[а-яё]+$/.test(w),
  '西里尔(不分大小写)': (w) => /^[а-яёА-ЯЁ]+$/.test(w),
};
const lens = {
  'len 4-14': (w) => w.length >= 4 && w.length <= 14,
  'len 4-12': (w) => w.length >= 4 && w.length <= 12,
  '无长度限制': () => true,
};

for (const [cn, cf] of Object.entries(isCyr)) {
  for (const [ln, lf] of Object.entries(lens)) {
    const list = [...new Set(raw.filter((w) => cf(w) && lf(w)))];
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
        // gap 字符按实现归一化（小写 + ё→е）后判定
        const gap = w.trim().toLowerCase().replace(/ё/g, 'е')[0];
        if (RU1.has(gap)) keep++;
        else elim++;
      }
    }
    const hit = d1 === 321 ? '   ★★★ 命中 321' : '';
    console.log(`${(cn + ' + ' + ln).padEnd(26)} 词条 ${String(list.length).padStart(6)} → D1 ${String(d1).padStart(4)} = 保留 ${String(keep).padStart(3)} + 消除 ${String(elim).padStart(4)}${hit}`);
  }
}
console.log('');
console.log(`基准（无过滤，与官方口径一致）：D1 = 342 = 保留 75 + 消除 267`);
db.close();
