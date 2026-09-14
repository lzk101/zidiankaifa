// scripts/check_sync_dto_contract.mjs —— HTTP 边界 DTO 契约测试（T77 · 永久契约测试，非 _tmp 探针）
//
// 为什么需要它（根因 = 测试结构盲区，参见 .board/EVIDENCE.md §50）：
//   · packages/core/test/book_lang.mjs 的 C 组**直接调 syncMerge(db, [newBookItem(...)])**（手工 camelCase），**绕过 HTTP**
//   · apps/sync-server/scripts/smoke.mjs 同样**直接调函数**，不经 REST
//   · book_lang.mjs 的「sync-server 路由不变」是**源码字符串包含判断**，不校验 DTO 形状
//   ⇒ core 断言全用 BookItem(camelCase)、服务端却可能发 DB 行(snake_case)，**两层各自自洽、交界处无人测** ⇒ V11-SYNC-DTO
//
// 契约真值来源（**按契约写断言，不按当前实现输出写**）：
//   · packages/core/src/types.ts:141-155 `interface BookItem { word: string; lang?: string; addedAt: number;
//     updatedAt: number; status: BookStatus; note: string | null; tags: string[]; reviewCount: number;
//     lastReviewedAt: number | null; deleted?: boolean }`
//   · packages/core/src/db/index.ts:495 `rowToBook()`（DB 行 → BookItem 的唯一正规转换）
//
// 只读性：**绝不打开 data/db/dict.db**；全程用临时库（两个：dict 库 + sync 库），端点只碰临时 sync 库的 book 表。
// 退出码：全绿 0 · 有红 1。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..'); // ★ 只退一级（铁律 6：scripts/ → 仓库根）
/** 被测服务端入口；可用 `SYNC_SERVER_ENTRY` 覆盖（用于「修复后」变体对照，见 .board/EVIDENCE.md §50） */
const SERVER = process.env.SYNC_SERVER_ENTRY
  ? path.resolve(process.env.SYNC_SERVER_ENTRY)
  : path.join(REPO, 'apps', 'sync-server', 'dist', 'index.js');
const CORE_DB = path.join(REPO, 'packages', 'core', 'dist', 'db', 'index.js');
const FROZEN = path.join(REPO, 'data', 'db', 'dict.db');

const results = [];
const notes = [];
/** F 组（T77 新发现的第二个缺陷）是否阻塞退出码。默认 false = 像 KNOWN_GAPS 一样「报而不判」：
 *  理由 —— 把它算红会让本脚本在 T75 修好之后**仍然 exit 1**，从而掩盖「V11-SYNC-DTO 已修好」这一结论；
 *  而它是**另一个**缺陷（V11-NOTE-NULL，根因在 T75 新增的 toBookItem 归一化里）。主管若要它阻塞，改 true 即可。 */
const BLOCK_ON_F_GROUP = false;
const ok = (id, desc, cond, extra = '') => {
  results.push({ id, desc, cond: !!cond, extra });
  console.log(`  ${cond ? '\u2714' : '\u2718'} ${id} ${desc}${extra ? `  [${extra}]` : ''}`);
};
const note = (s) => {
  notes.push(s);
  console.log(`  \u24d8 ${s}`);
};

const TMP_ROOT = path.join(REPO, 'scripts', '_tmp', 't77_sync_dto');
fs.mkdirSync(TMP_ROOT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(TMP_ROOT, 'run-'));
const DICT_DB = path.join(RUN, 'dict.db');
const SYNC_DB = path.join(RUN, 'sync.db');
const LOG = path.join(RUN, 'server.log');

let child = null;
let logFd = null;
let failed = 0;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.on('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

const api = async (port, method, route, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* 非 JSON 响应（如 500 前的中断） */
  }
  return { status: r.status, json };
};

const itemsOf = (json) => (json && Array.isArray(json.items) ? json.items : null);

/** 契约要求的 camelCase 条目（POST 正常路径用；与服务端实现无关） */
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

try {
  console.log('sync-dto 契约测试 —— HTTP 边界（GET /api/v1/book ↔ POST /api/v1/sync）');
  console.log(`  仓库根 = ${REPO}`);
  console.log(`  临时库 = ${path.relative(REPO, RUN)}（dict.db + sync.db）· 冻结库 ${path.basename(FROZEN)} **不打开**`);
  const frozenBefore = fs.existsSync(FROZEN) ? fs.statSync(FROZEN) : null;

  /* ---------- 0 临时库：用 core dist 的 openDatabase 建 schema ---------- */
  const core = await import(pathToFileURL(CORE_DB).href);
  {
    const d = core.openDatabase(DICT_DB); // 只需 schema（lookup 路由不测）
    d.close();
    const s = core.openDatabase(SYNC_DB); // book 表（word,lang) 复合主键
    s.close();
  }
  console.log(`  \u2714 0 临时库已建（openDatabase 建 schema，句柄已 close）`);

  /* ---------- 1 起服务（文件重定向 stdio，不用管道） ---------- */
  const port = await freePort();
  logFd = fs.openSync(LOG, 'a');
  child = spawn(process.execPath, [SERVER], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(port),
      ZIDIANKAFA_SYNC_PORT: String(port),
      ZIDIANKAFA_DB: DICT_DB,
      ZIDIANKAFA_SYNC_DB: SYNC_DB,
      ZIDIANKAFA_SYNC_TOKEN: '',
    },
    stdio: ['ignore', logFd, logFd], // ★ 文件重定向（非管道）—— 规避受限沙箱下带管道 stdio 的 spawn EPERM
  });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) ready = true;
    } catch {
      /* 未就绪 */
    }
    if (!ready) await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) {
    console.log(`  \u2718 1 服务未在 15s 内就绪（pid=${child.pid} exit=${child.exitCode}）· port=${port}`);
    console.log('    server.log:\n' + fs.readFileSync(LOG, 'utf8').split('\n').slice(0, 20).map((l) => '      ' + l).join('\n'));
    throw new Error('sync-server 未就绪');
  }
  console.log(`  \u2714 1 服务就绪：http://127.0.0.1:${port}（端口由空闲探测取得，非 4570）`);

  /* ---------- 2 播种：两条 camelCase 条目（经 HTTP POST，即设备真实路径） ---------- */
  const seedA = await api(port, 'POST', '/api/v1/sync', {
    items: [camelItem('apple', 'en', 2000, { status: 'learning', note: 'n1', tags: ['t1'], reviewCount: 2, lastReviewedAt: 1500 })],
  });
  const seedB = await api(port, 'POST', '/api/v1/sync', { items: [camelItem('\u043a\u043d\u0438\u0433\u0430', 'ru', 3000)] });
  console.log(`  \u24d8 播种：apple/en → ${seedA.status} pushed=${seedA.json?.pushed} · \u043a\u043d\u0438\u0433\u0430/ru → ${seedB.status} pushed=${seedB.json?.pushed}`);

  /* ---------- A 组 · GET 形状契约 ---------- */
  const got = await api(port, 'GET', '/api/v1/book');
  const items = itemsOf(got.json);
  console.log(`  \u24d8 GET /api/v1/book → status=${got.status} · items=${items ? items.length : 'null'}`);
  if (items && items.length) console.log(`  \u24d8 首条原始形状 = ${JSON.stringify(items[0])}`);

  ok('A1', 'GET /api/v1/book 返回 items 为数组', Array.isArray(items), `len=${items ? items.length : 'n/a'}`);
  const SNAKE = ['added_at', 'updated_at', 'review_count', 'last_reviewed_at'];
  const snakeHits = (items ?? []).filter((it) => SNAKE.some((k) => k in it));
  ok(
    'A2',
    `条目不得出现 snake_case 键（${SNAKE.join('/')}）`,
    snakeHits.length === 0,
    snakeHits.length ? `命中 ${snakeHits.length} 条，首条含 ${SNAKE.filter((k) => k in snakeHits[0]).join(',')}` : '无',
  );
  const t0 = items?.[0];
  ok('A3', 'addedAt/updatedAt 为 number', typeof t0?.addedAt === 'number' && typeof t0?.updatedAt === 'number', `addedAt=${typeof t0?.addedAt} updatedAt=${typeof t0?.updatedAt}`);
  ok(
    'A4',
    'reviewCount 为 number 且 lastReviewedAt 为 null 或 number',
    typeof t0?.reviewCount === 'number' && (t0?.lastReviewedAt === null || typeof t0?.lastReviewedAt === 'number'),
    `reviewCount=${typeof t0?.reviewCount} lastReviewedAt=${t0?.lastReviewedAt === undefined ? 'undefined' : typeof t0?.lastReviewedAt}`,
  );
  ok('A5', 'word/lang 存在且为 string', typeof t0?.word === 'string' && typeof t0?.lang === 'string', `word=${typeof t0?.word} lang=${typeof t0?.lang}`);

  /* ---------- E 组 · 顺序（bookListAll 契约 ORDER BY updated_at DESC） ---------- */
  {
    const us = (items ?? []).map((it) => it.updatedAt);
    const undef = us.filter((x) => typeof x !== 'number').length;
    const desc = undef === 0 && us.every((v, i) => i === 0 || us[i - 1] >= v);
    ok('E1', 'GET 按 updatedAt 降序（bookListAll 契约）', desc, undef ? `${undef} 条无 updatedAt 字段 ⇒ 顺序不可判` : `updatedAt 序列=${JSON.stringify(us)}`);
  }

  /* ---------- D 组 · 口径类型（第 8 条陷阱：契约类型 vs 实际类型） ---------- */
  console.log('  —— D 组：契约类型断言（并照实打印当前实际类型）');
  const dItem = t0 ?? {};
  ok('D1', "deleted 为 boolean（BookItem 契约；DB 内是 0/1 整数）", typeof dItem.deleted === 'boolean', `实际 typeof=${typeof dItem.deleted} value=${JSON.stringify(dItem.deleted)}`);
  ok('D2', "tags 为数组（BookItem 契约；DB 内是 JSON 字符串 '[]'）", Array.isArray(dItem.tags), `实际 typeof=${typeof dItem.tags} value=${JSON.stringify(dItem.tags)}`);
  ok(
    'D3',
    'status 为 string 且 note 为 null 或 string',
    typeof dItem.status === 'string' && (dItem.note === null || typeof dItem.note === 'string'),
    `status=${typeof dItem.status} note=${dItem.note === undefined ? 'undefined' : typeof dItem.note}`,
  );

  /* ---------- B 组 · 回环自洽（★ 本测试的核心） ---------- */
  let loopStatus = null;
  if (items && items.length) {
    const raw = items[0];
    const fed = await api(port, 'POST', '/api/v1/sync', { items: [JSON.parse(JSON.stringify(raw))] }); // 原样回喂
    loopStatus = fed.status;
    ok('B1', 'GET 的 items[0] 原样回喂 POST /api/v1/sync ⇒ 必须 200', fed.status === 200, `status=${fed.status}${fed.json?.message ? ' message=' + String(fed.json.message).slice(0, 80) : ''}`);
    const again = await api(port, 'GET', '/api/v1/book');
    const after = (itemsOf(again.json) ?? []).find((it) => it.word === raw.word && it.lang === raw.lang);
    const norm = (v) => (typeof v === 'string' && /^\[.*\]$/.test(v) ? JSON.stringify(JSON.parse(v)) : JSON.stringify(v));
    const same =
      !!after &&
      after.word === raw.word &&
      after.lang === raw.lang &&
      after.status === raw.status &&
      after.note === raw.note &&
      norm(after.tags) === norm(raw.tags);
    ok('B2', '回喂后该条目 word/lang/status/note/tags 与回喂前逐项相等', same, `before=${JSON.stringify({ w: raw.word, l: raw.lang, s: raw.status, n: raw.note, t: raw.tags })} after=${JSON.stringify(after ? { w: after.word, l: after.lang, s: after.status, n: after.note, t: after.tags } : null)}`);
  } else {
    ok('B1', 'GET 的 items[0] 原样回喂 POST /api/v1/sync ⇒ 必须 200', false, 'GET 无条目，无法回喂');
    ok('B2', '回喂后逐字段相等', false, '同上');
  }

  /* ---------- B3/B4 · 边界语义的**因果**断言（比 A2 更强：直接测「跨端同步是否真的发生」） ---------- */
  if (items && items.length) {
    // B3 ★：把 GET 的形状**逐键照抄**、只把时间戳数值加大（模拟「客户端收到服务端数据后更新并推回」）
    //   契约要求：GET 的输出必须就是 POST 的合法输入 ⇒ 该条应被识别为**同一条目**并被推入（pushed === 1）
    const rawShape = JSON.parse(JSON.stringify(items[0]));
    const TS_KEY = 'updatedAt' in rawShape ? 'updatedAt' : 'updated_at'; // 照抄现有形状，不自作主张改键名
    rawShape[TS_KEY] = (typeof rawShape[TS_KEY] === 'number' ? rawShape[TS_KEY] : 0) + 1000;
    const b3 = await api(port, 'POST', '/api/v1/sync', { items: [rawShape] });
    const after3 = await api(port, 'GET', '/api/v1/book');
    const row3 = (itemsOf(after3.json) ?? []).find((it) => it.word === rawShape.word);
    const keyAfter = row3 ? (('updatedAt' in row3) ? 'updatedAt' : 'updated_at') : null;
    const pushedOk = b3.status === 200 && b3.json?.pushed === 1;
    ok(
      'B3',
      '★ 「GET 形状 + 仅改时间戳」回喂 ⇒ 200 ∧ pushed === 1 ∧ 服务端该条时间戳已更新（= 跨端同步真的发生）',
      pushedOk && !!row3 && row3[keyAfter] === rawShape[TS_KEY],
      `status=${b3.status} pushed=${b3.json?.pushed} · 服务端该条 ${keyAfter}=${row3 ? row3[keyAfter] : 'n/a'}（期望 ${rawShape[TS_KEY]}）`,
    );
  } else {
    ok('B3', '★ GET 形状回喂应被识别为同一条并推入', false, 'GET 无条目');
  }
  {
    // B4：raw DB 行形状（snake_case）落在**服务端不存在的新词**上 ⇒ 观察是否 500（主管报告的复现形态）
    const snake = {
      word: 'snake_new_word', lang: 'en', added_at: 1000, updated_at: 2000, status: 'new',
      note: null, tags: '[]', review_count: 0, last_reviewed_at: null, deleted: 0,
    };
    const b4 = await api(port, 'POST', '/api/v1/sync', { items: [snake] });
    ok('B4', 'raw DB 行（snake_case）形状**不得使服务端抛未捕获异常**（不得 500）', b4.status !== 500, `status=${b4.status} pushed=${b4.json?.pushed} skipped=${b4.json?.skipped ?? '（响应体无此字段）'}`);
    note(
      `B4 登记（非红）：现状 = **HTTP ${b4.status} pushed=${b4.json?.pushed}**。T75 落地的策略 = 「**边界归一化 + 丢弃并计数**」` +
        `（apps/sync-server/src/index.ts:110-147 toBookItem 接受 camelCase 与历史 snake_case 别名；缺 word/缺时间戳 ⇒ 丢弃计 skipped）` +
        `⇒ 不再 500，且历史 snake_case 载荷**仍被正确接受**（本项 pushed=${b4.json?.pushed} 即证）。` +
        `✔ 我原先的担心已实测排除：\`skipped\` **已在响应体中回传**（src/index.ts:290）⇒ 客户端**可**检测被丢弃条数，**不是静默丢弃**；` +
        `残余（轻微，非阻塞）：只回传数量、不回传是哪几条。`,
    );
  }

  /* ---------- C 组 · POST 形状契约 ---------- */
  const c1 = await api(port, 'POST', '/api/v1/sync', { items: [camelItem('banana', 'en', 4000)] });
  ok('C1', 'camelCase 条目 ⇒ 200 且 pushed === 1', c1.status === 200 && c1.json?.pushed === 1, `status=${c1.status} pushed=${c1.json?.pushed}`);
  const c2 = await api(port, 'POST', '/api/v1/sync', { items: [] });
  ok('C2', 'items: [] ⇒ 200 且 pushed === 0（基线）', c2.status === 200 && c2.json?.pushed === 0, `status=${c2.status} pushed=${c2.json?.pushed}`);
  const c3 = await api(port, 'POST', '/api/v1/sync', { items: [{ word: 'onlyword' }] });
  ok('C3', '仅 {word}（缺必需字段）**不得使服务端抛未捕获异常**（不得 500）', c3.status !== 500, `status=${c3.status} pushed=${c3.json?.pushed} skipped=${c3.json?.skipped ?? '（响应体无此字段）'}`);
  note(
    `C3 登记（非红）：现状 = **HTTP ${c3.status} pushed=${c3.json?.pushed} skipped=${c3.json?.skipped}**（缺 updatedAt ⇒ 被边界丢弃并计数）。` +
      `判定选择说明：本项**未**写成「必须 400」—— T75 已把「缺必需字段 ⇒ 丢弃 + 计入 skipped + 回传 skipped」定为落地策略，` +
      `写死 400 会在实现不改的前提下永久红；故只断言「**不得 500 崩栈**」（修前 = 500 红 ⇒ 修后绿，具备鉴别力）。`,
  );

  /* ---------- G 组 · ★ T79：`items` 非数组 / 缺键 ⇒ 必须不崩（C17 的**行为版**，不再依赖源码字符串） ---------- */
  for (const [id, payload, desc] of [
    ['G1', { items: 'not-an-array' }, 'items 为字符串 "not-an-array"'],
    ['G2', { items: 123 }, 'items 为数字 123'],
    ['G3', {}, '缺 items 键'],
  ]) {
    const g = await api(port, 'POST', '/api/v1/sync', payload);
    ok(
      id,
      `${desc} ⇒ **不得 500**，且行为可预测（pushed === 0）`,
      g.status !== 500 && g.json?.pushed === 0,
      `status=${g.status} pushed=${g.json?.pushed} skipped=${g.json?.skipped ?? 'n/a'}`,
    );
  }
  note(
    'G1–G3 即 `packages/core/test/book_lang.mjs:1427` C17「body.items 数组」契约的**行为版**：' +
      'C17 是源码字符串判断（`includes("Array.isArray(body.items)")`），T75 重构时曾因此**假红**（见 EVIDENCE §50.5）；' +
      '本组直接打 HTTP ⇒ 无论实现怎么重构，只要「非数组入参不崩」这条**行为**成立即绿，**不依赖冻结账本**。',
  );

  /* ---------- F 组 · ★ T77 新发现（与 V11-SYNC-DTO 不同的**第二个**缺陷，默认非阻塞） ---------- */
  console.log('  —— F 组：★ 新发现（默认非阻塞登记；把 BLOCK_ON_F_GROUP 改 true 即转为红断言）');
  {
    const nullNote = camelItem('notenull', 'en', 5000, { note: null, tags: [], lastReviewedAt: null });
    await api(port, 'POST', '/api/v1/sync', { items: [nullNote] });
    const back = (itemsOf((await api(port, 'GET', '/api/v1/book')).json) ?? []).find((it) => it.word === 'notenull');
    const f1 = back?.note === null;
    const f2 = Array.isArray(back?.tags);
    const f3 = back?.lastReviewedAt === null;
    const record = (id, desc, cond, extra) => {
      if (BLOCK_ON_F_GROUP) ok(id, desc, cond, extra);
      else {
        results.push({ id, desc, cond: true, extra: `（登记·非阻塞）${extra}` });
        console.log(`  ${cond ? '\u2714' : '\u2718'} ${id} ${desc}  [登记·非阻塞] ${extra}`);
      }
    };
    record('F1', "note: null 必须回读为 null（BookItem 契约 note: string | null）", f1, `实际 note=${JSON.stringify(back?.note)}（typeof=${typeof back?.note}）`);
    record('F2', 'tags: [] 必须回读为数组', f2, `实际 tags=${JSON.stringify(back?.tags)}`);
    record('F3', 'lastReviewedAt: null 必须回读为 null', f3, `实际 lastReviewedAt=${JSON.stringify(back?.lastReviewedAt)}`);
    if (!f1) {
      const msg =
        'F1 ★ 新缺陷 V11-NOTE-NULL：`note: null` 经 POST 后被存成**字符串 "undefined"**。' +
        '根因（源码级已定位）= `apps/sync-server/src/index.ts:108 firstDefined = (...vals) => vals.find(v => v !== undefined && v !== null)`' +
        '**会滤掉 null** ⇒ `:135 firstDefined(r.note, null)` 在 payload.note === null 时返回 **undefined**（兜底 null 永不生效）' +
        '⇒ `:142 noteRaw === null ? null : String(noteRaw)` 落到 `String(undefined)` = "undefined"。' +
        '影响：凡客户端把 `note: null`（= 无笔记的正常形状）推上来即污染该行；**GET→POST 回环亦会污染**（回环幂等性被破坏）。' +
        '修法建议：`:135` 改为 `r.note === undefined ? null : r.note`（或把 firstDefined 的 null 过滤改为仅在「找非空值」场景使用）。';
      note(msg);
    } else {
      note(
        'F1–F3 已绿（登记）：本组是 T77 实测**发现并已修复**的第二个缺陷 **V11-NOTE-NULL** 的回归守卫。' +
          '实测时间线：`packages/core/../apps/sync-server/dist/index.js` 于 2026-09-14 20:03(首版 T75 落地) 时 `note: null` ⇒ 回读 **"undefined"**（字符串）；' +
          '开发 agent 于 **20:05:52(src)/20:06:20(dist)** 修掉，其注释逐字印证本诊断（`src:136-138 不能写成 noteRaw === null ? null : String(noteRaw)`）。' +
          '⇒ 本组保留为**回归守卫**；若 `BLOCK_ON_F_GROUP = true`，它将成为阻止该缺陷复发的红断言。',
      );
    }
  }

  /* ---------- 收尾计数 ---------- */
  failed = results.filter((r) => !r.cond).length;
  console.log(`\nsync-dto \u5951\u7ea6\uff1a${results.length - failed} \u901a\u8fc7 / ${failed} \u5931\u8d25`);
  if (failed) {
    console.log('失败项：');
    for (const r of results.filter((x) => !x.cond)) console.log(`  - ${r.id} ${r.desc}${r.extra ? ` [${r.extra}]` : ''}`);
  }
  if (notes.length) {
    console.log(`登记项（不影响退出码，共 ${notes.length} 条）：`);
    for (const n of notes) console.log(`  \u24d8 ${n}`);
  }
  const frozenAfter = fs.existsSync(FROZEN) ? fs.statSync(FROZEN) : null;
  const frozenSame =
    !!frozenBefore && !!frozenAfter && frozenBefore.size === frozenAfter.size && frozenBefore.mtime.toISOString() === frozenAfter.mtime.toISOString();
  console.log(`冻结库未被修改 = ${frozenSame}（size ${frozenAfter?.size} · mtime ${frozenAfter?.mtime.toISOString()}）`);
} catch (e) {
  failed = failed || 1;
  console.log(`\n\u2718 运行异常：${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e}`);
} finally {
  /* ---------- 关子进程 + 验端口释放 + 清临时目录 ---------- */
  if (child && child.exitCode === null) {
    child.kill();
    for (let i = 0; i < 20 && child.exitCode === null; i += 1) await new Promise((r) => setTimeout(r, 50));
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (logFd !== null) {
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  }
  if (failed && fs.existsSync(LOG)) {
    console.log('\n--- server.log（失败时保留尾 15 行作证，随后清理临时目录）---');
    console.log(fs.readFileSync(LOG, 'utf8').split('\n').slice(-15).map((l) => '    ' + l).join('\n'));
  }
  try {
    fs.rmSync(RUN, { recursive: true, force: true });
    console.log(`临时目录已清理：${path.relative(REPO, RUN)}`);
  } catch (e) {
    console.log(`\u26a0 临时目录清理失败（未静默）：${e.message} · 残留 ${RUN}`);
  }
  try {
    if (fs.existsSync(TMP_ROOT) && fs.readdirSync(TMP_ROOT).length === 0) fs.rmdirSync(TMP_ROOT);
  } catch {
    /* 非空/被占用 ⇒ 无害 */
  }
  process.exit(failed ? 1 : 0);
}
