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
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
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
  lookupWord,
  openDatabase,
  relatedByMorpheme,
  suggest,
  syncMerge,
} from '@zidiankaifa/core/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const PORT = Number(process.env.PORT ?? process.env.ZIDIANKAFA_SYNC_PORT ?? 4570);
const DICT_DB = process.env.ZIDIANKAFA_DB ?? path.join(REPO_ROOT, 'data', 'db', 'dict.db');
const SYNC_DB = process.env.ZIDIANKAFA_SYNC_DB ?? path.join(REPO_ROOT, 'data', 'sync-data', 'sync.db');
const TOKEN = process.env.ZIDIANKAFA_SYNC_TOKEN ?? '';

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

function authOk(req: IncomingMessage) {
  if (!TOKEN) return true;
  const h = req.headers.authorization ?? '';
  return h === `Bearer ${TOKEN}`;
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
  if (!authOk(req)) {
    return sendError(res, 401, '未授权：缺少或错误的令牌');
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/health') {
    return sendJson(res, 200, {
      ok: true,
      words: countWords(dictDb),
      sync: 'zidiankaifa-sync-server',
      version: '0.10.0',
    });
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
    const items = bookListAll(syncDb);
    return sendJson(res, 200, { items });
  }

  // 生词本 × 词根分组（知识图谱）：以服务端生词本为准
  // v0.10.0：入参 lang 可选（缺省不过滤）；语言过滤在**本层**（先过滤 items），
  // groupBookByMorpheme 只负责按 it.lang 选词素库（AC-17 第 6 条）。协议未变（仅多一个 query 参数）。
  if (req.method === 'GET' && p === '/api/v1/book-groups') {
    const lang = url.searchParams.get('lang') ?? undefined;
    const items = bookList(syncDb, lang);
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
    const merged = syncMerge(syncDb, items);
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
  console.log(`  auth    : ${TOKEN ? 'token 已启用' : '未启用（个人使用建议设置 ZIDIANKAFA_SYNC_TOKEN）'}`);
});

