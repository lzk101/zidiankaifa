/**
 * probe_t32_book_migration_forensics.mjs —— T32 红线取证：book 迁移是否改动了冻结的 dict.db
 * 功能测试 agent · 2026-09-13/14
 *
 * 背景（我的观测）：跑 ru_morph_v090_guard.mjs 时 stderr 出现
 *   `[zidiankaifa] book 迁移前备份失败（继续迁移）：fs is not defined`
 * 该逻辑来自**未提交**的 packages/core/src/db/index.ts（工作区 +94/-1，另一个 agent 正在写），
 * 它在 openDatabase() 内运行。若「继续迁移」真的执行了，会写 dict.db（经 WAL），
 * 而主库 mtime 仍是 23:13:53 —— **WAL 会掩盖写入**。本探针用**只读**连接核证。
 *
 * ⚠ 本探针必须只读打开：不用 dist 的 openDatabase（那会触发迁移），用 node:sqlite readOnly。
 */
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');

console.log(`只读连接：${DB}`);
const db = new DatabaseSync(DB, { readOnly: true });

console.log('\n=== A. book 表结构（判据：pk 列是否已是复合 (word, lang)）===');
let cols;
try {
  cols = db.prepare('PRAGMA table_info(book)').all();
} catch (e) {
  console.log('  PRAGMA 失败：' + e.message);
  cols = [];
}
if (!cols.length) {
  console.log('  ** book 表不存在 **');
} else {
  console.log('  列:', cols.map((c) => `${c.name}(pk=${c.pk})`).join('  '));
  const pk = cols.filter((c) => Number(c.pk) > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  console.log(`  ⇒ 主键 = ${JSON.stringify(pk)}`);
  console.log(`  ⇒ 是否已迁移为复合主键 (word, lang)：${pk.length === 2 && pk.includes('word') && pk.includes('lang') ? '**是（已迁移！）**' : '否'}`);
}
console.log('  book 行数 =', db.prepare('SELECT COUNT(1) AS n FROM book').get().n);

console.log('\n=== B. schema 快照：book 的建表 SQL ===');
const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='book'").get();
console.log('  ' + (sql?.sql ?? '（无）').replace(/\s+/g, ' '));

console.log('\n=== C. journal 模式与 WAL 状态 ===');
console.log('  journal_mode =', db.prepare('PRAGMA journal_mode').get().journal_mode);
console.log('  page_count =', db.prepare('PRAGMA page_count').get().page_count);
console.log('  freelist_count =', db.prepare('PRAGMA freelist_count').get().freelist_count);
console.log('  schema_version =', db.prepare('PRAGMA schema_version').get().schema_version);

console.log('\n=== D. 核心表规模（与 T29 基线对比，确认无写入）===');
for (const q of [
  ['words_i18n(ru)', "SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'"],
  ['morphemes', 'SELECT COUNT(1) AS n FROM morphemes'],
  ['morphemes(ru)', "SELECT COUNT(1) AS n FROM morphemes WHERE lang='ru'"],
  ['roots', 'SELECT COUNT(1) AS n FROM roots'],
  ['affixes', 'SELECT COUNT(1) AS n FROM affixes'],
  ['word_etymology', 'SELECT COUNT(1) AS n FROM word_etymology'],
]) console.log(`  ${q[0].padEnd(16)} ${db.prepare(q[1]).get().n}`);

console.log('\n=== E. 9 条 v0.9.0 词素仍在（确认库内容未变）===');
const ms = db.prepare("SELECT morpheme FROM morphemes WHERE lang='ru' AND morpheme IN ('суч-','суд-','домин-','-ной','пад-','тряс-','столп-','казус-','однако-') ORDER BY morpheme").all().map((r) => r.morpheme);
console.log(`  ${ms.length}/9 : ${ms.join(' ')}`);
db.close();
