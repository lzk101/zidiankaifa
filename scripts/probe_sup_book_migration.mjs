/**
 * 主管独立核验：book 表 (word, lang) 复合主键迁移（AC-12 判定式 1–8）。
 *
 * 只读原则：**不使用 data/db/dict.db**，全部在 os.tmpdir() 下合成老库后删除。
 * 目的：在测试 agent 的 book_lang.mjs 落地前，主管侧先独立确认迁移语义成立。
 *
 * ⚠ 主管自纠（本探针第一版有缺陷，已修）：bookListAll/bookList 经 API 层把 `deleted` 由 SQL 的
 * `0/1` 映射为 **boolean**（`false/true`），我首版用 `b.deleted !== 1` 过滤 ⇒ **把墓碑误判为存活**
 * （实测 `bookRemove` 缺省其实正确只删了 en）。教训同 `AGENTS.md` §4.1：断言写错会产出假红。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const DIST = pathToFileURL(path.resolve('packages/core/dist/db/index.js')).href;
const core = await import(DIST);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-bookmig-'));
const dbPath = path.join(dir, 'legacy.db');

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

// ---------- 造一个「老结构」库：word TEXT PRIMARY KEY，且 3 行全为墓碑 ----------
{
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE book (
      word             TEXT PRIMARY KEY,
      lang             TEXT NOT NULL DEFAULT 'en',
      added_at         INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      status           TEXT NOT NULL DEFAULT 'new',
      note             TEXT,
      tags             TEXT NOT NULL DEFAULT '[]',
      review_count     INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at INTEGER,
      deleted          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_book_updated ON book(updated_at);
    INSERT INTO book VALUES
      ('gone',    'en', 1000, 2000, 'new',      NULL,      '["a"]', 1, NULL, 1),
      ('умер',    'ru', 1001, 2001, 'learning', 'note-ру', '[]',    2, 1999, 1),
      ('deleted', 'en', 1002, 2002, 'mastered', 'note-en', '["b"]', 3, 1998, 1);
  `);
  db.close();
}

const before = (() => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare('SELECT * FROM book ORDER BY word').all();
  const pk = db.prepare('PRAGMA table_info(book)').all();
  db.close();
  return { rows, pkCols: pk.filter((c) => Number(c.pk) > 0).map((c) => c.name) };
})();

console.log('\n=== §0 前置：老库形状 ===');
ok(before.rows.length === 3, '老库 3 行', `实得 ${before.rows.length}`);
ok(
  before.pkCols.length === 1 && before.pkCols[0] === 'word',
  '老库主键 = 单列 word',
  `实得 [${before.pkCols.join(', ')}]`
);

// ---------- 触发迁移：openDatabase 走 SCHEMA_SQL + 迁移段 ----------
console.log('\n=== §1 迁移（AC-12 判定式 1、2）===');
const db = core.openDatabase(dbPath);
const pkAfter = db
  .prepare('PRAGMA table_info(book)')
  .all()
  .filter((c) => Number(c.pk) > 0)
  .map((c) => c.name);
ok(pkAfter.length === 2 && pkAfter.includes('word') && pkAfter.includes('lang'),
  '迁移后 两列 pk>0（word 与 lang）', `实得 [${pkAfter.join(', ')}]`);

// ---------- 保数据（判定式 3） ----------
console.log('\n=== §2 逐字段保真（AC-12 判定式 3，含墓碑）===');
const after = db.prepare('SELECT * FROM book ORDER BY word').all();
ok(after.length === before.rows.length, '行数不变', `${before.rows.length} → ${after.length}`);
const FIELDS = ['word', 'lang', 'added_at', 'updated_at', 'status', 'note', 'tags', 'review_count', 'last_reviewed_at', 'deleted'];
let fieldMismatch = 0;
for (let i = 0; i < before.rows.length; i += 1) {
  for (const f of FIELDS) {
    if (before.rows[i][f] !== after[i][f]) {
      fieldMismatch += 1;
      console.log(`    ✗ 字段不保真 ${before.rows[i].word}.${f}: ${before.rows[i][f]} → ${after[i][f]}`);
    }
  }
}
ok(fieldMismatch === 0, '全部字段逐字段相等（10 字段 × 3 行）', `不符 ${fieldMismatch} 处`);
ok(after.every((r) => r.deleted === 1), '墓碑全部保留 deleted=1');
ok(after.find((r) => r.word === 'умер')?.lang === 'ru', '墓碑 lang 未被写成 en（yмер 仍为 ru）');

// ---------- 备份（AC-12 判定式 8） ----------
console.log('\n=== §3 迁移前备份（AC-12 第 8 条）===');
const baks = fs.readdirSync(dir).filter((f) => f.includes('.bak-'));
ok(baks.length === 1, '产生且仅产生 1 个 .bak-<ISO> 备份', `实得 ${baks.length}：${baks.join(', ')}`);
ok(baks.length === 1 && /\.bak-\d{4}-\d{2}-\d{2}T/.test(baks[0]), '备份名含 ISO 时间戳');

// ---------- 幂等（判定式 4） + 不重复备份 ----------
console.log('\n=== §4 幂等（AC-12 判定式 4 + 第 8 条「不重复备份」）===');
const snapshot1 = JSON.stringify(db.prepare('SELECT * FROM book ORDER BY word').all());
db.close();
const db2 = core.openDatabase(dbPath); // 第二次打开
const snapshot2 = JSON.stringify(db2.prepare('SELECT * FROM book ORDER BY word').all());
ok(snapshot1 === snapshot2, '连续两次 openDatabase 后行内容完全一致');
const pk2 = db2.prepare('PRAGMA table_info(book)').all().filter((c) => Number(c.pk) > 0).map((c) => c.name);
ok(pk2.length === 2, '第二次打开后仍为复合主键');
const baks2 = fs.readdirSync(dir).filter((f) => f.includes('.bak-'));
ok(baks2.length === 1, '幂等重跑不产生第二个备份', `实得 ${baks2.length} 个`);

// ---------- 索引（判定式 7） ----------
console.log('\n=== §5 idx_book_updated 仍在（AC-12 判定式 7）===');
const idx = db2.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='book'").all().map((r) => r.name);
ok(idx.includes('idx_book_updated'), 'idx_book_updated 存在', `实得 [${idx.join(', ')}]`);

// ---------- AC-13 跨语言隔离（真库层，非展示层） ----------
console.log('\n=== §6 跨语言隔离（AC-13：同词双语言互不覆盖）===');
core.bookAdd(db2, 'test', [], 'en');
core.bookAdd(db2, 'test', [], 'ru');
const both = core.bookListAll(db2).filter((b) => b.word === 'test' && b.deleted !== true);
ok(both.length === 2, `同词双语言各存一条（bookListAll 计 ${both.length}）`);
core.bookRemove(db2, 'test', 'ru');
const enItem = core.bookGet(db2, 'test', 'en');
ok(enItem !== null && enItem.deleted !== true, '删除 ru 后 en 条仍存活（未被连带删除）');
const ruRow = db2.prepare("SELECT deleted, lang FROM book WHERE word = 'test' AND lang = 'ru'").get();
ok(ruRow && ruRow.deleted === 1 && ruRow.lang === 'ru', 'ru 墓碑 lang 仍为 ru（未回退 en）');

// ---------- D17 缺省语义（需求明确规定的不对称设计） ----------
console.log('\n=== §7 缺省 lang 语义（D17：不对称是有意为之）===');
core.bookAdd(db2, 'dual', [], 'en');
core.bookAdd(db2, 'dual', [], 'ru');
const listNoLang = core.bookListAll(db2).filter((b) => b.word === 'dual' && b.deleted !== true);
ok(listNoLang.length === 2, 'bookListAll 缺省 = 不过滤，返回全部语言', `实得 ${listNoLang.length} 条`);
const listEn = core.bookList(db2, 'en').filter((b) => b.word === 'dual' && b.deleted !== true);
ok(listEn.length === 1 && listEn[0].lang === 'en', 'bookList(db, "en") = 只返 en');
const listRu = core.bookList(db2, 'ru').filter((b) => b.word === 'dual' && b.deleted !== true);
ok(listRu.length === 1 && listRu[0].lang === 'ru', 'bookList(db, "ru") = 只返 ru');
const getDef = core.bookGet(db2, 'dual');
ok(getDef !== null && getDef.lang === 'en', 'bookGet 缺省 lang = "en"（与历史行为一致）');
ok(getDef !== null && getDef.deleted !== true, 'bookGet 缺省未意外命中墓碑');

// bookRemove 缺省：word 在两语言都存在时必须有确定行为（不得随机/不得双删）
core.bookRemove(db2, 'dual');
const afterRem = core.bookListAll(db2).filter((b) => b.word === 'dual');
const alive = afterRem.filter((b) => b.deleted !== true);
ok(alive.length === 1, 'bookRemove 缺省只删一条，另一语言仍存活', `存活 ${alive.length} 条`);

db2.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n===== 主管核验：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
