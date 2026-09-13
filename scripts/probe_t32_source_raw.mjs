/**
 * probe_t32_source_raw.mjs —— T32 任务 2 第三层：**裸 dump** 词源段原文
 * 功能测试 agent · 只读联网
 * 前两次脚本把 {{...}} 模板清洗掉了，导致「Происходит от ·」看不到内容。
 * 本次保留全部模板原文，只把巨型 перев-блок 折叠为 ⟨перев-блок⟩。
 * 目的：核实 origin 字段里的语言学主张（*sǫkъ / *sǫdъ / 拉丁 dominari / 拉丁 cāsus /
 *      *pasti / *tręsti / *stъlpъ / однако 为单词素）是否有原文依据。
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
          headers: { Host: u.hostname, 'User-Agent': 'zidiankaifa-test-agent/1.0 (T32 raw etym)' }, timeout: 30000 },
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
function fold(t) {
  let out = t;
  for (let i = 0; i < 20; i++) {
    const n = out.replace(/\{\{\s*перев-блок[\s\S]*?\n\}\}/g, '⟨перев-блок⟩');
    if (n === out) break;
    out = n;
  }
  return out;
}
/** 取「== Этимология ==」起 N 字符（裸文本） */
function etymRaw(t, n = 560) {
  const i = t.search(/==\s*Этимология\s*==/i);
  if (i < 0) return '—（无 Этимология 段）';
  return t.slice(i, i + n).replace(/\{\{\s*перев-блок[\s\S]*?\n\}\}/g, '⟨перев-блок⟩');
}

const PAGES = ['доминировать', 'казус', 'однако', 'сучок', 'самосуд', 'водопад', 'землетрясение', 'столп'];
for (const title of PAGES) {
  const r = await page(title);
  console.log(`\n${'█'.repeat(92)}`);
  if (r === 'MISSING') { console.log(`[${title}] ** 不存在 **`); continue; }
  if (!r) { console.log(`[${title}] !! 抓取失败 !!`); await sleep(2000); continue; }
  console.log(`[${title}] revid=${r.revid}`);
  const folded = fold(r.t);
  console.log('── 词源段裸文本 ──');
  console.log(etymRaw(folded).replace(/\n{2,}/g, '\n'));
  await sleep(1800);
}
