// T62 主管侧 · 「零引用 52」全通道复核（只读）
//
// 存在理由：两份独立分析（主管 20 文档语料 · 结构 agent classify_mece.mjs）**都得 52 个零引用**，
// 但**两者的语料都不含 `packages/**`、`apps/**` 与 `scripts/**` 自身** ⇒ 共有同一盲点。
// 已实测反例：`probe_t42_wal_fixture*.mjs` 被 `packages/core/test/book_lang.mjs:131/:401/:1765`
// 逐名引用（夹具），却被两份分析同时判为「零引用」。
// ⇒ 本脚本用**补充语料**（测试 + 源码 + 脚本注释 + git log）重判这 52 个，查出哪些其实被引用。
//
// 运行：仓库根目录 `node .board/structure/recheck_zero_refs.mjs`
// 只读，不写任何文件（除 stdout）。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, '.board')) || !fs.existsSync(path.join(ROOT, 'scripts'))) {
  console.error('请在仓库根目录运行');
  process.exit(1);
}

// ---- classify_mece.mjs 的原始语料（复现其「零引用 52」）----
const origDocs = [];
for (const d of ['.board', '.board/roles']) {
  for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) origDocs.push(path.join(d, f));
}
for (const f of fs.readdirSync('docs')) if (f.endsWith('.md')) origDocs.push('docs/' + f);
for (const f of ['AGENTS.md', 'PROJECT_STRUCTURE.md', 'PROJECT_CHARTER.md', 'README.md']) {
  if (fs.existsSync(f)) origDocs.push(f);
}

// ---- 补充语料（这是两份分析都缺的）----
const extraFiles = [];
function walk(dir, skip) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.test(p)) walk(p, skip); }
    else if (/\.(mjs|js|ts|tsx|py|json)$/.test(e.name)) extraFiles.push(p.replace(/\\/g, '/'));
  }
}
const SKIP = /node_modules|(^|\/)dist(\/|$)|(^|\/)\.git(\/|$)|\.electron-cache|\.eb-cache|dist-release/;
walk('packages', SKIP);
walk('apps', SKIP);
walk('scripts', SKIP);

const readAll = (list) => {
  const out = [];
  for (const f of list) {
    try { out.push({ f, raw: fs.readFileSync(f, 'utf8') }); } catch { /* 跳过不可读 */ }
  }
  return out;
};

console.log(`原始语料（classify_mece 用）= ${origDocs.length} 文件`);
console.log(`补充语料（本次新增）       = ${extraFiles.length} 文件`);
console.log(`  （含 packages/** · apps/** · scripts/** 自身的源码与注释引用）`);
console.log('');

// git log 通道：所有 commit message（含被删除的历史）
let logText = '';
try { logText = execSync('git log --all --format=%B', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { /* 忽略 */ }

// 52 个原始「零引用」条目（由 classify_mece.mjs 输出固化，避免运行时再依赖它）
const ZERO52 = [
  'exp_d1_audit.mjs', 'exp_d1_set.mjs', 'exp_d1_verify5.mjs', 'exp_ru_ceiling_recon.mjs',
  'exp_ru_ending_gap.mjs', 'exp_ru_recon_lib.mjs', 'exp_ru_root_plan.mjs', 'exp_v9_criterion_c.mjs',
  'exp_v9_mechanism.mjs', 'exp_v9_mechanism2.mjs', 'exp_v9_mechanism3.mjs', 'exp_v9_mechanism4.mjs',
  'exp_v9_mechanism_recon.mjs', 'exp_v9_signature.mjs', 'out_ceiling_restored.txt', 'out_sup_hc.txt',
  'out_v9_admission_run.txt', 'out_v9_named.json', 'probe_d1_comment_audit.mjs', 'probe_sandbox_spawn.mjs',
  'probe_sup_etym_coverage.mjs', 'probe_sup_group75_members.mjs', 'probe_sup_hc_feasibility.mjs',
  'probe_sup_v98_caliber.mjs', 'probe_sup_v98_caliber2.mjs', 'probe_t15_d1_pattern.mjs',
  'probe_t15_d6_residual.mjs', 'probe_t15_denominator.mjs', 'probe_t15_denominator2.mjs',
  'probe_t15_denominator3.mjs', 'probe_t15_denominator4.mjs', 'probe_t15_denominator5.mjs',
  'probe_t15_denominator6.mjs', 'probe_t15_denominator7.mjs', 'probe_t15_discrepancy.mjs',
  'probe_t15_lang_exposure.mjs', 'probe_t15_samples.mjs', 'probe_t20_etym_dump.mjs',
  'probe_t28_dbstate.mjs', 'probe_t32_guard_dump.mjs', 'probe_t32_noi_audit.mjs',
  'probe_t32_noi_claims.mjs', 'probe_t32_noi_inflection.mjs', 'probe_t32_noi_newfp.mjs',
  'probe_t32_source_audit.mjs', 'probe_t32_source_etym.mjs', 'probe_t32_source_psl.mjs',
  'probe_t32_source_raw.mjs', 'probe_t32_source_template.mjs', 'probe_t32_v92_invariant.mjs',
  'probe_t42_wal_fixture2.mjs', 'probe_t42_wal_fixture3.mjs',
];

const extraCorpus = readAll(extraFiles);
const origCorpus = readAll(origDocs);

// ★★ 第二层盲点修正（2026-09-16 主管实测发现）：
// 本项目存在 **brace 形式的声明式引用** —— `packages/core/test/book_lang.mjs:131` 写作
//   `scripts/probe_t42_wal_fixture{,2,3}.mjs`
// ⇒ **字面量 `probe_t42_wal_fixture2.mjs` 在该文件中根本不存在**（实测 `.Contains(...)` = False），
//   任何「字符串包含」匹配都抓不到它。这类文件因此会**同时骗过我最初的 20 文档普查与
//   结构 agent 的 classify_mece.mjs**，被误判为零引用 ⇒ 有被误删的真实风险。
// ⇒ 判据必须同时做 **brace 展开匹配**：把语料里的 `xxx{,A,B}.mjs` 视作同时引用了
//   `xxx.mjs` / `xxxA.mjs` / `xxxB.mjs`。
const bracePatterns = (raw) => {
  const out = new Set();
  for (const m of raw.matchAll(/([A-Za-z0-9_\-./]*?)\{([^{}]{1,80})\}([A-Za-z0-9_\-./]*)/g)) {
    const [, pre, inner, post] = m;
    for (const part of inner.split(',')) out.add(pre + part.trim() + post);
  }
  return out;
};
const extraBrace = extraCorpus.map(({ f, raw }) => ({ f, names: bracePatterns(raw) }));

// ★★ 第二处实测缺陷修正（2026-09-16）：`walk()` 写入 `extraFiles` 时未 normalize，
// 而 `readAll()` 用的是未处理的 `extraFiles`（**含反斜杠**）⇒ 下面所有 `f.endsWith('/'+n)`
// 之类的正斜杠比较对 `packages/`、`apps/` 下的文件**全部失效**（只有 `scripts/` 因
// `walk('scripts')` 的前缀恰好是正斜杠才碰巧正确）。
// 实证后果：`packages/core/test/ru_morph_v090_guard.mjs:391` 明确写着
//   「由 T32 独立发现（scripts/probe_t32_noi_audit.mjs）」
// 却因其两条匹配逻辑同时失效而被**漏报为「真候选」** ⇒ 差一点被误删。
// ⇒ 一切路径比较前**必须先 normalize 成正斜杠**。
const norm = (s) => s.replace(/\\/g, '/');
const extraCorpusN = extraCorpus.map(({ f, raw }) => ({ f: norm(f), raw }));
const extraBraceN = extraBrace.map(({ f, names }) => ({ f: norm(f), names }));
const isSelf = (f, n) => f === 'scripts/' + n || f.endsWith('/' + n);

// 逐个重判。注意：跳过「自身文件」——脚本注释里常写自己的名字，那不算被引用。
const rescued = [];   // 补充语料里被引用 ⇒ 不可按零引用删
const stillZero = []; // 补充语料里也查不到
for (const n of ZERO52) {
  const hits = [];
  for (const { f, raw } of extraCorpusN) {
    if (isSelf(f, n)) continue; // 自身
    if (raw.includes(n)) hits.push(f);
  }
  // 补：brace 展开命中
  for (const { f, names } of extraBraceN) {
    if (isSelf(f, n)) continue;
    for (const nm of names) {
      if (nm.endsWith(n) || nm.endsWith('/' + n)) {
        if (!hits.includes(f)) hits.push(f + '  〔brace 展开〕');
        break;
      }
    }
  }
  if (hits.length) rescued.push({ n, hits });
  else stillZero.push(n);
}

console.log(`=== ① 补充语料（packages/apps/scripts 源码与注释）命中 ===`);
if (!rescued.length) console.log('  （无）');
for (const { n, hits } of rescued) {
  console.log(`  ${n}`);
  for (const h of hits.slice(0, 6)) console.log(`      ← ${h}`);
  if (hits.length > 6) console.log(`      … 共 ${hits.length} 处`);
}
console.log('');

console.log(`=== ② git log --all（所有 commit message）命中 ===`);
const logHit = [];
for (const n of stillZero) {
  if (logText.includes(n)) logHit.push(n);
}
if (!logHit.length) console.log('  （无）');
for (const n of logHit) {
  const k = logText.indexOf(n);
  const ctx = logText.slice(Math.max(0, k - 60), k + n.length + 60).replace(/\s+/g, ' ');
  console.log(`  ${n}\n      ← …${ctx}…`);
}
console.log('');

console.log(`=== ③ 汇总 ===`);
console.log(`  原始判定「零引用」      = ${ZERO52.length}`);
console.log(`  补充语料救回（==有引用） = ${rescued.length}`);
console.log(`  git log 另有提及        = ${logHit.length}`);
console.log(`  ★ 四通道全零（真候选）   = ${stillZero.filter((n) => !logHit.includes(n)).length}`);
console.log('');
console.log(`  真候选名单（四通道全零，仍须过 Ⅰ 档「一次性取证已消费 + 非夹具/非台账」判据）：`);
for (const n of stillZero.filter((x) => !logHit.includes(x))) console.log(`    ${n}`);
console.log('');
console.log(`  仅 git log 提及（不计入真候选，须人工判读）：`);
for (const n of logHit) console.log(`    ${n}`);
