// T29 · 收尾取证：① '-ной' 的「空洞变少 90」口径分解 ② поднаковальня/поднакопить 旧态定性依据。
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const db = new DatabaseSync(process.env.ZIDIANKAIFA_DB ?? path.join(REPO, 'data', 'db', 'dict.db'));
const ENG = await import('./_tmp/eng_t28/db/index.js');

const safeEx = (s) => { try { const p = JSON.parse(s); return Array.isArray(p) ? p : []; } catch { return []; } };
const ALL = db.prepare("SELECT morpheme, kind, meaning_zh AS meaningZh, meaning_en AS meaningEn, origin, examples FROM morphemes WHERE lang='ru'").all()
  .map((r) => ({ ...r, examples: safeEx(r.examples) }));
const norm = (w) => w.trim().toLowerCase().replace(/ё/g, 'е');
function holeOf(parts, n) {
  if (!parts.length) return { total: n, max: n, runs: [] };
  const iv = parts.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
  const runs = []; let cur = 0;
  for (const [s, e] of iv) { if (s > cur) runs.push([cur, s]); cur = Math.max(cur, e); }
  if (cur < n) runs.push([cur, n]);
  const lens = runs.map(([a, b]) => b - a);
  return { total: lens.reduce((a, b) => a + b, 0), max: lens.length ? Math.max(...lens) : 0, runs };
}
const key = (ps) => ps.map((p) => `${p.morpheme}@${p.start}-${p.end}`).join(' ');
const words = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' ORDER BY rowid").all().map((r) => r.word);

function run(list) {
  ENG.__setReplace(list);
  const m = new Map();
  for (const w of words) {
    const p = ENG.breakdownWord(db, w, 'ru');
    m.set(w, { parts: p, str: key(p), h: holeOf(p, norm(w).length) });
  }
  return m;
}
const FULL = run(null);
const NOI = run(ALL.filter((x) => x.morpheme !== '-ной'));

console.log('════ T29 §7b 「-ной」空洞变化的口径分解 ════');
let dec = 0, inc = 0, decNew = 0, decOld = 0, zeroBefore = 0, zeroAfter = 0, ge3Before = 0, ge3After = 0;
for (const w of words) {
  const a = NOI.get(w), b = FULL.get(w);
  if (b.h.total < a.h.total) { dec++; if (a.parts.length === 0) decNew++; else decOld++; }
  if (b.h.total > a.h.total) inc++;
  if (a.h.total === 0) zeroBefore++;
  if (b.h.total === 0) zeroAfter++;
  if (a.h.total >= 3) ge3Before++;
  if (b.h.total >= 3) ge3After++;
}
console.log(`  空洞变少总数 = ${dec}`);
console.log(`    ├ 其中「原先不可拆 → 现可拆」= ${decNew}`);
console.log(`    └ 其中「原先已可拆、空洞缩小」= ${decOld}   ← 主管报「空洞变少 90」疑为此口径（报 90，我测 ${decOld}）`);
console.log(`  空洞变多 = ${inc}`);
console.log(`  零空洞词数：${zeroBefore} → ${zeroAfter}（Δ +${zeroAfter - zeroBefore}）`);
console.log(`  空洞≥3 词数：${ge3Before} → ${ge3After}（Δ ${ge3After - ge3Before >= 0 ? '+' : ''}${ge3After - ge3Before}）← 这就是口径A 的变化`);
console.log(`  可拆词数：${words.filter((w) => NOI.get(w).parts.length).length} → ${words.filter((w) => FULL.get(w).parts.length).length}`);

console.log('\n════ T29 §8b поднаковальня / поднакопить 旧态定性取证 ════');
for (const w of ['поднаковальня', 'поднакопить', 'наковальня', 'накопить', 'однако', 'день']) {
  const a = NOI.get(w)?.str ?? '(未测)', b = FULL.get(w)?.str;
  const et = db.prepare("SELECT chain, text_zh FROM word_etymology WHERE word = ? AND lang='ru'").get(w)
    ?? db.prepare('SELECT chain, text_zh FROM word_etymology WHERE word = ?').get(w);
  console.log(`  ${w.padEnd(16)} 无однако-: ${(a || '[]').padEnd(40)} 现状: ${(b ?? '[]')}`);
  console.log(`  ${''.padEnd(16)} 词源 chain = ${et?.chain ?? '（无记载）'}`);
}
console.log('\n  证明「дн-」是假词根的直接依据：');
const dn = db.prepare("SELECT morpheme, kind, meaning_zh, origin FROM morphemes WHERE morpheme='дн-'").get();
console.log(`    morphemes 中 дн- = ${JSON.stringify(dn)}`);
const dnWords = db.prepare("SELECT word FROM words_i18n WHERE lang='ru' AND word LIKE 'дн%' LIMIT 8").all().map((r) => r.word);
console.log(`    以 дн 开头的俄语词（дн- 的正当语境）= ${dnWords.join(' ')}`);
console.log(`    旧拆解把 поднаковальня 的「дн」当成 дн-（день 日/昼），而 наковальня = 「铁砧」，与 день 无关 ⇒ 假词根`);
console.log(`    另注：旧拆解同时含 -ко@5-7 碎片（наковальня 的 к 被切出）⇒ 旧态是双重错误拆解，不是「合法拆解」`);
