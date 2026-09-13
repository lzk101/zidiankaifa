/**
 * probe_t32_source_template.mjs —— T32 任务 2 第四层：抓 `этимология:*` 托管页
 * 功能测试 agent · 只读联网
 * 发现：ru.wiktionary 的 `== Этимология ==` 段常只写 `{{этимология:<名>|да}}`，
 *       真正的词源正文托管在**独立页面** `этимология:<名>`。故须单独抓。
 * 本文件核实的核心主张：
 *   · столп / казус / однако 是否确为单词素（3 条兜底条目的立项依据）
 *   · доминировать 的拉丁 dominari / 德语 dominieren 主张是否有依据（其模板参数为空）
 *   · суч- ← сук 的主张
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
          headers: { Host: u.hostname, 'User-Agent': 'zidiankaifa-test-agent/1.0 (T32 etym namespace)' }, timeout: 30000 },
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
      if (typeof c === 'string') return { t: c, revid: p.revisions[0].revid, title: p.title };
      await sleep(3500);
    } catch { await sleep(3500); }
  }
  return null;
}

// ⚠ 修正：`{{этимология:casus|да}}` 转写的是 **Template** 命名空间页 `Шаблон:этимология:casus`，
//    不是主命名空间的 `этимология:casus`（后者 5/5 均 MISSING，已实测）。
const PAGES = [
  'Шаблон:этимология:casus',
  'Шаблон:этимология:столп',
  'Шаблон:этимология:однако',
  'Шаблон:этимология:сук',
  'Шаблон:через',
  'Шаблон:этим-2',
];
for (const title of PAGES) {
  const r = await page(title);
  console.log(`\n${'█'.repeat(92)}`);
  if (r === 'MISSING') { console.log(`[${title}]  ** 页面不存在（托管页缺失）**`); await sleep(1500); continue; }
  if (!r) { console.log(`[${title}]  !! 抓取失败 !!`); await sleep(2000); continue; }
  console.log(`[${title}]  revid=${r.revid}  https://ru.wiktionary.org/wiki/${encodeURIComponent(title)}`);
  console.log(r.t.replace(/\n{2,}/g, '\n').slice(0, 900));
  await sleep(1800);
}
