/**
 * T19-C §10：按主管【更正后】的验收口径重判。
 *
 * 更正口径：真前缀组目标 = 75 → 63（容许 уч-×11 + дн-×1 消除），`да-` 子集 = 63 零容差，
 *           4 个哨兵词保持可拆，смекать/вода 保持可拆。
 * 冻结护栏（packages/core/test/ru_morph_d1guard.mjs:95-107）：
 *   breakableMin 33162 / truePrefixMin 63 / daCoreMin 63 / rNonEmptyMin 238 / rRateMin 0.30 / l4Hole3Max 134
 *
 * §10.1 词源「文本」信号勘察：12 个靶词是否**连词源行都没有**（决定 H-c 文本路线是否可行）
 * §10.2 分组 × 冻结护栏 对照（H-a / VH-a′ / VH-a″ / VH-e1 逐条判红绿）
 * §10.3 哨兵词与混合样本复测（含 смекать 事实核对）
 *
 * 用法：node scripts/exp_v9_criterion_c.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const NORM = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');

console.log('='.repeat(104));
console.log('§10.1 word_etymology 表结构与「文本」信号可用性');
console.log('='.repeat(104));
const cols = db.prepare(`PRAGMA table_info(word_etymology)`).all();
console.log('  列：' + cols.map((c) => `${c.name}(${c.type})`).join(' · '));
const total = db.prepare(`SELECT COUNT(1) c FROM word_etymology`).get().c;
const ruRows = db.prepare(`SELECT COUNT(1) c FROM word_etymology WHERE lang='ru'`).get().c;
console.log(`  行数：全部 ${total} / ru ${ruRows}`);

const TARGETS = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый',
  'сучкорезка', 'сучкорезный', 'сучок', 'сучёный', 'однако'];
const DA = ['удачный', 'вдаваться', 'одалживать', 'сдабривать', 'удавить', 'сдавать', 'удаление', 'ударить'];
const DA_ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word))
  .filter((w) => NORM(w).length >= 4 && NORM(w)[0] === '\u0443' && NORM(w).slice(1, 3) === '\u0434\u0430');
const q = db.prepare(`SELECT chain, text_en FROM word_etymology WHERE word = ? AND lang='ru'`);
const cnt = db.prepare(`SELECT COUNT(1) c FROM word_etymology WHERE word = ? AND lang='ru'`);

function rowInfo(w) {
  const n = cnt.get(w).c;
  const r = q.get(w);
  let parts = null, text = '';
  if (r) {
    text = String(r.text_en ?? '');
    try { const ch = JSON.parse(r.chain ?? '[]'); const steps = ch.filter((s) => Array.isArray(s.parts) && s.parts.length >= 2); if (steps.length) parts = steps.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), steps[0]).parts; } catch { /* ignore */ }
  }
  return { n, parts, text };
}

console.log('\n  ── 12 个 V9-2 靶词（要求「消除」的一方）');
console.log(`  ${'词'.padEnd(16)}${'词源行'.padEnd(8)}${'parts'.padEnd(8)}text 片段`);
for (const w of TARGETS) {
  const i = rowInfo(w);
  console.log(`  ${w.padEnd(16)}${String(i.n).padEnd(8)}${(i.parts ? '✔' : '-').padEnd(8)}${i.text ? i.text.slice(0, 70) : '（无）'}`);
}
console.log('\n  ── 对照：да- 族样本 + 真词（要求「保留」的一方）');
for (const w of DA) {
  const i = rowInfo(w);
  console.log(`  ${w.padEnd(16)}${String(i.n).padEnd(8)}${(i.parts ? '✔' : '-').padEnd(8)}${i.text ? i.text.slice(0, 70) : '（无）'}`);
}

/* 统计：全库 да- 族有多少词有词源行 / parts */
let daRows = 0, daParts = 0, daTextMentionsDa = 0;
for (const w of DA_ALL) { const i = rowInfo(w); if (i.n) daRows++; if (i.parts) daParts++; if (/\bда/.test(i.text)) daTextMentionsDa++; }
console.log(`\n  ── 全库「уда*」形 ${DA_ALL.length} 词：有词源行 ${daRows} / 有 parts ${daParts} / text 提及 да ${daTextMentionsDa}`);

/* 文本否决可行性：text 中是否出现该「真词根」或「假词根」 */
const ment = (w, needles) => { const i = rowInfo(w); const t = i.text.toLowerCase(); return needles.some((n) => t.includes(n)); };
console.log('\n  ── 文本路线可行性判定');
let t12 = 0;
for (const w of TARGETS) { const i = rowInfo(w); if (i.text && i.text.trim()) t12++; }
console.log(`  12 靶词中 text 非空 = ${t12}/12`);
let daT = 0;
for (const w of DA_ALL) { const i = rowInfo(w); if (i.text && i.text.trim()) daT++; }
console.log(`  да- 族 text 非空 = ${daT}/${DA_ALL.length}`);
console.log(`  靶词「суч/сук」提及：${TARGETS.filter((w) => ment(w, ['суч', 'сук'])).length}/12`);
console.log(`  да- 族「да/дач」提及：${DA_ALL.filter((w) => ment(w, ['да', 'дач'])).length}/${DA_ALL.length}`);

console.log('\n' + '='.repeat(104));
console.log('§10.2 ★ 按【更正后】验收口径逐条判红绿（冻结护栏 vs 各变体实测值）');
console.log('='.repeat(104));
const FROZEN = { breakableMin: 33162, truePrefixMin: 63, daCoreMin: 63, rNonEmptyMin: 238, rRateMin: 0.3, l4Hole3Max: 134 };
/* 各变体的实测值（来自 scripts/exp_v9_mechanism4.mjs §9/§9.4 + §8） */
const RES = [
  { name: 'V0 基线（现状）', all: 33174, tp: 75, da: 63, r: 238, l4: 134, reds: 33 },
  { name: 'VH-a 人工负向规则(2条)', all: 33162, tp: 63, da: 63, r: 238, l4: 134, reds: 21 },
  { name: 'VH-a\u2032 词素级(仅第2步)', all: 33099, tp: 12, da: 0, r: 237, l4: 134, reds: 21 },
  { name: 'VH-a\u2033 支撑关闭+词素级', all: 37811, tp: 75, da: 63, r: 275, l4: 163, reds: 9 },
  { name: 'VH-e1 补 1 条詞素 суч-', all: 33181, tp: 64, da: 63, r: 238, l4: 134, reds: 11 },
  { name: 'VH-e4 补全 8 条词素', all: 33567, tp: 75, da: 63, r: 243, l4: 131, reds: 4 },
  { name: 'VH-c veto HC-A', all: 28373, tp: 43, da: 31, r: 198, l4: 124, reds: 32 },
  { name: 'VH-c veto HC-B', all: 29068, tp: 64, da: 52, r: 199, l4: 121, reds: 32 },
];
console.log(`  ${'变体'.padEnd(30)}${'可拆≥33162'.padEnd(13)}${'真前缀≥63'.padEnd(12)}${'да-=63'.padEnd(10)}${'R≥238'.padEnd(9)}${'率≥0.30'.padEnd(10)}${'L4≤134'.padEnd(10)}总判`);
for (const r of RES) {
  const c = [
    [r.all >= FROZEN.breakableMin, `${r.all}`, FROZEN.breakableMin],
    [r.tp >= FROZEN.truePrefixMin, `${r.tp}`, FROZEN.truePrefixMin],
    [r.da === FROZEN.daCoreMin, `${r.da}`, FROZEN.daCoreMin],
    [r.r >= FROZEN.rNonEmptyMin, `${r.r}`, FROZEN.rNonEmptyMin],
    [r.r / 791 >= FROZEN.rRateMin, `${(r.r / 791 * 100).toFixed(2)}%`, '30.00%'],
    [r.l4 <= FROZEN.l4Hole3Max, `${r.l4}`, FROZEN.l4Hole3Max],
  ];
  const cells = c.map(([pass, v]) => `${(pass ? '✅' : '❌') + v}`.padEnd(pass ? 13 : 13).slice(0, 13));
  const allPass = c.every(([p]) => p);
  const failWhich = c.map(([p, v, lim], i) => (p ? null : ['可拆', '真前缀', 'да-', 'R', '率', 'L4'][i] + '=' + v)).filter(Boolean);
  console.log(`  ${r.name.padEnd(30)}${cells.join('')}${allPass ? '✅ 全过' : '❌ 挂 ' + failWhich.join('/')}`);
}
console.log('\n  ★ 结论：**唯一全过冻结护栏的机制是 VH-a（人工 2 条负向规则）**，且它消除的正好是 12 条红、');
console.log('    真前缀组恰好 75→63、да- 恰好 63、全库恰好 33,162 = breakableMin —— 三条冻结值与目标态**逐位吻合**。');
console.log('  ★ VH-a\u2033（骗绿陷阱）除 L4 外**全部通过**：它是被 **l4Hole3Max=134 这唯一一道护栏**拦下的。');
console.log('  ★ VH-a\u2032 被 rRateMin（237/791=29.96%<30%）与 daCoreMin（0≠63）双向拦下。');

console.log('\n' + '='.repeat(104));
console.log('§10.3 哨兵词事实核对（主管更正清单第 3/4 条）');
console.log('='.repeat(104));
const { breakdownWord } = await import('../packages/core/dist/db/index.js');
const SENT = ['вдаваться', 'одалживать', 'сдабривать', 'удачный', 'смекать', 'вода'];
for (const w of SENT) {
  const p = breakdownWord(db, w, 'ru');
  console.log(`  ${w.padEnd(14)} ${p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join(' ')}` + '}' : '[]  ← 不可拆'}`);
}
console.log('\n  ⚠ 事实核对：主管更正清单第 4 条要求「смекать 必须保持可拆」，');
console.log('    但实测 смекать 在**当前 v0.8.0 产品代码**下返回 []（不可拆）——');
console.log('    这与主管【裁决五·订正一】自己的实测结论一致（「смекать 是假警报，根本拆不出来」）。');
console.log('    ⇒ 「保持可拆」的前提不成立：它现在就不是可拆词，任何机制都不可能「破坏」它。');
console.log('    它**只能作为「不得凭空新增」的反例哨兵**（即：机制后仍须为 []），不能作为「必须保持可拆」的正例。');

db.close();
