/**
 * probe_t50_reuse_edges.mjs —— T50 只读探针：T49「复用已有迁移前备份」策略的**两个边界**
 *   （★ T52 复跑：T51 已把判据收紧 ⇒ 本探针现在是**回归证据**，S1/S2 都应打印 NO = 洞已堵）
 *
 * 目的：为 T50 回报里对 T49 复用策略的评价提供**可复核证据**（不改 src / 不碰 data/db/dict.db）。
 *
 * 被测代码：`packages/core/dist/db/index.js` 的 `ensurePreMigrationBackup(db, st, isRetry)`。
 *   · **T49 判据（探针当初测的那一版）**：扫主库目录，只要存在**非空**的
 *     `<basename(db)>.bak-<任意后缀>` 即复用（不校验 ISO 后缀、不校验内容）——
 *     本探针的 S1/S2 证明该判据过宽。
 *   · **T51 判据（现行，src `packages/core/src/db/index.ts:240-283`）**：只看
 *     `st.bak`（**同一次迁移调用内**刚创建、且 `statSync().size > 0` 验证过的那份）；
 *     重试递归传同一个 `st` ⇒ 复用只可能发生在「本次调用已创建」时。
 *   ⇒ 自 T51 起：**S1 与 S2 的洞都不应再复现**（本探针的判定行就是回归断言）。
 *
 * 场景：
 *   S1 **陈旧备份复用**：同目录已有一个 `.bak-<ISO>`（内容是**另一个库**的快照，与本次迁移的数据无关）
 *      ⇒ T49：打印「复用已有迁移前备份」，**不**新建快照 ⇒ 本次迁移的「回退点」并非本次迁移前的数据。
 *      ⇒ T51：**不**复用 ⇒ 新建一份内容 == 本次迁移前数据的新快照（判定行应打印 NO）。
 *   S2 **只剩 sidecar**：真备份不存在，只有 `<db>.bak-<ISO>-wal`（SQLite 为「被打开过的备份」生成的
 *      sidecar，T49 的前缀匹配**会**命中它）
 *      ⇒ T49：判定「已有备份」而**跳过新建**，但磁盘上**没有任何可用快照**（唯一命中的文件是 WAL
 *         索引，不能作为库打开）⇒ 迁移在**零回退点**下进行（AC-12⑧「与事务并列的第二道独立
 *         防线」在该路径上落空）。
 *      ⇒ T51：必新建 ⇒ 可用快照数 1（判定行应打印 NO）。
 *   S0 **对照**：干净目录 ⇒ 正常新建 1 份，且备份逐字段 == 迁移前数据（证明 S1/S2 的差异来自复用分支）。
 *
 * ⚠ 日志文案（判定行的匹配串）：T49 `复用已有迁移前备份` → **T51 `复用本次迁移已创建的快照`**。
 *   本探针**只匹配新文案**，并另打印「任何含『复用』的行」以便人工核对（旧串若残留会被看见）。
 *
 * 运行：node scripts/probe_t50_reuse_edges.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STDERR = process.stderr.write.bind(process.stderr);
const RUN = path.join(__dirname, '_tmp', 't50_probe', `run-${Date.now().toString(36)}`);
fs.mkdirSync(RUN, { recursive: true });

const COLS = `word TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'en',
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0`;

/** 老结构库（只有 `word` 单主键 ⇒ 触发真迁移） */
function makeOldDb(file, words) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE book (${COLS})`);
  db.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const ins = db.prepare(`INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
    VALUES (?, 'en', 1000, 2000, 'new', NULL, '[]', 0, NULL, 0)`);
  for (const w of words) ins.run(w);
  db.close();
}
const snap = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  let rows = [];
  try {
    rows = db.prepare('SELECT word FROM book ORDER BY word').all().map((r) => r.word);
  } catch (e) {
    rows = [`<打不开：${e.message}>`];
  }
  db.close();
  return rows;
};
const pk = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  const c = db.prepare('PRAGMA table_info(book)').all();
  db.close();
  return c.filter((x) => Number(x.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((x) => x.name);
};
const bakList = (file) => {
  const base = path.basename(file) + '.bak-';
  return fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(base));
};
/** 捕获 openDatabase 期间的 stdout/stderr（两种体例都收：实现用 console.log 打复用日志） */
function run(fn) {
  const out = [];
  const err = [];
  const ol = console.log;
  const ow = console.warn;
  console.log = (...a) => out.push(a.join(' '));
  console.warn = (...a) => err.push(a.join(' '));
  let value = null;
  let error = null;
  try {
    value = fn();
  } catch (e) {
    error = e;
  } finally {
    console.log = ol;
    console.warn = ow;
  }
  return { value, error, out, err };
}
const ISO = new Date().toISOString().replace(/[:.]/g, '-');

console.log('='.repeat(100));
console.log('S0 对照：干净目录（无同名 .bak- 文件）⇒ 应**新建** 1 份快照');
{
  const f = path.join(RUN, 's0_clean.db');
  makeOldDb(f, ['alpha', 'beta']);
  const before = snap(f);
  const r = run(() => openDatabase(f));
  const baks = bakList(f);
  console.log(`   主键=${JSON.stringify(pk(f))} · 备份=${JSON.stringify(baks)}`);
  console.log(`   备份内容=${JSON.stringify(baks.length ? snap(path.join(RUN, baks[0])) : null)} · 迁移前=${JSON.stringify(before)}`);
  console.log(`   复用日志=${JSON.stringify(r.out.filter((l) => l.includes('复用')))} · 抛出=${r.error ? r.error.message : 'null'}`);
  console.log(
    `   ⇒ 判定：新建=${baks.length === 1 ? 'YES ✔' : 'NO ✘'} · 备份==迁移前=${JSON.stringify(baks.length ? snap(path.join(RUN, baks[0])) : null) === JSON.stringify(before) ? 'YES ✔' : 'NO ✘'}`,
  );
}

console.log('='.repeat(100));
console.log('S1 陈旧备份复用：同目录已有 `.bak-<ISO>`（内容为**另一个库**的快照，与本次数据无关）');
{
  const dir = path.join(RUN, 's1');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 's1.db');
  // 先造一个「陈旧"备份"」：另一个库的快照（词 = stale-row），刻意非空
  const other = path.join(dir, 'other.db');
  makeOldDb(other, ['stale-row']);
  fs.copyFileSync(other, `${f}.bak-2020-01-01T00-00-00-000Z`);
  fs.rmSync(other);
  makeOldDb(f, ['alpha', 'beta']);
  const before = snap(f);
  const baksBefore = bakList(f);
  const r = run(() => openDatabase(f));
  const baksAfter = bakList(f);
  const bakSnap = snap(path.join(dir, baksBefore[0]));
  console.log(`   迁移前备份=${JSON.stringify(baksBefore)}（内容=${JSON.stringify(bakSnap)}）· 本次数据=${JSON.stringify(before)}`);
  console.log(`   迁移后备份=${JSON.stringify(baksAfter)} · 主键=${JSON.stringify(pk(f))} · 抛出=${r.error ? r.error.message : 'null'}`);
  console.log(`   复用日志=${JSON.stringify(r.out.filter((l) => l.includes('复用')))}`);
  console.log(
    `   ⇒ 判定：复用了陈旧文件=${r.out.some((l) => l.includes('复用本次迁移已创建的快照')) ? 'YES（= T49 语义，判据过宽 ⚠）' : 'NO ✔（T51 判据）'}` +
      ` · 未新建第二份=${baksAfter.length === 1 ? 'YES（= T49 语义 ⚠）' : 'NO ✔（T51：已新建）'}` +
      ` · **陈旧文件内容 != 本次迁移前数据**=${JSON.stringify(bakSnap) !== JSON.stringify(before) ? 'YES（陈旧件与本次数据无关 ⇒ T51 下它**不再**是本次迁移的回退点，见下一行 🆕）' : 'NO（陈旧件恰好等于本次数据 ⇒ 本场景无鉴别力）'}`,
  );
  // ★ T52 新增：T51 判据下应出现「**本次新建**且内容 == 本次迁移前数据」的那一份
  {
    const fresh = baksAfter.filter((b) => b !== path.basename(baksBefore[0]));
    const freshSnap = fresh.length ? snap(path.join(dir, fresh[0])) : null;
    console.log(
      `   新建份=${JSON.stringify(fresh)} · 内容=${JSON.stringify(freshSnap)} · 内容==本次迁移前=${JSON.stringify(freshSnap) === JSON.stringify(before) ? 'YES ✔' : 'NO ✘'}`,
    );
  }
}

console.log('='.repeat(100));
console.log('S2 只剩 sidecar：真备份移走，只留 `<db>.bak-<ISO>-wal`（实现前缀匹配会命中它）');
{
  const dir = path.join(RUN, 's2');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 's2.db');
  const stale = `${f}.bak-2020-01-01T00-00-00-000Z`;
  const sidecar = `${stale}-wal`;
  makeOldDb(f, ['alpha', 'beta']);
  fs.writeFileSync(sidecar, Buffer.alloc(4096, 7)); // 非空「备份」：只有 -wal sidecar
  const before = snap(f);
  console.log(`   迁移前目录内匹配 ${path.basename(f)}.bak- 前缀的文件=${JSON.stringify(bakList(f))}（真备份**不存在**，只有 -wal sidecar）`);
  const r = run(() => openDatabase(f));
  const after = bakList(f);
  const realBaks = after.filter((x) => !x.includes('-wal') && !x.includes('-shm'));
  console.log(`   迁移后文件=${JSON.stringify(after)} · 主键=${JSON.stringify(pk(f))} · 数据=${JSON.stringify(snap(f))}（迁移前 ${JSON.stringify(before)}）`);
  console.log(`   复用日志=${JSON.stringify(r.out.filter((l) => l.includes('复用')))} · 抛出=${r.error ? r.error.message : 'null'}`);
  console.log(`   ⇒ 判定：可用快照数=${realBaks.length} · **迁移在零可用快照下进行**=${realBaks.length === 0 && pk(f).length === 2 ? 'YES ⚠⚠' : 'NO'}`);
  // 清掉手工造的 sidecar，避免影响后续
  fs.rmSync(sidecar, { force: true });
}

console.log('='.repeat(100));
console.log(`临时目录（取证，本探针不自动清理）：${RUN}`);
