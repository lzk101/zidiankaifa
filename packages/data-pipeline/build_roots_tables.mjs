/**
 * 数据管线：构建「词根表 roots」与「词缀表 affixes」
 *
 * 目的（用户需求）：
 *   1. 独立的词根表 / 词缀表——可浏览、可搜索、可查看含义/词源/例词
 *   2. 每个词素带「关联词」——通过真实拆解（breakdownWord）建立倒排，而非子串匹配
 *      （子串会把 автосклейка 之类误算进 тоск 词族）
 *   3. 单词表按语言分离：视图 words_en / words_ru
 *
 * 运行：node packages/data-pipeline/build_roots_tables.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, copyFileSync } from 'node:fs';
import { openDatabase, breakdownWord } from '../../packages/core/dist/db/index.js';

const DB = 'data/db/dict.db';
const SAMPLE_MAX = 200; // 每个词素最多存多少关联词（按词长升序＝越短越基础）

if (!existsSync(DB)) { console.error('缺少', DB); process.exit(1); }

const db = openDatabase(DB);
const raw = new DatabaseSync(DB, { readOnly: true });

// ---------- 1. 读取词素库 ----------
const morphs = raw.prepare('SELECT morpheme, kind, meaning_zh, meaning_en, origin, examples, lang FROM morphemes').all();
console.log(`morphemes = ${morphs.length}`);

const key = (m, lang) => `${lang}::${m.replace(/^[-*]+|[-*]+$/g, '').toLowerCase()}`;
const index = new Map(); // stemKey → { morpheme, kind, lang, words: [] }
for (const m of morphs) {
  const lang = m.lang ?? 'en';
  const k = key(m.morpheme, lang);
  if (!index.has(k)) {
    index.set(k, { morpheme: m.morpheme, kind: m.kind, lang, meaningZh: m.meaning_zh, meaningEn: m.meaning_en, origin: m.origin, examples: m.examples, words: [] });
  }
}

// ---------- 2. 全量拆解，建立倒排 ----------
function buildInverted(lang, words) {
  const t0 = Date.now();
  let broken = 0, links = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let parts;
    try { parts = breakdownWord(db, w, lang); } catch { continue; }
    if (!parts.length) continue;
    // 中间碎片只允许【连接元音】：俄语复合词常有 о/е 连接元音（фотография = фото + о + граф + ия）。
    // 辅音碎片说明该词素只是恰好撞上子串——ректоскоп 的 тоск-（忧愁）实为 ректо-（直肠）+ -скоп（镜），
    // 中间夹着辅音 т；дефектоскоп、отосклероз 同理。
    // 首尾碎片放行：俄语词尾常有无词素归属的屈折字母（тоска 的 -а）。
    let midGapOk = true;
    let prevEnd = 0;
    const lower = w.toLowerCase();
    for (const p of parts) {
      const gap = lower.slice(prevEnd, p.start);
      if (gap && !/^[аеёиоуыэюяaeiou]+$/.test(gap)) { midGapOk = false; break; }
      prevEnd = p.end;
    }
    if (!midGapOk) continue;
    broken++;
    for (const p of parts) {
      const k = key(p.morpheme, lang);
      const node = index.get(k);
      if (!node) continue;
      node.words.push(w); // 全收，最后统一去重排序截断（word_count 用真实数）
      links++;
    }
  }
  console.log(`${lang}: ${words.length} 词拆解 ${broken} (${(broken / words.length * 100).toFixed(1)}%)，建立关联 ${links} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const ruWords = raw.prepare("SELECT word FROM words_i18n WHERE lang='ru'").all().map((r) => r.word).filter(Boolean);
const enWords = raw.prepare('SELECT word FROM words').all().map((r) => r.word).filter(Boolean);
buildInverted('ru', ruWords);
buildInverted('en', enWords);

// ---------- 3. 建表 ----------
db.exec(`DROP TABLE IF EXISTS roots`);
db.exec(`DROP TABLE IF EXISTS affixes`);
db.exec(`
CREATE TABLE roots (
  morpheme   TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'en',
  meaning_zh TEXT,
  meaning_en TEXT,
  origin     TEXT,
  examples   TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  words      TEXT,
  PRIMARY KEY (morpheme, lang)
);
CREATE TABLE affixes (
  morpheme   TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'en',
  kind       TEXT NOT NULL,
  meaning_zh TEXT,
  meaning_en TEXT,
  origin     TEXT,
  examples   TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  words      TEXT,
  PRIMARY KEY (morpheme, lang)
);
CREATE VIEW IF NOT EXISTS words_en AS
  SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, audio
  FROM words;
CREATE VIEW IF NOT EXISTS words_ru AS
  SELECT word, lang, phonetic, translation, definition, pos, forms, audio, source
  FROM words_i18n WHERE lang = 'ru';
`);
console.log('tables created: roots / affixes / views: words_en / words_ru');

// ---------- 4. 写入 ----------
const insRoot = db.prepare('INSERT OR REPLACE INTO roots (morpheme, lang, meaning_zh, meaning_en, origin, examples, word_count, words) VALUES (?,?,?,?,?,?,?,?)');
const insAffix = db.prepare('INSERT OR REPLACE INTO affixes (morpheme, lang, kind, meaning_zh, meaning_en, origin, examples, word_count, words) VALUES (?,?,?,?,?,?,?,?,?)');

let nRoot = 0, nAffix = 0, totalLinks = 0;
for (const node of index.values()) {
  // 按词长升序（短词更基础、更适合做例词），去重
  const uniq = [...new Set(node.words)].sort((a, b) => a.length - b.length || a.localeCompare(b, 'ru'));
  const words = JSON.stringify(uniq.slice(0, SAMPLE_MAX));
  const args = [node.morpheme, node.lang, node.meaningZh ?? null, node.meaningEn ?? null, node.origin ?? null, node.examples ?? null, uniq.length, words];
  if (node.kind === 'root') { insRoot.run(...args); nRoot++; }
  else { insAffix.run(...args.slice(0, 2).concat([node.kind], args.slice(2))); nAffix++; }
  totalLinks += uniq.length;
}
console.log(`written: roots=${nRoot} affixes=${nAffix} 关联词总数=${totalLinks}`);

// ---------- 5. 统计 ----------
for (const lang of ['ru', 'en']) {
  const r = raw.prepare('SELECT COUNT(1) c, SUM(word_count) s, AVG(word_count) a FROM roots WHERE lang=?').get(lang);
  const a = raw.prepare('SELECT kind, COUNT(1) c FROM affixes WHERE lang=? GROUP BY kind').all(lang);
  console.log(`${lang}: roots=${r.c} 关联词=${r.s} 平均=${Number(r.a).toFixed(1)}; affixes=${a.map((x) => `${x.kind}:${x.c}`).join(' ')}`);
}

console.log('\n=== 样例：тоск- 词根 ===');
const tosk = raw.prepare("SELECT * FROM roots WHERE morpheme='тоск-'").get();
console.log(JSON.stringify({ ...tosk, words: undefined }, null, 1));
console.log('关联词:', JSON.parse(tosk.words).join(' '));

console.log('\n=== 样例：-тель 后缀 ===');
const tel = raw.prepare("SELECT * FROM affixes WHERE morpheme='-тель'").get();
if (tel) { console.log(JSON.stringify({ ...tel, words: undefined }, null, 1)); console.log('关联词:', JSON.parse(tel.words).slice(0, 30).join(' ')); }

console.log('\n=== 样例：tele 词根（英语）===');
const tele = raw.prepare("SELECT * FROM roots WHERE morpheme='tele'").get();
if (tele) { console.log(JSON.stringify({ ...tele, words: undefined }, null, 1)); console.log('关联词:', JSON.parse(tele.words).slice(0, 20).join(' ')); }
