// scripts/probe_t60_handle_hook.mjs —— 预加载钩子（`node --import`），**不修改被测文件**
// 目的：在 book_lang.mjs 自己的进程内回答两个问题
//   ① 哪些 SQLite 连接在收尾时**还没 close**（并打印它们的创建/使用位置）
//   ② run-* 目录里到底哪个条目被锁（rename 探测，Windows 下带活动句柄的条目不能改名）
//   ③ 关掉泄漏句柄后能否删除（= 修复方向的可执行证明）
import fs from 'node:fs';
import path from 'node:path';
import * as sqliteMod from 'node:sqlite';

const registry = [];
const seen = new WeakSet();
function reg(db, how) {
  if (seen.has(db)) return;
  seen.add(db);
  let file = null;
  try {
    file = typeof db.location === 'function' ? db.location() : null;
  } catch {
    /* ignore */
  }
  registry.push({
    db,
    file,
    how,
    closed: false,
    closeAttempts: 0,
    closeErr: null,
    site: new Error('site').stack.split('\n').slice(2, 5).map((s) => s.trim()).join(' <- '),
  });
}

const P = sqliteMod.DatabaseSync.prototype;
for (const m of ['exec', 'prepare', 'close']) {
  const orig = P[m];
  if (typeof orig !== 'function') continue;
  P[m] = function patched(...args) {
    if (m === 'close') {
      reg(this, 'close');
      const r = registry.find((x) => x.db === this);
      if (r) r.closeAttempts += 1;
      try {
        const out = orig.apply(this, args);
        if (r) r.closed = true; // ★ 只有真正成功才算已关（原钩子在「调用即算」上会掩盖抛异常）
        return out;
      } catch (e) {
        if (r) r.closeErr = `${e.code || 'ERR'} :: ${e.message}`;
        throw e;
      }
    }
    reg(this, m);
    return orig.apply(this, args);
  };
}

function walk(dir, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    out.push({ p, dir: e.isDirectory() });
    if (e.isDirectory()) walk(p, out);
  }
  return out;
}

function renameProbe(root) {
  const locked = [];
  const all = walk(root).sort((a, b) => b.p.length - a.p.length); // 最深优先
  for (const e of all) {
    const t = `${e.p}.lktest`;
    try {
      fs.renameSync(e.p, t);
      fs.renameSync(t, e.p);
    } catch (err) {
      locked.push(`${path.relative(root, e.p)} :: ${err.code}`);
    }
  }
  return { locked, total: all.length };
}

const origRm = fs.rmSync;
fs.rmSync = function patchedRm(p, opts) {
  if (opts && opts.recursive && typeof p === 'string' && path.basename(p).startsWith('run-')) {
    console.log('\n' + '#'.repeat(78));
    console.log(`[hook] 拦截 fs.rmSync(${path.basename(p)}, {recursive:true,force:true})`);
    const leaked = registry.filter((r) => !r.closed);
    console.log(`[hook] 注册连接 ${registry.length} 个 · **仍未关闭 ${leaked.length} 个**`);
    for (const l of leaked) {
      console.log(
        `[hook]   LEAK file=${l.file}\n[hook]        close 调用次数=${l.closeAttempts} · close 抛错=${l.closeErr ?? '（从未调用）'}\n[hook]        site=${l.site}`,
      );
    }
    console.log(`[hook] （对照）已成功 close ${registry.filter((r) => r.closed).length} 个`);

    const r1 = renameProbe(p);
    console.log(`[hook] ① 关句柄前 rename 探测：被锁 ${r1.locked.length} / ${r1.total}`);
    for (const l of r1.locked) console.log(`[hook]    LOCKED ${l}`);

    let fixed = 0;
    for (const l of leaked) {
      try {
        l.db.close();
        l.closed = true;
        fixed += 1;
      } catch (e) {
        console.log(`[hook]   补 close 失败 file=${l.file} :: ${e.code || e.message}`);
      }
    }
    console.log(`[hook] ② 补 close 泄漏句柄：成功 ${fixed} / ${leaked.length}`);

    const r2 = renameProbe(p);
    console.log(`[hook] ③ 补 close 后 rename 探测：被锁 ${r2.locked.length} / ${r2.total}`);
    for (const l of r2.locked) console.log(`[hook]    STILL-LOCKED ${l}`);
    console.log('#'.repeat(78) + '\n');
  }
  return origRm.call(fs, p, opts);
};
