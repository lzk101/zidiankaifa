// agents_audit.mjs — agent 登记册信息保全自检（只读，须在仓库根运行）
//
// 用途：`.board/agents.md` 压缩/重写后，机械核验「零信息丢失」——
//   ① 13 个 UUID 席位逐个 .Contains()；② 关键结论/裁决落盘坐标/产物路径/精确数值 逐条 .Contains()；
//   ③ 重复率（同一结论被复述 N 次 ⇒ 口径陷阱复发）；④ 换行符行数。
// 用法：
//   node .board/structure/agents_audit.mjs [目标文件，默认 .board/agents.md]
// 退出码：0 = 全部命中；1 = 有缺失（逐条打印）+ 仅用于对照的重复项不判失败。
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── ① 13 个 UUID 席位（＋主 agent 无 id ⇒ 物理席位 14）──────────────────────────
const SEATS = [
  ['受保护 · 需求', '4ce66e63-8f5f-4b15-8203-c23b3dccce6f'],
  ['受保护 · 开发', '6c6cedb8-f03d-49d3-ab1a-c1aa2d9dc62c'],
  ['受保护 · 测试', '7ff57407-f229-40e9-ba31-3d3e58b9655b'],
  ['结构常驻（前任）', '2d4ba4d0-64b5-4449-a295-66c327942977'],
  ['临时 d1 · fa74d552', 'fa74d552-876e-4f94-b7c5-cf5af79bb297'],
  ['临时 d1 · bb19ba01', 'bb19ba01-5ddb-46f4-a093-f21b2b7bc7f8'],
  ['临时 d1 · 843b7bf5', '843b7bf5-6f12-44f4-b51a-9b87c4037bdd'],
  ['临时 d1 · 6e6acfbe', '6e6acfbe-4056-4d89-87ed-2857d3b50a5e'],
  ['临时 d1 · 18a79f6a', '18a79f6a-d575-48eb-932e-23bb90cc77e4'],
  ['临时 d1 · 3d2dc17e', '3d2dc17e-ac96-4d93-83a0-48bb24fa3ad3'],
  ['临时 d1 · 6b08a4c5', '6b08a4c5-d52d-46ae-8812-910498a18076'],
  ['临时 d2 · batch A', '9db3c4d0-f68d-4f1d-b579-8e1cfed96cdf'],
  ['临时 d2 · batch B', '0f53feaa-6945-4c5f-bdda-b3ab87621256'],
];

// ── ② 关键信息清单（结论 / 裁决落盘坐标 / 产物路径 / 精确数值 / 判据）──────────
const FACTS = [
  // 结论与口径
  ['总数口径终局（物理）', '14'],
  ['构成式（受保护4+结构1+临时9）', '受保护 4 ＋ 结构 1 ＋ 临时 9'],
  ['业务口径 13 的构成式', '受保护 4 ＋ 临时 9'],
  ['常驻合计 5 改述', '常驻合计恒为 5'],
  ['可回收 7', '可回收 7'],
  ['异常·未落盘 2', '异常 · 未落盘'],
  ['不判定＝未落盘同集', '不判定'],
  ['并入会把 7 虚报为 9', '虚报为 9'],
  ['两孙代理终局定性', '已沉没的子任务 · 证据未固化 · 与 `EVIDENCE.md` §41.5 重复'],
  ['归属存疑异常类', '归属存疑'],
  ['关键词≠未落盘 教训', '关键词'],
  ['语义通道补救', '语义通道'],
  ['同文件 5 次串行派单', '串行'],
  ['ready 不代表完成度', 'ready'],
  ['无删除 API / 三通道', 'interrupt_agent'],
  ['禁止把标记写成已删除', '已删除'],
  ['label 只读规则', '只读'],
  // 裁决落盘坐标
  ['裁决 A 坐标', '§11.9'],
  ['裁决 B 坐标', '§11.9'],
  ['裁决 E 坐标', '§11.10'],
  ['裁决 G 坐标', '§11.10'],
  ['终局裁定 D 坐标', '§11.11'],
  ['BASELINE 落盘坐标', 'BASELINE.md'],
  ['interrupt = 0 次', '`interrupt` = 0 次'],
  ['主管裁决提交', '2a796c9'],
  // depth1 七行产物（逐条）
  ['fa74d552 产物 1', 'scripts/exp_v9_admission.mjs'],
  ['fa74d552 产物 2', 'scripts/out_v9_admission.json'],
  ['fa74d552 精确字节', '639,777'],
  ['fa74d552 错标留痕 611 KB', '611 KB'],
  ['fa74d552 EVIDENCE §41', '§41'],
  ['fa74d552 §41 起行', ':1440'],
  ['bb19ba01 门禁产物', 'packages/core/test/ru_morph_d1guard.mjs'],
  ['bb19ba01 断言数', '26/0'],
  ['bb19ba01 探针 1', 'scripts/probe_t18_d1guard_baseline.mjs'],
  ['bb19ba01 探针 2', 'scripts/probe_t18_guard_power.mjs'],
  ['bb19ba01 逐名指认行', 'EVIDENCE.md:1253-1254'],
  ['bb19ba01 §40 范围', ':1248-1439'],
  ['bb19ba01 提交', '99c9992'],
  ['843b7bf5 夹具 (brace 写法留痕)', 'probe_t42_wal_fixture'],
  ['6e6acfbe 夹具 1', 'probe_t46_variant.mjs'],
  ['6e6acfbe 夹具 2', 'probe_t46_backup_fail.mjs'],
  ['6e6acfbe 夹具 3', 'probe_t46_postcheck.mjs'],
  ['共同产出文件', 'packages/core/test/book_lang.mjs'],
  ['18a79f6a 订正后行号', 'REQ.md:1291'],
  ['18a79f6a 异议行号', ':1314'],
  ['18a79f6a 原始错标', ':816-847'],
  ['18a79f6a 决策', 'DEC-026'],
  ['18a79f6a 决策行', ':559'],
  ['3d2dc17e 夹具', 'probe_t50_reuse_edges.mjs'],
  ['3d2dc17e 断言标签', 'A33'],
  ['6b08a4c5 断言标签', 'REUSE_LOG_RE'],
  ['6b08a4c5 断言标签 2', 'A28c'],
  ['6b08a4c5 发布提交', '041c6e7'],
  ['6b08a4c5 版本', 'v0.10.0'],
  // depth2 查证与结案
  ['第五通道（决定性）', 'EVIDENCE.md:1541'],
  ['§41.5 标题', '41.5 逐条候选审定表'],
  ['§41.5 表体范围', ':1548-1558'],
  ['四通道 ①', 'batch'],
  ['四通道 ②', '549,597'],
  ['四通道产物字节', '639,777 B（624.8 KiB）'],
  // 前任/本轮身份事实
  ['前任 corrupt', 'corrupt'],
  ['结构 agent 自身不计入临时', '不计入'],
  ['篡改留痕：主管多减 1', '多减 1'],
  ['label 原话 · 开发', '开发 agent 启动+可达性判别'],
  ['label 原话 · 测试', '测试 agent 启动+判别集'],
  ['label 原话 · 需求', '需求管理 agent 启动'],
  ['label 原话 · 结构', '结构管理 agent 常驻角色'],
];

// ── ②b 本轮新增事实（旧册没有，新册必须有；不参与「零信息丢失」基线）─────────────
const NEW_FACTS = [
  ['前任 corrupt', 'corrupt'],
  ['接任者会话 id', 'bb9e0148-3e78-4d58-b5ce-700fce51fd48'],
  ['临时 agent 准入纪律节', '准入'],
  ['必填登记项 · 预期产出落盘路径', '预期产出落盘路径'],
  ['结案须指 git ls-files 路径', 'git ls-files'],
  ['结构 agent 交接记录节', '交接记录'],
  // ── T62-C 新增（主管裁决落地）──
  ['接任者 id 已补登', 'bb9e0148'],
  ['结构席位恒为 2', '结构席位恒为 2'],
  ['裁决式照录（末项 临时 8）', '受保护 4 ＋ 结构 2 ＋ 临时 8'],
  ['T55 镜像值留痕（结构 1 / 临时 9）', '受保护 4 ＋ 结构 1 ＋ 临时 9'],
  ['主管快照 children 实测', 'children'],
  ['主管快照 descendants 实测', 'descendants'],
  ['末项口径提请复核', '提请复核'],
  ['HEAD 更新 d529b48', 'd529b48'],
  ['根因修复提交 2c908e8', '2c908e8'],
  ['红态留证分支坐标', 'book_lang.mjs:1786-1789'],
  ['红态保留取证语义', '红态保留取证'],
  ['V11-OPENDB-LEAK', 'V11-OPENDB-LEAK'],
];

// ── ③ 口径重复率监控（同一结论复述次数，压缩后应显著下降）──────────────────────
// 判据说明：直接数「13」「14」会把「§14 委任书」「13 个 UUID」等无关命中算进来 ⇒
// 只数【争议口径句本身】。旧册在这 4 个模式上是 §4/§7 反复复述的重灾区。
const REPEAT_WATCH = [
  ['争议口径句「总数/口径/业务侧 13」', /(总数|口径|业务侧|业务口径)[^\n]{0,4}13/g],
  ['已被推翻的算术「不判定 3」', /不判定\s*3/g],
  ['旧值复述「临时 10 / 临时 8」', /临时\s*(10|8)\b/g],
  ['旧值复述「缺 1 行 / 多减 1」', /(缺\s*1\s*行|多减\s*1)/g],
];

function countLines(text) {
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

const target = resolve(process.argv[2] ?? '.board/agents.md');
if (!existsSync(target)) {
  console.error(`✗ 目标不存在：${target}`);
  process.exit(1);
}
const text = readFileSync(target, 'utf8');
const lines = countLines(text);

let missing = 0;
const misses = [];

console.log(`目标：${target}`);
console.log(`行数（换行符计数）：${lines}`);
console.log(`\n── ① 13 个 UUID 席位逐条 .Contains() ──`);
for (const [label, id] of SEATS) {
  const hit = text.includes(id);
  if (!hit) { missing += 1; misses.push(`${label} → ${id}`); }
  console.log(`${hit ? '✓' : '✗'} ${label.padEnd(18)} ${id}`);
}

console.log(`\n── ② 关键信息清单逐条 .Contains() ──`);
for (const [label, needle] of FACTS) {
  const hit = text.includes(needle);
  if (!hit) { missing += 1; misses.push(`${label} → "${needle}"`); }
  console.log(`${hit ? '✓' : '✗'} ${label.padEnd(32)} ${needle}`);
}

console.log(`\n── ②b 本轮新增事实（旧册无、新册须有）──`);
for (const [label, needle] of NEW_FACTS) {
  const hit = text.includes(needle);
  if (!hit) { missing += 1; misses.push(`[新增] ${label} → "${needle}"`); }
  console.log(`${hit ? '✓' : '✗'} ${label.padEnd(32)} ${needle}`);
}

console.log(`\n── ③ 口径复述次数（仅供对照，不判失败；旧册 = 13:15 · 不判定:11 · 未落盘:26 · 可回收:30 · 14:27）──`);
for (const [label, re] of REPEAT_WATCH) {
  console.log(`   ${label.padEnd(24)} ${(text.match(re) ?? []).length} 次`);
}

console.log(`\n────────────────────────────────────────`);
if (missing === 0) {
  console.log(`✅ 全部命中：UUID 13/13 ＋ 保全清单 ${FACTS.length}/${FACTS.length} ＋ 新增事实 ${NEW_FACTS.length}/${NEW_FACTS.length}（无缺失）`);
  process.exit(0);
}
console.log(`❌ 缺失 ${missing} 项：`);
for (const m of misses) console.log(`   - ${m}`);
process.exit(1);
