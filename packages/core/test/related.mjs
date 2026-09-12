/**
 * 词源关联 & 同根词回归（v0.7.0）
 *
 * 覆盖：
 *  A. 词源详解里的相关词链接（俄语西里尔直接提取 / 英语限构词表达）
 *  B. 查词页「同根词 · 词族」（按共享词素分组、去碎片、按词频排序）
 *  C. 词首间隙假命中修复（сегодня 不得拆出 год-，acknowledge 必须保留 ac-）
 *
 * 需要本地 data/db/dict.db（可用 ZIDIANKAIFA_DB 覆盖）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDatabase,
  lookupWord,
  breakdownWord,
  relatedByMorpheme,
  etymologyLinks,
} from '../dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');

const db = openDatabase(DB_PATH);
let pass = 0;
let fail = 0;

function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      实得 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
  }
}

function ok(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

const bd = (w, lang = 'en') => breakdownWord(db, w, lang).map((p) => p.morpheme);
const links = (w, lang) => (lookupWord(db, w, { lang }).etymology?.links ?? []).map((l) => l.word);
const rel = (w, lang) => relatedByMorpheme(db, w, lang);

/* ---------------- A. 词源相关词链接 ---------------- */

console.log('--- A. 词源详解相关词链接 ---');
{
  const t = links('тоска', 'ru');
  ok('тоска 含 тощий', t.includes('тощий'));
  ok('тоска 含 тискать', t.includes('тискать'));
  ok('тоска 不含自身', !t.includes('тоска'));
  ok('俄语链接无中文 token', t.every((w) => !/[\u4e00-\u9fff]/.test(w)));

  const en = links('telephone', 'en');
  ok('telephone 含 tele', en.includes('tele'));
  ok('telephone 含 phone', en.includes('phone'));
  ok(
    'telephone 不把叙述用词当链接',
    !en.some((w) => ['distance', 'apparatus', 'signals', 'denoting', 'device'].includes(w)),
  );
  ok('英语链接无语言名', !en.some((w) => ['latin', 'english', 'greek', 'french'].includes(w)));

  const ph = links('photograph', 'en');
  ok('photograph 含 photo', ph.includes('photo'));
  ok('photograph 含 graph', ph.includes('graph'));
}

/* ---------------- B. 同根词 · 词族 ---------------- */

console.log('--- B. 同根词 · 词族 ---');
{
  const g = rel('тоска', 'ru');
  ok('тоска 有词族', g.length > 0);
  ok('тоска 含 тоск- 词根组', g.some((x) => x.morpheme === 'тоск-' && x.kind === 'root'));
  const tosk = g.find((x) => x.morpheme === 'тоск-');
  ok('тоск- 组排除自身', !!tosk && !tosk.words.includes('тоска'));
  ok('тоск- 组含 тоскливый', !!tosk && tosk.words.includes('тоскливый'));
  ok('тоск- 组含量正确', !!tosk && tosk.words.length === 5);

  const en = rel('telephone', 'en');
  ok('telephone 含 tele 组', en.some((x) => x.morpheme === 'tele'));
  ok('telephone 含 phon 组', en.some((x) => x.morpheme === 'phon'));
  const tele = en.find((x) => x.morpheme === 'tele');
  ok('tele 组含 television', !!tele && tele.words.includes('television'));
  ok('tele 组无 ≤3 字符碎片', !!tele && !tele.words.some((w) => w.length <= 3));
  ok(
    'tele 组无词频缺失噪声词',
    !!tele && !tele.words.some((w) => ['telep', 'teles', 'teledu', 'telega', 'teleut'].includes(w)),
  );
  const phon = en.find((x) => x.morpheme === 'phon');
  ok('phon 组含 microphone', !!phon && phon.words.includes('microphone'));
  ok('词根组排在词缀组之前', en.length === 0 || en[0].kind === 'root');

  // 请求时已按词素聚合，同根词不应含当前词
  ok('所有组均排除自身', en.every((x) => !x.words.includes('telephone')));

  // 无拆解的词不应报错
  eq('无拆解词返回空数组', rel('луна', 'ru'), []);
}

/* ---------------- C. 词首间隙假命中 ---------------- */

console.log('--- C. 词首间隙（假命中修复）---');
{
  eq('сегодня 不拆（原假命中 год-）', bd('сегодня', 'ru'), []);
  ok(
    'сегодня 不含 год-',
    !breakdownWord(db, 'сегодня', 'ru').some((p) => p.morpheme.startsWith('год')),
  );
  eq('acknowledge 保留 ac- 前缀', bd('acknowledge'), ['ac-', 'know', '-ledge']);
}

/* ---------------- D. 新增词素生效 ---------------- */

console.log('--- D. v0.7.0 新增词素 ---');
{
  eq('рассказать 用 сказ-', bd('рассказать', 'ru'), ['рас-', 'сказ-', '-ать']);
  eq('показать 用 каз-', bd('показать', 'ru'), ['по-', 'каз-', '-ать']);
  eq('стол 用 стол-', bd('стол', 'ru'), ['стол-']);
  eq('садовник 用 сад-', bd('садовник', 'ru'), ['сад-', '-ник']);
  eq('братство 用 брат-', bd('братство', 'ru'), ['брат-', '-ство']);
  eq('путешествие 用 путешеств-', bd('путешествие', 'ru'), ['путешеств-', '-ие']);
  eq('correct 用 cor-（con- 同化）', bd('correct'), ['cor-', 'rect']);
  eq('assign 用 as-（ad- 同化）', bd('assign'), ['as-', 'sign']);
}

/* ---------------- E. 覆盖率下限（防止回归到「拆不动」） ---------------- */

console.log('--- E. 覆盖率下限 ---');
{
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(DB_PATH, { readOnly: true });
  const ruWords = raw
    .prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0")
    .all()
    .map((r) => r.word);
  let ruOk = 0;
  for (const w of ruWords) if (breakdownWord(db, w, 'ru').length) ruOk++;
  const ruRate = ruOk / ruWords.length;
  ok(`俄语拆解覆盖率 ${(ruRate * 100).toFixed(1)}% ≥ 25%`, ruRate >= 0.25);

  let ruRel = 0;
  for (const w of ruWords) if (relatedByMorpheme(db, w, 'ru').length) ruRel++;
  const relRate = ruRel / ruWords.length;
  ok(`俄语词族覆盖率 ${(relRate * 100).toFixed(1)}% ≥ 20%`, relRate >= 0.2);

  const enWords = raw
    .prepare("SELECT word FROM words WHERE length(word) BETWEEN 5 AND 14 AND rowid % 2003 = 0")
    .all()
    .map((r) => r.word);
  let enRel = 0;
  for (const w of enWords) if (relatedByMorpheme(db, w, 'en').length) enRel++;
  const enRate = enRel / enWords.length;
  ok(`英语词族覆盖率 ${(enRate * 100).toFixed(1)}% ≥ 15%`, enRate >= 0.15);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
