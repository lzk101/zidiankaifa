/**
 * T94 · R2 鉴权底座端到端实测（主管验收探针，只读纪律）
 *
 * 目的：不采信 agent 自述，亲自验证 AC-27 / AC-29 的鉴权行为。
 *
 * 只读纪律：
 *   - **绝不打开 `data/db/dict.db`**（起止各核对一次 size+mtime，前后必须一致）
 *   - 全程用**临时库**（dict 库 = 临时复制的结构 + 临时 sync 库）
 *   - **随机空闲端口**，从不占用 4570
 *   - 临时目录收尾自清
 *
 * 判据（逐条断言，失败即 exit 1）：
 *   1. `POST /api/v1/auth/register` 返回 200（不是 404 —— R2 前实测是 404）
 *   2. 响应含 token；库中 `password_hash` 形如 `scrypt$N$salt$hash`（**三段以上，$ 分隔**）
 *   3. **库中不出现明文密码**（逐字段实测）
 *   4. **库中不出现裸 token**（只存哈希）
 *   5. 登录端点签发新 token；错误密码被拒（401/403）
 *   6. ★ **撤销后旧 token 打受保护路由必须被拒**
 *   7. 遗留通道：无 Authorization 时行为与 v0.10.0 一致（旧 22 条 DTO 契约不破）
 *   8. `rateLimit` 存在性（源码字面量 + 实测 429）
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, statSync, existsSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const FROZEN = path.join(REPO, 'data', 'db', 'dict.db');
const TMP_ROOT = path.join(REPO, 'scripts', '_tmp', 't94_auth');
const KEEP = process.env.KEEP_TMP === '1';

let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; results.push(`  \u2714 ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; results.push(`  \u2718 ${name}${detail ? '  [' + detail + ']' : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

/** 空闲端口（binding 到 0 再释放；从不硬编码 4570） */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const frozenFp = () => {
  if (!existsSync(FROZEN)) return null;
  const st = statSync(FROZEN);
  return { size: st.size, mtime: st.mtime.toISOString() };
};
const fpStr = (f) => (f ? `${f.size} B / ${f.mtime}` : '缺失');

async function req(base, method, p, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, json: j };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const before = frozenFp();
  console.log('===== T94 · R2 鉴权底座端到端实测 =====');
  console.log(`冻结库(不打开) ${FROZEN}`);
  console.log(`  起 ${fpStr(before)}`);

  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });

  const dictDb = path.join(TMP_ROOT, 'dict.db');
  const syncDb = path.join(TMP_ROOT, 'sync.db');
  const logPath = path.join(TMP_ROOT, 'server.log');

  // 临时 dict 库：只建 book 表结构（本探针不查词，只需 openDatabase 能过）
  {
    const d = new DatabaseSync(dictDb);
    d.exec(`CREATE TABLE IF NOT EXISTS book (
      user_id TEXT NOT NULL, word TEXT NOT NULL, lang TEXT NOT NULL,
      added_at TEXT, updated_at TEXT, status TEXT, note TEXT, tags TEXT,
      review_count INTEGER, last_reviewed_at TEXT, deleted INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, word, lang));`);
    d.close();
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  console.log(`  临时库 ${TMP_ROOT} · 端口 ${port}（随机，非 4570）`);

  const logFd = openSync(logPath, 'w');
  const child = spawn(process.execPath, [path.join(REPO, 'apps', 'sync-server', 'dist', 'index.js')], {
    cwd: REPO,
    env: {
      ...process.env,
      ZIDIANKAIFA_DB: dictDb,
      ZIDIANKAIFA_SYNC_DB: syncDb,
      PORT: String(port),
      ZIDIANKAIFA_SYNC_TOKEN: '', // 显式清空遗留 token，逼出 true 匿名路径
    },
    stdio: ['ignore', logFd, logFd],
  });

  const stop = () => { try { child.kill('SIGKILL'); } catch { /* noop */ } };

  try {
    // ---- 等服务起来（轮询，非固定 sleep）----
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`${base}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error(`服务未起来；日志尾部：\n${readFileSync(logPath, 'utf8').split('\n').slice(-12).join('\n')}`);
    console.log('  服务已就绪\n');

    // ---- 1. 注册 --------------------------------------------------------
    // ⚠ 实测契约：字段是 **username**（3-32 位字母/数字/下划线/点/减号），**不是 email**。
    //    T76 的需求稿写的是「邮箱 + 密码」，而开发 agent 实现的是用户名 —— 该差异已上报待裁。
    const uname = 'alice_probe';
    const unameB = 'bob_probe';
    const pwd = 'CorrectHorseBattery9';
    const reg = await req(base, 'POST', '/api/v1/auth/register', { body: { username: uname, password: pwd } });
    ok('1.1 注册端点存在（R2 前实测 404）', reg.status !== 404, `status=${reg.status}`);
    ok('1.2 注册返回 200', reg.status === 200, `status=${reg.status} body=${JSON.stringify(reg.json)?.slice(0, 160)}`);
    const token1 = reg.json?.token;
    ok('1.3 注册签发 token', typeof token1 === 'string' && token1.length > 10, `token 长度=${token1?.length ?? 'n/a'}`);
    ok('1.4 ★ 响应不含明文口令', !JSON.stringify(reg.json ?? {}).includes(pwd));
    ok('1.5 重复注册同一用户名被拒（409）', (await req(base, 'POST', '/api/v1/auth/register', { body: { username: uname, password: pwd } })).status !== 200);

    // ---- 2. 库中口令与 token 形态（直读临时库）----------------------------
    // ⚠ 用**普通打开**而非 `{ readOnly: true }`：临时库是一次性丢弃品，而只读模式在
    //    Windows 上对「sidecar 被删过」的库会报 `SQLITE_CANTOPEN (errcode 14)` —— 实测踩到。
    const sdb = new DatabaseSync(syncDb);
    const tables = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    ok('2.1 账号表 users 已建', tables.includes('users'), `表=${JSON.stringify(tables)}`);
    ok('2.2 token 表 auth_tokens 已建', tables.includes('auth_tokens'), `表=${JSON.stringify(tables)}`);
    const urows = sdb.prepare('SELECT * FROM users').all();
    const stored = String(urows[0]?.pass_hash ?? '');
    ok('2.3 库中 pass_hash 形如 scrypt$N$salt$hash', /^scrypt\$\d+\$[A-Za-z0-9_\-+/=]+\$[A-Za-z0-9_\-+/=]+$/.test(stored), `pass_hash=${stored.slice(0, 46)}…`);
    const trows = sdb.prepare('SELECT * FROM auth_tokens').all();
    ok('2.4 auth_tokens 每行都有 token_hash 且为 64 位十六进制', trows.length > 0 && trows.every((t) => /^[0-9a-f]{64}$/.test(String(t.token_hash))), `行数=${trows.length}`);
    const allText = JSON.stringify(urows) + JSON.stringify(trows);
    ok('2.5 ★★ 库中不出现明文口令（AC-29）', !allText.includes(pwd), `检索明文口令 ⇒ ${allText.includes(pwd) ? '命中(危险)' : '未命中'}`);
    ok('2.6 ★★ 库中不出现裸 token（只存哈希）', !token1 || !allText.includes(token1), `检索裸 token ⇒ ${token1 && allText.includes(token1) ? '命中(危险)' : '未命中'}`);
    sdb.close();

    // ---- 3. 登录 --------------------------------------------------------
    const login = await req(base, 'POST', '/api/v1/auth/login', { body: { username: uname, password: pwd } });
    ok('3.1 登录端点签发新 token', login.status === 200 && typeof login.json?.token === 'string', `status=${login.status}`);
    const token2 = login.json?.token ?? token1;
    const badLogin = await req(base, 'POST', '/api/v1/auth/login', { body: { username: uname, password: 'wrong-password-xyz' } });
    ok('3.2 错误口令被拒（401/403）', [401, 403].includes(badLogin.status), `status=${badLogin.status}`);
    const noUser = await req(base, 'POST', '/api/v1/auth/login', { body: { username: 'no_such_user_xyz', password: pwd } });
    ok('3.3 ★ 不存在的用户与错误口令返回同一状态码（防用户名枚举）', noUser.status === badLogin.status, `不存在=${noUser.status} 口令错=${badLogin.status}`);
    ok('3.4 ★ 两者错误信息文本一致（不泄露「用户是否存在」）', JSON.stringify(noUser.json) === JSON.stringify(badLogin.json), `${JSON.stringify(noUser.json)?.slice(0, 60)} vs ${JSON.stringify(badLogin.json)?.slice(0, 60)}`);

    // ---- 4. 受保护路由：两用户隔离 ---------------------------------------
    const who = await req(base, 'GET', '/api/v1/auth/whoami', { token: token2 });
    ok('4.1 whoami 需鉴权且返回 scope', who.status === 200 && typeof who.json?.scope === 'string', `status=${who.status} scope=${who.json?.scope}`);
    ok('4.2 带 token 访问 /api/v1/book 成功', (await req(base, 'GET', '/api/v1/book', { token: token2 })).status === 200);
    await req(base, 'POST', '/api/v1/sync', {
      token: token2,
      body: { items: [{ word: 'aliceword', lang: 'en', addedAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', status: 'new', tags: [], reviewCount: 0, deleted: false }] },
    });
    const reg2 = await req(base, 'POST', '/api/v1/auth/register', { body: { username: unameB, password: 'AnotherGoodPass7' } });
    const tokenB = reg2.json?.token;
    await req(base, 'POST', '/api/v1/sync', {
      token: tokenB,
      body: { items: [{ word: 'bobword', lang: 'en', addedAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', status: 'new', tags: [], reviewCount: 0, deleted: false }] },
    });
    const aList = await req(base, 'GET', '/api/v1/book', { token: token2 });
    const bList = await req(base, 'GET', '/api/v1/book', { token: tokenB });
    const aWords = (aList.json?.items ?? []).map((i) => i.word);
    const bWords = (bList.json?.items ?? []).map((i) => i.word);
    ok('4.3 ★★ alice 看得见自己的词', aWords.includes('aliceword'), `alice=${JSON.stringify(aWords)}`);
    ok('4.4 ★★ alice 看不见 bob 的词（AC-29 隔离）', !aWords.includes('bobword'), `alice=${JSON.stringify(aWords)}`);
    ok('4.5 ★★ bob 看不见 alice 的词', !bWords.includes('aliceword'), `bob=${JSON.stringify(bWords)}`);

    // ---- 5. ★ 撤销后旧 token 必须失效 -------------------------------------
    const rev = await req(base, 'POST', '/api/v1/auth/revoke', { token: token2, body: {} });
    ok('5.1 撤销端点存在并受理', rev.status === 200, `status=${rev.status} body=${JSON.stringify(rev.json)?.slice(0, 90)}`);
    const afterRevoke = await req(base, 'GET', '/api/v1/book', { token: token2 });
    ok('5.2 ★★ 撤销后旧 token 打受保护路由被拒（401/403）', [401, 403].includes(afterRevoke.status), `status=${afterRevoke.status}（若 200 = 撤销无效）`);
    ok('5.3 另一用户 token 不受影响（撤销是用户级而非全局）', (await req(base, 'GET', '/api/v1/book', { token: tokenB })).status === 200);

    // ---- 6. 遗留通道兼容（旧 22 条 DTO 契约不破）--------------------------
    const anon = await req(base, 'GET', '/api/v1/book');
    ok('6.1 无 Authorization 时遗留/匿名路径仍可用（行为同 v0.10.0）', anon.status === 200, `status=${anon.status}`);
    const health = await req(base, 'GET', '/health');
    ok('6.2 /health 正常', health.status === 200 && health.json?.ok === true, JSON.stringify(health.json)?.slice(0, 100));

    // ---- 7. 限流（R2 任务 5）--------------------------------------------
    // 注意：服务端默认 RATE_MAX = 300 / 60s（`ZIDIANKAIFA_RATE_MAX`）。探针**显式压低阈值**，
    //       否则要发 300+ 次请求，测试既慢又掩盖「阈值是否真的生效」这一点。
    //       这里改为**另起一个实例**、把阈值压到 10，从而既快又能验证阈值可配。
    let saw429 = false;
    let dist = {};
    for (let i = 0; i < 150; i++) {
      const r = await req(base, 'GET', '/api/v1/book', { token: tokenB });
      dist[r.status] = (dist[r.status] ?? 0) + 1;
      if (r.status === 429) { saw429 = true; break; }
    }
    ok('7.1 IP 维度限流：默认阈值(300)下 150 次不触发 429（符合预期）', !saw429, `状态分布=${JSON.stringify(dist)}`);

    // 压低阈值重启一个实例，验证「阈值确实生效且可配」
    stop();
    await sleep(400);
    const port2 = await freePort();
    const base2 = `http://127.0.0.1:${port2}`;
    const logPath2 = path.join(TMP_ROOT, 'server2.log');
    const fd2 = openSync(logPath2, 'w');
    const child2 = spawn(process.execPath, [path.join(REPO, 'apps', 'sync-server', 'dist', 'index.js')], {
      cwd: REPO,
      env: { ...process.env, ZIDIANKAIFA_DB: dictDb, ZIDIANKAIFA_SYNC_DB: syncDb, PORT: String(port2), ZIDIANKAIFA_SYNC_TOKEN: '', ZIDIANKAIFA_RATE_MAX: '10' },
      stdio: ['ignore', fd2, fd2],
    });
    try {
      let up2 = false;
      for (let i = 0; i < 40; i++) {
        try { const r = await fetch(`${base2}/health`); if (r.ok) { up2 = true; break; } } catch { /* retry */ }
        await sleep(250);
      }
      if (!up2) throw new Error(`第二实例未起来；日志：\n${readFileSync(logPath2, 'utf8').split('\n').slice(-12).join('\n')}`);
      let saw429b = false;
      let dist2 = {};
      for (let i = 0; i < 40; i++) {
        const r = await req(base2, 'GET', '/api/v1/book', { token: tokenB });
        dist2[r.status] = (dist2[r.status] ?? 0) + 1;
        if (r.status === 429) { saw429b = true; break; }
      }
      ok('7.2 ★ 阈值压到 10 后 40 次内出现 429（限流真实生效且可配）', saw429b, `状态分布=${JSON.stringify(dist2)}`);
    } finally {
      try { child2.kill('SIGKILL'); } catch { /* noop */ }
    }

    const srcText = readFileSync(path.join(REPO, 'apps', 'sync-server', 'src', 'index.ts'), 'utf8');
    ok('7.3 源码含限流实现（字面量核对）', /rateLimit|RATE_MAX/i.test(srcText), `rateLimit 命中=${(srcText.match(/rateLimit/gi) ?? []).length} 次 · RATE_MAX 命中=${(srcText.match(/RATE_MAX/g) ?? []).length} 次`);
  } finally {
    stop();
    await sleep(300);
    const after = frozenFp();
    console.log('\n===== 结果 =====');
    for (const r of results) console.log(r);
    console.log(`\n断言：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
    console.log(`冻结库(未打开) 止 ${fpStr(after)}  ⇒ ${before && after && before.size === after.size && before.mtime === after.mtime ? '\u2705 前后一致（未被写）' : '\u274c 发生了变化'}`);
    if (!KEEP) { try { rmSync(TMP_ROOT, { recursive: true, force: true }); console.log('临时目录已清理'); } catch (e) { console.log(`临时目录清理失败：${e.message}`); } }
    else console.log(`临时目录保留（取证）：${TMP_ROOT}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('探针异常：', e); process.exit(2); });
