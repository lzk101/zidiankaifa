/**
 * probe_t46_backup_fail.mjs —— 独立验证：**备份失败**路径是否也受「后置校验」保护
 *
 * 背景（主管 T45 变更②）：`migrateBookCompositeKey` 末尾加了 `if (!isBookComposite(db)) throw`
 * —— 但该后置校验位于 try/catch **之后**，而函数内有两处提前 `return`（放弃迁移）：
 *   ① `取不到主库文件路径`
 *   ② `备份失败（…），放弃迁移（数据优先）`
 * 两处 `return` 都**跳过**后置校验 ⇒ 若成立，则「静默降级」并未被消除，只是被缩小到这两条路径。
 *
 * 判别手段（确定性，不依赖时序）：冻结 `Date`（备份名为 `<db>.bak-<ISO ms>`）⇒ 预先在该路径上
 * 放一个占位对象 ⇒ `VACUUM INTO` 必然失败（"output file already exists"）⇒ 走「备份失败」分支。
 * 只读探针：夹具全在 scripts/_tmp/probe_t46b/；不动 packages/core/**、dist/**、package.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist');
const TMP = path.join(REPO_ROOT, 'scripts', '_tmp', 'probe_t46b');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const distMod = await import(pathToFileURL(path.join(DIST, 'db', 'index.js')).href);
const { openDatabase, bookAdd, bookList, bookListAll } = distMod;

const ISO = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
function baks(file) {
  const dir = path.dirname(file);
  const base = path.basename(file) + '.bak-';
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${ISO}$`);
  return fs.readdirSync(dir).filter((f) => re.test(f)).sort();
}
const OLD_DDL = `CREATE TABLE book (
  word TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'en',
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0)`;
const INS = `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, 'new', NULL, '[]', 0, NULL, 0)`;

function makeOld(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(OLD_DDL);
  db.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const s = db.prepare(INS);
  s.run('alpha', 'en', 1000, 2000);
  s.run('beta', 'en', 1001, 2001);
  db.close();
}
function pkCols(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const c = db.prepare('PRAGMA table_info(book)').all();
  db.close();
  return c.filter((x) => Number(x.pk) > 0).sort((a, b) => a.pk - b.pk).map((x) => x.name);
}
function capture(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let value = null, error = null;
  try { value = fn(); } catch (e) { error = e; } finally { console.warn = orig; }
  return { value, error, warns };
}
/** 冻结时钟（只为让备份名可预测）；返回还原函数 */
function freezeDate(fixedMs) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...a) { if (a.length === 0) super(fixedMs); else super(...a); }
    static now() { return fixedMs; }
  }
  globalThis.Date = Frozen;
  return () => { globalThis.Date = Real; };
}

console.log('='.repeat(92));
console.log('① VACUUM INTO 产物的属性（journal_mode / integrity_check / 可独立打开）');
{
  const dir = path.join(TMP, 'attrs'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'a.db');
  makeOld(file);
  const B = new DatabaseSync(file);
  const C = new DatabaseSync(file);
  C.prepare(INS).run('waldelta', 'ru', 3000, 4000);
  openDatabase(file).close();
  const bak = path.join(dir, baks(file)[0]);
  const b = new DatabaseSync(bak, { readOnly: true });
  const jm = b.prepare('PRAGMA journal_mode').get().journal_mode;
  const ic = b.prepare('PRAGMA integrity_check').get();
  const rows = b.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  const fk = b.prepare('PRAGMA foreign_key_check').all().length;
  b.close();
  console.log(`  备份 journal_mode=${jm} · integrity_check=${JSON.stringify(ic)} · 行数=${rows} · foreign_key_check 违规=${fk}`);
  console.log(`  备份文件 ${fs.statSync(bak).size} B · 主库 ${fs.statSync(file).size} B · 逐字节相等=${fs.readFileSync(bak).equals(fs.readFileSync(file))}`);
  console.log(`  备份内容 = 迁移前源库可见 3 行（含 waldelta）? ${rows === 3}`);
  B.close(); C.close();
}

console.log('\n② 「备份失败」路径是否绕过 T45 后置校验（冻结时钟 + 预占备份名）');
{
  const dir = path.join(TMP, 'bakfail'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'b.db');
  makeOld(file);
  const FIXED = Date.UTC(2026, 0, 2, 3, 4, 5, 678);
  const RealDateCtor = Date; // 必须在 freezeDate 之前取真实构造器来生成名字
  const bakName = `${file}.bak-${new RealDateCtor(FIXED).toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(bakName); // 占位：让 VACUUM INTO 的目标已存在（且是目录 ⇒ 必然失败）
  const restore = freezeDate(FIXED);
  let r;
  try {
    r = capture(() => openDatabase(file));
  } finally { restore(); }
  const dirs = fs.readdirSync(dir);
  console.log(`  备份目标名（冻结时钟）= ${path.basename(bakName)} · 是否已存在=${fs.existsSync(bakName)}`);
  console.log(`  openDatabase 抛出 = ${r.error ? JSON.stringify(r.error.message) : 'null（未抛！）'}`);
  console.log(`  warns = ${JSON.stringify(r.warns)}`);
  console.log(`  库内主键 = ${JSON.stringify(pkCols(file))}`);
  console.log(`  目录内容 = ${JSON.stringify(dirs)}`);
  if (r.value) {
    // 复现「能打开、列表正常、但一条也加不进去」的静默故障
    const list = capture(() => bookList(r.value, 'en'));
    const all = capture(() => bookListAll(r.value));
    const addEn = capture(() => bookAdd(r.value, 'newbie', [], 'en'));
    const addRu = capture(() => bookAdd(r.value, 'новичок', [], 'ru'));
    console.log(`  ★ 降级连接可用性：bookList=${list.error ? '抛 ' + list.error.message : list.value.length + ' 条'}` +
      ` · bookListAll=${all.error ? '抛 ' + all.error.message : all.value.length + ' 条'}` +
      ` · bookAdd(en)=${addEn.error ? '抛 ' + addEn.error.message : 'OK'}` +
      ` · bookAdd(ru)=${addRu.error ? '抛 ' + addRu.error.message : 'OK'}`);
    r.value.close();
  }
  fs.rmSync(bakName, { recursive: true, force: true });
}

console.log('\n③ 反复失败的启动是否累积整库大小的备份（每启动一次 = 1 份全新快照）');
{
  const dir = path.join(TMP, 'accum'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'c.db');
  makeOld(file, );
  // 用一个「必然失败」的夹具：残留 view book_new（dbTryDropTable 无法清除）
  {
    const d = new DatabaseSync(file);
    d.exec('CREATE VIEW book_new AS SELECT 1 AS x');
    d.close();
  }
  const before = fs.statSync(file).size;
  for (let i = 0; i < 3; i++) {
    const r = capture(() => openDatabase(file));
    console.log(`  第 ${i + 1} 次 openDatabase：抛=${r.error ? '是' : '否'} · 备份数=${baks(file).length} · 备份总字节=${baks(file).reduce((s, b) => s + fs.statSync(path.join(dir, b)).size, 0)}`);
  }
  console.log(`  主库 ${before} B（生产库 494 MB ⇒ 每次失败启动 ≈ +494 MB）`);
}

console.log('\n④ 残留 book_new 是**索引**时，「已清除」这条警告是否属实');
{
  const dir = path.join(TMP, 'idx'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'd.db');
  makeOld(file);
  {
    const d = new DatabaseSync(file);
    d.exec('CREATE INDEX book_new ON book(word)');
    d.close();
  }
  const r = capture(() => openDatabase(file));
  const d = new DatabaseSync(file, { readOnly: true });
  const objs = d.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'book_new%'").all();
  d.close();
  console.log(`  warns = ${JSON.stringify(r.warns)}`);
  console.log(`  迁移后仍存在的 book_new* 对象 = ${JSON.stringify(objs)}`);
  console.log(`  抛出 = ${r.error ? '是（含「复合主键」=' + r.error.message.includes('复合主键') + '）' : '否'}`);
  if (r.value) r.value.close();
}

console.log('\n⑤ 「重试仍失败」后是否再次落备份（有界性：备份数 = 迁移尝试次数上界）');
{
  const dir = path.join(TMP, 'bounded'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'e.db');
  makeOld(file);
  {
    const d = new DatabaseSync(file);
    d.exec('CREATE INDEX book_new ON book(word)');
    d.close();
  }
  const r = capture(() => openDatabase(file));
  console.log(`  警告条数=${r.warns.length} · 备份数=${baks(file).length} · 内容=${JSON.stringify(r.warns.map((w) => w.slice(0, 60)))}`);
  if (r.value) r.value.close();
}
console.log('='.repeat(92));
