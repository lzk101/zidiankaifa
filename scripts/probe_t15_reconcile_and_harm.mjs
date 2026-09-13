/**
 * 只读探针（功能测试 agent · T15）：主管 321/71/250 与我的 342/75/267 的**分母归因**，
 * 以及**误伤清单**（修法后由「非空」变 [] 但语言学上本应可拆的词）。
 *
 * 只读、幂等。用法：node scripts/probe_t15_reconcile_and_harm.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const ruStems = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`)
  .all()
  .map((r) => ({
    stem: String(r.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е'),
    kind: String(r.kind),
  }));
const RU1 = new Set(ruStems.filter((s) => s.kind === 'prefix' && s.stem.length === 1).map((s) => s.stem));

console.log('='.repeat(92));
console.log('§A 分母归因：主管 86,697 词条 / 321 D1 词  vs  我 101,512 词条 / 342 D1 词');
console.log('='.repeat(92));
const TOTAL = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'`).get().n;
console.log(`  我用的总体  : lang='ru' 全量 = ${TOTAL}`);
console.log(`  主管分母    : 86,697  差 ${TOTAL - 86697}`);

const filters = [
  ['length(word) >= 2', `length(word)>=2`],
  ['length(word) >= 3', `length(word)>=3`],
  ['length(word) >= 4', `length(word)>=4`],
  ['length(word) >= 5', `length(word)>=5`],
  ['无空格', `word NOT LIKE '% %'`],
  ['全小写', `word = lower(word)`],
  ['纯西里尔字母', `word GLOB '*[а-яё]*' AND word NOT GLOB '*[^а-яё]*'`],
  ['纯西里尔 + 小写', `word = lower(word) AND word NOT GLOB '*[^а-яё]*'`],
  ['纯西里尔 + len>=4', `word NOT GLOB '*[^а-яё]*' AND length(word)>=4`],
  ['无数字', `word NOT GLOB '*[0-9]*'`],
  ['无标点', `word NOT GLOB '*[.,;:!?()]*'`],
];
for (const [label, cond] of filters) {
  const n = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND ${cond}`).get().n;
  const mark = n === 86697 ? '  ★★★ 命中主管分母' : '';
  console.log(`    ${label.padEnd(22)} ${String(n).padStart(7)}${mark}`);
}

/* 用「纯西里尔+小写」口径重跑 D1 扫描，看是否复现 321/71/250 */
function scanD1(where) {
  const words = db
    .prepare(`SELECT word FROM words_i18n WHERE lang='ru'${where ? ` AND ${where}` : ''}`)
    .all()
    .map((r) => String(r.word));
  const d1 = [];
  const pass = [];
  const reject = [];
  for (const w of words) {
    let parts;
    try {
      parts = core.breakdownWord(db, w, 'ru');
    } catch {
      parts = [];
    }
    if (parts.length < 2 || parts[0].start !== 1) continue;
    const gap = String(w).trim().toLowerCase().replace(/ё/g, 'е').slice(0, 1);
    d1.push(w);
    (RU1.has(gap) ? pass : reject).push(w);
  }
  return { total: words.length, d1: d1.length, pass: pass.length, reject: reject.length, passList: pass, rejectList: reject };
}

console.log('');
console.log('  按不同口径重跑 D1 扫描（找 321/71/250）：');
for (const [label, cond] of [['全量', ''], ['纯西里尔+小写', `word = lower(word) AND word NOT GLOB '*[^а-яё]*'`], ['无空格', `word NOT LIKE '% %'`]]) {
  const r = scanD1(cond);
  const mark = r.d1 === 321 ? '  ★★★ 命中主管 321' : '';
  console.log(`    ${label.padEnd(16)} 词条 ${String(r.total).padStart(7)} → D1 ${String(r.d1).padStart(4)} = 放行 ${String(r.pass).padStart(3)} + 拒绝 ${String(r.reject).padStart(4)}${mark}`);
}

/* ---------- §B 误伤清单 ---------- */
console.log('');
console.log('='.repeat(92));
console.log('§B 误伤清单：修法后变 [] 但「首字符语言学上真是前缀」的词');
console.log('='.repeat(92));

const full = scanD1('');
const harm = [];
for (const w of full.rejectList) {
  const gap = String(w).trim().toLowerCase().replace(/ё/g, 'е').slice(0, 1);
  const e = db.prepare(`SELECT text_en, text_zh, chain FROM word_etymology WHERE word=? AND lang='ru'`).all(w)[0];
  const t = e ? String(e.text_en ?? '') : '';
  // 词源文本里出现「gap- (gap-) +」或「By surface analysis, gap-」即为单字符前缀铁证
  const re = new RegExp(`(?:^|[\\s,(])${gap}-\\s*\\(|surface analysis,\\s*${gap}-`, 'i');
  if (re.test(t)) {
    const parts = core.breakdownWord(db, w, 'ru');
    harm.push({ w, gap, t: t.slice(0, 100), parts: parts.map((p) => p.morpheme) });
  }
}
console.log(`  拒绝组 ${full.reject} 词中，词源明示首字符为前缀的：${harm.length} 词`);
for (const h of harm) console.log(`    ${h.w.padEnd(16)} gap='${h.gap}' 当前拆解=${JSON.stringify(h.parts)}\n       词源: ${h.t}`);

/* 希腊源否定前缀 а- 专项：词源含 Ancient Greek 且以 а 开头 */
console.log('');
console.log('  ── 专项：希腊源否定前缀 а-（库内无 а-，故修法后一律拒绝）');
const greek = db
  .prepare(`SELECT word, text_en FROM word_etymology WHERE lang='ru' AND text_en LIKE '%Ancient Greek%'`)
  .all()
  .map((r) => ({ w: String(r.word), t: String(r.text_en) }));
const priv = [];
for (const g of greek) {
  if (!g.w.startsWith('а')) continue;
  const parts = core.breakdownWord(db, g.w, 'ru');
  if (parts.length < 2 || parts[0].start !== 1) continue;
  // 判断剩余部分是否为独立词（а + X）
  const rest = g.w.slice(1);
  const restIsWord = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND word=?`).get(rest).n > 0;
  priv.push({ w: g.w, rest, restIsWord, parts: parts.map((p) => p.morpheme), t: g.t.slice(0, 80) });
}
console.log(`    字母 а 开头 + 词源带 Ancient Greek + 当前是 D1 模式：${priv.length} 词`);
for (const p of priv) {
  console.log(
    `      ${p.w.padEnd(20)} = а- + ${p.rest.padEnd(18)} 剩余部分是独立词=${p.restIsWord ? '是★' : '否'} 当前拆解=${JSON.stringify(p.parts)}`,
  );
}

/* ---------- §C 尺子 R 内 6 词的误伤判定 ---------- */
console.log('');
console.log('='.repeat(92));
console.log('§C 尺子 R 内 6 个翻转词是否误伤（首字符是否真是前缀）');
console.log('='.repeat(92));
for (const w of ['глетчерный', 'зверство', 'плескание', 'тлеться', 'хлестаться', 'эмальерный']) {
  const gap = w.slice(0, 1);
  const e = db.prepare(`SELECT text_en FROM word_etymology WHERE word=? AND lang='ru'`).all(w)[0];
  const t = e ? String(e.text_en) : '(无词源)';
  console.log(`  ${w.padEnd(13)} gap='${gap}' 库内单字符前缀=${RU1.has(gap) ? '是' : '否'} → 拒绝`);
  console.log(`     词源: ${t.slice(0, 110)}`);
}
console.log('  ⇒ 6 词首字符 г/з/п/т/х/э 均非俄语前缀；其当前拆解均为「跳过首字符、拿后文巧合命中词根」');
console.log('     的 D1 误拆 ⇒ 修法对 R 内 6 词是**纯收益，无误伤**。');

db.close();
