/**
 * probe_t32_source_audit.mjs —— T32 任务 2：独立复核 v0.9.0 落库 9 条词素的**来源支撑**
 * 功能测试 agent · 2026-09-13 · 只读联网
 *
 * 通道：http CONNECT 隧道 127.0.0.1:7897 → ru.wiktionary MediaWiki API
 *      （pwsh 的 Invoke-RestMethod -Proxy / curl.exe 在本机报 SEC_E_NO_CREDENTIALS，勿用）
 *
 * 方法：把每条词素 `origin` 字段里的**可证伪主张**逐条抽出，去来源页核对：
 *   · 引用了具体 oldid 的 → 直接抓该版本（action=parse&oldid=）
 *   · 只引用词条名的     → 抓当前版本（action=query&prop=revisions）
 * 判据：模板原文逐字符匹配（去空白归一化）。
 */
import https from 'node:https';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const proxyUrl = new URL(process.env.HTTPS_PROXY || 'http://127.0.0.1:7897');

function getViaProxy(target, tries = 4) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const attempt = (n) => {
      const req = http.request({
        host: proxyUrl.hostname, port: Number(proxyUrl.port), method: 'CONNECT',
        path: `${u.hostname}:443`, headers: { Host: `${u.hostname}:443` }, timeout: 30000,
      });
      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) return retry(new Error(`CONNECT ${res.statusCode}`));
        const r = https.request(
          { socket, servername: u.hostname, path: u.pathname + u.search, method: 'GET',
            headers: { Host: u.hostname, 'User-Agent': 'zidiankaifa-test-agent/1.0 (T32 source audit)' }, timeout: 30000 },
          (resp) => {
            let d = ''; resp.setEncoding('utf8');
            resp.on('data', (c) => { d += c; });
            resp.on('end', () => resolve({ status: resp.statusCode, body: d }));
          },
        );
        r.on('error', retry);
        r.on('timeout', () => { r.destroy(); retry(new Error('TLS timeout')); });
        r.end();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(new Error('CONNECT timeout')); });
      req.end();
      function retry(e) { if (n <= 1) return reject(e); setTimeout(() => attempt(n - 1), 2500); }
    };
    attempt(tries);
  });
}

const API = 'https://ru.wiktionary.org/w/api.php';

/** 按 oldid 抓指定版本（精确复核引用） */
async function byOldid(oldid) {
  for (let i = 0; i < 5; i++) {
    try {
      const url = `${API}?action=parse&oldid=${oldid}&prop=wikitext&format=json&formatversion=2`;
      const { status, body } = await getViaProxy(url);
      if (status !== 200) { await sleep(2500); continue; }
      const j = JSON.parse(body);
      const t = j?.parse?.wikitext;
      if (typeof t === 'string') return { wikitext: t, revid: j?.parse?.revid, title: j?.parse?.title };
      await sleep(2500);
    } catch { await sleep(2500); }
  }
  return null;
}

/** 按标题抓当前版本 */
async function byTitle(page) {
  for (let i = 0; i < 5; i++) {
    try {
      const url = `${API}?action=query&prop=revisions&rvprop=ids%7Ccontent&rvslots=main&titles=${encodeURIComponent(page)}&format=json&formatversion=2`;
      const { status, body } = await getViaProxy(url);
      if (status !== 200) { await sleep(2500); continue; }
      const j = JSON.parse(body);
      const p = j?.query?.pages?.[0];
      if (p?.missing) return 'MISSING';
      const rev = p?.revisions?.[0];
      if (rev?.slots?.main?.content) return { wikitext: rev.slots.main.content, revid: rev.revid, title: p.title };
      await sleep(2500);
    } catch { await sleep(2500); }
  }
  return null;
}

const norm = (s) => String(s).replace(/\s+/g, '');
/** 抽取全部 морфо-* 模板原文 */
const morphoTemplates = (t) =>
  [...t.matchAll(/\{\{\s*(морфо-ru|морфо|морфемы|морфо-цс)\s*\|([^}]*)\}\}/g)].map((m) => `{{${m[1]}|${m[2].trim()}}}`);
/** 抽取 Этимология 段前 400 字符 */
function etym(t) {
  const i = t.search(/==\s*Этимология\s*==/i);
  if (i < 0) return '—（无 Этимология 段）';
  return t.slice(i + 16, i + 1200)
    .split('\n').filter((l) => l.trim() && !/^===/.test(l) && !/\{\{t\?\|/.test(l))
    .join(' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

// ── 逐条：词素 → 来源主张清单 ─────────────────────────────────────────────────
const SUBJECTS = [
  { m: 'суч-', page: 'сучок', oldid: 13801399,
    claims: ['{{морфо-ru|суч|-ок|+∅|и=т}}'],
    note: 'root「节，枝节」+ *sǫkъ' },
  { m: 'суд-', page: 'самосуд',
    claims: ['{{морфо-ru|сам|-о-|суд|и=т}}'],
    note: 'root「审判、判断」+ *sǫdъ' },
  { m: 'домин-', page: 'доминировать', oldid: 13281907,
    claims: ['{{морфо-ru|домин|-ир-|-ова|+ть|и=т}}'],
    note: 'root「支配、统治」+ 拉丁 dominari（经德语 dominieren）★主管点名：疑未抓到 {{морфо-ru}}' },
  { m: '-ной', page: 'больной',
    claims: ['{{морфо-ru|боль|-н|+ой|и=т}}', '{{морфо-ru|боль|-ной|и=т}}'],
    note: 'suffix「重音变体」★二源冲突：ru.wiktionary ? vs 本地 chain ["боль","-ной"]' },
  { m: 'пад-', page: 'водопад',
    claims: ['{{морфо-ru|вод|-о-|пад|и=т}}'],
    note: 'root「落、坠」+ *pasti（另引 падать = {{морфо-ru|пад|-а|+ть|и=т}}）' },
  { m: 'пад-①', page: 'падать', claims: ['{{морфо-ru|пад|-а|+ть|и=т}}'], note: 'пад- 的第二来源（origin 字段括注）' },
  { m: 'тряс-', page: 'землетрясение', oldid: 13948603,
    claims: ['{{морфо-ru|земл|-е-|тряс|-ениj|+е|и=т}}'],
    note: 'root「抖、震」+ *tręsti（另引 трясти = {{морфо-ru|тряс|+ти|и=т}}）' },
  { m: 'тряс-①', page: 'трясти', claims: ['{{морфо-ru|тряс|+ти|и=т}}'], note: 'тряс- 的第二来源（origin 字段括注）' },
  { m: 'столп-', page: 'столп', claims: ['{{морфо-ru|столп|и=т}}'], note: '★兜底条目：须确为单词素' },
  { m: 'казус-', page: 'казус', claims: ['{{морфо-ru|казус|и=т}}'], note: '★兜底条目：须确为单词素（借自拉丁 cāsus）' },
  { m: 'однако-', page: 'однако', claims: ['{{морфо-ru|однако|и=т}}'], note: '★兜底条目：须确为单词素' },
];

const results = [];
for (const s of SUBJECTS) {
  let r;
  if (s.oldid) {
    r = await byOldid(s.oldid);
    console.log(`\n${'='.repeat(88)}`);
    console.log(`[${s.m}] ${s.page}  —— 按 origin 引用的 oldid=${s.oldid} 精确抓取`);
  } else {
    r = await byTitle(s.page);
    console.log(`\n${'='.repeat(88)}`);
    console.log(`[${s.m}] ${s.page}  —— 抓当前版本`);
  }
  if (r === 'MISSING') { console.log('  ** 页面不存在 **'); results.push({ ...s, verdict: 'MISSING' }); await sleep(1500); continue; }
  if (!r) { console.log('  !! 抓取失败（网络/限流）!!'); results.push({ ...s, verdict: 'FETCH_FAIL' }); await sleep(1500); continue; }

  const { wikitext: t, revid } = r;
  const url = s.oldid
    ? `https://ru.wiktionary.org/w/index.php?oldid=${revid}`
    : `https://ru.wiktionary.org/wiki/${encodeURIComponent(s.page)}`;
  console.log(`  实际 revid = ${revid}   ${url}`);
  console.log(`  说明：${s.note}`);

  const found = morphoTemplates(t);
  console.log(`  {{морфо-ru}} 全部命中（${found.length}）：${found.length ? found.join('  ||  ') : '—（无）'}`);

  const nt = norm(t);
  for (const c of s.claims) {
    const hit = nt.includes(norm(c));
    console.log(`  ${hit ? '✅ 支撑' : '❌ 未支撑'}  主张模板 ${c}`);
  }
  // 附加线索：H-d（主管提到 домин- 是 |H-d| 候选）
  const hd = [...t.matchAll(/H-d[^\n]{0,120}/g)].slice(0, 2).map((x) => x[0].trim());
  if (hd.length) console.log(`  |H-d| 线索：${hd.join(' || ')}`);

  // больной 专项：打印所有含「боль」的 морфо/структура 字段
  if (s.page === 'больной') {
    const suf = [...t.matchAll(/\|\s*(корень\d?|суффикс\d?|приставка\d?|окончание\d?|основа)\s*=\s*([^\n|]+)/gi)].map((x) => `${x[1]}=${x[2].trim()}`);
    console.log(`  字符段字段：${suf.length ? suf.join(' ; ') : '—'}`);
  }
  console.log(`  Этимология 片段：${etym(t).slice(0, 330)}`);

  results.push({ m: s.m, page: s.page, revid, url, found, claims: s.claims, wikitext: t });
  await sleep(1500);
}

console.log(`\n\n${'='.repeat(88)}`);
console.log('汇总（供人工判档）');
console.log('='.repeat(88));
for (const r of results) {
  const st = r.verdict ?? (r.claims.every((c) => norm(r.wikitext).includes(norm(c))) ? '全主张命中' : '有主张未命中');
  console.log(`${String(r.m).padEnd(9)} ${String(r.page).padEnd(15)} ${st.padEnd(12)} revid=${r.revid ?? '-'}`);
}
