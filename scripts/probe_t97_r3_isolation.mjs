/**
 * T97（主管自建 · R3 验收探针）—— 多用户隔离在**真 HTTP 边界**上的端到端验证。
 *
 * 为什么必须走 HTTP：缺陷 `V11-SYNC-DTO` 正是「`packages/core/test/book_lang.mjs` 直接调 `syncMerge`」
 * 与「`apps/sync-server/scripts/smoke.mjs` 也直接调函数」**两层各自自洽、交界处无人测**漏过去的。
 * 同理，`bookListAll(db, userId)` 单测通过 ≠ 路由真的传了作用域 ⇒ 本探针只打真实路由。
 *
 * 零风险隔离（AGENTS.md §3 的既定配方，三条件缺一不可）：
 *   ① `spawn` ＋ **显式 `{ env }`**（绝不依赖 env 继承 —— 实测继承通道 `SYNC_DB=null`）
 *   ② `stdio: ['ignore', logFd, logFd]` 文件重定向（规避沙箱管道 EPERM）
 *   ③ **安全闸**：读服务自报的 `dict db :` / `sync db :` 两行，指向 `data/**` 立即 kill 并整体中止
 * 全程临时库；冻结库 `data/db/dict.db` 起止核对 size+mtime 必须逐位一致。
 *
 * 覆盖判定（对应 `scripts/check_user_scope.mjs` 的 3.2 / 3.4 与用户拍板「存量上传为我的」）：
 *   A 起服/安全闸       B 首账号**认领**本机存量（AC-28④）      C 第二账号**不**认领（匿名桶不可二分）
 *   D 双向隔离（同词同语言各存一行 / 互相不可见）               E 写入侧与读取侧**同一桶**（否则自己看不见自己）
 *   F 存量行确实离开 `'local'` 桶（无重复、无遗留）              G 死库指纹不变
 */
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SERVER = path.join(REPO, 'apps', 'sync-server', 'dist', 'index.js');
const FROZEN_DB = path.join(REPO, 'data', 'db', 'dict.db');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}${detail ? ' · ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ✘ ${name}${detail ? ' · ' + detail : ''}`);
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

const RUN = path.join(__dirname, '_tmp', 't97-' + randomBytes(4).toString('hex'));
fs.mkdirSync(RUN, { recursive: true });
const TMP_DICT = path.join(RUN, 't_dict.db');
const TMP_SYNC = path.join(RUN, 't_sync.db');
const LOG = path.join(RUN, 'server.log');

/** 冻结库指纹三项并查（只看 size/mtime 会漏判 —— 改动可能全在 WAL） */
function frozenFingerprint() {
  const st = fs.statSync(FROZEN_DB);
  const side = (suffix) => {
    const p = FROZEN_DB + suffix;
    return fs.existsSync(p) ? fs.statSync(p).size : null;
  };
  return { size: st.size, mtime: st.mtimeMs, wal: side('-wal'), shm: side('-shm') };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/** 建一个真库并预置存量行（等价于生产 `data/sync-data/sync.db` 的现状：3 行在 'local' 桶） */
const SEED = [
  { word: 'telephone', lang: 'en', status: 'learning', added_at: 1000, updated_at: 5000 },
  { word: 'test', lang: 'en', status: 'new', added_at: 2000, updated_at: 6000 },
  { word: 'test', lang: 'ru', status: 'new', added_at: 3000, updated_at: 7000 },
];
function makeSeededSyncDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS book (
    user_id TEXT NOT NULL, word TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en',
    added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', note TEXT, tags TEXT NOT NULL DEFAULT '[]',
    review_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, word, lang));`);
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);`);
  db.exec(`CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
    revoked_at INTEGER, label TEXT);`);
  const ins = db.prepare(`INSERT OR REPLACE INTO book
    (user_id, word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of SEED) ins.run('local', s.word, s.lang, s.added_at, s.updated_at, s.status, null, '[]', 0, null, 0);
  db.close();
}

const live = [];
async function startServer() {
  const port = await freePort();
  const logFd = fs.openSync(LOG, 'a');
  const child = spawn(process.execPath, [SERVER], {
    cwd: REPO,
    env: {
      ...process.env,
      ZIDIANKAFA_DB: TMP_DICT,
      ZIDIANKAFA_SYNC_DB: TMP_SYNC,
      ZIDIANKAFA_SYNC_PORT: String(port),
      ZIDIANKAFA_SYNC_TOKEN: '',
      ZIDIANKAFA_RATE_MAX: '100000',
      ZIDIANKAFA_AUTH_RATE_MAX: '100000',
      ZIDIANKAFA_AUTH_USER_RATE_MAX: '100000',
    },
    stdio: ['ignore', logFd, logFd],
  });
  live.push(child);
  // ⏳ 轮询就绪（服务起来后端点非立即可用）
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return { port, child };
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('服务未在 30 秒内就绪（见 ' + LOG + '）');
}

async function api(port, method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}

const h = (pw) => createHash('sha256').update(pw).digest('hex');

async function main() {
  console.log('T97 · R3 多用户隔离·真 HTTP 边界验收探针');
  console.log('RUN =', RUN);

  // ---------- G0 起服前指纹 ----------
  const fpBefore = frozenFingerprint();

  makeSeededSyncDb(TMP_SYNC);

  const { port, child } = await startServer();

  // ---------- A 安全闸（★ 最重要：确认打的是临时库） ----------
  const logText = fs.readFileSync(LOG, 'utf8');
  const dictLine = /dict db\s*:\s*(.+)/.exec(logText)?.[1]?.trim() ?? '';
  const syncLine = /sync db\s*:\s*(.+)/.exec(logText)?.[1]?.trim() ?? '';
  const pointsAtProd = /[\\/]data[\\/]/.test(dictLine) || /[\\/]data[\\/]/.test(syncLine);
  ok('A1 安全闸：服务自报路径不含 data/**', !pointsAtProd, `dict=${dictLine} | sync=${syncLine}`);
  ok('A2 用的是临时 dict 库', dictLine.includes('t_dict.db'), dictLine);
  ok('A3 用的是临时 sync 库', syncLine.includes('t_sync.db'), syncLine);
  if (pointsAtProd) {
    child.kill('SIGKILL');
    throw new Error('安全闸触发：服务指向生产库，已 kill 并整体中止');
  }

  // ---------- B 首账号认领本机存量（AC-28④） ----------
  const r1 = await api(port, 'POST', '/api/v1/auth/register', { email: 'alice@example.com', password: 'pw-alice-123' });
  ok('B1 首账号注册 200', r1.status === 200, `status=${r1.status} body=${JSON.stringify(r1.json)}`);
  const alice = r1.json;
  eq('B2 注册响应带 claimed 字段且 = 存量条数 3', alice?.claimed, 3);
  eq('B3 作用域形态 = u:<userId>', alice?.scope, `u:${alice?.userId}`);

  const aBook = await api(port, 'GET', '/api/v1/book', undefined, alice.token);
  ok('B4 首账号读生词本 200', aBook.status === 200, `status=${aBook.status}`);
  eq('B5 ★ 首账号看到认领来的 3 条（存量上传为「我的」）', aBook.json?.items?.length, 3);
  const bWords = (aBook.json?.items ?? []).map((i) => `${i.word}[${i.lang}]`).sort();
  eq('B6 逐条内容正确', bWords, ['telephone[en]', 'test[en]', 'test[ru]']);

  // ---------- F 存量行确实离开 'local' 桶 ----------
  const raw = new DatabaseSync(TMP_SYNC, { readOnly: true });
  const localLeft = raw.prepare(`SELECT COUNT(1) AS n FROM book WHERE user_id = 'local'`).get().n;
  const inAlice = raw.prepare(`SELECT COUNT(1) AS n FROM book WHERE user_id = ?`).get(`u:${alice.userId}`).n;
  const pk = raw.prepare(`PRAGMA table_info(book)`).all().filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  eq('F1 ★ 认领后 local 桶清空（无重复、无遗留）', localLeft, 0);
  eq('F2 3 条全在 alice 桶', inAlice, 3);
  eq('F3 主键顺序敏感 = [user_id, word, lang]', pk, ['user_id', 'word', 'lang']);
  ok('F4 ★ 库中无明文口令', !fs.readFileSync(TMP_SYNC).includes(Buffer.from('pw-alice-123')), '按字节扫描主文件');
  const storedHash = raw.prepare('SELECT password_hash FROM users WHERE email = ?').get('alice@example.com').password_hash;
  ok('F5 口令哈希格式 scrypt$N$salt$hash', /^scrypt\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(storedHash), storedHash.slice(0, 28) + '…');
  raw.close();

  // ---------- C 第二账号不认领（匿名桶不可二分） ----------
  const r2 = await api(port, 'POST', '/api/v1/auth/register', { email: 'bob@example.com', password: 'pw-bob-12345' });
  ok('C1 第二账号注册 200', r2.status === 200, `status=${r2.status}`);
  const bob = r2.json;
  eq('C2 ★ 第二账号 claimed = 0（不重复认领）', bob?.claimed, 0);
  const bBook0 = await api(port, 'GET', '/api/v1/book', undefined, bob.token);
  eq('C3 ★ bob 初始生词本为空（看不到 alice 的存量）', bBook0.json?.items?.length, 0);

  // ---------- D 双向隔离：同词同语言各存一行 ----------
  const w1 = await api(port, 'POST', '/api/v1/sync', { items: [{ word: 'shared', lang: 'en', status: 'new', addedAt: 10000, updatedAt: 10000 }] }, alice.token);
  const w2 = await api(port, 'POST', '/api/v1/sync', { items: [{ word: 'shared', lang: 'en', status: 'mastered', note: 'bob的', addedAt: 11000, updatedAt: 11000 }] }, bob.token);
  ok('D1 alice 写 shared[en] 200', w1.status === 200, JSON.stringify(w1.json));
  ok('D2 bob 写同词同语言 200', w2.status === 200, JSON.stringify(w2.json));
  const raw2 = new DatabaseSync(TMP_SYNC, { readOnly: true });
  const rows = raw2.prepare(`SELECT user_id, status, note FROM book WHERE word = 'shared' AND lang = 'en' ORDER BY user_id`).all();
  raw2.close();
  eq('D3 ★★ 两用户同词同语言各存一行（不是只剩 1 行）', rows.length, 2);
  eq('D4 两行分属两个桶', rows.map((r) => r.user_id), [`u:${alice.userId}`, `u:${bob.userId}`]);
  const aSees = await api(port, 'GET', '/api/v1/book', undefined, alice.token);
  const bSees = await api(port, 'GET', '/api/v1/book', undefined, bob.token);
  const aShared = (aSees.json?.items ?? []).find((i) => i.word === 'shared');
  const bShared = (bSees.json?.items ?? []).find((i) => i.word === 'shared');
  eq('D5 ★ alice 看到的是自己的 status', aShared?.status, 'new');
  eq('D6 ★ bob 看到的是自己的 status/note', [bShared?.status, bShared?.note], ['mastered', 'bob的']);
  eq('D7 alice 总数 = 3(认领) + 1(自写)', aSees.json?.items?.length, 4);
  eq('D8 bob 总数 = 0 + 1(自写)', bSees.json?.items?.length, 1);

  // ---------- E 写入侧与读取侧同一桶（自己的写入必须自己能读到） ----------
  const bAgain = await api(port, 'GET', '/api/v1/book', undefined, bob.token);
  ok('E1 ★ bob 自己的写入读得回来（写/读同桶）', (bAgain.json?.items ?? []).some((i) => i.word === 'shared'), '若写读不同桶，此处会「自己看不见自己」');

  // ---------- H 匿名通道回归（未配置 token 且已有账号 ⇒ 应 401，不能匿名读全库） ----------
  const anon = await api(port, 'GET', '/api/v1/book');
  eq('H1 ★ 已有账号时无令牌读全库 = 401（匿名回路必须关死）', anon.status, 401);

  // ---------- I 令牌撤销 ----------
  const rev = await api(port, 'POST', '/api/v1/auth/revoke', {}, bob.token);
  ok('I1 bob 撤销自己令牌 200', rev.status === 200, JSON.stringify(rev.json));
  const after = await api(port, 'GET', '/api/v1/book', undefined, bob.token);
  ok('I2 ★ 撤销后旧令牌立即失效（401/403）', after.status === 401 || after.status === 403, `status=${after.status}`);
  const aStill = await api(port, 'GET', '/api/v1/book', undefined, alice.token);
  eq('I3 撤销只影响 bob，alice 不受影响', aStill.status, 200);

  // ---------- G 冻结库指纹不变（三项并查） ----------
  const fpAfter = frozenFingerprint();
  eq('G1 ★ 冻结库 size 不变', fpAfter.size, fpBefore.size);
  eq('G2 ★ 冻结库 mtime 不变', fpAfter.mtime, fpBefore.mtime);
  eq('G3 ★ 冻结库无新增 -wal/-shm', [fpAfter.wal, fpAfter.shm], [fpBefore.wal, fpBefore.shm]);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  return fail === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error('探针异常：', e?.message ?? e);
  code = 1;
} finally {
  for (const c of live) {
    try {
      c.kill('SIGKILL');
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 800));
  const leftover = (() => {
    try {
      return fs.readdirSync(RUN).length;
    } catch {
      return -1;
    }
  })();
  try {
    fs.rmSync(RUN, { recursive: true, force: true });
    console.log(leftover >= 0 ? `临时库已清理（收尾前 ${leftover} 项）` : '临时库已清理');
  } catch (e) {
    console.warn('⚠ 临时目录未清理（留证）：', e.message, RUN);
  }
}
process.exit(code);
