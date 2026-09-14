// T81 第 2 段：反方向（电脑端写入 → 手机端回读）+ 双向残留清理自证
// 前置：scripts/probe_t81_mobile_sync_e2e.mjs 已证明「手机 → 电脑」方向成立。
const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://127.0.0.1:4570';
const SYNC = 'D:/lzk17/Documents/zidiankaifa/data/sync-data/sync.db';
const MARK_PC = 't81desktop';
const MARKS = ['t81phone', 't81desktop'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { DatabaseSync } = await import('node:sqlite');

const dbCount = () => { const d = new DatabaseSync(SYNC, { readOnly: true }); const n = d.prepare('SELECT COUNT(1) AS n FROM book').get().n; const w = d.prepare('SELECT word FROM book ORDER BY word').all().map((r) => r.word); d.close(); return { n, w }; };

// ---------- 1) 电脑端写入 ----------
console.log('① 电脑端写入（模拟桌面端在电脑上加了生词）');
const start = dbCount();
console.log(`   写入前 book = ${start.n} 行：${start.w.join(' ')}`);
const now = Date.now();
const push = await fetch(`${BASE}/api/v1/sync`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{ word: MARK_PC, lang: 'en', addedAt: now, updatedAt: now, status: 'mastered', note: 'T81 电脑端写入', tags: ['电脑端'], reviewCount: 3, lastReviewedAt: null, deleted: false }] }),
});
const pj = await push.json();
const mid = dbCount();
console.log(`   电脑端 POST /api/v1/sync ⇒ HTTP ${push.status}  pushed=${pj.pushed}  pulled=${pj.pulled}`);
console.log(`   写入后 book = ${mid.n} 行：${mid.w.join(' ')}`);

// ---------- 2) 手机端回读 ----------
let target = null;
for (let i = 0; i < 30; i++) {
  try { const l = await (await fetch(`${CDP}/json`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (target) break; } catch {}
  await sleep(400);
}
if (!target) { console.log('★ CDP 不可用'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

console.log('\n② ★ 手机端拉取（反方向：电脑 → 手机）');
const pull = await evaluate(`(async () => {
  const base = (localStorage.getItem('zidian-sync-url') || 'http://10.0.2.2:4570').replace(/\\/+$/, '');
  const r = await fetch(base + '/api/v1/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] })
  });
  const j = await r.json();
  const mine = (j.items ?? []).find(i => i.word === '${MARK_PC}');
  return {
    status: r.status, pushed: j.pushed, pulled: j.pulled,
    words: (j.items ?? []).map(i => i.word + '[' + i.lang + ']'),
    看到电脑端新词: !!mine,
    该词内容: mine ? { status: mine.status, note: mine.note, tags: mine.tags, reviewCount: mine.reviewCount } : null
  };
})()`);
console.log('   ' + JSON.stringify(pull, null, 2).split('\n').join('\n   '));

// ---------- 3) 清理与自证 ----------
console.log('\n③ 清理双向测试残留');
const del = await evaluate(`(async () => {
  const base = (localStorage.getItem('zidian-sync-url') || 'http://10.0.2.2:4570').replace(/\\/+$/, '');
  const now = Date.now();
  const marks = ['t81phone', 't81desktop'];
  const items = marks.map(function (w) { return { word: w, lang: 'en', addedAt: now, updatedAt: now + 99999, status: 'new', note: null, tags: [], reviewCount: 0, lastReviewedAt: null, deleted: true }; });
  const r = await fetch(base + '/api/v1/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items })
  });
  const j = await r.json();
  return { status: r.status, pushed: j.pushed, pulled: j.pulled };
})()`);
console.log(`   手机端写入墓碑 ⇒ HTTP ${del.status}  pushed=${del.pushed}`);

const db = new DatabaseSync(SYNC);
for (const w of MARKS) db.exec(`DELETE FROM book WHERE word = '${w}'`);
const end = dbCount();
const rows = db.prepare('SELECT word, lang FROM book ORDER BY word').all();
db.close();
console.log(`\n④ 自证还原：book ${start.n} 行 → ${end.n} 行（本段凭空增 ${mid.n - start.n}，已清）`);
console.log(`   逐行与初始相同 = ${JSON.stringify(start.w) === JSON.stringify(end.w)}`);
console.log(`   剩余：${rows.map((r) => `${r.word}[${r.lang}]`).join(' ')}`);
ws.close();
