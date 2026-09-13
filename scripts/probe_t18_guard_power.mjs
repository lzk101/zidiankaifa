/**
 * probe_t18_guard_power.mjs —— T18 判别实验：证明 `ru_morph_d1guard.mjs` 的**双向鉴别力**
 *
 * 为什么必须做：一个从未被观察到「报红」的守卫是**未经验证**的。本探针用
 * **临时副本 + 文本级变体**（`packages/core/src/**` 一字不改，工作区零污染）构造三种错误实现，
 * 复跑**守卫自身的同一份度量与判据代码**（`measureAll` / `evaluate` 直接 import），
 * 逐一确认对应的断言确实报警。
 *
 * 变体（全部只改副本）：
 *   V-PRE    回退版：`parts[0].start >= 1` → `>= 2`（重演 D1 缺陷，方向 A）
 *   V-OVER   修过头：`const explained = all.some(...)` → `false`（无条件禁止 gap≥1，方向 B）
 *   V-PART   部分修过头：`explained = all.some(...) && gap !== 'у'`（只禁一个字母）
 *
 * 只读主库、只写临时副本、结束自清理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { measureAll, evaluate, DB_PATH } from '../packages/core/test/ru_morph_d1guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '_tmp_t18');
const SRC_DIST = path.join(__dirname, '..', 'packages', 'core', 'dist');

console.log('='.repeat(96));
console.log('T18 判别实验：守卫双向鉴别力（临时副本变体，src 一字不改）');
console.log('='.repeat(96));

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.cpSync(SRC_DIST, path.join(TMP, 'dist'), { recursive: true });

const target = path.join(TMP, 'dist', 'db', 'index.js');
const orig = fs.readFileSync(target, 'utf8');

const GATE = 'parts[0].start >= 1';
const EXPLAINED = 'const explained = all.some((x) => x.m.kind === \'prefix\' && x.stem === gap);';
console.log(`锚点 1（gate）出现次数：${orig.split(GATE).length - 1}`);
console.log(`锚点 2（explained）出现次数：${orig.split(EXPLAINED).length - 1}`);
if (orig.split(GATE).length - 1 !== 1 || orig.split(EXPLAINED).length - 1 !== 1) {
  console.error('❌ 锚点不唯一 —— 中止（避免改错位置）');
  process.exit(1);
}

const VARIANTS = [
  { id: 'V-PROD', desc: '生产实现（对照）', text: orig },
  { id: 'V-PRE', desc: '回退：gap 关卡门槛 >= 1 → >= 2（重演 D1）', text: orig.replace(GATE, 'parts[0].start >= 2') },
  { id: 'V-OVER', desc: '修过头：explained 恒 false（无条件禁止 gap>=1）', text: orig.replace(EXPLAINED, 'const explained = false;') },
  {
    id: 'V-PART',
    desc: "部分修过头：explained 额外排除 gap==='у'（只禁一个字母）",
    text: orig.replace(EXPLAINED, "const explained = all.some((x) => x.m.kind === 'prefix' && x.stem === gap) && gap !== 'у';"),
  },
];

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const rows = [];

try {
  for (const v of VARIANTS) {
    const dir = path.join(TMP, v.id);
    fs.cpSync(path.join(TMP, 'dist'), path.join(dir, 'dist'), { recursive: true });
    const f = path.join(dir, 'dist', 'db', 'index.js');
    fs.writeFileSync(f, v.text);
    const mod = await import(pathToFileURL(f).href);
    const m = measureAll(db, mod.breakdownWord);
    const results = evaluate(m);
    const failed = results.filter((r) => !r.pass);
    rows.push({ v, m, results, failed });
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

/* ---------------- 度量对照表 ---------------- */
console.log('\n【度量对照】（全部为**守卫同一份度量代码**的输出）\n');
const head = ['变体', '可拆', 'D1', 'gap1总', '真前缀组', 'да-核心', 'R 可拆', 'R 率', '失败断言'];
console.log(head.map((h, i) => h.padEnd(i === 0 ? 10 : 12)).join(''));
for (const { v, m, failed } of rows) {
  console.log(
    [
      v.id.padEnd(10),
      String(m.breakable).padEnd(12),
      String(m.d1).padEnd(12),
      String(m.gap1Total).padEnd(12),
      String(m.gap1InPrefix).padEnd(12),
      String(m.daCore).padEnd(12),
      `${m.rNonEmpty}/${m.R.length}`.padEnd(12),
      `${((m.rNonEmpty / m.R.length) * 100).toFixed(2)}%`.padEnd(12),
      String(failed.length).padEnd(12),
    ].join(''),
  );
}

/* ---------------- 逐变体断言明细 ---------------- */
for (const { v, m, failed } of rows) {
  console.log(`\n--- ${v.id}：${v.desc}`);
  console.log(`    退出码将是 ${failed.length ? 1 : 0}（失败 ${failed.length} / 共 ${rows[0].results.length}）`);
  for (const f of failed) console.log(`    ✗ ${f.name}${f.detail ? `  —— ${f.detail}` : ''}`);
  if (v.id === 'V-PRE') {
    console.log(`    D1 词样本（前 10）：${m.d1Words.slice(0, 10).join(', ')}`);
    console.log(`    ⇒ 方向 A（回退）被 §1 主断言拦住`);
  }
  if (v.id === 'V-OVER') console.log(`    ⇒ 方向 B（修过头）被 §2 哨兵与 §3 地板拦住（D1 计数仍为 0，单靠计数完全拦不住）`);
  if (v.id === 'V-PART') console.log(`    ⇒ 部分修过头被四字母哨兵 ${"'" + 'у' + "'"} 与 да- 核心地板拦住`);
}

/* ---------------- 结论 ---------------- */
const prod = rows.find((r) => r.v.id === 'V-PROD');
const pre = rows.find((r) => r.v.id === 'V-PRE');
const over = rows.find((r) => r.v.id === 'V-OVER');
const part = rows.find((r) => r.v.id === 'V-PART');
console.log('\n' + '='.repeat(96));
console.log('判别结论');
console.log(`  V-PROD 生产：${prod.failed.length === 0 ? '✅ 全绿' : `❌ ${prod.failed.length} 红`}（应全绿）`);
console.log(
  `  V-PRE  回退：D1 ${pre.m.d1} > 0 ⇒ ${pre.failed.length} 条红 ${pre.failed.length ? '✅ 能拦住' : '❌ 拦不住'}` +
    `（若为 0 红则守卫对方向 A 无效）`,
);
console.log(
  `  V-OVER 修过头：D1 仍为 ${over.m.d1}（计数型断言**看不到**）但 ${over.failed.length} 条红 ${over.failed.length ? '✅ 能拦住' : '❌ 拦不住'}`,
);
console.log(
  `  V-PART 部分修过头：D1 ${part.m.d1} · 真前缀组 ${part.m.gap1InPrefix} ⇒ ${part.failed.length} 条红 ${part.failed.length ? '✅ 能拦住' : '❌ 拦不住'}`,
);
const bi = pre.failed.length > 0 && over.failed.length > 0 && prod.failed.length === 0;
console.log(`\n★ 双向鉴别力：${bi ? '✅ 成立（方向 A 与方向 B 均被拦住，生产全绿）' : '❌ 不成立'}`);
console.log('='.repeat(96));

db.close();
process.exit(bi ? 0 : 1);
