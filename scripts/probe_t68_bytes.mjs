// scripts/probe_t68_bytes.mjs —— 只读：高频词子集的「体积按语言拆分」+「gzip 可压缩性」实测
// 目的：为 v0.11.0 decision ②（子集体积上限）提供实测依据，替代拍脑袋的数字。
// 只读 data/db/dict.db，不写任何东西；临时库建在脚本自管临时目录并自清。
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const DICT = process.env.ZIDIANKAIFA_DB ?? path.join(ROOT, 'data', 'db', 'dict.db');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't68b_'));
const out = path.join(TMP, 'sub.db');

const src = new DatabaseSync(DICT, { readOnly: true });
const st0 = fs.statSync(DICT);

const SCHEMA = `
CREATE TABLE words_i18n (word TEXT, lang TEXT, phonetic TEXT, translation TEXT, definition TEXT,
  pos TEXT, forms TEXT, audio TEXT, source TEXT);
CREATE TABLE words (word TEXT, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT,
  collins TEXT, oxford TEXT, tag TEXT, bnc INTEGER, frq INTEGER, exchange TEXT, audio TEXT);
CREATE TABLE word_etymology (word TEXT, text_en TEXT, text_zh TEXT, chain TEXT, origin TEXT,
  origin_code TEXT, source TEXT, lang TEXT);
CREATE TABLE word_forms (word TEXT, form TEXT, form_type TEXT);
`;

const N_RU = 20000;
const N_EN = 20000;

const makeEmpty = (name) => {
  const db = new DatabaseSync(path.join(TMP, name));
  db.exec(SCHEMA);
  return db;
};

// ---- A. 只装俄语侧 ----
const ruOnly = makeEmpty('ru_only.db');
{
  const rows = src.prepare(`SELECT * FROM words_i18n WHERE lang='ru' ORDER BY length(word), word LIMIT ?`).all(N_RU);
  const ins = ruOnly.prepare(`INSERT INTO words_i18n VALUES (?,?,?,?,?,?,?,?,?)`);
  ruOnly.exec('BEGIN');
  for (const r of rows) ins.run(r.word, r.lang, r.phonetic, r.translation, r.definition, r.pos, r.forms, r.audio, r.source);
  ruOnly.exec('COMMIT');
}
// ---- B. 只装英语侧（按 bncfrq 排名：bnc>0 优先，bnc 升序 = 更常用）----
const enOnly = makeEmpty('en_only.db');
{
  const rows = src.prepare(`SELECT * FROM words WHERE bnc > 0 ORDER BY bnc ASC LIMIT ?`).all(N_EN);
  const ins = enOnly.prepare(`INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  enOnly.exec('BEGIN');
  for (const r of rows) ins.run(r.word, r.phonetic, r.definition, r.translation, r.pos, r.collins, r.oxford, r.tag, r.bnc, r.frq, r.exchange, r.audio);
  enOnly.exec('COMMIT');
}

const size = (db, name) => { db.exec('VACUUM'); db.close(); return fs.statSync(path.join(TMP, name)).size; };
const sRu = size(ruOnly, 'ru_only.db');
const sEn = size(enOnly, 'en_only.db');

const M = (b) => (b / 1048576).toFixed(2);
console.log(`冻结库 = ${st0.size} B (${M(st0.size)} MiB) · 临时目录 = ${TMP}`);
console.log('');
console.log('§1 分语言体积（VACUUM 后实测）');
console.log(`  · 俄语侧 N=${N_RU}：${sRu} B (${M(sRu)} MiB) ⇒ 每词 ${(sRu / N_RU).toFixed(0)} B`);
console.log(`  · 英语侧 N=${N_EN}（bnc>0 升序）：${sEn} B (${M(sEn)} MiB) ⇒ 每词 ${(sEn / N_EN).toFixed(0)} B`);
console.log(`  · 两侧合计 = ${sRu + sEn} B (${M(sRu + sEn)} MiB)`);
console.log('');
console.log('§2 gzip 可压缩性（APK 内资源是压缩态，必须用这个数字估下载量）');
for (const [label, file, raw] of [['俄语侧', 'ru_only.db', sRu], ['英语侧', 'en_only.db', sEn]]) {
  const buf = fs.readFileSync(path.join(TMP, file));
  const gz = gzipSync(buf, { level: 9 }).length;
  console.log(`  · ${label}：原始 ${M(raw)} MiB → gzip ${M(gz)} MiB（压缩比 ${(raw / gz).toFixed(2)}×）`);
}
const ruBuf = fs.readFileSync(path.join(TMP, 'ru_only.db'));
const enBuf = fs.readFileSync(path.join(TMP, 'en_only.db'));
const gzRu = gzipSync(ruBuf, { level: 9 }).length;
const gzEn = gzipSync(enBuf, { level: 9 }).length;
console.log(`  · 两侧合计：原始 ${M(sRu + sEn)} MiB → gzip ${M(gzRu + gzEn)} MiB`);
console.log('');
console.log('§3 若要「俄语全量离线」要多大');
const fullRu = makeEmpty('ru_full.db');
{
  const rows = src.prepare(`SELECT * FROM words_i18n WHERE lang='ru'`).all();
  const ins = fullRu.prepare(`INSERT INTO words_i18n VALUES (?,?,?,?,?,?,?,?,?)`);
  fullRu.exec('BEGIN');
  for (const r of rows) ins.run(r.word, r.lang, r.phonetic, r.translation, r.definition, r.pos, r.forms, r.audio, r.source);
  fullRu.exec('COMMIT');
}
const sFullRu = size(fullRu, 'ru_full.db');
const gzFullRu = gzipSync(fs.readFileSync(path.join(TMP, 'ru_full.db')), { level: 9 }).length;
console.log(`  · 俄语全量 101,512 词：${M(sFullRu)} MiB → gzip ${M(gzFullRu)} MiB`);
console.log('');
console.log('§4 APK 体积参照（现有 debug 包实测 4,201,212 B = 4.01 MiB，不含子集）');
console.log(`  · 加俄语20k+英语20k 子集后（gzip 态）：约 ${(4.01 + (gzRu + gzEn) / 1048576).toFixed(2)} MiB`);
console.log(`  · 加俄语全量（gzip 态）：约 ${(4.01 + gzFullRu / 1048576).toFixed(2)} MiB`);
console.log('');

src.close();
fs.rmSync(TMP, { recursive: true, force: true });
const st1 = fs.statSync(DICT);
console.log(`§只读自证：size ${st0.size} → ${st1.size}（相等=${st0.size === st1.size}）· mtime 相等=${st0.mtimeMs === st1.mtimeMs} · 临时目录已清=${!fs.existsSync(TMP)}`);
