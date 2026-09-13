// scripts/probe_t60_rm_forensics.mjs —— 只读诊断（T60）
// 目的：定位 `packages/core/test/book_lang.mjs` 收尾 `fs.rmSync(RUN)` 报 EPERM 的**真正被锁条目**。
// 判据（Windows）：SQLite 打开文件时不带 FILE_SHARE_DELETE ⇒ 有活动句柄的条目**不能改名/删除**；
//   而普通 `open('r+')` 仍会成功 ⇒ 用 rename 而不是 open 做锁探测。
// 用法：node scripts/probe_t60_rm_forensics.mjs [runDir]
//   不给参数 = 扫描 scripts/_tmp/booklang_tmp 下全部 run-*（最新在后）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const TMP_ROOT = path.join(REPO, 'scripts', '_tmp', 'booklang_tmp');

function listRuns() {
  if (!fs.existsSync(TMP_ROOT)) return [];
  return fs
    .readdirSync(TMP_ROOT)
    .filter((n) => n.startsWith('run-'))
    .sort()
    .map((n) => path.join(TMP_ROOT, n));
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push({ p, dir: e.isDirectory() });
    if (e.isDirectory()) walk(p, out);
  }
  return out;
}

const arg = process.argv[2];
const runs = arg ? [arg] : listRuns();
console.log(`[probe] TMP_ROOT = ${TMP_ROOT} (exists=${fs.existsSync(TMP_ROOT)})`);
console.log(`[probe] 待检 run 目录数 = ${runs.length}`);
for (const r of runs) console.log(`  - ${path.basename(r)}`);

for (const run of runs) {
  console.log('\n' + '='.repeat(78));
  console.log(`[probe] 目标: ${run}`);
  const entries = walk(run);
  const files = entries.filter((e) => !e.dir);
  const bytes = files.reduce((s, e) => s + fs.statSync(e.p).size, 0);
  console.log(`[probe] 文件 ${files.length} 个 / ${bytes} B · 子目录 ${entries.length - files.length} 个`);
  for (const e of entries) {
    const rel = path.relative(run, e.p);
    console.log(`   ${e.dir ? 'DIR ' : 'FILE'} ${rel}${e.dir ? '' : ` (${fs.statSync(e.p).size})`}`);
  }

  // ① 整体删除（与测试文件收尾同一条语句）
  let rmErr = null;
  try {
    fs.rmSync(run, { recursive: true, force: true });
  } catch (e) {
    rmErr = e;
  }
  console.log(
    `[probe] ① fs.rmSync(recursive,force) => ${rmErr ? `FAIL ${rmErr.code} :: ${rmErr.message}` : 'OK（已删除）'}`,
  );
  if (!rmErr) continue;

  // ② 逐文件 rename 探测（非破坏性）
  const still = walk(run).filter((e) => !e.dir);
  const locked = [];
  for (const e of still) {
    const t = `${e.p}.lktest`;
    try {
      fs.renameSync(e.p, t);
      fs.renameSync(t, e.p);
    } catch (err) {
      locked.push({ rel: path.relative(run, e.p), code: err.code, msg: err.message });
    }
  }
  console.log(`[probe] ② rename 锁探测: 被锁 ${locked.length} / 共 ${still.length}`);
  for (const l of locked) console.log(`     LOCKED ${l.rel} :: ${l.code} :: ${l.msg}`);

  // ③ 目录级 rename 探测（父目录能否整体改名 = 有无子句柄）
  try {
    fs.renameSync(run, `${run}.lktest`);
    fs.renameSync(`${run}.lktest`, run);
    console.log('[probe] ③ 目录整体 rename => OK（无子句柄）');
  } catch (err) {
    console.log(`[probe] ③ 目录整体 rename => ${err.code} :: ${err.message}`);
  }

  // ④ 延迟重试（判别「句柄未释放」vs「Windows 延迟释放」）
  for (let i = 1; i <= 3; i++) {
    await new Promise((r) => setTimeout(r, 250 * i));
    try {
      fs.rmSync(run, { recursive: true, force: true });
      console.log(`[probe] ④ 第 ${i} 次延迟重试 => OK（累计等待 ${250 * ((i * (i + 1)) / 2)} ms）`);
      break;
    } catch (e) {
      console.log(`[probe] ④ 第 ${i} 次延迟重试 => ${e.code}`);
    }
  }
  console.log(`[probe] ⑤ 最终残留存在 = ${fs.existsSync(run)}`);
}
console.log('\n[probe] 结束');
