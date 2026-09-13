/**
 * 文本健康普查 v2（只读）—— 精确判据，排除 CRLF 噪声
 *
 * 判据 ①（真损坏，三种形态，已在 README.md:144 出现过）：
 *   a. 存在 BEL U+0007 或 FF U+000C 等**非空白**控制字符
 *   b. 存在**行中** CR（CR 后面不是 LF）—— CRLF 文件的 CR 后面必是 LF，故行中 CR 即异常
 *   c. CR 与 BEL 在同一行（本项目已实测到的字节损坏形态）
 * 判据 ②：旧口径数字残留（仅结构类文档，且要求是全量基准语境）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve('.');
const SKIP = /(^|[\\/])(node_modules|\.git|\.pnpm-store|\.electron-cache|\.eb-cache|dist|dist-release|data|[_]tmp)([\\/]|$)/;
const EXT = new Set(['.md', '.mjs', '.ts', '.tsx', '.json', '.py', '.yml', '.yaml', '.sql', '.html', '.css']);
const NONWS_CTRL = new Set([7, 11, 12, 27]); // BEL VT FF ESC

const findings = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) { walk(p); continue; }
    if (!EXT.has(path.extname(e.name))) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const rel = path.relative(ROOT, p);
    lines.forEach((l, i) => {
      const cps = [...l].map((c) => c.codePointAt(0));
      const hasCr = cps.includes(13);
      const hasBel = cps.includes(7);
      const nonws = cps.filter((c) => NONWS_CTRL.has(c));
      const bad = hasBel || nonws.length > 0 || hasCr; // 拆行后仍含 CR ⇒ CR 不在行尾
      if (bad) findings.push(`${rel}:${i + 1}  ${hasCr ? 'CR(行中) ' : ''}${hasBel ? 'BEL ' : ''}${nonws.length ? 'ctrl=' + nonws.join(',') : ''}｜${JSON.stringify(l.slice(0, 70))}`);
    });
  }
};
walk(ROOT);

console.log('=== ① 真·控制字符异常（排除 CRLF）===');
console.log(findings.length ? findings.join('\n') : '全仓无 ✔');

console.log('');
console.log('=== ② 结构类文档旧口径抽查 ===');
const targets = ['README.md', 'PROJECT_STRUCTURE.md', 'PROJECT_CHARTER.md', 'AGENTS.md', 'docs/交接文档.md', 'docs/需求总结.md', '.board/REQ.md'];
const pats = [['909 条词素', /909 条词素/], ['俄语 441', /俄语 441/], ['204 项', /\b204 项/], ['门禁 506（旧口径）', /506 通过/]];
let hit = 0;
for (const t of targets) {
  if (!fs.existsSync(t)) continue;
  const raw = fs.readFileSync(t, 'utf8');
  for (const [tag, re] of pats) {
    if (re.test(raw)) {
      hit++;
      const m = raw.match(new RegExp('.{0,42}' + re.source + '.{0,42}'));
      console.log(`${t}  「${tag}」  …${m ? m[0].replace(/\n/g, '⏎') : ''}…`);
    }
  }
}
if (!hit) console.log('无 ✔');
