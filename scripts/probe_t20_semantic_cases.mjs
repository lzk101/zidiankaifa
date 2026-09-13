/**
 * 只读探针（功能测试 agent · T20）：为 ru_morph_semantic.mjs 打印全部候选案例的**实测**输出，
 * 断言必须对着实测写，不猜。只读、幂等。
 * 用法：node scripts/probe_t20_semantic_cases.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakdownWord } from '../packages/core/dist/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', 'data', 'db', 'dict.db');
const db = new DatabaseSync(DB, { readOnly: true });

const fmt = (w) => {
  const ps = breakdownWord(db, w, 'ru');
  const cov = new Array(w.length).fill(false);
  for (const p of ps) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
  const holes = [];
  let run = -1;
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length && !cov[i]) { if (run < 0) run = i; }
    else if (run >= 0) { holes.push(w.slice(run, i)); run = -1; }
  }
  const covN = cov.filter(Boolean).length;
  return {
    parts: ps.map((p) => `${p.morpheme}@${p.start}-${p.end}`),
    covRate: (covN / w.length).toFixed(3),
    holes,
    holeLen: w.length - covN,
  };
};

const GROUPS = {
  'S1 суч- 族（真词根 суч-）': ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный'],
  'S2 однако': ['однако'],
  'S3 D2 复合词': ['землетрясение', 'водопад'],
  'S4 D4 假词根': ['столп', 'казус', 'доминировать'],
  'S5 D4 真词素被截': ['больной', 'самосуд', 'термостат'],
  'S6 D1 已修（回归）': ['плескание', 'хлестаться', 'зверство', 'глетчерный', 'тлеться', 'ателье', 'эмальерный'],
  'S7 反向对照·真前缀真被匹配': ['вбегать', 'обегать', 'обеднеть', 'вдаться', 'удаться', 'удачный', 'вверх'],
  'S8 да- 族核证（打印用）': ['вдавить', 'сдавить', 'удавить', 'одарить', 'ударить', 'удалить', 'удаление', 'вдалеке', 'сдабривать', 'вдавлина', 'сдаигаться', 'одалживать', 'удавка', 'удалец'],
  'S9 其他疑似巧合': ['обольстить', 'смекать', 'сущность', 'очко', 'свить'],
};

for (const [g, ws] of Object.entries(GROUPS)) {
  console.log('\n' + '#'.repeat(94));
  console.log(`# ${g}`);
  console.log('#'.repeat(94));
  for (const w of ws) {
    const f = fmt(w);
    console.log(`  ${w.padEnd(20)} ${JSON.stringify(f.parts).padEnd(52)} cov=${f.covRate} holeLen=${String(f.holeLen).padStart(2)} holes=${JSON.stringify(f.holes)}`);
  }
}

console.log('\n\n' + '#'.repeat(94));
console.log('# 词素库存在性（真词根是否收录）');
console.log('#'.repeat(94));
const has = db.prepare(`SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE lang='ru' AND morpheme = ?`);
for (const m of ['суч-', 'уч-', 'дав-', 'дар-', 'дал-', 'да-', 'дн-', 'однако', 'день', 'боль-', 'суд', 'термо-', 'стат-', 'дом-', 'домин-', 'стол-', 'каз-', 'тряс-', 'пад-', 'вод-', 'водо-', 'зем-', 'лет-', 'льст-', 'боль', 'верх-', 'бег-', 'бедн-']) {
  const r = has.get(m);
  console.log(`  ${m.padEnd(10)} ${r ? `${r.kind.padEnd(7)} ${r.meaning_zh ?? ''} | origin=${r.origin ?? ''}` : '**不在库内**'}`);
}
db.close();
