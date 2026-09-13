/**
 * probe_t32_noi_audit.mjs —— T32 独立发现量化（v2：修正判据）
 * 功能测试 agent · 只读 · 2026-09-13
 *
 * ⚠ v1 的判据错误（如实记录）：我起初用 `pos` 列判词性，得「182/263 非形容词」——
 *   但实测 `pos` 对俄语**大多是 'unknown'**（词源管线未填），该数字反映的是**字段覆盖缺口**，
 *   不是误命中（входной/выводной/заказной 等都是真形容词却 pos=unknown）。**v1 结论作废。**
 * ✅ v2 判据：`forms` 列里**该词自身**的 tags 含 `animate`/`inanimate`（有生性只标名词）
 *   ⇒ 该词条是**名词（含屈折形）**而非形容词。实测 `малиной` = [canonical, feminine, inanimate]。
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const dbPath = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const BASE_JSON = path.join(REPO, 'packages', 'data-pipeline', 'roots_ru.json.bak-2026-09-13T13-46-08-977Z');

const V080 = await import('./_tmp/eng_t28_v080/db/index.js');
const V090 = await import('./_tmp/eng_t28/db/index.js');
const db = new DatabaseSync(dbPath);
V080.__setReplace(JSON.parse(fs.readFileSync(BASE_JSON, 'utf8')));
V090.__setInjected([]);

const key = (ps) => ps.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');

/** 该词自身是否为名词形态（有生性标签只出现在名词上） */
function isNounForm(word, formsJson) {
  if (!formsJson) return false;
  try {
    const arr = JSON.parse(formsJson);
    return arr.some((f) => f.form === word && (f.tags || []).some((t) => t === 'animate' || t === 'inanimate'));
  } catch { return false; }
}

const rows = db.prepare("SELECT word, pos, forms, translation FROM words_i18n WHERE lang='ru'").all();
const hits = [];
for (const r of rows) {
  const p90 = V090.breakdownWord(db, r.word, 'ru');
  if (!p90.some((p) => p.morpheme === '-ной')) continue;
  const p80 = V080.breakdownWord(db, r.word, 'ru');
  hits.push({
    word: r.word, pos: r.pos, zh: (r.translation || '').split('\n')[0],
    noun: isNounForm(r.word, r.forms), space: /\s/.test(r.word), digit: /\d/.test(r.word),
    k90: key(p90), k80: key(p80),
  });
}
const gains = hits.filter((h) => h.k80 === '');

console.log(`全库 ru = ${rows.length}；v0.9.0 含 -ной 的词 = ${hits.length}；其中 v0.8.0 尚不可拆（新增）= ${gains.length}`);
console.log(`\n=== A. 名词形态误命中（forms 有生性标签判据，硬证据）: ${hits.filter((h) => h.noun).length} 词 ===`);
for (const h of hits.filter((h) => h.noun)) {
  console.log(`  ${h.word.padEnd(16)} 新增=${h.k80 === '' ? '是★' : '否 '} ${h.k90.padEnd(34)} zh=${h.zh.slice(0, 22)}`);
}

console.log(`\n=== B. 数据卫生问题 ===`);
console.log(`  含空格短语 = ${hits.filter((h) => h.space).length} 词：${hits.filter((h) => h.space).map((h) => h.word).join(' | ')}`);
console.log(`  编号重复   = ${hits.filter((h) => h.digit).length} 词：${hits.filter((h) => h.digit).map((h) => h.word).join(' ')}`);

console.log(`\n=== C. 新增可拆词中的误命中（唯一硬判据：名词形态）===`);
const badGains = gains.filter((h) => h.noun);
for (const h of badGains) console.log(`  ${h.word.padEnd(16)} ${h.k90}   zh=${h.zh.slice(0, 24)}`);
console.log(`  ⇒ 新增 ${gains.length} 词中，硬判据可确认的误命中 = ${badGains.length} 词`);

console.log(`\n=== D. 明确语义错误的个案（我人工判定，附理由）===`);
for (const w of ['паранойя', 'малиной']) {
  const h = hits.find((x) => x.word === w);
  if (!h) { console.log(`  ${w}: 未在 -ной 命中集内`); continue; }
  console.log(`  ${w.padEnd(12)} ${h.k90}   新增=${h.k80 === '' ? '是' : '否'}  zh=${h.zh.slice(0, 30)}`);
}

console.log(`\n=== E. pos 字段可用性（证伪 v1 判据）===`);
const posCount = {};
for (const h of hits) posCount[h.pos ?? '(null)'] = (posCount[h.pos ?? '(null)'] || 0) + 1;
console.log('  ' + Object.entries(posCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('  ⇒ pos 绝大多数为 unknown ⇒ **不可用于词性判别**（v1 的 182 数字作废）');
