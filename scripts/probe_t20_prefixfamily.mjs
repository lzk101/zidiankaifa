/**
 * 只读探针（功能测试 agent · T20 §3）：核证「75 词真前缀组」的三族命运。
 *   A. да-×63：逐词拉词源链，判定「真 у-/о-/с-/в- + 真 да-」vs 巧合
 *   B. уч-×11 / дн-×1：已定性为真污染，此处只复核
 *   C. 反向对照：全库中单字符前缀【真被匹配到位置 0】的词（parts[0].start===0）
 *      —— 这些是「字母像巧合/实际真前缀」的实证样本
 * 只读、幂等。用法：node scripts/probe_t20_prefixfamily.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prod from '../packages/core/dist/db/index.js';
// 注：修法前引擎副本 scripts/_tmp/prefix_engine/ 已不在盘上；本探针不需要它——
// 75 词组在修法后仍被生产引擎返回（gap ∈ {в,о,с,у} 通过 explained 判定），
// 用 prod 直接筛即可得到同一集合。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB, { readOnly: true });
const RU1 = new Set(['в', 'о', 'с', 'у']);
const norm = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, 'е');

const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const et = db.prepare(`SELECT text_en, chain, origin FROM word_etymology WHERE word = ? AND lang='ru' LIMIT 1`);
const bd = (m, w) => m.breakdownWord(db, w, 'ru') ?? [];
const head = (w) => bd(prod, w)[0] ?? null;

console.log('#'.repeat(88));
console.log('# A. да- 族逐词：拆解 + 词源自带 parts');
console.log('#'.repeat(88));
const group = ALL.filter((w) => {
  const p = bd(prod, w);
  return p.length >= 2 && p[0].start === 1 && RU1.has(norm(w)[0]);
});
const da = group.filter((w) => head(w)?.morpheme === 'да-');
console.log(`да- 族规模 = ${da.length}\n`);
const noEtym = [];
for (const w of da) {
  const e = et.get(w);
  let parts = null;
  if (e?.chain) {
    try {
      parts = JSON.parse(e.chain).flatMap((x) => x.parts ?? []).join(' + ');
    } catch {}
  }
  const flag = parts ? '★有parts' : e ? '有词源' : '**无记载';
  const after = norm(w).slice(1); // 去首字母后的剩余串
  console.log(`  ${w.padEnd(26)} ${JSON.stringify(bd(prod, w).map((p) => `${p.morpheme}@${p.start}`)).padEnd(34)} 去首字母=${after.padEnd(20)} [${flag}]${parts ? ' parts=' + parts : ''}`);
  if (!parts) noEtym.push(w);
}
console.log(`\n  ⇒ 有明确 parts（可判定词素粒度）的：${da.length - noEtym.length} / ${da.length}`);
console.log(`  ⇒ 无 parts 的（需联网/人工判定）：${noEtym.length} → ${noEtym.join(' ')}`);

console.log('\n\n' + '#'.repeat(88));
console.log('# B. 反向对照：单字符前缀【真被匹配到位置 0】的词');
console.log('#'.repeat(88));
const matched = [];
for (const w of ALL) {
  const p = bd(prod, w);
  if (p.length && p[0].start === 0 && /^[восuy]-$/.test(p[0].morpheme)) matched.push({ w, m: p[0].morpheme, all: p.map((x) => `${x.morpheme}@${x.start}-${x.end}`) });
}
console.log(`全库「单字符前缀真被匹配到位置 0」的词 = ${matched.length}`);
const byM = {};
for (const x of matched) (byM[x.m] ??= []).push(x);
for (const [m, xs] of Object.entries(byM)) {
  console.log(`\n  ${m} 共 ${xs.length} 词（示例 25）:`);
  for (const x of xs.slice(0, 25)) {
    const e = et.get(x.w);
    let parts = null;
    if (e?.chain) { try { parts = JSON.parse(e.chain).flatMap((y) => y.parts ?? []).join('+'); } catch {} }
    console.log(`    ${x.w.padEnd(20)} ${JSON.stringify(x.all).padEnd(46)} ${parts ? 'parts=' + parts : e ? '(有词源无parts)' : '(无记载)'}`);
  }
}

console.log('\n\n' + '#'.repeat(88));
console.log('# C. 命中词素是否在库内（суч- / дав- / добр- / дар- / дал- 等）');
console.log('#'.repeat(88));
const mo = db.prepare(`SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang='ru' AND morpheme LIKE ?`);
for (const pat of ['суч%', 'дав%', 'добр%', 'дар%', 'дал%', 'дн%', 'стат%', 'терм%', 'да%']) {
  const rows = mo.all(pat);
  console.log(`  ${pat.padEnd(8)} → ${rows.length} 条 ${rows.map((r) => `${r.morpheme}(${r.kind})`).join(' ')}`);
}

db.close();
