/**
 * A2 判别集 · 第二轮候选实测（只读；测试 agent 独占）
 *
 * 依据 .board/BOARD.md:88 主管指令——判别集须重点覆盖「后缀剥离误拆风险」
 * （арест 不该被剥 -ре、Краков 不该被剥 -ко），因为 45% 的实现路径必然踩在这条线上。
 *
 * 用法：node scripts/probe_ru_discriminator2.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const CAND = [
  // 主管点名的后缀剥离误拆风险
  'арест', 'Краков', 'Лена', 'Эдем', 'Белград', 'Мальта', 'Александров', 'Удмуртия',
  // 我第一轮发现的词中空洞假命中
  'землетрясение', 'ателье', 'тельце', 'глетчерный', 'плескание', 'хлестаться', 'зверство',
  // 单字符前缀支撑规则回归
  'вода', 'страшный', 'врач', 'внук', 'свет',
  // 单词根词（A6）
  'луна', 'небо', 'река', 'гора', 'окно', 'стена', 'земля',
  // 旧正字法
  'Богъ', 'Іванъ', 'Іисусъ', 'Москва',
  // 含后缀但可能误剥
  'честность', 'радость', 'новость', 'скорость', 'смелость',
  // 复合词
  'землетрясение', 'водопад', 'снегопад', 'листопад',
];

const fmt = (parts) =>
  parts.length === 0
    ? '[]'
    : '[' + parts.map((p) => `${p.morpheme}(${p.kind}@${p.start}-${p.end})`).join(' ') + ']';

console.log('='.repeat(78));
console.log('A2 判别集 · 第二轮候选实测（只读）');
console.log('='.repeat(78));

for (const w of [...new Set(CAND)]) {
  let parts = [];
  let err = '';
  try {
    parts = core.breakdownWord(db, w, 'ru');
  } catch (e) {
    err = ' THROW ' + e.message;
  }
  // 计算空洞
  let holes = '';
  if (parts.length) {
    const cov = new Array(w.length).fill(false);
    for (const p of parts) for (let i = p.start; i < p.end && i < w.length; i++) cov[i] = true;
    const hs = [];
    let run = -1;
    for (let i = 0; i <= w.length; i++) {
      if (i < w.length && !cov[i]) { if (run < 0) run = i; }
      else if (run >= 0) { hs.push(`${run}..${i}「${w.slice(run, i)}」`); run = -1; }
    }
    if (hs.length) holes = `  空洞 ${hs.join(',')}`;
  }
  console.log(`  ${w.padEnd(16)} ${fmt(parts).padEnd(58)}${holes}${err}`);
}

// 该词在 words_i18n 中是否存在（判断能否进判别集）
console.log('\n--- 是否在 words_i18n(lang=ru) ---');
for (const w of [...new Set(CAND)]) {
  const n = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang='ru' AND word=?`).get(w).n;
  if (!n) console.log(`  ${w}  —— 不在词库（仍可用作纯算法断言）`);
}

db.close();
