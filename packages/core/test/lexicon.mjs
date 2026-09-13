/**
 * v0.6.0 俄语专项测试：词源 + 词根表 + 词缀表 + 词表分离
 * 用户要求「主要测试俄语的词源词根词缀」
 */
import { openDatabase, breakdownWord, listLexicon, getLexiconEntry, lexiconStats, listWords, lookupWord } from '../dist/db/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO_ROOT, 'data', 'db', 'dict.db');
const db = openDatabase(DB);
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      实得 ${g}\n      期望 ${w}`); }
};
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const bd = (w, lang) => breakdownWord(db, w, lang).map((p) => p.morpheme);

console.log('=== A. 俄语词源 ===');
for (const [w, kw] of [
  ['тоска', '原始斯拉夫语'],
  ['вода', '原始印欧语'],
  ['телефон', '古希腊语'],
  ['книга', '原始斯拉夫语'],
  ['читать', '原始斯拉夫语'],
  ['хороший', '东斯拉夫'],
]) {
  const d = lookupWord(db, w, { lang: 'ru' });
  ok(`${w} 有词源且含「${kw}」`, !!(d && (d.etymology?.origin ?? d.origin?.origin ?? '').includes(kw)),
    `实得 origin=${d?.etymology?.origin ?? d?.origin?.origin ?? 'null'}`);
}
const toska = lookupWord(db, 'тоска', { lang: 'ru' });
ok('тоска 有中文词源详解', !!(toska?.etymology?.textZh && toska.etymology.textZh.length > 10), `len=${toska?.etymology?.textZh?.length ?? 0}`);
ok('тоска 有变格表', (toska?.i18n?.forms?.length ?? 0) >= 5, `forms=${toska?.i18n?.forms?.length ?? 0}`);
ok('тоска 词源含 *tъska', (toska?.etymology?.textZh ?? '').includes('tъska') || (toska?.etymology?.textEn ?? '').includes('tъska'));

console.log('\n=== B. 俄语拆解（本轮 DP 重写目标）===');
eq('тоска', bd('тоска', 'ru'), ['тоск-']);
eq('тосковать', bd('тосковать', 'ru'), ['тоск-', '-овать']);
eq('тоскливый', bd('тоскливый', 'ru'), ['тоск-', '-ливый']);
eq('затосковать', bd('затосковать', 'ru'), ['за-', 'тоск-', '-овать']);
eq('учитель', bd('учитель', 'ru'), ['уч-', '-тель']);
eq('писатель', bd('писатель', 'ru'), ['пис-', '-тель']);
eq('телефон', bd('телефон', 'ru'), ['теле-', 'фон-']);
eq('водопровод', bd('водопровод', 'ru'), ['водо-', '-провод']);
eq('фотография', bd('фотография', 'ru'), ['фото-', 'граф-', '-ия']);
eq('стетоскоп 不再误拆出 тоск-', bd('стетоскоп', 'ru').includes('тоск-'), false);
eq('лактоскоп 不再误拆出 тоск-', bd('лактоскоп', 'ru').includes('тоск-'), false);
eq('статоскоп 不再误拆出 тоск-', bd('статоскоп', 'ru').includes('тоск-'), false);
eq('картосклад 不再误拆出 тоск-', bd('картосклад', 'ru').includes('тоск-'), false);
ok('ателье 不再被 -тель 误拆', !bd('ателье', 'ru').includes('-тель'), `实得 ${JSON.stringify(bd('ателье', 'ru'))}`);

console.log('\n=== C. 俄语词根表 ===');
const ruRoots = listLexicon(db, { kind: 'root', lang: 'ru', limit: 500 });
ok('俄语词根表非空', ruRoots.total > 100, `total=${ruRoots.total}`);
ok('全部 lang=ru', ruRoots.items.every((i) => i.lang === 'ru'));
ok('全部 kind=root', ruRoots.items.every((i) => i.kind === 'root'));
const toskEntry = getLexiconEntry(db, 'тоск-', 'ru');
ok('тоск- 词根存在', !!toskEntry);
ok('тоск- 含义=忧愁、苦闷', toskEntry?.meaningZh === '忧愁、苦闷', `实得 ${toskEntry?.meaningZh}`);
ok('тоск- 词源=原始斯拉夫语 *tъska', (toskEntry?.origin ?? '').includes('tъska'), `实得 ${toskEntry?.origin}`);
ok('тоск- 关联词含 тоска', toskEntry?.words.includes('тоска'), `实得 ${JSON.stringify(toskEntry?.words)}`);
ok('тоск- 关联词含 тосковать', toskEntry?.words.includes('тосковать'));
ok('тоск- 关联词含 тоскливый', toskEntry?.words.includes('тоскливый'));
ok('тоск- 关联词不含 ректоскоп（仪器，非忧愁词族）', !toskEntry?.words.includes('ректоскоп'));
ok('тоск- 关联词数 >0', (toskEntry?.wordCount ?? 0) > 0, `count=${toskEntry?.wordCount}`);

const voд = getLexiconEntry(db, 'вод-', 'ru');
ok('вод- 词根存在', !!voд);
ok('вод- 关联词含 вода', voд?.words.includes('вода'), `实得 ${JSON.stringify(voд?.words?.slice(0, 10))}`);

console.log('\n=== D. 俄语词缀表 ===');
const ruPrefix = listLexicon(db, { kind: 'prefix', lang: 'ru', limit: 500 });
const ruSuffix = listLexicon(db, { kind: 'suffix', lang: 'ru', limit: 500 });
ok('俄语前缀表非空', ruPrefix.total > 50, `total=${ruPrefix.total}`);
ok('俄语后缀表非空', ruSuffix.total > 50, `total=${ruSuffix.total}`);
ok('前缀表 kind=prefix', ruPrefix.items.every((i) => i.kind === 'prefix'));
ok('后缀表 kind=suffix', ruSuffix.items.every((i) => i.kind === 'suffix'));

const tel = getLexiconEntry(db, '-тель', 'ru');
ok('-тель 后缀存在', !!tel);
ok('-тель 含义=施动者、器具', tel?.meaningZh === '施动者、器具', `实得 ${tel?.meaningZh}`);
ok('-тель 关联词含 учитель', tel?.words.includes('учитель'), `实得 ${JSON.stringify(tel?.words?.slice(0, 15))}`);
ok('-тель 关联词含 писатель', tel?.words.includes('писатель'));
ok('-тель 关联词含 читатель', tel?.words.includes('читатель'));
ok('-тель 关联词数 >50', (tel?.wordCount ?? 0) > 50, `count=${tel?.wordCount}`);

const bez = getLexiconEntry(db, 'без-', 'ru');
ok('без- 前缀存在', !!bez);
ok('без- 含义含「无」', (bez?.meaningZh ?? '').includes('无'), `实得 ${bez?.meaningZh}`);

const ost = getLexiconEntry(db, '-ость', 'ru');
ok('-ость 后缀存在', !!ost);

console.log('\n=== E. 单词表按语言分离 ===');
const wRu = listWords(db, 'ru', { limit: 5 });
const wEn = listWords(db, 'en', { limit: 5 });
ok('俄语词表 total≈101512', wRu.total === 101512, `total=${wRu.total}`);
ok('英语词表 total≈770611', wEn.total === 770611, `total=${wEn.total}`);
ok('俄语词表条目为西里尔', wRu.items.every((i) => /[\u0400-\u04FF]/.test(i.word)), JSON.stringify(wRu.items.map((i) => i.word)));
ok('英语词表条目不含西里尔字母', wEn.items.every((i) => !/[\u0400-\u04FF]/.test(i.word)), JSON.stringify(wEn.items.map((i) => i.word)));
ok('俄语词表带释义', wRu.items.some((i) => !!i.gloss));
const wRuQi = listWords(db, 'ru', { query: 'тоск', limit: 20 });
ok('俄语词表前缀查询生效', wRuQi.total > 0 && wRuQi.items.every((i) => i.word.startsWith('тоск')), `total=${wRuQi.total} 样例=${JSON.stringify(wRuQi.items.slice(0, 3).map((i) => i.word))}`);

console.log('\n=== F. 搜索与统计 ===');
const search = listLexicon(db, { kind: 'root', lang: 'ru', query: '忧愁' });
ok('中文含义搜索命中 тоск-', search.items.some((i) => i.morpheme === 'тоск-'), JSON.stringify(search.items.map((i) => i.morpheme)));
const searchRu = listLexicon(db, { kind: 'root', lang: 'ru', query: 'тоск' });
ok('俄文字形搜索命中 тоск-', searchRu.items.some((i) => i.morpheme === 'тоск-'));
const enRoots = listLexicon(db, { kind: 'root', lang: 'en', query: 'tele' });
ok('英语词根 tele 命中', enRoots.items.some((i) => i.morpheme === 'tele'), JSON.stringify(enRoots.items.map((i) => i.morpheme)));
const enTele = getLexiconEntry(db, 'tele', 'en');
ok('tele 关联词含 telephone', enTele?.words.includes('telephone'), `实得 ${JSON.stringify(enTele?.words?.slice(0, 8))}`);
ok('tele 关联词含 television', enTele?.words.includes('television'));

const stats = lexiconStats(db);
// ★ v0.9.0 重标（主管 T29）：本组为**冻结统计快照**，随词素库/倒排表重建而变，须在每次落库迭代后同步。
//   口径：roots/affixes 由 packages/data-pipeline/build_roots_tables.mjs 生成，该脚本 `DROP TABLE` 后重建，
//   且只收「经 breakdownWord 拆出且有真实关联词」的词素 ⇒ 计数天然 ≤ morphemes 表。
//   v0.9.0 落库 9 条（суч- суд- домин- -ной столп- казус- однако- пад- тряс-）并重建后实测：
//     stats.roots.ru   154 → 171（+17：新 root 7 条 + 其余来自拆解变化）
//     stats.roots.en   322 → 321（−1 = `ment`：库中作为 root 存在，但无任何英语拆解用到它）
//     ru:prefix        185 → 184（−1 = `о-`：无真实关联词 ⇒ 不入表）
//     ru:suffix         92 →  94（+2：新 `-ной` + 拆解变化使原 0 关联词后缀获词）
//   ⚠ 与 morphemes 表的系统差额（设计使然，非缺陷）：ru suffix 有 3 条 0 关联词（-еский / -ьё / -ёк）、
//     ru prefix 1 条（о-）、en root 1 条（ment）。此项即 v0.8.0 遗留项 **C3**（「倒排表差 10 条」）的同一成因。
ok('统计：俄语词根 171', stats.roots.ru?.count === 171, JSON.stringify(stats.roots.ru));
ok('统计：英语词根 321', stats.roots.en?.count === 321, JSON.stringify(stats.roots.en));
ok('统计：俄语前缀 184', stats.affixes['ru:prefix']?.count === 184, JSON.stringify(stats.affixes['ru:prefix']));
ok('统计：俄语后缀 94', stats.affixes['ru:suffix']?.count === 94, JSON.stringify(stats.affixes['ru:suffix']));

console.log('\n=== G. 语言隔离（词根表不得串语言）===');
ok('俄语词根表不含英语词素', !ruRoots.items.some((i) => i.morpheme === 'tele'));
ok('英语词根表不含俄语词素', !enRoots.items.some((i) => i.morpheme === 'тоск-'));
const ruTel = getLexiconEntry(db, '-тель', 'ru');
const enTel = getLexiconEntry(db, '-тель', 'en');
ok('英语表查 -тель 为空', enTel === null, JSON.stringify(enTel));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

