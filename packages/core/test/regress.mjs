/**
 * core 数据层回归（需要本地 data/db/dict.db，故不进 CI，作为本地回归）。
 * 用法：pnpm --filter @zidiankaifa/core test
 * 覆盖：英/俄拆解、语言路由、词形反查、反查劫持、俄语词源、suggest 语言隔离、大小写宽容。
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupWord, breakdownWord, suggest, getI18n } from '../dist/db/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dbPath = process.env.ZIDIANKAIFA_DB ?? resolve(root, 'data/db/dict.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      实得 ${g}\n      期望 ${w}`); }
};
const bd = (w, l = 'en') => breakdownWord(db, w, l).map((p) => p.morpheme);

console.log('=== A. 英语拆解验收 ===');
eq('telephone', bd('telephone'), ['tele', 'phon']);
eq('biology', bd('biology'), ['bio', '-logy']);
eq('transportation', bd('transportation'), ['trans-', 'port', '-ation']);
eq('spectator', bd('spectator'), ['spect', '-ator']);
eq('unbelievable', bd('unbelievable'), ['un-', 'believ', '-able']);
eq('photograph', bd('photograph'), ['phot', 'graph']);
eq('constitution', bd('constitution'), ['con-', 'stit', '-tion']);
console.log('--- believ 词族 / 新词素 ---');
eq('believer', bd('believer'), ['believ', '-er']);
eq('disbelief', bd('disbelief'), ['dis-', 'belief']);
eq('knowledge', bd('knowledge'), ['know', '-ledge']);
eq('acknowledge', bd('acknowledge'), ['know', '-ledge']);
eq('creator', bd('creator'), ['creat', '-or']);
eq('creative', bd('creative'), ['creat', '-ive']);
eq('technology', bd('technology'), ['techn', '-logy']);
eq('aircraft', bd('aircraft'), ['air', 'craft']);
console.log('--- 误拆回归（应为空）---');
eq('principle', bd('principle'), []);
eq('difficult', bd('difficult'), []);
eq('business', bd('business'), []);

console.log('=== B. 俄语拆解验收 ===');
eq('телефон', bd('телефон', 'ru'), ['теле-', 'фон-']);
eq('вода', bd('вода', 'ru'), ['вод-']);
eq('писатель', bd('писатель', 'ru'), ['пис-', '-тель']);
eq('учитель', bd('учитель', 'ru'), ['уч-', '-тель']);
eq('бездомный', bd('бездомный', 'ru'), ['без-', 'дом-', '-ный']);
eq('переход', bd('переход', 'ru'), ['пере-', 'ход-']);

console.log('=== B2. 俄语词素扩充（v0.4.3：用户举例 тоска 与常用词）===');
eq('тоска', bd('тоска', 'ru'), ['тоск-']);
eq('грусть', bd('грусть', 'ru'), ['груст-']);
eq('печаль', bd('печаль', 'ru'), ['печал-']);
eq('надежда', bd('надежда', 'ru'), ['надежд-']);
eq('водопровод', bd('водопровод', 'ru'), ['водо-', '-провод']);
eq('телевидение', bd('телевидение', 'ru'), ['теле-', 'вид-', '-ение']);
eq('фотография', bd('фотография', 'ru'), ['фото-', 'граф-', '-ия']);
eq('авиабилет', bd('авиабилет', 'ru'), ['авиа-', 'лет-']);
eq('холодный', bd('холодный', 'ru'), ['холод-', '-ный']);
eq('жирный', bd('жирный', 'ru'), ['жир-', '-ный']);

console.log('=== B3. 单字符前缀严格化（v0.4.3 修复：不得用远处的 -ный 放行词首 с-/в-）===');
eq('страшный', bd('страшный', 'ru'), ['страш-', '-ный']);
eq('весёлый', bd('весёлый', 'ru'), ['весел-']);
eq('одиночество', bd('одиночество', 'ru'), ['один-', '-ество']);
eq('самолёт', bd('самолёт', 'ru'), ['само-', 'лет-']);
// 依赖单字符前缀的正确词不得被误伤
eq('сделать', bd('сделать', 'ru'), ['с-', 'дел-', '-ать']);
eq('списать', bd('списать', 'ru'), ['с-', 'пис-', '-ать']);
eq('отдать', bd('отдать', 'ru'), ['от-', 'да-']);

console.log('=== B4. ё/е 等价（v0.4.3 修复：весёлый 须匹配 весел-）===');
eq('весёлый 词素为 весел-', bd('весёлый', 'ru')[0], 'весел-');
eq('тёплый', bd('тёплый', 'ru'), ['тепл-']);
eq('лёгкий', bd('лёгкий', 'ru'), ['легк-']);

console.log('=== C. 语言路由（英俄分离）===');
eq('lookup стол lang=ru', lookupWord(db, 'стол', { lang: 'ru' })?.word, 'стол');
eq('lookup telephone lang=en', lookupWord(db, 'telephone', { lang: 'en' })?.word, 'telephone');
eq('telephone lang=ru → null', lookupWord(db, 'telephone', { lang: 'ru' }), null);
eq('стол lang=en → null', lookupWord(db, 'стол', { lang: 'en' }), null);
eq('auto стол → ru', lookupWord(db, 'стол')?.i18n?.lang, 'ru');
eq('стол forms 数', lookupWord(db, 'стол', { lang: 'ru' })?.i18n?.forms.length, 19);

console.log('=== D. 词形反查（变格形 → 主词条）===');
const inv = lookupWord(db, 'столом', { lang: 'ru' });
eq('столом → стол', inv?.word, 'стол');
eq('столом matchedForm tags', inv?.i18n?.matchedForm?.tags, ['instrumental', 'singular']);
eq('大写变体 Столом → стол', lookupWord(db, 'Столом', { lang: 'ru' })?.word, 'стол');

console.log('=== E. 俄语词源（含此前漏失的专名）===');
for (const w of ['вода', 'телефон', 'стол', 'читать', 'хороший', 'книга', 'человек']) {
  const o = lookupWord(db, w, { lang: 'ru' })?.etymology?.origin;
  eq(`${w} 词源存在`, !!o, true);
}
console.log('--- 专名（大小写 bug 修复目标）---');
for (const w of ['Китай', 'Москва', 'Европа', 'Япония', 'Россия', 'Англия', 'Франция', 'Индия']) {
  const d = lookupWord(db, w, { lang: 'ru' });
  eq(`${w} 词源`, !!d?.etymology?.origin, true);
}
console.log('--- 反查劫持回归（独立词条不得被误判为屈折形）---');
eq('Франция 返回自身（非 франций）', lookupWord(db, 'Франция', { lang: 'ru' })?.word, 'Франция');
eq('Индия 返回自身（非 индий）', lookupWord(db, 'Индия', { lang: 'ru' })?.word, 'Индия');
eq('дома 返回自身（非 дом）', lookupWord(db, 'дома', { lang: 'ru' })?.word, 'дома');
eq('яма 返回自身（非 ям）', lookupWord(db, 'яма', { lang: 'ru' })?.word, 'яма');
eq('банана 纯屈折形仍反查', lookupWord(db, 'банана', { lang: 'ru' })?.word, 'банан');
eq('сентября 纯屈折形仍反查', lookupWord(db, 'сентября', { lang: 'ru' })?.word, 'сентябрь');
eq('Франция 无 matchedForm', lookupWord(db, 'Франция', { lang: 'ru' })?.i18n?.matchedForm, null);
console.log('--- 屈折释义不得顶替主词条义项 ---');
eq('Франция 义项=法国', lookupWord(db, 'Франция', { lang: 'ru' })?.translation, '法国（位于西欧的国家）');
eq('франция(小写输入) 义项=法国', lookupWord(db, 'франция', { lang: 'ru' })?.translation, '法国（位于西欧的国家）');
eq('Индия 义项=印度', lookupWord(db, 'Индия', { lang: 'ru' })?.translation, '印度（位于南亚的国家）');
eq('Китай 义项=中国', lookupWord(db, 'Китай', { lang: 'ru' })?.translation, '中国（位于东亚的地区和国家）');
eq('дома 保留实质释义', lookupWord(db, 'дома', { lang: 'ru' })?.translation?.includes('在家'), true);
eq('яма 保留实质释义', lookupWord(db, 'яма', { lang: 'ru' })?.translation?.includes('坑'), true);

console.log('=== F. suggest 语言隔离 ===');
const s = (q, l) => suggest(db, q, 8, l).map((x) => x.lang);
eq('桌子 ru 全俄语', s('桌子', 'ru').every((l) => l === 'ru'), true);
eq('桌子 en 全英语', s('桌子', 'en').every((l) => l === 'en'), true);
eq('桌子 auto 英俄交错', s('桌子', 'auto').slice(0, 4), ['en', 'ru', 'en', 'ru']);
eq('西里尔 сто ru 非空', s('сто', 'ru').length > 0, true);
eq('西里尔 сто en 为空', s('сто', 'en').length, 0);
eq('拉丁 table ru 为空', s('table', 'ru').length, 0);

console.log('=== G. 大小写宽容（不再误伤英语）===');
eq('Telephone lang=en', lookupWord(db, 'Telephone', { lang: 'en' })?.word, 'telephone');
eq('Apple lang=en', lookupWord(db, 'Apple', { lang: 'en' })?.word, 'apple');
eq('getI18n Китай 原形优先', getI18n(db, 'Китай', 'ru')?.word, 'Китай');
eq('getI18n англия 小写命中小写', getI18n(db, 'англия', 'ru')?.word, 'англия');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
db.close();
process.exit(fail ? 1 : 0);
