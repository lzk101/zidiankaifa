/**
 * 探针 4：定位「上界够但当前失败」165 词的失败原因（决定 45% 是否可达）
 */
import { DatabaseSync } from 'node:sqlite';
import * as core from '../../packages/core/dist/db/index.js';

const DB_PATH = 'D:\\lzk17\\Documents\\zidiankaifa\\data\\db\\dict.db';
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const cdb = core.openDatabase(DB_PATH);

const morphs = db.prepare("SELECT morpheme, kind FROM morphemes WHERE lang='ru'").all().map((m) => ({
  kind: m.kind,
  stem: String(m.morpheme).replace(/^-+|-+$/g, '').replace(/ё/g, 'е'),
}));
const prefixStems = new Set(morphs.filter((m) => m.kind === 'prefix').map((m) => m.stem));
const nonPrefix = morphs.filter((m) => m.kind !== 'prefix' && m.stem.length >= 3).map((m) => m.stem);

const rowsA = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0").all().map((r) => String(r.word));
const fails = rowsA.filter((w) => !core.breakdownWord(cdb, w, 'ru').length);

/* 复刻 UB（与探针 3 同） */
const patsFirst = new Set(), patsAny = [], corePats = [];
for (const m of morphs) {
  const list = [m.stem];
  if (m.kind === 'suffix' && m.stem.length >= 5 && /[ьйоаяеыиую]$/.test(m.stem)) {
    const c = m.stem.slice(0, -1);
    if (c.length >= 3) { list.push(c); corePats.push(c); }
  }
  for (const p of list) {
    if (p.length === 1) patsFirst.add(p);
    else if (p.length >= 2) patsAny.push(p);
  }
}
function ub(w) {
  const mw = w.trim().toLowerCase().replace(/ё/g, 'е');
  const n = mw.length;
  const cov = new Int32Array(n + 1);
  for (let i = n - 1; i >= 0; i--) {
    let best = cov[i + 1];
    for (const p of patsAny) {
      if (p.length > n - i || !mw.startsWith(p, i)) continue;
      const c = p.length + cov[i + p.length];
      if (c > best) best = c;
    }
    if (i === 0) for (const p of patsFirst) if (mw.startsWith(p, 0) && p.length + cov[p.length] > best) best = p.length + cov[p.length];
    for (const p of corePats) {
      if (p.length > n - i || !mw.startsWith(p, i)) continue;
      if (n - (i + p.length) > 3) continue;
      if (n - i > best) best = n - i;
    }
    cov[i] = best;
  }
  return cov[0] / n;
}
const head = fails.filter((w) => ub(w) >= 0.55);

/* 分桶：词首是否为单字符前缀（в/о/с/у） */
const bucket = { 单字符前缀开头: 0, 多字符词素可起于词首: 0, 其它: 0 };
const examples = { 单字符前缀开头: [], 多字符词素可起于词首: [], 其它: [] };
for (const w of head) {
  const mw = w.trim().toLowerCase().replace(/ё/g, 'е');
  const c0 = mw[0];
  if (patsFirst.has(c0)) { bucket['单字符前缀开头']++; if (examples['单字符前缀开头'].length < 12) examples['单字符前缀开头'].push(w); }
  else if (patsAny.some((p) => mw.startsWith(p))) { bucket['多字符词素可起于词首']++; if (examples['多字符词素可起于词首'].length < 12) examples['多字符词素可起于词首'].push(w); }
  else { bucket['其它']++; if (examples['其它'].length < 12) examples['其它'].push(w); }
}
console.log('== 「上界够但当前失败」共', head.length, '词，分桶 ==');
console.log(JSON.stringify(bucket));
console.log('  单字符前缀开头例:', examples['单字符前缀开头'].join(' '));
console.log('  多字符词素起首例:', examples['多字符词素可起于词首'].join(' '));
console.log('  其它例:', examples['其它'].join(' '));

/* 详诊 6 词 */
console.log('\n== 详诊（为什么上界够却拆不出）==');
for (const w of [...examples['单字符前缀开头'].slice(0, 3), ...examples['多字符词素可起于词首'].slice(0, 3)]) {
  const mw = w.trim().toLowerCase().replace(/ё/g, 'е');
  const matches = [];
  for (const m of morphs) {
    const minLen = m.kind === 'prefix' ? 1 : 2;
    if (m.stem.length < minLen) continue;
    let idx = mw.indexOf(m.stem);
    while (idx >= 0) {
      const posOk = m.kind === 'prefix' ? idx === 0 : m.kind === 'suffix' ? idx >= 3 : true;
      matches.push(`${m.stem}(${m.kind}@${idx}${posOk ? '' : ' ✗位置'})`);
      idx = mw.indexOf(m.stem, idx + 1);
    }
  }
  const singleOk = patsFirst.has(mw[0]) ? nonPrefix.some((s) => mw.slice(1).startsWith(s)) : null;
  console.log(`  ${w} (${mw.length}字符, UB=${ub(w).toFixed(2)}) → 命中: ${matches.slice(0, 8).join(' ')}${matches.length > 8 ? ' …' : ''}`);
  console.log(`      单字符前缀支撑检查: ${singleOk === null ? '首字符非单字符前缀' : singleOk ? '支撑成立' : '✗ 无紧邻词根支撑（index.ts:776 拒绝）'}`);
}

/* 若放宽到「多字符前缀允许非词首」，能救多少 */
let rescue = 0;
for (const w of head) {
  const mw = w.trim().toLowerCase().replace(/ё/g, 'е');
  if (patsAny.some((p) => prefixStems.has(p) && mw.includes(p))) rescue++;
}
console.log('\n失败词中含「库内多字符前缀但不在词首」的 =', rescue, '词（放宽前缀位置规则可争取的上限之一）');
db.close();
