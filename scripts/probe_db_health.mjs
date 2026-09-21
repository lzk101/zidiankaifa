/**
 * T94 · 污染现场勘察（只读，不写任何库）
 *
 * 背景：pump 诊断脚本因 Start-Process 不继承 pwsh 动态环境变量，打到了生产库
 *       （data/db/dict.db + data/sync-data/sync.db），并向生产 sync 库写入了测试账号。
 *
 * 目的：
 *   1. 读清 sync.db 当前真实内容（含 WAL 里的未 checkpoint 内容）
 *   2. 找出本次泄漏写入的测试账号/生词（用于精确回滚）
 *   3. 读清 dict.db 的 WAL 里到底改了什么
 * 纪律：**全程只读**（readOnly: true），不做任何写入。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DICT = path.join(REPO, 'data', 'db', 'dict.db');
const SYNC = path.join(REPO, 'data', 'sync-data', 'sync.db');

const fp = (p) => (existsSync(p) ? `${statSync(p).size} B / ${statSync(p).mtime.toISOString()}` : '不存在');

console.log('===== T94 污染现场勘察（只读）=====');
console.log(`dict.db      ${fp(DICT)}`);
console.log(`  -wal       ${fp(DICT + '-wal')}`);
console.log(`sync.db      ${fp(SYNC)}`);
console.log(`  -wal       ${fp(SYNC + '-wal')}`);
console.log('');

/** 只读打开；若 -wal 存在，只读连接也能看到 WAL 中已提交的内容 */
function inspect(label, p, queries) {
  console.log(`===== ${label} =====`);
  if (!existsSync(p)) { console.log('  （文件不存在）\n'); return; }
  let db;
  try {
    db = new DatabaseSync(p, { readOnly: true });
  } catch (e) {
    console.log(`  ⚠ 只读打开失败：${e.message}\n`);
    return;
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((t) => t.name);
    console.log(`  表(${tables.length})：${tables.join(', ')}`);
    for (const [name, sql] of Object.entries(queries)) {
      try {
        const rows = db.prepare(sql).all();
        console.log(`  ${name} ⇒ ${rows.length} 行`);
        for (const r of rows.slice(0, 25)) console.log(`      ${JSON.stringify(r)}`);
        if (rows.length > 25) console.log(`      …（余 ${rows.length - 25} 行略）`);
      } catch (e) {
        console.log(`  ${name} ⇒ 查询失败：${e.message}`);
      }
    }
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
  console.log('');
}

inspect('sync.db（用户数据 · 读写层）', SYNC, {
  'book 全量': 'SELECT * FROM book',
  'book 计数': 'SELECT COUNT(1) AS n FROM book',
  'users': 'SELECT * FROM users',
  'auth_tokens': 'SELECT token_hash, user_id, label FROM auth_tokens',
});

inspect('dict.db（冻结词库 · 只读层）', DICT, {
  'book 计数': 'SELECT COUNT(1) AS n FROM book',
  'book 内容': 'SELECT * FROM book',
  'book 主键列': "SELECT name FROM pragma_table_info('book')",
  'morphemes 计数': 'SELECT COUNT(1) AS n FROM morphemes',
  'roots 计数': 'SELECT COUNT(1) AS n FROM roots',
  'affixes 计数': 'SELECT COUNT(1) AS n FROM affixes',
  'words_i18n(ru) 计数': "SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'",
  'words 计数': 'SELECT COUNT(1) AS n FROM words',
});

console.log('===== 冻结库基准表行数（对照 AGENTS.md 铁律）=====');
{
  const db = new DatabaseSync(DICT, { readOnly: true });
  const want = { words: 770611, ru: 101512, morphemes: 918, roots: 492, affixes: 416 };
  const got = {
    words: db.prepare('SELECT COUNT(1) AS n FROM words').get().n,
    ru: db.prepare("SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru'").get().n,
    morphemes: db.prepare('SELECT COUNT(1) AS n FROM morphemes').get().n,
    roots: db.prepare('SELECT COUNT(1) AS n FROM roots').get().n,
    affixes: db.prepare('SELECT COUNT(1) AS n FROM affixes').get().n,
  };
  for (const k of Object.keys(want)) {
    console.log(`  ${k.padEnd(12)} 实测 ${String(got[k]).padStart(8)}  期望 ${String(want[k]).padStart(8)}  ${got[k] === want[k] ? '\u2705' : '\u274c'}`);
  }
  console.log(`  integrity_check = ${db.prepare('PRAGMA integrity_check').get().integrity_check}`);
  db.close();
}
