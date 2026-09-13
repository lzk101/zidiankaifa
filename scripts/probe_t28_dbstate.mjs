// T28 · 红线取证：dict.db / roots_ru.json 指纹 + 词素表现状 + 与 v0.8.0 基线的差异。
// 基线（我 T28 开工时实测，2026-09-13 21:4x，改动前）：
//   dict.db mtime=2026-09-13 05:37:43 size=494.23MB
//   roots_ru.json mtime=2026-09-13 05:32:31 size=108262B
//   morphemes: total 909 = ru 441 (prefix185/root163/suffix93) + en 468
//   生产指标：可拆 33174 · 口径A 20214 · 口径B 18762 · 真前缀组 75 · да- 63 · R 238(30.0885%) · L4A 134 · L4B 129 · 判据① 342 · 30 红
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const dbPath = path.join(REPO, 'data', 'db', 'dict.db');
const st = fs.statSync(dbPath);
console.log('=== 文件指纹现状 ===');
console.log(`dict.db        mtime=${st.mtime.toISOString()} size=${(st.size / 1048576).toFixed(2)}MB`);
for (const f of ['data/db/dict.db-wal', 'data/db/dict.db-shm', 'packages/data-pipeline/roots_ru.json', 'packages/data-pipeline/roots.json']) {
  const p = path.join(REPO, f);
  if (fs.existsSync(p)) { const s = fs.statSync(p); console.log(`${f.padEnd(42)} mtime=${s.mtime.toISOString()} size=${s.size}`); }
  else console.log(`${f.padEnd(42)} (不存在)`);
}

const db = new DatabaseSync(dbPath);
const c = (q) => db.prepare(q).get().c;
console.log('\n=== morphemes 现状 ===');
console.log('total =', c('SELECT COUNT(1) c FROM morphemes'));
console.log("ru    =", c("SELECT COUNT(1) c FROM morphemes WHERE lang='ru'"), '  （基线 441）');
console.log("en    =", c("SELECT COUNT(1) c FROM morphemes WHERE lang='en'"), '  （基线 468）');
console.log('ru by kind:', JSON.stringify(db.prepare("SELECT kind, COUNT(1) c FROM morphemes WHERE lang='ru' GROUP BY kind").all()));
console.log('roots =', c('SELECT COUNT(1) c FROM roots'), ' affixes =', c('SELECT COUNT(1) c FROM affixes'), '（基线 476 / 403）');
console.log('words_i18n ru =', c("SELECT COUNT(1) c FROM words_i18n WHERE lang='ru'"), '（基线 101512）');

console.log('\n=== v0.8.0 已知词素总数差（相对基线 441）===');
console.log(`ru 净增 = ${c("SELECT COUNT(1) c FROM morphemes WHERE lang='ru'") - 441}`);

console.log('\n=== 表结构（确认无 schema 漂移）===');
console.log('morphemes:', db.prepare("SELECT name FROM pragma_table_info('morphemes')").all().map((r) => r.name).join(','));

// 目标候选是否已落库
const TARGETS = ['суч-', 'суд-', 'стат-', 'домин-', 'доми-', 'столп-', 'казус-', 'однако-', '-ной', 'больной-', 'пад-', 'тряс-'];
console.log('\n=== T24 候选在库内的存在性（LIKE 前缀匹配）===');
for (const t of TARGETS) {
  const stem = t.replace(/^-+|-+$/g, '');
  const rows = db.prepare("SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang='ru' AND (morpheme = ? OR morpheme LIKE ?)").all(t, stem + '%');
  console.log(`${t.padEnd(10)} → ${rows.length} 行 ${rows.slice(0, 4).map((r) => `${r.morpheme}[${r.kind}]`).join(' ')}`);
}

// 全部 ru root/suffix 中，词条含 суч/суд/стат/домин/столп/казус/однако/ной
console.log('\n=== 精确查（stem 相等）===');
for (const t of TARGETS) {
  const stem = t.replace(/^-+|-+$/g, '');
  const r = db.prepare("SELECT morpheme, kind, meaning_zh, meaning_en, origin, examples FROM morphemes WHERE lang='ru' AND replace(replace(morpheme,'-',''),'ё','е') = ?").get(stem);
  console.log(`${t.padEnd(10)} → ${r ? `已落库 kind=${r.kind} zh=${r.meaning_zh} origin=${r.origin} examples=${r.examples}` : '未落库'}`);
}
