// T55 结构 agent · scripts/ 保留策略 A–E MECE 分类器（只读）
// 优先级（互斥判据，先命中先归类）：D > E > A > B > C > 未分类
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 运行方式：务必在仓库根目录执行 `node .board/structure/classify_mece.mjs`
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, '.board')) || !fs.existsSync(path.join(ROOT, 'scripts'))) {
  console.error('请在仓库根目录运行：node .board/structure/classify_mece.mjs');
  process.exit(1);
}

const tracked = execSync('git ls-files scripts', { encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean);
const names = tracked.map((p) => p.replace(/^scripts\//, ''));
const nameSet = new Set(names);

// ---- 文档语料 ----
const docs = [];
for (const f of fs.readdirSync('.board')) {
  if (f.endsWith('.md')) docs.push('.board/' + f);
}
for (const f of fs.readdirSync('.board/roles')) {
  if (f.endsWith('.md')) docs.push('.board/roles/' + f);
}
for (const f of fs.readdirSync('docs')) {
  if (f.endsWith('.md')) docs.push('docs/' + f);
}
for (const f of ['AGENTS.md', 'PROJECT_STRUCTURE.md', 'PROJECT_CHARTER.md', 'README.md']) {
  if (fs.existsSync(f)) docs.push(f);
}
const docLines = [];
for (const d of docs) {
  const raw = fs.readFileSync(d, 'utf8').split('\n');
  raw.forEach((line, i) => docLines.push({ doc: d, ln: i + 1, line }));
}

// 每文件被引用次数
const cites = new Map();
for (const n of names) cites.set(n, []);
for (const dl of docLines) {
  for (const n of names) {
    if (dl.line.includes(n)) cites.get(n).push(dl);
  }
}

// ---- 档位规则 ----
const D_REGISTERED = new Set([
  'exp_ru_recoverable.mjs', 'exp_ru_gap.mjs', 'exp_ru_head_gap.mjs',
]);
// A：委任书 §7 点名的活跃工具 + 门禁/发布路径直接依赖
const A_NAMED = new Set([
  'check_v10_ui_contract.mjs', 'audit_text_health.mjs',
  'fix_readme_l144_corruption.mjs', 'build_web_nospawn.mjs',
  'exp_ru_ceiling.mjs', // B-5 已修复、自检 exit 0，且是唯一上界工具（C→A 升级候选，见报告）
]);
// D：本轮新发现的「结论已错」候选（依据：文档明写作废/推翻）
const D_NEW_CANDIDATE = new Set([
  'probe_t15_reconcile_and_harm.mjs',
  'probe_sup_wal_snapshot.mjs',
  'exp_v9_criterion_d.mjs',
]);

const INV = /作废|推翻|不成立|失效|错误结论|已被取代|不得引用|有缺陷/;

const buckets = { A: [], B: [], C: [], D: [], E: [], U: [] };
const invalidationHits = [];

for (const n of names) {
  const cl = cites.get(n) ?? [];
  const invLines = cl.filter((x) => INV.test(x.line));
  if (invLines.length) invalidationHits.push({ n, invLines });

  if (D_REGISTERED.has(n) || D_NEW_CANDIDATE.has(n)) buckets.D.push(n);
  else if (n.startsWith('_tmp')) buckets.E.push(n);
  else if (A_NAMED.has(n)) buckets.A.push(n);
  else if (n.startsWith('out_')) buckets.B.push(n);
  else if (n.startsWith('probe')) buckets.C.push(n);
  else buckets.U.push(n);
}
buckets.A = buckets.A.filter((n) => !n.startsWith('?UNCLASSIFIED:'));

const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);
console.log('=== scripts/ 已跟踪文件 =', tracked.length, '/ 分类合计 =', total);
console.log('=== MECE：A∪B∪C∪D∪E 覆盖数 =', total - buckets.U.length,
  ' ⇒ 未覆盖 U =', buckets.U.length, '（§7 五档无归属）');
for (const k of ['A', 'B', 'C', 'D', 'E', 'U']) {
  console.log(`[${k}] ${buckets[k].length}`);
}
console.log('\n--- A 档 ---');
buckets.A.forEach((n) => console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length));
console.log('\n--- B 档 (out_*) ---');
buckets.B.forEach((n) => console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length));
console.log('\n--- D 档 ---');
buckets.D.forEach((n) => console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length));
console.log('\n--- E 档 ---');
buckets.E.forEach((n) => console.log('  ' + n));

console.log('\n--- 零引用（在 .board/**+docs/**+4 根文档 中从未出现）---');
const zeroCite = names.filter((n) => (cites.get(n) ?? []).length === 0);
console.log('  数量 =', zeroCite.length);
zeroCite.forEach((n) => console.log('  ' + n));

console.log('\n--- ★ 被「作废/推翻/不成立」语境提及的脚本（新 D 档候选，需人工判读）---');
for (const h of invalidationHits) {
  console.log(`  ${h.n}  (${h.invLines.length} 条)`);
  for (const l of h.invLines.slice(0, 2)) {
    console.log(`      ${l.doc}:${l.ln}  ${l.line.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}
