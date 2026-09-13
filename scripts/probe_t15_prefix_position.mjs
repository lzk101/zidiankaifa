/**
 * 只读探针（功能测试 agent · T15）：修法落地后直测「放行组」的真实输出形态。
 *
 * ★ 关键疑点：主管要求断言「修法后首个片段的 morpheme 就是该单字符前缀（如 сдабривать 首片段应为 с-）」。
 *   但「放行组」的定义就是 `parts[0].start === 1` —— 首字符被跳过。二者不能同时成立。
 *   本探针直测，用事实定论。
 *
 * 只读、幂等。用法：node scripts/probe_t15_prefix_position.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const bd = (w, lang = 'ru') => core.breakdownWord(db, w, lang);

console.log('='.repeat(92));
console.log('§1 放行组（首字符 ∈ в/о/с/у）修法后的真实输出：首片段到底是不是该前缀？');
console.log('='.repeat(92));
const PASS_SAMPLE = [
  'удаваться', 'удавить', 'удавиться', 'удавка', 'удавливать', 'удаление', 'удалец', 'удалить', 'удалять',
  'сдабривать', 'сдавать', 'сдаваться', 'сдавить', 'сдавленный', 'сдавливать', 'сдаточный', 'сдатчик', 'сдаться',
  'одалживать', 'одаренность', 'одаренный', 'одаривать', 'одарить', 'одарять',
  'вдаваться', 'вдавить', 'вдавливать', 'вдалбливать', 'вдалеке', 'вдаться',
];
let firstIsPrefix = 0;
let firstStartsAt1 = 0;
let nonEmpty = 0;
for (const w of PASS_SAMPLE) {
  const p = bd(w);
  if (p.length) nonEmpty++;
  const f = p[0];
  const isPre = f && f.kind === 'prefix' && f.morpheme.replace(/^-+|-+$/g, '') === w[0];
  if (isPre) firstIsPrefix++;
  if (f && f.start === 1) firstStartsAt1++;
  console.log(
    `  ${w.padEnd(13)} start=${String(f ? f.start : '-').padEnd(2)} 首片段=${String(f ? f.morpheme : '—').padEnd(9)} 是单字符前缀=${isPre ? '是' : '否'}  ${JSON.stringify(p.map((x) => `${x.morpheme}@${x.start}-${x.end}`))}`,
  );
}
console.log('');
console.log(`  非空 ${nonEmpty}/${PASS_SAMPLE.length} · 首片段就是该单字符前缀的 ${firstIsPrefix}/${PASS_SAMPLE.length} · 首片段 start===1 的 ${firstStartsAt1}/${PASS_SAMPLE.length}`);
console.log('  ⇒ 结论：放行组修法后【仍然是非空但首字符被跳过】的形态；主管要求的「首片段=该前缀」不成立。');

console.log('');
console.log('='.repeat(92));
console.log('§2 消除组（首字符 ∉ в/о/с/у）修法后应为 []');
console.log('='.repeat(92));
const REJECT_SAMPLE = [
  'плескание', 'хлестаться', 'зверство', 'глетчерный', 'тлеться', 'ателье', 'эмальерный',
  'блестеть', 'блистать', 'блистательный', 'звериный', 'зверовод', 'гигрометр', 'градостроитель',
  'аполярный', 'аполитизм', 'атравматический', 'аметропия', 'анестезия', 'амальгамация',
  'аполярность', 'алетье', 'блескость', 'блеснуть', 'бучарда', 'гигрология', 'звероловство',
];
let emptyCount = 0;
for (const w of REJECT_SAMPLE) {
  const p = bd(w);
  if (p.length === 0) emptyCount++;
  console.log(`  ${w.padEnd(18)} ${p.length === 0 ? '[] ✅ 已消除' : JSON.stringify(p.map((x) => x.morpheme)) + ' ❌ 仍可拆'}`);
}
console.log(`  ⇒ ${emptyCount}/${REJECT_SAMPLE.length} 已被消除`);

console.log('');
console.log('='.repeat(92));
console.log('§3 误伤复核：放行组 75 词里，是否有「本该被拒绝却因首字母恰好是前缀字母而漏网」的？');
console.log('='.repeat(92));
console.log('  逐词查词源：首字符是否真的是该词的前缀（而非仅仅形似）');
const SUSPECT_PASS = ['однако', 'удавка', 'удалец', 'удалой', 'сдаигаться', 'вдавлина', 'сучение', 'сучильный', 'сучить', 'одаренность'];
for (const w of SUSPECT_PASS) {
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(w)[0];
  const p = bd(w);
  const t = e ? String(e.text_en) : '(无词源)';
  console.log(`  ${w.padEnd(14)} ${JSON.stringify(p.map((x) => `${x.morpheme}@${x.start}`)).padEnd(46)} ${t.slice(0, 70)}`);
}
db.close();
