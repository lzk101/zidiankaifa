/**
 * probe_t32_source_etym.mjs —— T32 任务 2 深挖：词源原文取证 + однако 重试
 * 功能测试 agent · 只读联网
 * 目的：origin 字段里的**语言学主张**（*sǫkъ / *sǫdъ / 拉丁 dominari / 拉丁 cāsus /
 *      *pasti / *tręsti / *stъlpъ）必须能在来源页找到对应原文，否则该主张属「无来源支撑」。
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
          headers: { Host: u.hostname, 'User-Agent': 'zidiankaifa-test-agent/1.0 (T32 etym audit)' }, timeout: 30000 },
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
/** 去掉巨大的 перев-блок（翻译表）以免淹没词源原文 */
function stripTranslations(t) {
  let out = t;
  for (let i = 0; i < 20; i++) {
    const next = out.replace(/\{\{\s*перев-блок[\s\S]*?\n\}\}/g, '⟨перев-блок⟩');
    if (next === out) break;
    out = next;
  }
  return out;
}
const KEYWORDS = [
  ['Праслав|праслав|праформ', '原始斯拉夫语/原始形式'],
  ['праиндоевр|ПИЕ|индоевроп', '原始印欧语'],
  ['лат\\.|латинск|лат\\.\\s*\\[', '拉丁语'],
  ['нем\\.|немецк', '德语'],
  ['восходит|Происходит|происходит', '词源动词'],
];

const PAGES = ['однако', 'доминировать', 'казус', 'сучок', 'самосуд', 'водопад', 'землетрясение', 'столп'];

for (const title of PAGES) {
  const r = await page(title);
  console.log(`\n${'='.repeat(92)}`);
  if (r === 'MISSING') { console.log(`[${title}] ** 页面不存在 **`); continue; }
  if (!r) { console.log(`[${title}] !! 抓取失败（已重试 6 次）!!`); await sleep(2000); continue; }
  console.log(`[${title}]  revid=${r.revid}  https://ru.wiktionary.org/w/index.php?oldid=${r.revid}`);
  const t = stripTranslations(r.t);
  for (const [re, label] of KEYWORDS) {
    const hits = [...t.matchAll(new RegExp(re, 'gi'))].slice(0, 3)
      .map((mm) => t.slice(Math.max(0, mm.index - 130), mm.index + 210).replace(/\s+/g, ' ').replace(/\{\{[^}]*\}\}/g, '·'));
    if (hits.length) console.log(`  〔${label}〕\n    ${hits.join('\n    ')}`);
  }
  // морфо-ru 完整命中清单（含无 |и=т 的变体）
  const mo = [...t.matchAll(/\{\{\s*морфо-ru\s*\|([^}]*)\}\}/g)].map((m) => `{{морфо-ru|${m[1].trim()}}}`);
  console.log(`  морфо-ru 清单（去重）：${[...new Set(mo)].join('  ||  ') || '—（无）'}`);
  await sleep(1800);
}
