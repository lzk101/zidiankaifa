/**
 * 只读探针（功能测试 agent · T17）：核实主管裁决八 V9-2 词表里的 6 个点名词。
 * 主管列表：однако сучить сучение сучильный вдавлина сдаигаться
 * 后两个疑似拼写有误，逐词实测其是否存在于词库、是否属放行组、首片段是什么。
 * 用法：node scripts/probe_t17_v92_words.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as prod from '../packages/core/dist/db/index.js';
import * as pre from './_tmp/prefix_engine/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
const RU1 = new Set(['в', 'о', 'с', 'у']);

const LIST = ['однако', 'сучить', 'сучение', 'сучильный', 'вдавлина', 'сдаигаться'];
// 备选拼写（若上面不存在，试这些）
const ALT = ['вдавливание', 'вдавить', 'сдаиваться', 'сдаивать', 'сдвигаться', 'сдаивание', 'вдалбливать'];

const inLib = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND word = ?`);
const bd = (mod, w) => {
  try {
    return mod.breakdownWord(db, w, 'ru') ?? [];
  } catch (e) {
    return [`<ERR ${e.message}>`];
  }
};
const fmt = (p) => JSON.stringify(p.map((x) => `${x.morpheme}@${x.start}-${x.end}`));

console.log('='.repeat(84));
console.log('A. 主管 V9-2 词表逐词实测');
console.log('='.repeat(84));
for (const w of LIST) {
  const n = inLib.get(w).n;
  const p = bd(prod, w);
  const gap = p.length && p[0].start >= 1 ? norm(w).slice(0, p[0].start) : null;
  const inGroup = p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0]);
  console.log(
    `  ${w.padEnd(14)} 库内${n ? '有' : '**无**'}  输出=${p.length ? fmt(p) : '[]'}` +
      `  ${gap !== null ? `gap='${gap}'` : ''}  放行组=${inGroup ? '是' : '否'}`,
  );
}

console.log('\n' + '='.repeat(84));
console.log('B. 疑似拼写有误词的备选拼写');
console.log('='.repeat(84));
for (const w of ALT) {
  const n = inLib.get(w).n;
  if (!n) {
    console.log(`  ${w.padEnd(14)} 库内**无**`);
    continue;
  }
  const p = bd(prod, w);
  const after = norm(w).slice(1);
  console.log(`  ${w.padEnd(14)} 库内有  输出=${p.length ? fmt(p) : '[]'}  去首字母后='${after}'`);
}

console.log('\n' + '='.repeat(84));
console.log('C. 放行组 75 词全名单（供 V9-2 引用，按首片段分组）');
console.log('='.repeat(84));
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const grp = {};
for (const w of ALL) {
  const p = bd(pre, w);
  if (!(p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0]))) continue;
  const q = bd(prod, w);
  if (!q.length) continue;
  const head = q[0].morpheme;
  (grp[head] ??= []).push(w);
}
for (const [head, ws] of Object.entries(grp).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${head.padEnd(6)} ×${String(ws.length).padStart(2)} : ${ws.join(' ')}`);
}

db.close();
