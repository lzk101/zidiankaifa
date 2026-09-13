/**
 * ★用户可见影响评估（只读，不改任何被测文件）
 *
 * 背景：功能测试 agent 发现 D1 —— 词首 gap=1 的假词根（плескание→лес-「森林」）。
 * 其测试脚本 ru_morph_defects.mjs 是"期望它修好"的红灯清单（10 条失败）。
 * 作为主管，我需要独立确认这些缺陷对**用户可见功能**（词族关联 relatedByMorpheme）的影响面，
 * 以决定 D1 是否必须进入本迭代范围。
 *
 * 做法：不修改测试脚本，而是在本脚本内重新实现同样的探测：
 *   ① 复核 D1 的 7 个词在当前实现下的实际输出
 *   ② 统计这类"词首 1 字符 + 假词根"模式的规模（全库 87,443 俄语词条）
 *   ③ 评估词族关联污染的用户可见后果
 *
 * 用法：node scripts/probe_ru_gap_audit2.mjs 的姊妹脚本 → node scripts/probe_ru_d1_impact.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

console.log('='.repeat(82));
console.log('★主管独立复核 D1：词首 gap=1 假词根的影响面');
console.log('='.repeat(82));

// ---- ① 复核 D1 的 7 个词 ----
const d1 = [
  ['плескание', '溅水', 'лес-', '森林'],
  ['хлестаться', '抽打', 'лес-', '森林'],
  ['зверство', '暴行', 'вер-', '相信'],
  ['глетчерный', '冰川的', 'лет-', '飞'],
  ['тлеться', '阴燃', 'лет-', '飞'],
  ['ателье', '画室(法语借词)', 'тел-', '身体'],
  ['эмальерный', '珐琅的', 'мал-', '小'],
];

console.log('\n① D1 七词实测（独立重跑）');
let d1Confirmed = 0;
for (const [w, meaning, bad, badMeaning] of d1) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  const got = parts.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');
  const hit = parts.some((p) => p.morpheme.replace(/-/g, '') === bad.replace(/-/g, ''));
  if (hit) d1Confirmed++;
  console.log(`  ${w.padEnd(14)}(${meaning.padEnd(14)}) 拆出 [${got}]  ${hit ? '❌ 含 ' + bad + '「' + badMeaning + '」' : '✓ 未误拆'}`);
}
console.log(`  ⇒ 7 词中 ${d1Confirmed} 词确认误拆`);

// ---- ② 词首 gap=1 模式的规模 ----
console.log('\n② "词首 gap=1 + 假词根" 模式的规模统计');
const allRu = db
  .prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 14`)
  .all()
  .map((r) => String(r.word))
  .filter((w) => /^[а-яё-]+$/.test(w));

let gap1 = 0;
let gap1Full = 0;
const gap1List = [];
for (const w of allRu) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  if (parts.length >= 2 && parts[0].start === 1) {
    gap1++;
    if (gap1List.length < 25) gap1List.push(`${w} → [${parts.map((p) => p.morpheme + '@' + p.start).join(' ')}]`);
  }
}

console.log(`  全库俄语词条            : ${allRu.length}`);
console.log(`  词首 gap=1 且有 ≥2 片段 : ${gap1}  (${(gap1 / allRu.length * 100).toFixed(2)}%)`);
console.log(`  ⇒ 这一类**当前完全不受约束**（两条守卫恰好都放过 gap=1）`);
console.log('  样例 25:');
for (const l of gap1List) console.log('    ' + l);

// ---- ③ 词族关联污染：用户可见后果 ----
console.log('\n③ 词族关联（relatedByMorpheme）污染 —— 用户可见后果');
const probes = ['плескание', 'хлестаться', 'зверство', 'ателье', 'землетрясение'];
for (const w of probes) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  console.log(`\n  ${w}:`);
  for (const p of parts) {
    let fam = [];
    try { fam = core.relatedByMorpheme(db, p.morpheme, 'ru') ?? []; } catch { fam = []; }
    const list = Array.isArray(fam) ? fam : (fam.words ?? []);
    console.log(`    ${p.morpheme.padEnd(10)} (${p.kind}) → 词族 ${list.length} 词: ${list.slice(0, 8).join(', ')}${list.length > 8 ? ' …' : ''}`);
  }
}

// ---- ④ 阈值 0.55 对 D1 的覆盖情况 ----
console.log('\n④ 为什么覆盖率阈值 0.55 挡不住 D1？');
for (const [w] of d1.slice(0, 4)) {
  let parts = [];
  try { parts = core.breakdownWord(db, w, 'ru'); } catch { parts = []; }
  const cov = parts.reduce((s, p) => s + (p.end - p.start), 0);
  console.log(`  ${w.padEnd(14)} 词长 ${w.length}  覆盖 ${cov}  ${(cov / w.length).toFixed(2)}  ${cov / w.length >= 0.55 ? '≥0.55 通过阈值' : '<0.55'}`);
}
console.log('  ⇒ D1 的假命中**覆盖率很高**（首字母被跳过，但词根+后缀占满其余），');
console.log('     所以覆盖率阈值对它完全无效 —— 这是"阈值型防护"的固有盲区。');

db.close();
