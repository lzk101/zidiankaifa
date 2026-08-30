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
import {
  bookList,
  breakdownWord,
  countWords,
  groupBookByMorpheme,
  lookupWord,
  openDatabase,
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
      version: '0.2.0',
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
    return sendJson(res, 200, suggest(dictDb, q, limit));
  }

  if (req.method === 'GET' && p === '/api/v1/breakdown') {
    const word = url.searchParams.get('word') ?? '';
    return sendJson(res, 200, breakdownWord(dictDb, word));
  }

  if (req.method === 'GET' && p === '/api/v1/book') {
    const items = syncDb.prepare('SELECT * FROM book ORDER BY updated_at DESC').all();
    return sendJson(res, 200, { items });
  }

  // 生词本 × 词根分组（知识图谱）：以服务端生词本为准
  if (req.method === 'GET' && p === '/api/v1/book-groups') {
    const items = bookList(syncDb);
    return sendJson(res, 200, { groups: groupBookByMorpheme(dictDb, items) });
  }

  if ((req.method === 'POST' || req.method === 'PUT') && (p === '/api/v1/sync' || p === '/api/v1/book')) {
    const body = await readJson(req).catch((e) => sendError(res, 400, e.message));
    if (!body) return;
    const items = Array.isArray(body.items) ? body.items : [];
    const merged = syncMerge(syncDb, items);
    return sendJson(res, 200, { ok: true, pushed: merged.pushed, pulled: merged.pulled, items: merged.items });
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
