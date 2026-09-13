// T55 结构 agent · scripts/ 保留策略 A–F MECE 分类器（只读）
// ★ 优先级（互斥判据，先命中先归类）：D > E > A > F > B > C > 未分类
//   主管 T55 四轮裁决 1（.board/TASKS.md §11.12「:1138-1142」）采纳本 agent 顶回：
//   A 与 F 对调 —— A 是「角色」（门禁/发布/AC 依赖它），F 是「形态」（实验脚本），角色压过形态。
//   唯一分配制不变：一个文件只进一个档；不得因文件名前缀覆盖角色判定。
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
// ⚠ 方法学注意（T55 四轮新增）：cites 是「在 .board/**+docs/**+4 根文档中被提及的行数」，
//   而本台账自身就在这些文档里 ⇒ 本 agent 每写一次某文件，其 cites 就会 +1（自指效应）。
//   ⇒ cites 只可用于「是否被提及 / 相对多少」，**不可用于论证「引用强度」**；
//     顶回 1 引用的 cites=17 系裁决前时点值，裁决后已因本轮写作升至 24（同一文件，非新引用）。
const cites = new Map();
for (const n of names) cites.set(n, []);
for (const dl of docLines) {
  for (const n of names) {
    if (dl.line.includes(n)) cites.get(n).push(dl);
  }
}

// ---- 档位规则 ----
// D 档：结论已错/已作废 ∧ 无任何「把它当有效依据」的引用（主管 T55 四轮裁决 2）
//   粒度要求（裁决 3）：必须定位到 `文件:行` 或 `文件:§节`，并写明「文件其余部分不受牵连」。
const D_ENTRIES = [
  { n: 'exp_ru_recoverable.mjs', grain: '整文件', why: '任意位置子串匹配 ⇒ 86.7% 假天花板（真实 70.0%）' },
  { n: 'exp_ru_gap.mjs', grain: '整文件', why: '分类器不互斥（310+182≠492）' },
  { n: 'exp_ru_head_gap.mjs', grain: '整文件', why: '58.0% 把启发式上界当可达性 ⇒ 真上限 36.54% = 289/791' },
  { n: 'exp_v9_criterion_d.mjs', grain: ':97（EX_ALL 未经核证注入件）', why: '⚠ 其余部分被 BOARD.md:1949 引为「★★ 权威表」⇒ 不受牵连' },
  { n: 'probe_t15_reconcile_and_harm.mjs', grain: '§B（「96 词真误伤」）', why: '⚠ 其余各节未作废，不受牵连' },
];
const D_REGISTERED = new Set(D_ENTRIES.map((e) => e.n));
const D_GRAIN = new Map(D_ENTRIES.map((e) => [e.n, e]));

// 已消失的目标（文档声称保留但磁盘不存在；不是 D 档，只是留痕 —— 见 STRUCTURE.md §4.4）
const GONE = ['probe_sup_wal_snapshot.mjs'];

// A：委任书 §7 点名的活跃工具 + 门禁/发布路径直接依赖
const A_NAMED = new Set([
  'check_v10_ui_contract.mjs', 'audit_text_health.mjs',
  'fix_readme_l144_corruption.mjs', 'build_web_nospawn.mjs',
  'exp_ru_ceiling.mjs', // ★ 裁决 1 的解：名是 exp_*（形态 F）但角色是 A ⇒ A 优先于 F 后它正确留在 A
]);
// F 档（主管裁决 3 新增）：「实验台」= exp_* / apply_*（非 A 且非 D）
//   ⚠ 子标注（裁决 4）：apply_* **必须**标「不得重跑（已落库）」—— 该裁定本身即其落盘坐标。
const F_NO_RERUN = new Set(['apply_v9_morphemes.mjs', 'apply_v9_morphemes2.mjs']);

const INV = /作废|推翻|不成立|失效|错误结论|已被取代|不得引用|有缺陷/;

const buckets = { A: [], B: [], C: [], D: [], E: [], F: [], U: [] };
const invalidationHits = [];

for (const n of names) {
  const cl = cites.get(n) ?? [];
  const invLines = cl.filter((x) => INV.test(x.line));
  if (invLines.length) invalidationHits.push({ n, invLines });
}

// ★ 唯一分配：按 D > E > A > F > B > C 顺序「先命中先归类」
for (const n of names) {
  if (D_REGISTERED.has(n)) buckets.D.push(n);
  else if (n.startsWith('_tmp')) buckets.E.push(n);
  else if (A_NAMED.has(n)) buckets.A.push(n);
  else if (n.startsWith('exp_') || n.startsWith('apply_')) buckets.F.push(n);
  else if (n.startsWith('out_')) buckets.B.push(n);
  else if (n.startsWith('probe')) buckets.C.push(n);
  else buckets.U.push(n);
}

const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);
const covered = total - buckets.U.length;
console.log('=== scripts/ 已跟踪文件 =', tracked.length, '/ 分类合计 =', total);
console.log('=== 优先级 D > E > A > F > B > C（裁决 1）· 唯一分配');
console.log('=== MECE：A∪B∪C∪D∪E∪F 覆盖数 =', covered,
  ' ⇒ 未覆盖 U =', buckets.U.length, buckets.U.length === 0 ? '（✅ MECE 通过）' : '（⛔ 不通过）');
const parts = ['D', 'E', 'A', 'F', 'B', 'C'].map((k) => `${k} ${buckets[k].length}`);
console.log('=== 构成式（纪律「总数须附构成式」）：' + tracked.length + ' = ' + parts.join(' ＋ ')
  + (buckets.U.length ? ' ＋ U ' + buckets.U.length : ''));
for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'U']) {
  console.log(`[${k}] ${buckets[k].length}`);
}

const byCites = (list) => list.slice().sort((a, b) => (cites.get(b) ?? []).length - (cites.get(a) ?? []).length);

console.log('\n--- A 档（活跃工具/角色）---');
byCites(buckets.A).forEach((n) => console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length));

console.log('\n--- D 档（结论已错 · 粒度到行/节）---');
byCites(buckets.D).forEach((n) => {
  const e = D_GRAIN.get(n);
  console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length
    + '  粒度=' + e.grain + '\n      ' + e.why);
});

console.log('\n--- F 档（实验台 exp_*/apply_*）---');
byCites(buckets.F).forEach((n) => {
  const tag = F_NO_RERUN.has(n) ? '   ⚠ 不得重跑（已落库）' : '';
  console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length + tag);
});

console.log('\n--- B 档 (out_*) ---');
byCites(buckets.B).forEach((n) => console.log('  ' + n + '  cites=' + (cites.get(n) ?? []).length));

console.log('\n--- E 档 ---');
console.log('  数量 =', buckets.E.length);
buckets.E.forEach((n) => console.log('  ' + n));

console.log('\n--- 已消失的目标（文档称保留 / 磁盘不存在 · 留痕见 STRUCTURE.md §4.4）---');
const goneTracked = GONE.filter((n) => nameSet.has(n));
console.log('  清单 =', GONE.length, '个；其中仍被 git 跟踪 =', goneTracked.length,
  goneTracked.length === 0 ? '（✅ 均未跟踪且不存在）' : '（⛔ ' + goneTracked.join(',') + '）');

console.log('\n--- 零引用（在 .board/**+docs/**+4 根文档 中从未出现）---');
const zeroCite = names.filter((n) => (cites.get(n) ?? []).length === 0);
console.log('  数量 =', zeroCite.length);
zeroCite.forEach((n) => console.log('  ' + n));

console.log('\n--- ★ 被「作废/推翻/不成立」语境提及的脚本（候选，需人工判读）---');
console.log('    ⚠ 注意：含「推翻」字样者未必属 D —— 它们也可能是**做出推翻的一方**（反例 probe_t28_*/probe_t29_*/probe_sup_bolnoy_mincost.mjs，保持 C 档）。');
for (const h of invalidationHits) {
  console.log(`  ${h.n}  (${h.invLines.length} 条)`);
  for (const l of h.invLines.slice(0, 2)) {
    console.log(`      ${l.doc}:${l.ln}  ${l.line.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}
