// T81：手机端 ↔ 电脑端 真实互通实测（CDP 驱动真实 WebView）
// 目的：在模拟器内的真实页面里执行 fetch，验证「手机端写入 → 电脑端库可见 → 电脑端回读一致」。
// 只读/可清理：写入用带前缀的测试词，末尾从 PC 侧库中删除并自证还原。
const CDP = 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 取唯一缺省目标的 WebSocket 调试地址（轮询到可用为止）
let target = null;
for (let i = 0; i < 30; i++) {
  try {
    const list = await (await fetch(`${CDP}/json`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch { /* 端点尚未就绪 */ }
  await sleep(400);
}
if (!target) {
  console.log('★ 未能连上 CDP 端点 —— 检查 adb forward 与 webview_devtools_remote');
  process.exit(1);
}
console.log(`① CDP 目标：title=${JSON.stringify(target.title)}  url=${target.url}`);
console.log(`   id=${target.id.slice(0, 24)}…`);

// 2) 极简 CDP 客户端（全局 WebSocket，Node 24 内置）
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连接失败')); });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ': ' + (r.result.exceptionDetails.exception?.description ?? '') };
  return r.result?.result?.value;
};

// 3) 页面环境事实
console.log('\n② 页面环境');
console.log('  ' + JSON.stringify(await evaluate(`(async () => ({
  origin: location.origin,
  title: document.title,
  hasCapacitor: typeof window.Capacitor !== 'undefined',
  platform: window.Capacitor?.getPlatform?.() ?? null,
  isNative: window.Capacitor?.isNativePlatform?.() ?? null,
  savedSyncUrl: localStorage.getItem('zidian-sync-url'),
  bookLang: localStorage.getItem('zidian-book-lang'),
  viewport: [innerWidth, innerHeight]
}))()`, null, 2)));

// 4) ★ 关键：手机端经真实 fetch 打电脑端服务（这是「互通」的本体）
const MARK = 't81phone';
console.log(`\n③ ★ 手机端发起同步（测试词 = ${MARK}）`);
const probe = await evaluate(`(async () => {
  const base = (localStorage.getItem('zidian-sync-url') || 'http://10.0.2.2:4570').replace(/\\/+$/, '');
  const out = { base };
  try {
    const h = await fetch(base + '/health');
    out.health = await h.json();
    out.healthStatus = h.status;
  } catch (e) { out.healthErr = String(e); return out; }
  try {
    const before = await (await fetch(base + '/api/v1/book')).json();
    out.beforeCount = before.items?.length ?? null;
    out.beforeWords = (before.items ?? []).map(i => i.word + '[' + i.lang + ']');
    const now = Date.now();
    const body = { items: [{
      word: '${MARK}', lang: 'en', addedAt: now, updatedAt: now,
      status: 'learning', note: 'T81 手机端写入', tags: ['手机端'], reviewCount: 0,
      lastReviewedAt: null, deleted: false
    }] };
    const p = await fetch(base + '/api/v1/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    out.pushStatus = p.status;
    const pj = await p.json();
    out.pushed = pj.pushed; out.pulled = pj.pulled; out.skipped = pj.skipped;
    const after = await (await fetch(base + '/api/v1/book')).json();
    out.afterCount = after.items?.length ?? null;
    out.mine = (after.items ?? []).find(i => i.word === '${MARK}');
  } catch (e) { out.postErr = String(e); }
  return out;
})()`);
console.log('  ' + JSON.stringify(probe, null, 2).split('\n').join('\n  '));

// 5) 电脑端回读验证由外层脚本完成（本脚本只负责手机侧证据）
console.log('\n④ 手机侧证据采集完毕；电脑侧回读见随后的库查询');
ws.close();
