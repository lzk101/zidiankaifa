/**
 * zidiankaifa 轻量云同步服务（Node 内置 http + node:sqlite，无外部依赖）
 *
 * 职责：
 *  1) 查词代理（手机/浏览器端没有本地词库时，经此查询）
 *  2) 生词本跨端同步（last-write-wins 全量合并，含删除墓碑）
 *
 * 环境变量：
 *  PORT / ZIDIANKAFA_SYNC_PORT  端口，默认 4570
 *  ZIDIANKAFA_DB                词典库路径，默认 <repo>/data/db/dict.db
 *  ZIDIANKAFA_SYNC_DB           同步库路径，默认 <repo>/data/sync-data/sync.db
 *  ZIDIANKAFA_SYNC_TOKEN        可选鉴权令牌；设置后客户端需带 Authorization: Bearer <token>
 *                               ★ 遗留通道：其作用域 = `LOCAL_USER_ID`（单用户模式，行为与 v0.10.0 一致）
 *  —— v0.11.0（AC-27 / R2）账号体系 ——
 *  ZIDIANKAFA_AUTH_REGISTER     `open`（默认）| `closed`（注册接口一律 403；已建号后仍可 login）
 *  ZIDIANKAIFA_RATE_MAX         每 IP 每分钟上限（所有路由，默认 300）
 *  ZIDIANKAIFA_RATE_WINDOW_MS   上述窗口，默认 60000
 *  ZIDIANKAIFA_AUTH_RATE_MAX    每 IP 每分钟的**认证路由**上限（默认 15）
 *  ZIDIANKAIFA_AUTH_USER_RATE_MAX 每**用户名**每分钟的认证尝试上限（默认 8）
 *
 * ★ 账号存放在**同步库**（`ZIDIANKAFA_SYNC_DB`）里，**绝不写词典库**：
 *   `data/db/dict.db` 是冻结只读词库（`BASELINE.md` 有指纹、`data/**` 属保护清单），
 *   往里写账号表会把词库变成可写状态并破坏结构体检口径。
 * ★ 安全红线（AC-27 / `DEC-031`）：客户端**绝不直连 Turso**，Turso token 只存服务端环境变量；
 *   本文件即那条红线的服务端实现。
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { BookItem } from '@zidiankaifa/core';
import {
  bookList,
  bookListAll,
  breakdownWord,
  countWords,
  getLexiconEntry,
  groupBookByMorpheme,
  lexiconStats,
  listLexicon,
  listWords,
  LOCAL_USER_ID,
  lookupWord,
  openDatabase,
  relatedByMorpheme,
  suggest,
  syncMerge,
} from '@zidiankaifa/core/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * ★ 本仓有**两套形近前缀**，历史上已两次造成「设了变量却落到生产库/默认值」的事故：
 *   · `ZIDIANKAFA_*`  —— 本文件（sync-server）与 Electron 调试钩子用的拼法
 *   · `ZIDIANKAIFA_*` —— `packages/core/test/**` 与 AGENTS.md §3「UI 验证」配方用的拼法（多了个 I）
 * 两者只差一个字母，肉眼几乎不可辨（T94 实测：探针按 `ZIDIANKAIFA_DB` 注入 ⇒ 服务读 `ZIDIANKAFA_DB`
 * 取不到 ⇒ **静默回落到 `data/db/dict.db` 生产库**，触发一次 493 MB 迁移快照）。
 * ⇒ 处置：**两种拼法都收**（本文件自己的拼法优先），把「拼错即静默回落」改成「任一拼法都生效」。
 *   这比在文档里反复强调拼写更可靠 —— 静默回落是这类事故唯一的真正放大器。
 */
const pickEnv = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
};
const pickEnvNum = (fallback: number, ...names: string[]): number => {
  const raw = pickEnv(...names);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const PORT = Number(pickEnv('PORT', 'ZIDIANKAFA_SYNC_PORT', 'ZIDIANKAIFA_SYNC_PORT') ?? 4570);
const DICT_DB = pickEnv('ZIDIANKAFA_DB', 'ZIDIANKAIFA_DB') ?? path.join(REPO_ROOT, 'data', 'db', 'dict.db');
const SYNC_DB =
  pickEnv('ZIDIANKAFA_SYNC_DB', 'ZIDIANKAIFA_SYNC_DB') ?? path.join(REPO_ROOT, 'data', 'sync-data', 'sync.db');
const TOKEN = pickEnv('ZIDIANKAFA_SYNC_TOKEN', 'ZIDIANKAIFA_SYNC_TOKEN') ?? '';

import fs from 'node:fs';
fs.mkdirSync(path.dirname(SYNC_DB), { recursive: true });

const dictDb = openDatabase(DICT_DB);
const syncDb = openDatabase(SYNC_DB);

/* ---------------- http 工具 ---------------- */

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res: ServerResponse, status: number, obj: unknown) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function sendError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { ok: false, message });
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (e) {
        reject(new Error('无效的 JSON 请求体'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------- v0.11.0 账号体系（AC-27 / R2）：注册·登录·撤销 + 限流 ----------------
 *
 * 设计要点（每条都有理由，勿「简化」）：
 *  ① 账号表建在**同步库**（SYNC_DB）而不是词典库 —— `data/db/dict.db` 是冻结只读词库
 *     （`BASELINE.md` 指纹 · `data/**` 保护清单），且 `openDatabase()` 会改写它打开的库。
 *  ② 口令 = `scrypt`（Node 内置 ⇒ **零新依赖**）+ **每用户 16 字节随机盐**，存储格式
 *     `scrypt$<N>$<salt base64url>$<hash base64url>`；校验用 `timingSafeEqual`（定长比较防时序侧信道），
 *     先比长度再比内容（长度不等时 `timingSafeEqual` 会抛 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`）。
 *  ③ 令牌只存 **sha256 哈希**，DB 里**没有明文**；撤销 = 删行 ⇒ **立即失效**（每次请求查库，无内存缓存，
 *     也不设「已撤销」标志位 —— 少一个状态就少一种「忘了判它」的缺陷）。
 *  ④ **作用域（scope）就是传给 core 的 `userId`**：账号 = `u:<users.id>`；遗留单 token / 匿名 = `LOCAL_USER_ID`。
 *     于是 AC-28① 自动成立：本机单机用户的数据仍在 `'local'` 桶里，v0.10.0 的库无需数据搬运。
 *  ⑤ **失败关闭（fail-closed）**：配置了 `ZIDIANKAFA_SYNC_TOKEN` **或** 已存在任一账号 ⇒ **无令牌一律 401**；
 *     两者都没有 ⇒ 匿名 = `LOCAL_USER_ID`（保住局域网/桌面单机既有行为与既有 22 条 DTO 契约）。
 *     ⇒ 旧行为「不设 token 就全放开」只在「既无 token 又无账号」这一步保留，一旦有账号即收紧。
 *  ⑥ 限流 = **内存令牌桶**，两个维度：IP 维（全路由 + 认证路由各一档）与用户维（同用户名的认证尝试）。
 *     超限返回 **429** + `Retry-After`，响应体带 `dimension: 'ip' | 'user'` —— 让客户端与测试能区分**是哪一维**触发。
 *  ⑦ **不信任 `X-Forwarded-For`**（可伪造）：IP 取 `req.socket.remoteAddress`。真要在反代后部署，
 *     必须由反代剥离该头或由本服务显式信任 —— 这是部署契约，不是可以「顺手」加的一行。
 */
const AUTH_REGISTER_OPEN = (pickEnv('ZIDIANKAFA_AUTH_REGISTER', 'ZIDIANKAIFA_AUTH_REGISTER') ?? 'open') !== 'closed';
const RATE_MAX = pickEnvNum(300, 'ZIDIANKAFA_RATE_MAX', 'ZIDIANKAIFA_RATE_MAX');
const RATE_WINDOW_MS = pickEnvNum(60_000, 'ZIDIANKAFA_RATE_WINDOW_MS', 'ZIDIANKAIFA_RATE_WINDOW_MS');
const AUTH_RATE_MAX = pickEnvNum(15, 'ZIDIANKAFA_AUTH_RATE_MAX', 'ZIDIANKAIFA_AUTH_RATE_MAX');
const AUTH_USER_RATE_MAX = pickEnvNum(8, 'ZIDIANKAFA_AUTH_USER_RATE_MAX', 'ZIDIANKAIFA_AUTH_USER_RATE_MAX');

// 独立的 try/catch：老同步库没有这两张表（正常），但**迁移失败不该带崩服务**（同 AGENTS.md §5 索引纪律）。
// 列名按 T94 规格：`users(id, email, password_hash, created_at, revoked_at)` / `tokens(token_hash, user_id, created_at, revoked_at)`。
// `revoked_at` 用 NULL 表示有效 ⇒ 撤销是**置时间戳**而非删行（留审计痕迹；判定处 `IS NULL`）。
try {
  syncDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens (user_id);
  `);
} catch (e) {
  console.error('[zidiankaifa-sync] 账号表初始化失败（认证将不可用）：', e);
}

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isFinite(n) || n <= 0) return false;
  const salt = Buffer.from(parts[2], 'base64url');
  const want = Buffer.from(parts[3], 'base64url');
  let got: Buffer;
  try {
    got = scryptSync(password, salt, want.length, { N: n, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
  } catch {
    return false;
  }
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/** 用户不存在时也跑一次同代价的 scrypt，避免用响应时间枚举用户名是否存在 */
const DUMMY_HASH = hashPassword(randomBytes(24).toString('base64url'));

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const mintToken = () => randomBytes(32).toString('base64url');

type RateBucket = { n: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function take(key: string, max: number, windowMs: number): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
  }
  const b = rateBuckets.get(key);
  if (!b || b.resetAt <= now) {
    rateBuckets.set(key, { n: 1, resetAt: now + windowMs });
    return { limited: false, retryAfter: 0 };
  }
  b.n += 1;
  if (b.n > max) return { limited: true, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  return { limited: false, retryAfter: 0 };
}

function send429(res: ServerResponse, retryAfter: number, dimension: 'ip' | 'user', message: string) {
  cors(res);
  res.setHeader('Retry-After', String(retryAfter));
  res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, message, dimension, retryAfter }));
}

function accountCount(): number {
  const r = syncDb.prepare('SELECT COUNT(1) AS n FROM users').get() as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/**
 * 账号标识 = **邮箱**（T95 / 需求稿 AC-28 口径；字段名统一为 `email`，列 = `users.email`）。
 *
 * ★ 归一化规则 ⇒ **注册与登录必须调用同一个 `normalizeEmail()`**，否则最典型的坑 =
 *   「注册成功但登录失败」。规则 = `raw.trim().toLowerCase()`：
 *   · **折叠大小写**：本服务不发验证信、不做域名可达性校验，email 只承担「唯一且可读的标识」。
 *     若不折叠，SQLite 的 TEXT UNIQUE 会把 `Alice@x.com` 与 `alice@x.com` 当成两个账号（大小写敏感）
 *     ⇒ 用户「明明注册过却登不进去」。折叠是可预期的唯一选择。
 *     ⚠ 不靠 `COLLATE NOCASE`：它只折叠 ASCII（对西里尔无效）⇒ 归一化放在**应用层**，规则只有一处。
 *     ⚠ 不做 Unicode 正规化（NFKC）：非 ASCII 域名属已知边缘情形，如实标注，不假装支持。
 *   · **trim**：粘贴来的邮箱常带首尾空格；静默 trim 且登录侧同规则 ⇒ 不会出现「注册用了 trim、登录没用」。
 *
 * ★ 合法性判据（**可机械核对**，T95 指定口径）：恰好一个 `@` · `@` 两侧非空 · **不含任何空白字符** ·
 *   总长 ≤254 · 本地部分 ≤64。⛔ 不用「3-32 位字母/数字/下划线/点/减号」那套用户名规则（已废弃）。
 *   ⛔ 也不强求域名含点（`admin@localhost` 在局域网自建场景合法）。
 */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function validateEmail(email: string, password: string): string | null {
  if (email.length === 0) return '缺少 email';
  if (/\s/.test(email)) return 'email 不得含空白字符';
  const parts = email.split('@');
  if (parts.length !== 2) return 'email 必须恰好含一个 @';
  if (parts[0].length === 0 || parts[1].length === 0) return 'email 的 @ 两侧都不得为空';
  if (parts[0].length > 64) return 'email 本地部分过长（>64）';
  if (email.length > 254) return 'email 总长过长（>254）';
  if (password.length < 8) return '口令至少 8 位';
  if (password.length > 256) return '口令过长';
  return null;
}

/**
 * ★ R3：**首账号认领本机存量生词本**（用户拍板「本地生词本绑定账号后上传为『我的』」；
 * 机制依 `packages/core/src/db/schema.ts:5` 的 AC-28④ —— 绑定 = `UPDATE book SET user_id = <new>`）。
 *
 * 为什么必须有：本文件顶部 ④ 规定「作用域就是传给 core 的 `userId`」⇒ 账号作用域 = `u:<id>`，
 * 而绑定前所有行都在 `LOCAL_USER_ID`（= `'local'`）桶。**若只接用户维度而不做本步，
 * 用户注册后读的是 `u:<id>` 桶 ⇒ 他自己的存量生词本会「凭空消失」**（这正是 R3 的连带后果）。
 *
 * 只认领**首个**账号（判据 = 认领前 `users` 计数为 1）：`'local'` 是**单个匿名桶**，
 * 后续账号无从区分「哪些匿名行是它的」⇒ 一律不认领（返回 0）。迁移行一旦改判即离开该桶 ⇒ 天然幂等。
 * ⚠ 本函数**只按 user_id 过滤，不碰 dict.db**（`syncDb` 与词库是两个库）。
 */
function claimAnonymousBook(db: DatabaseSync, newUserId: number): number {
  const r = db
    .prepare('UPDATE book SET user_id = ? WHERE user_id = ?')
    .run(`u:${newUserId}`, LOCAL_USER_ID);
  return Number(r.changes);
}

type AuthResult =
  | { ok: true; scope: string; userId: number | null; tokenHash: string | null; email: string | null }
  | { ok: false; message: string };

/**
 * 解析请求的作用域（= core 的 `userId`）。
 * - `Bearer <ZIDIANKAFA_SYNC_TOKEN>`（遗留单 token）⇒ `LOCAL_USER_ID`
 * - `Bearer <账号令牌>`（查 `auth_tokens` 的 sha256）⇒ `u:<user_id>`
 * - 无 Authorization：仅在「既无 TOKEN 又无账号」时放行为 `LOCAL_USER_ID`，否则 401（见 ⑤）
 */
function resolveAuth(req: IncomingMessage): AuthResult {
  const h = (req.headers.authorization ?? '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) {
    const token = m[1].trim();
    if (TOKEN && token === TOKEN) {
      return { ok: true, scope: LOCAL_USER_ID, userId: null, tokenHash: null, email: null };
    }
    const th = hashToken(token);
    // 令牌有效 = 该 token 未被撤销 **且** 其账号未被撤销（`revoked_at IS NULL` 两侧都判）
    const row = syncDb
      .prepare(
        `SELECT t.user_id AS user_id, u.email AS email
           FROM tokens t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.revoked_at IS NULL`
      )
      .get(th) as { user_id: number; email: string } | undefined;
    if (row) {
      return { ok: true, scope: `u:${row.user_id}`, userId: row.user_id, tokenHash: th, email: row.email };
    }
    return { ok: false, message: '未授权：令牌无效或已撤销' };
  }
  if (TOKEN || accountCount() > 0) {
    return { ok: false, message: '未授权：需要 Authorization: Bearer <token>' };
  }
  return { ok: true, scope: LOCAL_USER_ID, userId: null, tokenHash: null, email: null };
}

/* ---------------- 入站 DTO 规范化（★ T75 V11-SYNC-DTO） ----------------
 *
 * 背景（缺陷）：「GET /api/v1/book」曾直接 `SELECT * FROM book` 返回**原始 DB 行**（snake_case），
 * 而同文件的「POST /api/v1/sync」把客户端条目按 core 的公开契约 `BookItem`（**camelCase**）处理。
 * ⇒ 同一服务对同一实体有两套字段名；把 GET 的输出回喂 POST 会抛
 *   `TypeError: Provided value cannot be bound to SQLite parameter 3`（`upsertBook` 绑定 updatedAt=undefined）⇒ HTTP 500。
 *
 * 修法（**修在边界，不修在核心**）：
 *   ① 出站：`GET /api/v1/book` 改用已导出的 `bookListAll()`（内含 `rowToBook` 转换，含墓碑，排序与旧 SQL 同）。
 *   ② 入站：本函数把**两种形状**都规范化成 `BookItem`，并做**最小校验**——缺 `word` / 缺时间戳的条目
 *      **丢弃并计数**（`skipped`），不再把 `undefined` 交给 SQLite 绑定（⇒ 不再 500）。
 * 为什么不去改 `syncMerge` / `upsertBook` 兼容 snake_case：`BookItem` 是 core 的公开契约，
 * `syncMerge` 是纯函数；让核心猜测输入形状会掩盖边界错误，并会撞 `packages/core/test/book_lang.mjs` 的 C 组
 * 与 `scripts/check_v10_ui_contract.mjs:246`。契约在核心，规范化在边界。
 */
type IncomingItem = Record<string, unknown>;

const firstDefined = (...vals: unknown[]): unknown => vals.find((v) => v !== undefined && v !== null);

/** 把 snake_case 别名（历史 GET 输出形状）与 camelCase 统一成 `BookItem`；非法条目返回 null */
function toBookItem(raw: unknown): BookItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as IncomingItem;
  const word = firstDefined(r.word, r.text);
  if (typeof word !== 'string' || !word.trim()) return null;
  const updatedAt = Number(firstDefined(r.updatedAt, r.updated_at));
  const addedAtRaw = Number(firstDefined(r.addedAt, r.added_at));
  // 时间戳缺失 ⇒ 无法做 last-write-wins 判定，且会给 SQLite 绑定 undefined ⇒ 丢弃（计入 skipped）
  if (!Number.isFinite(updatedAt)) return null;
  const addedAt = Number.isFinite(addedAtRaw) ? addedAtRaw : updatedAt;
  const tagsRaw = firstDefined(r.tags, []);
  let tags: string[] = [];
  if (Array.isArray(tagsRaw)) tags = tagsRaw.map(String);
  else if (typeof tagsRaw === 'string' && tagsRaw.trim()) {
    try {
      const parsed = JSON.parse(tagsRaw);
      tags = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      tags = [];
    }
  }
  const deletedRaw = firstDefined(r.deleted, false);
  const reviewRaw = Number(firstDefined(r.reviewCount, r.review_count));
  const lastReviewedRaw = Number(firstDefined(r.lastReviewedAt, r.last_reviewed_at));
  const noteRaw = firstDefined(r.note, r.noteText);
  // ⚠ 注意：不能写成 `noteRaw === null ? null : String(noteRaw)` —— 缺字段时 noteRaw 是 **undefined**，
  //   那样会写出字符串 `"undefined"`（本探针 e2e 实测捕获过该形态：`"note":"undefined"`）。
  const noteMissing = noteRaw === undefined || noteRaw === null;
  return {
    word: word.trim(),
    lang: typeof r.lang === 'string' && r.lang ? r.lang : 'en',
    addedAt,
    updatedAt,
    status: (typeof r.status === 'string' && r.status ? r.status : 'new') as BookItem['status'],
    note: noteMissing ? null : String(noteRaw),
    tags,
    reviewCount: Number.isFinite(reviewRaw) ? reviewRaw : 0,
    lastReviewedAt: Number.isFinite(lastReviewedRaw) ? lastReviewedRaw : null,
    deleted: deletedRaw === true || deletedRaw === 1 || deletedRaw === '1',
  };
}

/** 规范化整批入站条目；返回 { items, skipped } —— skipped 只计数，不透传原因（原因写日志） */
function normalizeIncomingItems(raw: unknown): { items: BookItem[]; skipped: number } {
  if (!Array.isArray(raw)) return { items: [], skipped: 0 };
  const items: BookItem[] = [];
  let skipped = 0;
  for (const it of raw) {
    const norm = toBookItem(it);
    if (norm) items.push(norm);
    else skipped += 1;
  }
  return { items, skipped };
}

/* ---------------- 路由 ---------------- */

async function handle(req: IncomingMessage, res: ServerResponse) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  const ip = req.socket.remoteAddress ?? 'unknown';
  const isAuthRoute = p === '/api/v1/auth/register' || p === '/api/v1/auth/login';

  // 全路由 IP 限流（`/health` 豁免：它是就绪探针，限流会把「服务活着」误报成「服务挂了」）
  if (p !== '/health') {
    const g = take(`ip:${ip}`, RATE_MAX, RATE_WINDOW_MS);
    if (g.limited) return send429(res, g.retryAfter, 'ip', '请求过于频繁');
  }
  // 认证路由单独一档（更严）：公开路由 = 唯一可被无凭证滥用的入口
  if (isAuthRoute) {
    const a = take(`auth-ip:${ip}`, AUTH_RATE_MAX, RATE_WINDOW_MS);
    if (a.limited) return send429(res, a.retryAfter, 'ip', '认证请求过于频繁');
  }

  if (req.method === 'GET' && p === '/health') {
    return sendJson(res, 200, {
      ok: true,
      words: countWords(dictDb),
      sync: 'zidiankaifa-sync-server',
      version: '0.11.0',
    });
  }

  /* ---------- 公开认证路由（在鉴权门之前：否则无法引导出第一个账号） ---------- */
  if (req.method === 'POST' && p === '/api/v1/auth/register') {
    if (!AUTH_REGISTER_OPEN) {
      return sendError(res, 403, '本服务已关闭注册（ZIDIANKAFA_AUTH_REGISTER=closed）');
    }
    const body = await readJson(req).catch((e) => sendError(res, 400, e.message));
    if (!body) return;
    // 主字段 `email`（T95 / AC-28 规格）；`username` 仅作**历史别名**读入，随后一律 `normalizeEmail()` 归一
    const email = normalizeEmail(String(body.email ?? body.username ?? ''));
    const password = String(body.password ?? '');
    const bad = validateEmail(email, password);
    if (bad) return sendError(res, 400, bad);
    // 账号维度限流（防针对单账号的批量注册/撞库）
    const uLim = take(`user:${email}`, AUTH_USER_RATE_MAX, RATE_WINDOW_MS);
    if (uLim.limited) return send429(res, uLim.retryAfter, 'user', `账号 ${email} 尝试过于频繁`);
    const dup = syncDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
    if (dup) return sendError(res, 409, '该 email 已注册');
    const now = Date.now();
    let userId: number;
    try {
      const r = syncDb
        .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
        .run(email, hashPassword(password), now);
      userId = Number(r.lastInsertRowid);
    } catch (e) {
      return sendError(res, 409, `注册失败（email 已存在？）：${(e as Error).message}`);
    }
    const token = mintToken();
    syncDb
      .prepare('INSERT INTO tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, now);
    const scope = `u:${userId}`;
    // ★ R3：首账号认领本机存量（AC-28④「绑定」= UPDATE 改判桶）—— 失败只记日志，不使注册失败
    let claimed = 0;
    try {
      claimed = claimAnonymousBook(syncDb, userId);
    } catch (e) {
      console.warn(`[zidiankaifa-sync] 存量生词本认领失败（账号已创建）：${(e as Error).message}`);
    }
    console.log(
      `[zidiankaifa-sync] 新账号 #${userId} ${email}（作用域 ${scope}，认领本机存量 ${claimed} 条）`
    );
    return sendJson(res, 200, { ok: true, token, userId, email, scope, claimed });
  }

  if (req.method === 'POST' && p === '/api/v1/auth/login') {
    const body = await readJson(req).catch((e) => sendError(res, 400, e.message));
    if (!body) return;
    // ★ 与注册**同一归一化函数** `normalizeEmail()` —— 否则会出现「注册成功但登录失败」（大小写不一致）
    const email = normalizeEmail(String(body.email ?? body.username ?? ''));
    const password = String(body.password ?? '');
    const uLim = take(`user:${email}`, AUTH_USER_RATE_MAX, RATE_WINDOW_MS);
    if (uLim.limited) return send429(res, uLim.retryAfter, 'user', `账号 ${email} 尝试过于频繁`);
    const row = syncDb.prepare('SELECT id, password_hash, revoked_at FROM users WHERE email = ?').get(email) as
      | { id: number; password_hash: string; revoked_at: number | null }
      | undefined;
    // 账号不存在也走一次同代价 scrypt（见 DUMMY_HASH 注释），失败信息不区分「无此账号 / 口令错」
    const passOk = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || row.revoked_at !== null || !passOk) return sendError(res, 401, '邮箱或口令错误');
    const token = mintToken();
    syncDb
      .prepare('INSERT INTO tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)')
      .run(hashToken(token), row.id, Date.now());
    const scope = `u:${row.id}`;
    return sendJson(res, 200, { ok: true, token, userId: row.id, email, scope });
  }

  /* ---------- 鉴权门（所有其它路由都必须带有效令牌，除非既无 TOKEN 又无账号） ---------- */
  const auth = resolveAuth(req);
  if (!auth.ok) {
    return sendError(res, 401, auth.message);
  }
  // 作用域维度限流（同一作用域的洪泛不因换 IP 而绕过）
  {
    const s = take(`scope:${auth.scope}`, RATE_MAX, RATE_WINDOW_MS);
    if (s.limited) return send429(res, s.retryAfter, 'user', '本作用域请求过于频繁');
  }

  if (req.method === 'GET' && p === '/api/v1/auth/whoami') {
    return sendJson(res, 200, { ok: true, scope: auth.scope, userId: auth.userId, email: auth.email });
  }

  if (req.method === 'POST' && p === '/api/v1/auth/revoke') {
    if (!auth.tokenHash) {
      return sendError(res, 400, '本令牌不可撤销（遗留 ZIDIANKAFA_SYNC_TOKEN 由服务端环境变量管理）');
    }
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const all = body && body.all === true && auth.userId !== null;
    const now = Date.now();
    // 撤销 = 置 `revoked_at`（不删行）：留审计痕迹；判定处两侧都要求 `revoked_at IS NULL`
    const r = all
      ? syncDb
          .prepare('UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
          .run(now, auth.userId as number)
      : syncDb
          .prepare('UPDATE tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
          .run(now, auth.tokenHash);
    const revoked = Number(r.changes);
    console.log(`[zidiankaifa-sync] 撤销令牌：作用域 ${auth.scope}${all ? '（全部）' : ''}，置撤销时间 ${revoked} 条`);
    return sendJson(res, 200, { ok: true, revoked, all });
  }

  if (req.method === 'GET' && p === '/api/v1/lookup') {
    const word = url.searchParams.get('word') ?? '';
    const lang = url.searchParams.get('lang') ?? 'auto';
    return sendJson(res, 200, lookupWord(dictDb, word, { lang }));
  }

  if (req.method === 'GET' && p === '/api/v1/suggest') {
    const q = url.searchParams.get('q') ?? '';
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const lang = url.searchParams.get('lang') ?? undefined;
    return sendJson(res, 200, suggest(dictDb, q, limit, lang));
  }

  if (req.method === 'GET' && p === '/api/v1/breakdown') {
    const word = url.searchParams.get('word') ?? '';
    const lang = url.searchParams.get('lang') ?? 'en';
    return sendJson(res, 200, breakdownWord(dictDb, word, lang));
  }

  // 词根表 / 词缀表：kind=root 词根，prefix/suffix 词缀，all 词缀全量
  if (req.method === 'GET' && p === '/api/v1/lexicon') {
    const kindRaw = url.searchParams.get('kind') ?? 'root';
    const kind = (['root', 'prefix', 'suffix', 'all'] as const).includes(kindRaw as never) ? (kindRaw as 'root' | 'prefix' | 'suffix' | 'all') : 'root';
    return sendJson(
      res,
      200,
      listLexicon(dictDb, {
        kind,
        lang: url.searchParams.get('lang') ?? 'en',
        query: url.searchParams.get('q') ?? undefined,
        sort: url.searchParams.get('sort') === 'alpha' ? 'alpha' : 'words',
        limit: Number(url.searchParams.get('limit') ?? 60),
        offset: Number(url.searchParams.get('offset') ?? 0),
      })
    );
  }

  if (req.method === 'GET' && p === '/api/v1/lexicon/entry') {
    const morpheme = url.searchParams.get('morpheme') ?? '';
    const lang = url.searchParams.get('lang') ?? 'en';
    const entry = getLexiconEntry(dictDb, morpheme, lang);
    return entry ? sendJson(res, 200, entry) : sendError(res, 404, `未收录词素：${morpheme}`);
  }

  if (req.method === 'GET' && p === '/api/v1/lexicon/stats') {
    return sendJson(res, 200, lexiconStats(dictDb));
  }

  // 单词表（按语言分离）
  if (req.method === 'GET' && p === '/api/v1/words') {
    return sendJson(
      res,
      200,
      listWords(dictDb, url.searchParams.get('lang') ?? 'en', {
        query: url.searchParams.get('q') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 60),
        offset: Number(url.searchParams.get('offset') ?? 0),
      })
    );
  }

  if (req.method === 'GET' && p === '/api/v1/book') {
    // ★ T75：改用 core 已导出的入口（内含 rowToBook 转换 ⇒ camelCase，含墓碑，ORDER BY updated_at DESC 同序）
    //   旧写法 `syncDb.prepare('SELECT * FROM book ...')` 返回**原始 DB 行（snake_case）** ⇒ 与 POST 的
    //   `BookItem` 契约不一致，把本响应回喂 `POST /api/v1/sync` 会 500（V11-SYNC-DTO）。
    // ★ R3（本单）：接上用户维度。实参形态依本文件顶部 ④「作用域（scope）就是传给 core 的 `userId`」——
    //   账号 → `u:<users.id>`；遗留单 token / 匿名 → `LOCAL_USER_ID`（= `'local'`）。
    //   ⚠ `bookListAll()` 同时服务本路由与 `POST /sync` 的回包 ⇒ 两处**必须成套改**，否则读到的行与写入的行不同桶。
    //   ⚠ `auth` 是 `ok:true` 分支的收窄类型（`:476` 已 `if (!auth.ok) return sendAuthError(...)`）⇒ 此处可直接取。
    const items = bookListAll(syncDb, auth.scope);
    return sendJson(res, 200, { items });
  }

  // 生词本 × 词根分组（知识图谱）：以服务端生词本为准
  // v0.10.0：入参 lang 可选（缺省不过滤）；语言过滤在**本层**（先过滤 items），
  // groupBookByMorpheme 只负责按 it.lang 选词素库（AC-17 第 6 条）。协议未变（仅多一个 query 参数）。
  if (req.method === 'GET' && p === '/api/v1/book-groups') {
    const lang = url.searchParams.get('lang') ?? undefined;
    // ⚠ `packages/core/test/book_lang.mjs:1466`（C15）的文本契约要求保留 `bookList(syncDb, lang)` 这段字面量；
    //   R3 在其后**追加**第 3 个实参（core 签名 `bookList(db, lang?, userId = LOCAL_USER_ID)`）。
    //   ⇒ 旧字面量仍是新调用的前缀子串，C15 不破。
    const items = bookList(syncDb, lang, auth.scope);
    return sendJson(res, 200, { groups: groupBookByMorpheme(dictDb, items) });
  }

  // 查词页「同根词」：当前词经构词拆解关联到的词族
  if (req.method === 'GET' && p === '/api/v1/related') {
    const word = url.searchParams.get('word') ?? '';
    const lang = url.searchParams.get('lang') ?? 'en';
    return sendJson(res, 200, { groups: relatedByMorpheme(dictDb, word, lang) });
  }

  if ((req.method === 'POST' || req.method === 'PUT') && (p === '/api/v1/sync' || p === '/api/v1/book')) {
    const body = await readJson(req).catch((e) => sendError(res, 400, e.message));
    if (!body) return;
    // ★ T75：入站形状在**边界**规范化（camelCase 与历史 snake_case 都接受），
    //   缺 word / 缺时间戳的条目丢弃并计入 skipped ⇒ 不再抛 500（历史：parameter 3 绑定失败）。
    // ⚠ T78：此处**保留** `Array.isArray(body.items)` 字面量 —— 它是 AC-14⑤「sync-server 协议不改」
    //   在源码层面的可见契约（`packages/core/test/book_lang.mjs:1427-1428` C17 断言按文本核验）。
    //   语义与旧写法完全等价：旧代码对非数组也是 `[]`，而 `normalizeIncomingItems` 对非数组返回 `{ items: [], skipped: 0 }`。
    const { items, skipped } = normalizeIncomingItems(Array.isArray(body.items) ? body.items : []);
    if (skipped > 0) {
      console.warn(`[zidiankaifa-sync] 同步载荷有 ${skipped} 条被丢弃（缺 word 或缺 updatedAt/updated_at）`);
    }
    // ★ R3（本单）：写入侧接上同一作用域 —— 与上面 `GET /book` 的读取侧**成套**（同一 `auth.scope`）。
    const merged = syncMerge(syncDb, items, auth.scope);
    return sendJson(res, 200, {
      ok: true,
      pushed: merged.pushed,
      pulled: merged.pulled,
      items: merged.items,
      skipped,
    });
  }

  return sendError(res, 404, `未找到接口：${p}`);
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[zidiankaifa-sync] error:', e);
    sendError(res, 500, '服务器内部错误');
  });
}).listen(PORT, () => {
  console.log(`[zidiankaifa-sync] listening on http://127.0.0.1:${PORT}`);
  console.log(`  dict db : ${DICT_DB} (${countWords(dictDb)} words)`);
  console.log(`  sync db : ${SYNC_DB}`);
  console.log(`  auth    : ${TOKEN ? 'ZIDIANKAFA_SYNC_TOKEN 已启用（作用域 local）' : '未设 ZIDIANKAFA_SYNC_TOKEN'}` +
    ` · 账号 ${accountCount()} 个${AUTH_REGISTER_OPEN ? '' : ' · 注册已关闭'}` +
    ` · 限流 ip=${RATE_MAX}/${RATE_WINDOW_MS}ms auth-ip=${AUTH_RATE_MAX} auth-user=${AUTH_USER_RATE_MAX}`);
});

