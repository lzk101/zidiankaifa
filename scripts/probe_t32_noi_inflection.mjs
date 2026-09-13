/**
 * probe_t32_noi_inflection.mjs —— T32 独立发现核查：`-ной` 是否把工具格屈折形 `-ой` 误当后缀
 * 功能测试 agent · 只读 · 2026-09-13
 * 线索来源：probe_t32_noi_claims.mjs 抽样显示 `-ной` 的 72 词关联表含 `малиной`，
 *          而 `малиной` 是 малина 的工具格（"用马林果"），**不是**形容词。
 * 若成立 ⇒ v0.9.0 新落库的 `-ной` 引入了一类**新**假拆解（屈折形尾 -ой 被吃掉）。
 * 判据：breakdownWord 输出中 `-ной` 落在词尾，且该词在 words_i18n 中存在**同族主格形**。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = openDatabase(DB_PATH);

// 假设：以 -ной 结尾但实为「名词 + 工具格 -ой」的词（主格形去掉 -ой + -а）
const SUSPECTS = ['малиной', 'весной', 'женой', 'страной', 'войной', 'луной', 'зимой', 'травой',
                  'водой', 'рукой', 'ногой', 'головой', 'работой', 'мамой', 'сестрой'];

console.log('=== A. 实测 breakdownWord（ru）===');
for (const w of SUSPECTS) {
  const parts = breakdownWord(db, w, 'ru');
  const tail = parts.length ? parts[parts.length - 1] : null;
  const isNoi = tail && tail.morpheme === '-ной' && tail.end === w.length;
  console.log(
    `${w.padEnd(12)} ${JSON.stringify(parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`)).padEnd(46)}` +
      ` ${isNoi ? '★ -ной 吞掉工具格 -ой' : ''}`,
  );
}

console.log('\n=== B. 这些词的「主格形」是否在库内（若在 ⇒ 该词条是屈折形污染）===');
for (const w of SUSPECTS) {
  const stem = w.slice(0, -2); // 去掉 -ой
  const cands = [stem + 'а', stem + 'я', stem];
  const found = cands.filter((c) => db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE word = ? AND lang='ru'").get(c).n > 0);
  const self = db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE word = ? AND lang='ru'").get(w).n > 0;
  console.log(`${w.padEnd(12)} 自身在库=${self ? '是' : '否'}   主格候选存在=${found.length ? found.join(',') : '无'}`);
}

console.log('\n=== C. `-ной` 的 72 词里，有多少能拆出「主格名词 + -ой」形态（抽样精查）===');
const arr = JSON.parse(db.prepare("SELECT words FROM affixes WHERE morpheme = ?").get('-ной').words);
let flagged = [];
for (const w of arr) {
  // 若去掉末尾 -ной 后剩下的是一个「名词词干」，且 w 以 -ной 结尾 ——
  // 更硬的判据：w 去掉最后 2 字符（ой）后 + а/я 是否在库内 ⇒ 疑似工具格
  const stem = w.slice(0, -2);
  const hit = [stem + 'а', stem + 'я'].some((c) => db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE word = ? AND lang='ru'").get(c).n > 0);
  if (hit) {
    const parts = breakdownWord(db, w, 'ru');
    flagged.push({ w, parts: parts.map((p) => p.morpheme), guess: [stem + 'а', stem + 'я'] });
  }
}
console.log(`  72 词中疑似「名词工具格」= ${flagged.length} 词`);
for (const f of flagged) console.log(`    ${f.w.padEnd(12)} 拆解=${JSON.stringify(f.parts)}  疑似主格=${f.guess.join('/')}`);

console.log('\n=== D. 反面：真正的 -ной 形容词应拆不出名词主格 ===');
for (const w of ['больной', 'внеземной', 'входной', 'выводной', 'лесной', 'ночной', 'земной', 'смешной']) {
  const stem = w.slice(0, -2);
  const hit = [stem + 'а', stem + 'я'].some((c) => db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE word = ? AND lang='ru'").get(c).n > 0);
  const parts = breakdownWord(db, w, 'ru');
  console.log(`  ${w.padEnd(12)} 拆解=${JSON.stringify(parts.map((p) => p.morpheme))}  存在主格候选=${hit ? '是★' : '否'}`);
}
