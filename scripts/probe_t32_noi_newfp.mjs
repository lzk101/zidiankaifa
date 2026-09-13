/**
 * probe_t32_noi_newfp.mjs —— T32 独立发现：`-ной`（v0.9.0 新落库）是否引入新假拆解
 * 功能测试 agent · 只读 · 2026-09-13
 * 方法：v0.8.0 引擎（scripts/_tmp/eng_t28_v080 + __setReplace(基线 441 条)） vs
 *       v0.9.0 引擎（scripts/_tmp/eng_t28 = 生产 dist，保真已验证）逐词对比。
 * 目的：区分「`-ной` 带来的 176 个增益」里，哪些是**真形容词**、哪些是**屈折形误命中**。
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

const baseline = JSON.parse(fs.readFileSync(BASE_JSON, 'utf8'));
V080.__setReplace(baseline);
V090.__setInjected([]);

const key = (ps) => ps.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');
const bd80 = (w) => key(V080.breakdownWord(db, w, 'ru'));
const bd90 = (w) => key(V090.breakdownWord(db, w, 'ru'));

console.log('=== 0. words_i18n 结构（找 POS 字段以精确判别屈折形）===');
const cols = db.prepare('PRAGMA table_info(words_i18n)').all();
console.log('  ' + cols.map((c) => `${c.name}:${c.type}`).join('  '));

console.log('\n=== 1. 靶标复核：малиной 在 v0.8.0 / v0.9.0 ===');
for (const w of ['малиной', 'весной', 'зимой']) {
  const r = db.prepare('SELECT * FROM words_i18n WHERE word = ? AND lang = ?').get(w, 'ru');
  console.log(`  ${w.padEnd(10)} v0.8.0=${JSON.stringify(bd80(w)).padEnd(30)} v0.9.0=${JSON.stringify(bd90(w))}`);
  console.log(`     行=${JSON.stringify(r)}`);
}

console.log('\n=== 2. `-ной` 的 72 词关联表：v0.8.0 → v0.9.0 变化 ===');
const arr = JSON.parse(db.prepare("SELECT words FROM affixes WHERE morpheme = ?").get('-ной').words);
let newSplit = 0, unchanged = 0, other = 0;
const newly = [];
for (const w of arr) {
  const a = bd80(w);
  const b = bd90(w);
  if (a === b) { unchanged++; continue; }
  if (a === '' && b !== '') { newSplit++; newly.push({ w, b }); }
  else other++;
}
console.log(`  72 词中：v0.8.0 不可拆→v0.9.0 可拆 = ${newSplit}；无变化 = ${unchanged}；其他变化 = ${other}`);
console.log('  新可拆明细：');
for (const n of newly) console.log(`    ${n.w.padEnd(13)} → ${n.b}`);

console.log('\n=== 3. 屈折形判别（词尾 -ной 但实为「名词 + 工具格 -ой」）===');
// 硬判据：该词去掉末 2 字符（ой）后 + а / я 命名词主格，且该词本身**不是**形容词。
// 无 POS 字段时用保守判据：主格名词在库 + 该词无 -ный 阳性格对应形。
let confirmed = [];
for (const w of arr) {
  const stem = w.slice(0, -2);
  const nom = [stem + 'а', stem + 'я'].filter((c) =>
    db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE word = ? AND lang='ru'").get(c).n > 0);
  if (!nom.length) continue;
  // 形容词应有 -ный 阳性形（сводный/лесной→лесный×, 用 -ой→-ый 与 -ный 两种）
  const adjNom = [stem + 'ный', w.slice(0, -1) + 'ый'].filter((c) =>
    db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE word = ? AND lang='ru'").get(c).n > 0);
  console.log(`  ${w.padEnd(13)} 主格名词候选=${nom.join('/').padEnd(16)} 形容词阳性候选=${adjNom.join('/') || '无'}  拆解=${JSON.stringify(bd90(w))}`);
  if (!adjNom.length) confirmed.push(w);
}
console.log(`\n  ⇒ 无形容词阳性对应形、疑为屈折形 = ${confirmed.length} 词：${confirmed.join(' ') || '（无）'}`);
