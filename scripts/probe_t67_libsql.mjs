// scripts/probe_t67_libsql.mjs —— T67 实验 B（服务端形态改造可行性）判别探针
//
// 目的（只读 + 临时目录，不碰 data/**）：
//   §1 @libsql/client 的 API 形态（是否同步、是否有 prepare/exec）⇒ core 能否原样复用
//   §2 libsql 本地文件 ↔ node:sqlite 双向互读（本实验最关键：文件格式是否通用）
//   §3 同文件并发（一个进程 libsql 持连接、另一连接 node:sqlite 读写）可见性
//   §4 embedded replica（file: + syncUrl）的语义实测：读/写/sync() 各自行为与报错
//   §5 core 实际用到的 SQL 形状在 libsql 本地模式下的兼容性
//   §6 静态量化 core 对 DatabaseSync **同步 API** 的依赖面（改造面到底多大）
//
// 运行：node scripts/probe_t67_libsql.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.tmp', 't67_libsql');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const libsqlEntry = path.join(
  ROOT, '.tmp', 'libsql-probe', 'node_modules', '@libsql', 'client', 'lib-esm', 'node.js',
);
const { createClient, LibsqlError } = await import(pathToFileURL(libsqlEntry).href);

const line = (s = '') => console.log(s);
const head = (s) => { line(); line('='.repeat(96)); line(s); line('='.repeat(96)); };
const ok = (s) => line(`  ✔ ${s}`);
const info = (s) => line(`  ⓘ ${s}`);
const bad = (s) => line(`  ✘ ${s}`);
let counts = { ok: 0, bad: 0 };

async function step(name, fn) {
  try {
    const r = await fn();
    counts.ok += 1;
    ok(`${name}${r === undefined ? '' : ` ⇒ ${r}`}`);
    return r;
  } catch (e) {
    counts.bad += 1;
    bad(`${name} ⇒ 抛错：${e?.constructor?.name}: ${e?.message}`);
    return { __error: e };
  }
}

/* ------------------------------------------------------------------ *
 * §1 API 形态
 * ------------------------------------------------------------------ */
head('§1 @libsql/client API 形态（决定 core 能否原样复用）');
{
  const client = createClient({ url: `file:${path.join(TMP, 'api.db').replace(/\\/g, '/')}` });
  const proto = Object.getPrototypeOf(client);
  const methods = Object.getOwnPropertyNames(proto).filter((n) => typeof client[n] === 'function' || n === 'closed');
  line(`  实例方法：${methods.join(' · ')}`);
  const kinds = {};
  for (const m of methods) kinds[m] = typeof client[m];
  line(`  类型：${JSON.stringify(kinds)}`);
  for (const k of ['prepare', 'exec', 'close', 'execute', 'batch', 'sync', 'transaction', 'executeMultiple']) {
    line(`  ${k.padEnd(17)} = ${typeof client[k]}`);
  }
  const pending = client.execute('SELECT 1 AS one');
  line(`  execute() 是否返回 Promise（**未 await**）：${pending instanceof Promise ? '是 ⇒ 异步 API' : '否 ⇒ 同步'}`);
  const sel = await pending;
  line(`  await 后返回对象键：${Object.keys(sel).join(' · ')}`);
  line(`  execute() 返回 rows 形态：${JSON.stringify(sel.rows)}（rows 是数组? ${Array.isArray(sel.rows)}）`);
  await client.close();
  info('对照：node:sqlite 的 DatabaseSync 是**同步** API（db.prepare(sql).get()/all()/run()、db.exec(sql)），无 Promise');
}

/* ------------------------------------------------------------------ *
 * §2 双向互读：libsql 写 → node:sqlite 读；node:sqlite 写 → libsql 读
 * ------------------------------------------------------------------ */
head('§2 文件格式互操作（本实验最关键：能否「libsql 同步文件 + node:sqlite 照旧读」）');
{
  // 2a libsql 建库写入 → node:sqlite 读
  const a = path.join(TMP, 'interop_a.db');
  const ca = createClient({ url: `file:${a.replace(/\\/g, '/')}` });
  await ca.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  await ca.execute("INSERT INTO t (v) VALUES ('from-libsql')");
  await ca.close();
  await step('§2a libsql 建库并写入 1 行', async () => `${fs.statSync(a).size} B`);
  const header = fs.readFileSync(a).subarray(0, 16).toString('latin1');
  line(`  文件头 16 字节：${JSON.stringify(header)}（标准 SQLite = "SQLite format 3\\0"）`);
  await step('§2a node:sqlite 打开 libsql 产出的库并读出该行', () => {
    const db = new DatabaseSync(a, { readOnly: true });
    try {
      const r = db.prepare('SELECT v FROM t').all();
      return JSON.stringify(r);
    } finally { db.close(); }
  });
  const walA = fs.existsSync(`${a}-wal`) ? fs.statSync(`${a}-wal`).size : null;
  info(`libsql 关闭后 sidecar：-wal=${walA} B · -shm=${fs.existsSync(`${a}-shm`)}`);

  // 2b node:sqlite 建库（WAL，模拟本项目实测形态）→ libsql 读
  const b = path.join(TMP, 'interop_b.db');
  const nb = new DatabaseSync(b);
  nb.exec('PRAGMA journal_mode=wal');
  nb.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  nb.prepare('INSERT INTO t (v) VALUES (?)').run('from-node-sqlite');
  nb.close();
  line(`  node:sqlite 产出：主库 ${fs.statSync(b).size} B · -wal ${fs.existsSync(`${b}-wal`) ? fs.statSync(`${b}-wal`).size : 0} B`);
  await step('§2b libsql 打开 node:sqlite 产出的库并读出该行', async () => {
    const cb = createClient({ url: `file:${b.replace(/\\/g, '/')}` });
    try {
      const r = await cb.execute('SELECT v FROM t');
      return JSON.stringify(r.rows);
    } finally { await cb.close(); }
  });
}

/* ------------------------------------------------------------------ *
 * §3 同文件并发：libsql 持句柄期间，node:sqlite 读/写是否可见
 * ------------------------------------------------------------------ */
head('§3 同文件并发（「libsql 同步 → node:sqlite 照旧读」的可行性前提）');
{
  const p = path.join(TMP, 'concurrent.db');
  const c = createClient({ url: `file:${p.replace(/\\/g, '/')}` });
  await c.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  await c.execute("INSERT INTO t (v) VALUES ('libsql-1')");
  await step('§3a libsql 持连接（未关闭）时，node:sqlite 只读打开并 SELECT', () => {
    const db = new DatabaseSync(p, { readOnly: true });
    try { return JSON.stringify(db.prepare('SELECT v FROM t').all()); }
    finally { db.close(); }
  });
  await step('§3b 同场景下 node:sqlite **可写**打开并 INSERT', () => {
    const db = new DatabaseSync(p);
    try { db.prepare('INSERT INTO t (v) VALUES (?)').run('from-node-while-libsql-open'); return 'insert ok'; }
    finally { db.close(); }
  });
  await step('§3c libsql 随后 SELECT 能否看到 node:sqlite 刚写入的行', async () => {
    const r = await c.execute('SELECT v FROM t ORDER BY id');
    return JSON.stringify(r.rows.map((x) => x.v));
  });
  await c.close();
  await step('§3d 反之：libsql 写入后 node:sqlite 再读是否可见', async () => {
    const c2 = createClient({ url: `file:${p.replace(/\\/g, '/')}` });
    await c2.execute("INSERT INTO t (v) VALUES ('libsql-2')");
    const db = new DatabaseSync(p, { readOnly: true });
    const rows = db.prepare('SELECT v FROM t ORDER BY id').all().map((x) => x.v);
    db.close();
    await c2.close();
    return JSON.stringify(rows);
  });
}

/* ------------------------------------------------------------------ *
 * §4 embedded replica：file: 本地文件 + syncUrl 远端
 *   ★ 必须隔离子进程：该路径会加载 libsql 原生扩展（hyper-rustls），实测在受限沙箱下
 *     触发 **Rust panic 直接杀进程**（exit -1073740791 = 0xC0000409），不可捕获。
 * ------------------------------------------------------------------ */
head('§4 embedded replica（file: + syncUrl）语义实测 —— 「零改造路径」的核心');
{
  const { spawnSync } = await import('node:child_process');
  const child = path.join(__dirname, 'probe_t67_libsql_replica.mjs');
  const caFile = path.join(ROOT, '.tmp', 'ca-from-node.pem');
  if (!fs.existsSync(caFile)) {
    const { rootCertificates } = await import('node:tls');
    fs.writeFileSync(caFile, rootCertificates.join('\n') + '\n');
  }
  const variants = [
    { name: '变体①无 SSL_CERT_FILE（平台证书库）', url: 'libsql://probe-t67-does-not-exist.turso.io', env: {} },
    { name: '变体②带 SSL_CERT_FILE（绕过平台证书库）', url: 'libsql://probe-t67-does-not-exist.turso.io', env: { SSL_CERT_FILE: caFile } },
  ];
  for (const v of variants) {
    line();
    line(`  ── ${v.name} ──`);
    // ⚠ 沙箱禁止「管道 stdio 的 spawn」（AGENTS.md §3）⇒ 只能 stdio:'inherit'（子进程直接写父进程终端）
    const r = spawnSync(process.execPath, [child, v.url], {
      env: { ...process.env, ...v.env },
      stdio: 'inherit',
    });
    line(`  ← 子进程退出码 = ${r.status}${r.error ? ` · spawn 错误=${r.error.code ?? r.error.message}` : ''}（-1073740791 = 原生崩溃）`);
  }
  info('说明：本地无 Turso 凭据 ⇒ 「真实跨设备同步」未实测；但「写入被转发到主库」已由 §4b 的 WriteDelegation 报错证实');
}

/* ------------------------------------------------------------------ *
 * §5 core 实际用到的 SQL 形状在 libsql 本地模式的兼容性
 * ------------------------------------------------------------------ */
head('§5 core 的 SQL 形状在 libsql 本地模式下是否照样能跑');
{
  const c = createClient({ url: `file:${path.join(TMP, 'sql.db').replace(/\\/g, '/')}` });
  await step('§5a 复合主键 + ON CONFLICT(word, lang) DO UPDATE（upsertBook 用法）', async () => {
    await c.execute('CREATE TABLE book (word TEXT NOT NULL, lang TEXT NOT NULL, status TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0, PRIMARY KEY (word, lang))');
    await c.execute("INSERT INTO book (word, lang, status, updated_at) VALUES ('test','en','new',1)");
    await c.execute("INSERT INTO book (word, lang, status, updated_at) VALUES ('test','en','mastered',2) ON CONFLICT(word, lang) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at");
    const r = await c.execute("SELECT status, updated_at FROM book WHERE word='test' AND lang='en'");
    return JSON.stringify(r.rows);
  });
  await step('§5b PRAGMA table_info(book)（迁移用）', async () => {
    const r = await c.execute('PRAGMA table_info(book)');
    return `列数=${r.rows.length} · 名称=${JSON.stringify(r.rows.map((x) => x.name))}`;
  });
  await step('§5c 多语句 batch([...], "write")（事务语义）', async () => {
    const r = await c.batch([
      "INSERT INTO book (word, lang, status, updated_at) VALUES ('a','en','new',3)",
      "INSERT INTO book (word, lang, status, updated_at) VALUES ('b','ru','new',4)",
    ], 'write');
    return `batch 返回 ${Array.isArray(r) ? r.length : '?'} 项 · rowsAffected=${JSON.stringify(r.map((x) => x.rowsAffected))}`;
  });
  await step('§5d VACUUM INTO（T45 备份实现所依赖）', async () => {
    const out = path.join(TMP, 'vac.db').replace(/\\/g, '/');
    await c.execute(`VACUUM INTO '${out}'`);
    return `成功，产出 ${fs.existsSync(path.join(TMP, 'vac.db')) ? fs.statSync(path.join(TMP, 'vac.db')).size : '?'} B`;
  });
  await step('§5e BEGIN IMMEDIATE（迁移事务）是否可经 execute 执行', async () => {
    await c.execute('BEGIN IMMEDIATE');
    await c.execute('COMMIT');
    return '可执行';
  });
  await step('§5f 尺子 R 的那条 SELECT（对真实 494MB dict.db **不跑**，此处仅验证语法形状）', async () => {
    const r = await c.execute({ sql: "SELECT word FROM book WHERE lang = 'ru' AND length(word) BETWEEN 4 AND 12", args: [] });
    return `语法通过，返回 ${r.rows.length} 行`;
  });
  await c.close();
}

/* ------------------------------------------------------------------ *
 * §6 静态量化：core 对同步 API 的依赖面
 * ------------------------------------------------------------------ */
head('§6 改造面量化：core 对 DatabaseSync 同步 API 的依赖（静态扫描源码，不执行）');
{
  const src = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'src', 'db', 'index.ts'), 'utf8');
  const lex = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'src', 'db', 'lexicon.ts'), 'utf8');
  const all = src + '\n' + lex;
  const count = (re) => (all.match(re) ?? []).length;
  const rows = [
    ['db.prepare(...) 调用', count(/\.prepare\(/g)],
    ['  .get() 同步取一行', count(/\.get\(/g)],
    ['  .all() 同步取多行', count(/\.all\(/g)],
    ['  .run() 同步执行', count(/\.run\(/g)],
    ['db.exec(...) 执行多语句', count(/\.exec\(/g)],
    ['export function（接收 db 形参）', count(/export function /g)],
    ['Transaction / async 关键字', count(/\basync\b/g)],
  ];
  for (const [k, v] of rows) line(`  ${k.padEnd(34)} = ${v}`);
  line();
  info('@libsql/client 只有 execute()/batch()/sync()，**全部返回 Promise**，且**没有** prepare/exec/get/all/run');
  info('⇒ 形状不匹配是**同步 vs 异步**层面的，不是参数改名层面的');
}

head(`探针结论统计：通过 ${counts.ok} · 抛错 ${counts.bad}（抛错多半是**预期的**失败模式，逐条见上文）`);
line(`临时目录：${path.relative(ROOT, TMP)}（本探针自建，可随时删除；未触碰 data/**）`);
