/**
 * 只读探针（功能测试 agent · T15 补六）：确认主管分母 86,697 的**精确**取数式。
 * 已知：`仅小写西里尔 + len4-14 + 去重` = 84,701 词，D1 = 321 = 71 + 250（与主管逐字一致）。
 * 假设：主管未去重 ⇒ 86,697。
 * 只读、幂等。用法：node scripts/probe_t15_denominator6.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const raw = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const TARGET = 86697;

const filt = raw.filter((w) => /^[а-яё]+$/.test(w) && w.length >= 4 && w.length <= 14);
const uniq = [...new Set(filt)];
console.log(`  仅小写西里尔 + len4-14  ·  不去重 = ${filt.length}`);
console.log(`  仅小写西里尔 + len4-14  ·  去重   = ${uniq.length}`);
console.log(`  主管分母                                    = ${TARGET}`);
console.log(`  ⇒ 不去重是否命中：${filt.length === TARGET ? '★★★ 是（精确命中）' : `否（差 ${filt.length - TARGET}）`}`);
console.log(`  ⇒ 去重是否命中  ：${uniq.length === TARGET ? '★ 是' : `否（差 ${uniq.length - TARGET}）`}`);
console.log(`  ⇒ 表中 lang='ru' 原始行数 = ${raw.length}，去重后 = ${uniq.length === raw.length ? '相同（表内无重复词）' : `${new Set(raw).size}`}`);
db.close();
