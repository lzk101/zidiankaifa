// 临时交叉核对（只读）：用**官方引擎**独立复算「全库空洞≥3（口径 A）」与「全库可拆数」，
// 与 scripts/exp_v9_admission.mjs 的复刻引擎结果对账（预期 20214 / 33174）。
import { DatabaseSync } from 'node:sqlite';
import * as core from '../packages/core/dist/db/index.js';
const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const norm = (w) => String(w).trim().toLowerCase().replace(/ё/g, 'е');
let cov = 0, h3 = 0, h2 = 0, max3 = 0;
for (const w of ALL) {
  let p = [];
  try { p = core.breakdownWord(db, w, 'ru'); } catch { p = []; }
  if (!p.length) continue;
  cov++;
  const n = norm(w).length;
  const c = new Uint8Array(n);
  for (const x of p) for (let i = x.start; i < x.end && i < n; i++) c[i] = 1;
  let h = 0, run = 0, mx = 0;
  for (let i = 0; i < n; i++) { if (!c[i]) { h++; run++; if (run > mx) mx = run; } else run = 0; }
  if (h >= 3) h3++;
  if (h >= 2) h2++;
  if (mx >= 3) max3++;
}
console.log(`官方引擎全库：可拆 ${cov}  空洞≥3(口径A) ${h3}  空洞≥2 ${h2}  最大单段≥3(口径B) ${max3}`);
db.close();
