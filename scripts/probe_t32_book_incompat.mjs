/**
 * probe_t32_book_incompat.mjs —— T32 红线取证(2)：迁移后的 schema 与**已发布 v0.9.0** 代码是否兼容
 * 功能测试 agent · 只读
 *
 * 事实：
 *   · HEAD（已发布 v0.9.0）packages/core/src/db/index.ts:960 用 `ON CONFLICT(word) DO UPDATE SET …`
 *   · HEAD 的 schema.ts 声明 `book(word TEXT PRIMARY KEY)`
 *   · 而 dict.db 的 book 现行主键已是 **(word, lang)**（被未提交的迁移改写）
 * ⇒ 若 SQLite 在 prepare 阶段即拒绝 `ON CONFLICT(word)`，则**已发布代码对本库的生词本写入会直接报错**。
 * 本探针**只 prepare 不 execute**，用只读连接，不产生任何写入。
 */
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DB = process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB, { readOnly: true });

console.log('现行 schema：', db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='book'").get().sql.replace(/\s+/g, ' ').slice(0, 200));

// HEAD(v0.9.0) 的原文片段（只取 ON CONFLICT 行以复现约束匹配）
const OLD = `INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(word) DO UPDATE SET
    updated_at = excluded.updated_at,
    status = excluded.status`;
const NEW = `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(word, lang) DO UPDATE SET
    updated_at = excluded.updated_at,
    status = excluded.status`;

for (const [label, sql] of [['HEAD/v0.9.0  ON CONFLICT(word)', OLD], ['工作区(未提交) ON CONFLICT(word, lang)', NEW]]) {
  try {
    db.prepare(sql);
    console.log(`  ✅ ${label}  —— prepare 成功（兼容）`);
  } catch (e) {
    console.log(`  ❌ ${label}  —— prepare 失败：${e.message}`);
  }
}

console.log('\n参照：只读连接下的表结构快照');
console.log('  pk =', db.prepare('PRAGMA table_info(book)').all().filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name).join(','));
db.close();
