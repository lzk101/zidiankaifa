// scripts/check_user_scope.mjs —— AC-27 / AC-28 / AC-29 / AC-30「用户维度隔离 + 账号后端」独立判别集（T84）
//
// ★ 为什么必须存在（根因 = 测试结构盲区，见 .board/EVIDENCE.md §50 与本文件 §0）：
//   · packages/core/test/book_lang.mjs 直接调 syncMerge(db,[...])，**绕过 HTTP**
//   · apps/sync-server/scripts/smoke.mjs 同样直接调函数
//   ⇒ V11-SYNC-DTO 就是这样漏过 643 条门禁的：「两层各自自洽、交界处无人测」
//   ⇒ 本文件**所有用户维度断言一律走真实 HTTP**（真起服务、随机端口、真 fetch）。
//
// ★ 为什么不接入 pnpm test（主管 T84-R 明令）：
//   packages/core/package.json:25 的 test 链 + book_lang.mjs 的 137 条是**冻结账本（core 621）**；
//   而本文件在 T83-R1/R2 落地前**必然红**（user_id 列尚不存在）。
//   教训：ru_morph_defects.mjs 因「src 没修好就写红断言」而被链外永久隔离 —— 不让本文件拖累门禁。
//
// 契约真值来源（**按 .board/REQ.md 的判定式写断言，不按当前实现输出写**）：
//   · AC-27（:1505-1516）① 用户列 ② 主键必须重建为 ["user_id","word","lang"] ③ 每条 book 读取必须带 user_id
//                       ④ 成套改 ⑤ 新列索引单独 try/catch 建 ⑥ 用户级可撤销凭证
//   · AC-28（:1518-1525）① 匿名不阻断 ② 哨兵常量 'local'（不得 NULL/空串/随机） ③ 双向隔离 ④ 绑定上传改判 ⑤ LWW + 被覆盖行留痕
//   · AC-29（:1527-1535）① 注册/登录 ② scrypt$N$salt$hash + timingSafeEqual ③ token 只存哈希 + 可撤销 ④ 限流 429（IP ＋ 用户）
//   · AC-30（:1537-1544）① 存量落 'local' ② 未认领仅本地可见 ③ 认领后对他用户仍不可见 ④ 幂等
//
// 只读性纪律：**绝不打开 data/db/dict.db**（起止各核对一次 size+mtime）；真实 sync 库**只拷副本读**；
//             服务端一律指向 scripts/_tmp 下的临时库。
// 退出码约定：0 = 全部 RUN 断言绿　·　1 = 有 RUN 断言红（PENDING 不计失败）　·　2 = 基建失败（库/服务起不来）
//
// 用法：node scripts/check_user_scope.mjs            （任意 cwd，两种 cwd 都实测过）
//       VERBOSE=1 node scripts/check_user_scope.mjs  (额外打印路由清单/列清单)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..'); // ★ 只退一级（铁律 6：scripts/ → 仓库根）
const VERBOSE = !!process.env.VERBOSE;

const SERVER = process.env.SYNC_SERVER_ENTRY
  ? path.resolve(process.env.SYNC_SERVER_ENTRY)
  : path.join(REPO, 'apps', 'sync-server', 'dist', 'index.js');
const CORE_DB = path.join(REPO, 'packages', 'core', 'dist', 'db', 'index.js');
const SERVER_SRC = path.join(REPO, 'apps', 'sync-server', 'src', 'index.ts');
const FROZEN = path.join(REPO, 'data', 'db', 'dict.db');
const REAL_SYNC = path.join(REPO, 'data', 'sync-data', 'sync.db');

/* ---------------- 断言登记 ---------------- */
const results = [];
const pendings = [];
const notes = [];
const ok = (id, desc, cond, extra = '') => {
  results.push({ id, desc, cond: !!cond, extra });
  console.log(`  ${cond ? '\u2714' : '\u2718'} ${id} ${desc}${extra ? `  [${extra}]` : ''}`);
};
const pending = (id, desc, why) => {
  pendings.push({ id, desc, why });
  console.log(`  \u25cb ${id} ${desc}  \u2190 PENDING：${why}`);
};
const note = (s) => {
  notes.push(s);
  console.log(`  \u24d8 ${s}`);
};
const head = (s) => console.log(`\n${s}`);

/* ---------------- 基建 ---------------- */
const TMP_ROOT = path.join(REPO, 'scripts', '_tmp', 't84_user_scope');
fs.mkdirSync(TMP_ROOT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(TMP_ROOT, 'run-'));
const LIVE_DICT = path.join(RUN, 'live', 'dict.db');
const LIVE_SYNC = path.join(RUN, 'live', 'sync.db');
const MIG_SYNC = path.join(RUN, 'migrate', 'sync.db'); // ★ 真实 sync 库的副本（存量迁移对象）
const LOG = path.join(RUN, 'server.log');
fs.mkdirSync(path.dirname(LIVE_DICT), { recursive: true });
fs.mkdirSync(path.dirname(MIG_SYNC), { recursive: true });

let child = null;
let logFd = null;
let infraFail = null;
let frozenBefore = null; // ★ 必须在 finally 可见（首版写在 try 内 ⇒ ReferenceError）

const fp = (p) => {
  try {
    const s = fs.statSync(p);
    return { size: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return null;
  }
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

const api = async (port, method, route, body, headers) => {
  const h = { ...(headers || {}) };
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: Object.keys(h).length ? h : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* 非 JSON（如空响应的 500） */
  }
  return { status: r.status, json };
};

const startServer = async (port) => {
  if (logFd !== null) {
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  }
  logFd = fs.openSync(LOG, 'a');
  child = spawn(process.execPath, [SERVER], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(port),
      ZIDIANKAFA_SYNC_PORT: String(port),
      ZIDIANKAFA_DB: LIVE_DICT,
      ZIDIANKAFA_SYNC_DB: LIVE_SYNC,
      ZIDIANKAFA_SYNC_TOKEN: '',
    },
    // ★ 文件重定向（非管道）—— 规避受限沙箱下带管道 stdio 的 spawn EPERM
    stdio: ['ignore', logFd, logFd],
  });
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return true;
    } catch {
      /* 未就绪 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

const stopServer = async () => {
  if (child && child.exitCode === null) {
    child.kill();
    for (let i = 0; i < 40 && child.exitCode === null; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  child = null;
};

/* ---------------- 库取证助手（一律 readOnly，避免任何写入副作用） ---------------- */
const sqlite = await import('node:sqlite');
const DatabaseSync = sqlite.DatabaseSync;

const withDb = (p, fn, ro = true) => {
  const db = new DatabaseSync(p, ro ? { readOnly: true } : {});
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const bookColsOf = (p) => {
  if (!fs.existsSync(p)) return [];
  return withDb(p, (db) => db.prepare('PRAGMA table_info(book)').all());
};
const bookDdlOf = (p) => {
  if (!fs.existsSync(p)) return '';
  return withDb(p, (db) => {
    const r = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='book'").all();
    return r.length ? r[0].sql : '';
  });
};
const bookRowsOf = (p) => {
  if (!fs.existsSync(p)) return [];
  return withDb(p, (db) => db.prepare('SELECT * FROM book ORDER BY word, lang').all());
};
const pkOf = (cols) => cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
const itemsOf = (j) => (j && Array.isArray(j.items) ? j.items : null);

/** 契约形状的条目（与服务端实现无关；camelCase，见 check_sync_dto_contract.mjs 的同名助手） */
const camelItem = (word, lang, updatedAt, over = {}) => ({
  word,
  lang,
  addedAt: 1000,
  updatedAt,
  status: 'new',
  note: null,
  tags: [],
  reviewCount: 0,
  lastReviewedAt: null,
  deleted: false,
  ...over,
});

/* ==================================================================== */
try {
  console.log('check_user_scope —— AC-27/28/29/30 用户维度隔离与账号后端独立判别集（HTTP 边界）');
  console.log(`  仓库根 = ${REPO}`);
  console.log(`  临时目录 = ${path.relative(REPO, RUN)}`);
  console.log(`  被测服务端 = ${path.relative(REPO, SERVER)}`);
  frozenBefore = fp(FROZEN);
  console.log(`  冻结库(不打开) data/db/dict.db = ${frozenBefore ? frozenBefore.size + ' B · ' + frozenBefore.mtime : '缺失'}`);

  /* ---------- §0 基建自证 ---------- */
  head('§0 基建自证（若本段有红，后面所有结论无效）');
  const core = await import(pathToFileURL(CORE_DB).href);
  {
    const d = core.openDatabase(LIVE_DICT);
    d.close();
    const s = core.openDatabase(LIVE_SYNC);
    s.close();
  }
  ok('0.1', '临时 live 库两枚已建（dict + sync，openDatabase 建 schema，句柄已 close）', fs.existsSync(LIVE_DICT) && fs.existsSync(LIVE_SYNC));

  // 真实 sync 库只拷副本（含 -wal/-shm，若有）
  let fixtureRows = null;
  if (fs.existsSync(REAL_SYNC)) {
    fs.copyFileSync(REAL_SYNC, MIG_SYNC);
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(REAL_SYNC + ext)) fs.copyFileSync(REAL_SYNC + ext, MIG_SYNC + ext);
    }
    fixtureRows = bookRowsOf(MIG_SYNC);
    ok('0.2', '存量夹具已就绪（真实 sync 库副本，未碰原库）', fixtureRows.length === 3, `行数=${fixtureRows.length}`);
    note(`夹具为 data/sync-data/sync.db 的**副本**；原库 size=${fp(REAL_SYNC).size} B · mtime=${fp(REAL_SYNC).mtime}`);
  } else {
    ok('0.2', '存量夹具已就绪（真实 sync 库副本）', false, 'data/sync-data/sync.db 不存在');
  }

  const port = await freePort();
  ok('0.3', '随机空闲端口已取（绝不用 4570）', port > 0 && port !== 4570, `port=${port}`);
  const up = await startServer(port);
  if (!up) {
    infraFail = `服务未在 18s 内就绪（pid=${child ? child.pid : '-'} exit=${child ? child.exitCode : '-'}）· 日志尾见 ${path.relative(REPO, LOG)}`;
    ok('0.4', '服务 /health 就绪', false, infraFail);
    throw new Error(infraFail);
  }
  ok('0.4', '服务 /health 就绪（真起进程，真 HTTP）', true);

  const health = await api(port, 'GET', '/health');
  ok('0.5', '/health 返回 200', health.status === 200, `status=${health.status}`);

  /* ---------- §1 AC-27①② 用户列 + 复合主键（真实 DDL，不靠读源码） ---------- */
  head('§1 AC-27①②　book 表用户列与复合主键（PRAGMA table_info + sqlite_master 真实 DDL）');
  const liveCols = bookColsOf(LIVE_SYNC);
  const livePk = pkOf(liveCols);
  const liveDdl = bookDdlOf(LIVE_SYNC);
  if (VERBOSE) note(`live book 列 = ${liveCols.map((c) => c.name + (c.pk ? '#' + c.pk : '')).join(', ')}`);
  ok('1.1', 'book 表含 user_id 列（AC-27①）', liveCols.some((c) => c.name === 'user_id'), `列=${liveCols.map((c) => c.name).join(',') || '（无 book 表）'}`);
  ok('1.2', '★ 主键 === ["user_id","word","lang"]（AC-27②，顺序敏感）', JSON.stringify(livePk) === JSON.stringify(['user_id', 'word', 'lang']), `实测 pk=${JSON.stringify(livePk)}`);
  ok('1.3', 'sqlite_master 真实 DDL 的 PRIMARY KEY 含 user_id 且非"仅 ALTER 加列"', /primary key\s*\(\s*"?user_id"?/i.test(liveDdl), liveDdl ? 'DDL 已取' : 'DDL 为空');
  const idxList = fs.existsSync(LIVE_SYNC) ? withDb(LIVE_SYNC, (db) => db.prepare('PRAGMA index_list(book)').all()) : [];
  const idxCols = idxList.map((ix) => ({ name: ix.name, cols: withDb(LIVE_SYNC, (db) => db.prepare(`PRAGMA index_info("${ix.name}")`).all()).map((c) => c.name) }));
  ok('1.4', 'user_id 上有独立索引（AC-27⑤：新列索引须单独 try/catch 建，不得写进 SCHEMA_SQL）', idxCols.some((ix) => ix.cols.includes('user_id')), `索引=${idxCols.map((i) => i.name + '(' + i.cols.join('+') + ')').join(' ') || '（无）'}`);

  // AC-27② 的数据面硬判据：「只 ALTER 加列不满足多用户」——同词同语言两用户必须 2 行共存
  let coexist = { ok: false, info: '未执行' };
  try {
    const db = new DatabaseSync(LIVE_SYNC, {});
    const cols = db.prepare('PRAGMA table_info(book)').all().map((c) => c.name);
    if (!cols.includes('user_id')) {
      coexist = { ok: false, info: 'book 无 user_id 列 ⇒ 无法表达两用户' };
    } else {
      const now = Date.now();
      const ins = `INSERT INTO book (user_id, word, lang, added_at, updated_at) VALUES (?,?,?,?,?)`;
      db.prepare(ins).run('alice', 'coexist', 'en', now, now);
      db.prepare(ins).run('bob', 'coexist', 'en', now + 1, now);
      const n = db.prepare("SELECT COUNT(1) AS n FROM book WHERE word='coexist'").get().n;
      coexist = { ok: n === 2, info: `同词同语言两用户行数=${n}（须=2）` };
    }
    db.close();
  } catch (e) {
    coexist = { ok: false, info: `写入失败：${e.message}` };
  }
  ok('1.5', '★ 数据面：alice/bob 同词同语言 ⇒ 两行共存（AC-27②「只 ALTER 加列不满足」的硬判据）', coexist.ok, coexist.info);

  /* ---------- §2 AC-28③ 双向隔离（HTTP 边界） ---------- */
  head('§2 AC-28③　双向隔离（HTTP 边界；种子行直接写临时库，读取一律走 HTTP）');
  // 种子里放 alice/bob 各一行（若 user_id 不存在则记录原因，不掩盖）
  let seeded = { ok: false, info: '未执行', anonItems: null };
  try {
    const db = new DatabaseSync(LIVE_SYNC, {});
    const cols = db.prepare('PRAGMA table_info(book)').all().map((c) => c.name);
    if (cols.includes('user_id')) {
      const now = Date.now();
      const ins = `INSERT INTO book (user_id, word, lang, added_at, updated_at) VALUES (?,?,?,?,?)`;
      db.prepare(ins).run('alice', 'alicetoken', 'en', now, now);
      db.prepare(ins).run('bob', 'bobtoken', 'en', now + 1, now + 1);
      db.prepare(ins).run('local', 'localtoken', 'en', now + 2, now + 2);
      seeded.ok = true;
      seeded.info = 'alice/bob/local 各一行（词 a|b|l 前缀区分）';
    } else {
      seeded.info = 'book 无 user_id 列 ⇒ 无用户维度可切分';
    }
    db.close();
  } catch (e) {
    seeded.info = `种子写入失败：${e.message}`;
  }
  const anonBook = await api(port, 'GET', '/api/v1/book');
  seeded.anonItems = itemsOf(anonBook.json);
  const anonWords = (seeded.anonItems || []).map((i) => i.word);
  ok(
    '2.1',
    '★ 匿名（无凭证）GET /book **不得**看见任何用户行（alice/bob）',
    seeded.ok && anonWords.includes('localtoken') === true && !anonWords.includes('alicetoken') && !anonWords.includes('bobtoken'),
    seeded.ok ? `匿名可见词=${JSON.stringify(anonWords)}` : `PENDING 前置失败：${seeded.info}`,
  );
  // 用凭证切分（需账号端点；无则 PENDING —— 机械化判据 = 端点实测 404）
  const regProbe = await api(port, 'POST', '/api/v1/auth/register', { email: 'probe@example.com', password: 'Probe!Passw0rd' });
  const loginProbe = await api(port, 'POST', '/api/v1/auth/login', { email: 'probe@example.com', password: 'Probe!Passw0rd' });
  const hasRegister = regProbe.status !== 404;
  const hasLogin = loginProbe.status !== 404;
  note(`账号端点探测：POST /api/v1/auth/register ⇒ ${regProbe.status}　·　POST /api/v1/auth/login ⇒ ${loginProbe.status}（404 = 未落地）`);
  if (hasLogin) {
    const tok = loginProbe.json && (loginProbe.json.token || loginProbe.json.accessToken);
    const a = await api(port, 'GET', '/api/v1/book', undefined, { Authorization: `Bearer ${tok}` });
    const aw = (itemsOf(a.json) || []).map((i) => i.word);
    ok('2.2', 'alice 凭证只看见自己的行（不含 bob/local）', aw.includes('alicetoken') && !aw.includes('bobtoken') && !aw.includes('localtoken'), `可见=${JSON.stringify(aw)}`);
    ok('2.3', '★ 用户看不到 local 行（AC-28③ 反方向）', !aw.includes('localtoken'), `可见=${JSON.stringify(aw)}`);
  } else {
    pending('2.2', 'alice 凭证只看见自己的行', 'POST /api/v1/auth/login 实测 404（AC-29 未落地）⇒ HTTP 层无用户级凭证');
    pending('2.3', '★ 用户看不到 local 行（AC-28③ 反方向）', '同上：无用户级凭证');
  }

  /* ---------- §3 AC-27③ 逐路由「不得有漏过滤」（双通道） ---------- */
  head('§3 AC-27③　逐路由核对：不得存在无用户过滤的用户数据查询');
  const srvSrc = fs.readFileSync(SERVER_SRC, 'utf8').split('\n');
  const markers = [];
  srvSrc.forEach((l, i) => {
    const m = l.match(/p === '([^']+)'/);
    if (m) markers.push({ route: m[1], ln: i + 1 });
  });
  const routeBlocks = markers.map((mk, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].ln - 1 : srvSrc.length;
    return { ...mk, body: srvSrc.slice(mk.ln - 1, end).join('\n') };
  });
  const bookBlocks = routeBlocks.filter((b) => /\bbook/i.test(b.body));
  if (VERBOSE) note(`路由标记 ${markers.length} 条：${markers.map((m) => m.route).join(' ')}`);
  ok('3.1', '路由清单已枚举且「涉及 book 的路由块」已筛出', markers.length > 0 && bookBlocks.length > 0, `路由=${markers.length} 条 · 涉及 book=${bookBlocks.length} 条（${bookBlocks.map((b) => b.route).join(', ')}）`);
  ok(
    '3.2',
    '★ 每条涉及 book 的路由块都出现用户过滤（user_id / userId / LOCAL_USER_ID）',
    bookBlocks.length > 0 && bookBlocks.every((b) => /user_id|userId|LOCAL_USER_ID/.test(b.body)),
    bookBlocks.map((b) => `${b.route}@${b.ln}:${/user_id|userId|LOCAL_USER_ID/.test(b.body) ? '有' : '**无**'}`).join(' · '),
  );
  const pathLiterals = (srvSrc.join('\n').match(/p === '\/api\/v1\/[^']+'/g) || []).length;
  ok('3.3', '覆盖率自校验：我的枚举数 === 源码中 `p === \'/api/v1/…\'` 出现数（防正则漏路由）', pathLiterals === markers.length, `字面量=${pathLiterals} 枚举=${markers.length}`);
  const bookListCalls = (srvSrc.join('\n').match(/bookListAll\s*\([^)]*\)/g) || []);
  ok(
    '3.4',
    '★ `bookListAll(...)` 的每次调用都传入用户维度实参（AC-27④「成套改」：该函数同时服务 GET /book 与 POST /sync 回包）',
    bookListCalls.length > 0 && bookListCalls.every((c) => c.includes(',')),
    `调用=${JSON.stringify(bookListCalls)}`,
  );
  if (hasLogin) {
    pending('3.5', '通道 B（实际请求）：两用户 POST /sync 后 GET /book 集合因凭证而不同', '账号端点已探测存在，但本脚本尚未取得两用户 token —— 待 T83-R2 落地后放开');
  } else {
    pending('3.5', '通道 B（实际请求）：两用户 POST /sync 后 GET /book 集合因凭证而不同', 'POST /api/v1/auth/login 实测 404 ⇒ 无法以两用户身份发请求');
  }

  /* ---------- §4 AC-30 存量迁移 + AC-27② 主键重建（在真实库副本上做） ---------- */
  head('§4 AC-30　存量 3 行 → user_id=\'local\'（行数保真 · 逐字段保真 · 幂等 · 主键重建）');
  const migBefore = fs.existsSync(MIG_SYNC) ? bookRowsOf(MIG_SYNC) : [];
  let migErr = null;
  try {
    const d = core.openDatabase(MIG_SYNC);
    d.close();
  } catch (e) {
    migErr = e.message;
  }
  const migAfter = migErr ? [] : bookRowsOf(MIG_SYNC);
  const migCols = bookColsOf(MIG_SYNC);
  const migPk = pkOf(migCols);
  ok('4.0', '迁移在真实 sync 库副本上执行未抛异常（含 AC-27⑤「新列索引须单独 try/catch 建」的反面：老库不得崩 no such column）', !migErr, migErr ? `抛错：${migErr}` : '无异常');
  ok('4.1', '行数保真：迁移前后行数相等（AC-30④）', !migErr && migAfter.length === migBefore.length, `迁移前=${migBefore.length} 迁移后=${migAfter.length}`);
  const stripUser = (r) => {
    const o = { ...r };
    delete o.user_id;
    return JSON.stringify(o);
  };
  ok(
    '4.2',
    '逐字段保真（除新列 user_id 外，每行每个字段与迁移前完全一致）',
    !migErr && migBefore.length === migAfter.length && migBefore.every((r, i) => stripUser(r) === stripUser(migAfter[i])),
    migErr ? '未迁移' : `比对 ${migBefore.length} 行`,
  );
  ok(
    '4.3',
    "★ 三行 user_id === 'local'（常量哨兵；AC-28② 禁止 NULL/空串/随机值）",
    !migErr && migAfter.length > 0 && migAfter.every((r) => r.user_id === 'local'),
    migErr ? '未迁移' : `实测=${JSON.stringify(migAfter.map((r) => r.user_id))}`,
  );
  ok('4.4', '迁移后主键已重建为 ["user_id","word","lang"]（AC-27②）', JSON.stringify(migPk) === JSON.stringify(['user_id', 'word', 'lang']), `实测 pk=${JSON.stringify(migPk)}`);
  let mig2 = null;
  try {
    const d = core.openDatabase(MIG_SYNC);
    d.close();
    mig2 = bookRowsOf(MIG_SYNC);
  } catch (e) {
    mig2 = null;
    note(`幂等复跑抛错：${e.message}`);
  }
  ok(
    '4.5',
    '★ 幂等：第二次 openDatabase 后行数与归属均不变（AC-30④）',
    !!mig2 && mig2.length === migAfter.length && JSON.stringify(mig2.map((r) => r.user_id)) === JSON.stringify(migAfter.map((r) => r.user_id)),
    mig2 ? `复跑后行数=${mig2.length} 归属=${JSON.stringify(mig2.map((r) => r.user_id))}` : '复跑失败',
  );
  const distCoreSrc = fs.readFileSync(CORE_DB, 'utf8');
  ok(
    "4.6",
    "哨兵常量可 grep：core dist 中存在字面量 'local'（AC-28② 要求常量、可 grep、可迁移）",
    /['"]local['"]/.test(distCoreSrc),
    `core dist 中 'local' 字面量出现 = ${(distCoreSrc.match(/['"]local['"]/g) || []).length} 次`,
  );
  ok('4.7', "LOCAL_USER_ID 常量已导出（AC-28② 建议 core 导出 LOCAL_USER_ID）", /LOCAL_USER_ID/.test(distCoreSrc), `出现 = ${(distCoreSrc.match(/LOCAL_USER_ID/g) || []).length} 次`);

  /* ---------- §5 AC-28④⑤ 绑定上传 ---------- */
  head('§5 AC-28④⑤　绑定账号与「上传为我的」（LWW ＋ 被覆盖行留痕）');
  const claimCandidates = ['/api/v1/auth/claim', '/api/v1/auth/bind', '/api/v1/book/claim', '/api/v1/me/claim'];
  let claimRoute = null;
  for (const r of claimCandidates) {
    const p2 = await api(port, 'POST', r, {});
    if (p2.status !== 404) {
      claimRoute = { route: r, status: p2.status };
      break;
    }
  }
  const bindWhy = `绑定端点未落地（候选 ${claimCandidates.join(' / ')} 实测全 404）`;
  if (claimRoute) {
    note(`绑定端点候选命中：${claimRoute.route} ⇒ ${claimRoute.status}`);
    pending('5.2', "绑定后 'local' 行改判为新用户（行数守恒）", '端点存在但断言体待 T83-R2 定契约后放开（避免按实现猜协议）');
    pending('5.3', '改判后对其他用户仍不可见', '同上');
    pending('5.4', '冲突按 last-write-wins（较新者胜）', '同上');
    pending('5.5', '★ 被覆盖行留痕（不得静默丢弃）', '同上');
  } else {
    pending('5.1', '绑定端点存在（POST claim/bind 之一）', bindWhy);
    pending('5.2', "绑定后 'local' 行改判为新用户（行数守恒）", bindWhy);
    pending('5.3', '改判后对其他用户仍不可见', bindWhy);
    pending('5.4', '冲突按 last-write-wins（较新者胜）', bindWhy);
    pending('5.5', '★ 被覆盖行留痕（不得静默丢弃）', bindWhy);
  }

  /* ---------- §6 AC-29② 密码 ---------- */
  head('§6 AC-29②　密码哈希存储（scrypt$N$salt$hash；不得明文/可逆）');
  if (!hasRegister) {
    pending('6.1', '注册端点存在（POST /api/v1/auth/register）', `实测 ${regProbe.status}（404 = 未落地）`);
    pending('6.2', '库中密码字段格式匹配 /^scrypt\\$\\d+\\$[0-9a-f]+\\$[0-9a-f]+$/', '无注册端点 ⇒ 无账号行可查');
    pending('6.3', '★ 库中不出现明文密码', '无注册端点 ⇒ 无账号行可查');
    pending('6.4', '校验路径含 timingSafeEqual（AC-29②）', '账号后端未落地');
  } else {
    const pwd = 'Probe!Passw0rd';
    const reg = await api(port, 'POST', '/api/v1/auth/register', { email: `probe+${Date.now()}@example.com`, password: pwd });
    note(`注册实测 ⇒ ${reg.status} ${JSON.stringify(reg.json).slice(0, 120)}`);
    const usersCols = withDb(LIVE_SYNC, (db) => {
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%user%' OR name LIKE '%account%')").all();
      return t.map((x) => x.name);
    });
    let found = { scrypt: false, plain: false, rows: 0 };
    for (const t of usersCols) {
      const rows = withDb(LIVE_SYNC, (db) => db.prepare(`SELECT * FROM "${t}"`).all());
      for (const r of rows) {
        found.rows += 1;
        for (const v of Object.values(r)) {
          if (typeof v !== 'string') continue;
          if (/^scrypt\$\d+\$[0-9a-fA-F]+\$[0-9a-fA-F]+$/.test(v)) found.scrypt = true;
          if (v === pwd) found.plain = true;
        }
      }
    }
    ok('6.2', '库中密码字段格式匹配 scrypt$N$salt$hash', found.scrypt, `账号表=${JSON.stringify(usersCols)} 行数=${found.rows}`);
    ok('6.3', '★ 库中不出现明文密码', !found.plain, `明文命中=${found.plain}`);
    ok('6.4', '校验路径含 timingSafeEqual（AC-29②）', /timingSafeEqual/.test(srvSrc.join('\n')), `sync-server src 中 timingSafeEqual = ${(srvSrc.join('\n').match(/timingSafeEqual/g) || []).length} 次`);
  }

  /* ---------- §7 AC-29③ token 只存哈希 + 可撤销 ---------- */
  head('§7 AC-29③　用户级 bearer token：只存哈希 ＋ 撤销后立即失效');
  if (!hasLogin) {
    pending('7.1', '登录端点存在并签发 token', `实测 ${loginProbe.status}（404）`);
    pending('7.2', '★ 库中查不到裸 token（只存哈希）', '无登录端点 ⇒ 无 token 可核对');
    pending('7.3', '撤销端点存在', '账号后端未落地');
    pending('7.4', '★ 撤销后旧 token 打受保护路由必须被拒（401/403）', '账号后端未落地');
  } else {
    const email = `probe+${Date.now()}@example.com`;
    await api(port, 'POST', '/api/v1/auth/register', { email, password: 'Probe!Passw0rd' });
    const lg = await api(port, 'POST', '/api/v1/auth/login', { email, password: 'Probe!Passw0rd' });
    const tok = lg.json && (lg.json.token || lg.json.accessToken);
    ok('7.1', '登录端点签发 token', !!tok, `status=${lg.status} token=${tok ? '已签发' : '无'}`);
    const tokenTables = withDb(LIVE_SYNC, (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name));
    let rawFound = false;
    for (const t of tokenTables) {
      const rows = withDb(LIVE_SYNC, (db) => db.prepare(`SELECT * FROM "${t}"`).all());
      for (const r of rows) if (tok && Object.values(r).some((v) => v === tok)) rawFound = true;
    }
    ok('7.2', '★ 库中查不到裸 token（只存哈希）', !!tok && !rawFound, `裸 token 命中=${rawFound}`);
    const rev = await api(port, 'POST', '/api/v1/auth/revoke', undefined, { Authorization: `Bearer ${tok}` });
    ok('7.3', '撤销端点存在（POST /api/v1/auth/revoke）', rev.status !== 404, `status=${rev.status}`);
    const after = await api(port, 'GET', '/api/v1/book', undefined, { Authorization: `Bearer ${tok}` });
    ok('7.4', '★ 撤销后旧 token 打受保护路由必须被拒', rev.status !== 404 && (after.status === 401 || after.status === 403), `撤销=${rev.status} 再用=${after.status}`);
  }

  /* ---------- §8 AC-29④ 限流 429 ---------- */
  head('§8 AC-29④　限流：第 N+1 次 ⇒ 429（IP 维度 ＋ 用户维度）');
  const BURST = 120;
  const target = hasLogin ? '/api/v1/auth/login' : '/api/v1/book';
  const burst = { n: 0, statuses: {}, first429At: null };
  for (let i = 0; i < BURST; i += 1) {
    const r = hasLogin
      ? await api(port, 'POST', target, { email: 'ratelimit@example.com', password: 'Wrong!Passw0rd' })
      : await api(port, 'GET', target);
    burst.n += 1;
    burst.statuses[r.status] = (burst.statuses[r.status] || 0) + 1;
    if (r.status === 429) {
      burst.first429At = burst.n;
      break;
    }
  }
  ok(
    '8.1',
    `IP 维度限流存在：连续请求 ${target} 至多 ${BURST} 次内必须出现 429`,
    !!burst.statuses[429],
    `已发=${burst.n} 状态分布=${JSON.stringify(burst.statuses)}`,
  );
  ok(
    '8.2',
    '第 1 次请求不得被限（429 只允许出现在第 2 次及以后；阈值 N 由实现自定）',
    burst.first429At === null || burst.first429At > 1,
    `首次 429 出现在第 ${burst.first429At === null ? '—（未出现）' : burst.first429At} 次`,
  );
  if (!hasLogin) {
    pending('8.3', '用户维度限流（按 user 计数）', '无用户级凭证（登录端点 404）⇒ 无法按用户维度施压');
  } else {
    pending('8.3', '用户维度限流（按 user 计数）', '端点存在但阈值口径待 T83-R2 定案后放开');
  }

  /* ---------- §9 AC-28①（＋②③）匿名不阻断 = 回归性质 ---------- */
  head('§9 AC-28①　匿名不阻断：不传 token 时本机生词本行为与改造前一致');
  const anon1 = await api(port, 'GET', '/api/v1/book');
  ok('9.1', '无凭证 GET /api/v1/book 不被阻断（200，非 401/403）', anon1.status === 200, `status=${anon1.status}`);
  const w1 = `anonword${Date.now()}`;
  const push = await api(port, 'POST', '/api/v1/sync', { items: [camelItem(w1, 'en', 777000)] });
  ok('9.2', '无凭证 POST /api/v1/sync 不被阻断且确实落库（200 ∧ pushed≥1）', push.status === 200 && (push.json?.pushed ?? 0) >= 1, `status=${push.status} pushed=${push.json?.pushed} skipped=${push.json?.skipped}`);
  const anon2 = await api(port, 'GET', '/api/v1/book');
  const w2 = (itemsOf(anon2.json) || []).map((i) => i.word);
  ok('9.3', '匿名写入后匿名词表立即可读（同进程往返）', w2.includes(w1), `词表含 ${w1} = ${w2.includes(w1)}`);
  // 重启后仍可读（持久化）
  await stopServer();
  const port2 = await freePort();
  child = null;
  const up2 = await startServer(port2);
  if (up2) {
    const anon3 = await api(port2, 'GET', '/api/v1/book');
    const w3 = (itemsOf(anon3.json) || []).map((i) => i.word);
    ok('9.4', '★ 重启服务后匿名数据仍在（持久化，非内存态）', w3.includes(w1), `重启后词表含 ${w1} = ${w3.includes(w1)}`);
  } else {
    ok('9.4', '★ 重启服务后匿名数据仍在（持久化，非内存态）', false, '第二次起服务失败');
  }
  // 匿名写入必须落 'local' 哨兵（AC-28②）
  const liveAfter = bookRowsOf(LIVE_SYNC);
  const mine = liveAfter.filter((r) => r.word === w1);
  ok('9.5', "★ 匿名写入行的 user_id === 'local'（AC-28② 哨兵，不得 NULL/空串）", mine.length === 1 && mine[0].user_id === 'local', mine.length ? `user_id=${JSON.stringify(mine[0].user_id)}` : '未找到匿名写入行');
  ok('9.6', "匿名上下文看不见用户行（'local' 侧的隔离方向；与 §2.1 同源，此处为重启后复验）", !!seeded.ok && (itemsOf((await api(port2, 'GET', '/api/v1/book')).json) || []).every((i) => !['alicetoken', 'bobtoken'].includes(i.word)), `种子=${seeded.ok ? '已种' : seeded.info}`);
} catch (e) {
  if (!infraFail) infraFail = e?.stack || String(e);
  console.log(`\n  \u2718 基建/执行异常：${infraFail}`);
} finally {
  await stopServer();
  if (logFd !== null) {
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  }

  /* ---------------- 收尾：冻结库指纹核对 + 临时目录处置 ---------------- */
  const frozenAfter = fp(FROZEN);
  const frozenSame = !!frozenBefore && !!frozenAfter && frozenBefore.size === frozenAfter.size && frozenBefore.mtime === frozenAfter.mtime;

  head('§10 收尾自证');
  console.log(`  ${frozenSame ? '\u2714' : '\u2718'} 冻结库未被修改：${frozenAfter ? frozenAfter.size + ' B · ' + frozenAfter.mtime : '缺失'}`);
  console.log(`  \u24d8 真实 sync 库（只读、仅拷副本）：${fp(REAL_SYNC) ? fp(REAL_SYNC).size + ' B · ' + fp(REAL_SYNC).mtime : '缺失'}`);

  const passed = results.filter((r) => r.cond).length;
  const failedList = results.filter((r) => !r.cond);
  console.log(`\n  RUN 断言：${passed} 通过 / ${failedList.length} 失败（共 ${results.length} 条）`);
  if (failedList.length) {
    console.log('  失败项：');
    for (const f of failedList) console.log(`    - ${f.id} ${f.desc}${f.extra ? `  [${f.extra}]` : ''}`);
  }
  console.log(`  PENDING（等 T83-R1/R2 落地，**不计失败**，共 ${pendings.length} 条）：`);
  for (const p of pendings) console.log(`    - ${p.id} ${p.desc} ← ${p.why}`);

  if (!frozenSame) {
    console.log(`  \u2718 冻结库指纹变化 —— 本脚本任何结论无效（可能他人并行写入）`);
  }

  // 清理纪律：**基建失败**或显式 KEEP_TMP=1 时保留取证；其余情况（含「预期红」）清理。
  // ★ 与 book_lang.mjs 的差异及理由：本脚本在 T83-R1/R2 落地前**必然红**，若照「红即保留」会让每次运行都堆一个目录；
  //   需要取证时用 `KEEP_TMP=1 node scripts/check_user_scope.mjs`。
  const keep = !!infraFail || !!process.env.KEEP_TMP;
  if (!keep) {
    try {
      fs.rmSync(RUN, { recursive: true, force: true });
      console.log(`  \u2714 临时目录已清理（${path.relative(REPO, RUN)}；取证用 KEEP_TMP=1）`);
    } catch (e) {
      console.log(`  \u2718 临时目录清理失败：${e.message}（路径 ${path.relative(REPO, RUN)}）`);
    }
  } else {
    console.log(`  \u24d8 临时目录保留取证：${path.relative(REPO, RUN)}`);
  }

  const code = infraFail ? 2 : failedList.length ? 1 : 0;
  console.log(`\n结果：RUN ${passed} 通过 / ${failedList.length} 失败 · PENDING ${pendings.length} · exit ${code}`);
  process.exit(code);
}
