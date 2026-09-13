/**
 * probe_t32_source_psl.mjs —— T32 任务 2 第五层：核证 3 条「原始斯拉夫语形式」主张
 * 功能测试 agent · 只读联网
 * 待核：суд- 的 *sǫdъ / пад- 的 *pasti / тряс- 的 *tręsti
 *       （origin 字段引的是 самосуд / водопад+падать / землетрясение+трясти，
 *         而这些页面只证明**切分**，不证明**原始形式** ⇒ 须抓基词的 этимология 模板页）
 */
import https from 'node:https';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const proxyUrl = new URL(process.env.HTTPS_PROXY || 'http://127.0.0.1:7897');
function getViaProxy(target, tries = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const attempt = (n) => {
      const req = http.request({ host: proxyUrl.hostname, port: Number(proxyUrl.port), method: 'CONNECT',
        path: `${u.hostname}:443`, headers: { Host: `${u.hostname}:443` }, timeout: 30000 });
      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) return retry(new Error(`CONNECT ${res.statusCode}`));
        const r = https.request({ socket, servername: u.hostname, path: u.pathname + u.search, method: 'GET',
          headers: { Host: u.hostname, 'User-Agent': 'zidiankaifa-test-agent/1.0 (T32 psl audit)' }, timeout: 30000 },
          (resp) => { let d = ''; resp.setEncoding('utf8'); resp.on('data', (c) => { d += c; });
            resp.on('end', () => resolve({ status: resp.statusCode, body: d })); });
        r.on('error', retry); r.on('timeout', () => { r.destroy(); retry(new Error('TLS timeout')); }); r.end();
      });
      req.on('error', retry); req.on('timeout', () => { req.destroy(); retry(new Error('CONNECT timeout')); }); req.end();
      function retry(e) { if (n <= 1) return reject(e); setTimeout(() => attempt(n - 1), 3000); }
    };
    attempt(tries);
  });
}
const API = 'https://ru.wiktionary.org/w/api.php';
async function page(title, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const { status, body } = await getViaProxy(`${API}?action=query&prop=revisions&rvprop=ids%7Ccontent&rvslots=main&titles=${encodeURIComponent(title)}&format=json&formatversion=2`);
      if (status !== 200) { await sleep(3500); continue; }
      const j = JSON.parse(body);
      const p = j?.query?.pages?.[0];
      if (p?.missing) return 'MISSING';
      const c = p?.revisions?.[0]?.slots?.main?.content;
      if (typeof c === 'string') return { t: c, revid: p.revisions[0].revid };
      await sleep(3500);
    } catch { await sleep(3500); }
  }
  return null;
}

// 待核主张：模板页名 → 期望命中的原始形式
// ⚠ 2026-09-13 补记：`Шаблон:этимология:падать` 实为 `#REDIRECT [[Шаблон:этимология:паду]]`
//    （revid 558729 首行即 REDIRECT）⇒ 须跟一跳抓 `паду`。
const TARGETS = [
  ['Шаблон:этимология:паду', '*pasti', 'пад- ← 原始斯拉夫语 *pasti（经 падать 重定向）'],
];
for (const [title, want, note] of TARGETS) {
  const r = await page(title);
  console.log(`\n${'█'.repeat(92)}`);
  console.log(`[${title}]  待核：${note}`);
  if (r === 'MISSING') { console.log('  ** 模板页不存在 **'); await sleep(1500); continue; }
  if (!r) { console.log('  !! 抓取失败 !!'); await sleep(2000); continue; }
  const t = r.t;
  console.log(`  revid=${r.revid}  https://ru.wiktionary.org/wiki/${encodeURIComponent(title)}`);
  // 抓 праслав 模板参数 + 含目标串的上下文
  const psl = [...t.matchAll(/\{\{\s*праслав\s*\|([^}]*)\}\}/g)].map((m) => m[1].trim());
  console.log(`  {{праслав}} 参数：${psl.length ? psl.join(' || ') : '—（无）'}`);
  const idx = t.indexOf(want.replace('*', '')); // 去掉 * 找词干
  console.log(`  ${t.includes(want.replace('*', '')) ? '✅ 命中' : '❌ 未命中'}内容「${want}」`);
  if (idx >= 0) console.log(`  上下文：…${t.slice(Math.max(0, idx - 160), idx + 220).replace(/\s+/g, ' ')}…`);
  else console.log(`  首 260 字符：${t.slice(0, 260).replace(/\s+/g, ' ')}`);
  await sleep(1800);
}
