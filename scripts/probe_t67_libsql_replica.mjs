// scripts/probe_t67_libsql_replica.mjs —— T67 实验 B §4 子进程：embedded replica 语义实测
//
// 为什么要独立进程：`file:` + `syncUrl` 的 replica 路径会加载 libsql 原生扩展（hyper-rustls），
// 实测在受限沙箱下会触发 **Rust panic 并直接杀掉进程**（exit -1073740791 = 0xC0000409），
// 这是**不可捕获**的原生崩溃 ⇒ 必须隔离子进程，否则主探针后半段（§5/§6）全部跑不到。
//
// 用法：node scripts/probe_t67_libsql_replica.mjs <syncUrl>
//   例：node scripts/probe_t67_libsql_replica.mjs "http://127.0.0.1:9/"
//       node scripts/probe_t67_libsql_replica.mjs "libsql://probe-t67.turso.io"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.tmp', 't67_libsql');
fs.mkdirSync(TMP, { recursive: true });

const syncUrl = process.argv[2] ?? 'http://127.0.0.1:9/';
const tag = syncUrl.startsWith('libsql:') ? 'tls' : 'http';
const file = path.join(TMP, `replica_${tag}.db`);
for (const suffix of ['', '-wal', '-shm', '-info']) fs.rmSync(file + suffix, { force: true });

const entry = path.join(ROOT, '.tmp', 'libsql-probe', 'node_modules', '@libsql', 'client', 'lib-esm', 'node.js');
const { createClient } = await import(pathToFileURL(entry).href);

const out = (label, v) => console.log(`  [${tag}] ${label} ⇒ ${v}`);
const attempt = async (label, fn) => {
  try {
    const r = await fn();
    out(label, `成功${r === undefined ? '' : `：${r}`}`);
    return { ok: true, r };
  } catch (e) {
    out(label, `抛错 name=${e?.name} code=${e?.code ?? '-'} msg=${String(e?.message).slice(0, 160)}`);
    return { ok: false, e };
  }
};

console.log(`[${tag}] syncUrl = ${syncUrl}`);
const client = createClient({ url: `file:${file.replace(/\\/g, '/')}`, syncUrl, authToken: 'dummy' });
out('构造 createClient(file + syncUrl + authToken)', `成功 · typeof sync=${typeof client.sync}`);

await attempt('未 sync 前 CREATE TABLE（本地写）', () => client.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)'));
await attempt('未 sync 前 INSERT（本地写）', () => client.execute("INSERT INTO t (v) VALUES ('w1')"));
await attempt('未 sync 前 SELECT（本地读）', async () => JSON.stringify((await client.execute('SELECT COUNT(1) AS n FROM t')).rows));
await attempt('client.sync()（连远端）', () => client.sync());
await attempt('sync 失败后 SELECT（本地副本仍可读?）', async () => JSON.stringify((await client.execute('SELECT COUNT(1) AS n FROM t')).rows));
out('本地副本文件大小', fs.existsSync(file) ? `${fs.statSync(file).size} B` : '不存在');
await attempt('close()', () => client.close());
if (fs.existsSync(file)) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  const n = db.prepare('SELECT COUNT(1) AS n FROM t').get().n;
  db.close();
  out('node:sqlite 读 replica 本地文件', `行数=${n}（⇒ 文件是标准 SQLite，core 可直接读）`);
}
