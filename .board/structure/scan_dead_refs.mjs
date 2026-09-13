/* 只读：扫描文档中对 scripts/** 与 .board/_tmp/** 的路径引用，报告"被引用但已不存在"的死引用。
   写者：项目结构管理 agent。只读，不改任何文件。 */
import fs from 'node:fs';
import path from 'node:path';

/* 运行方式：务必在仓库根目录执行 `node .board/structure/scan_dead_refs.mjs`
   （T55 首轮：本文件原以 import.meta 定根，移出 _tmp/ 后根解析会错位，改为 cwd + 自检） */
const REPO = process.cwd();
if (!fs.existsSync(path.join(REPO, '.board')) || !fs.existsSync(path.join(REPO, 'scripts'))) {
  console.error('请在仓库根目录运行：node .board/structure/scan_dead_refs.mjs');
  process.exit(1);
}

const DOCS = [
  'AGENTS.md', 'PROJECT_STRUCTURE.md', 'PROJECT_CHARTER.md', 'README.md',
];
function collectMd(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectMd(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}
collectMd(path.join(REPO, '.board'), []);
collectMd(path.join(REPO, 'docs'), []);
for (const d of DOCS) { const p = path.join(REPO, d); if (fs.existsSync(p)) collectMd(path.dirname(p), []); }
const files = [...new Set([
  ...DOCS.map((d) => path.join(REPO, d)).filter((p) => fs.existsSync(p)),
  ...collectMd(path.join(REPO, '.board'), []),
  ...collectMd(path.join(REPO, 'docs'), []),
])];

/* 提取 scripts/... 或 .board/_tmp/... 的路径 token（含扩展名） */
const TOK = /(?<![\w/.-])((?:scripts|\.board\/_tmp)\/[A-Za-z0-9_./{},*-]+\.(?:mjs|txt|json|md|py))/g;

/** 展开 bash 花括号：a{,2,3}.mjs / {a,b} */
function expandBraces(s) {
  const m = s.match(/\{([^{}]*)\}/);
  if (!m) return [s];
  const out = [];
  for (const alt of m[1].split(',')) {
    out.push(...expandBraces(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)));
  }
  return out;
}

const rows = [];
const seen = new Set();
for (const f of files) {
  const rel = path.relative(REPO, f).replace(/\\/g, '/');
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    let m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(line)) !== null) {
      const raw = m[1];
      if (raw.includes('*')) continue;              // 通配路径（运行时目录），非固定文件
      for (const cand of expandBraces(raw)) {
        const abs = path.join(REPO, cand);
        if (fs.existsSync(abs)) continue;
        const key = `${rel}|${i + 1}|${cand}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ doc: rel, line: i + 1, ref: cand, kind: cand.startsWith('scripts/') ? 'scripts' : 'board_tmp', text: line.trim().slice(0, 110) });
      }
    }
  });
}

console.log(`扫描文档数：${files.length}`);
console.log(`死引用条数：${rows.length}`);
console.log('');
for (const r of rows.sort((a, b) => (a.doc + a.ref).localeCompare(b.doc + b.ref))) {
  console.log(`${r.doc}:${r.line}  ->  ${r.ref}   [${r.kind}]`);
  console.log(`      ${r.text}`);
}
console.log('');
console.log('--- 按被引用文件聚合（去重） ---');
const agg = new Map();
for (const r of rows) {
  if (!agg.has(r.ref)) agg.set(r.ref, []);
  agg.get(r.ref).push(`${r.doc}:${r.line}`);
}
for (const [ref, where] of [...agg.entries()].sort()) {
  console.log(`${ref}\n    ${where.join('  ')}`);
}
