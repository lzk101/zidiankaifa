/**
 * 主管独立反事实验证（只读）：D4.4 больной 能否用比 -ной 更小的、有来源的候选修好？
 * 动机：-ной 使口径A/B +71/+73，是唯一挡住 30 条全清的候选；需知有无更低代价方案。
 * 候选来源：库内已有 -ный（俄语形容词后缀 *-ьnъ）与 -ние/-ний/-ник 等；
 *           库内**【没有】-ой / -н / -ная / -ное / -ные**（已查 roots_ru.json）。
 * 用法：node scripts/probe_sup_bolnoy_mincost.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const NORM = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);

const libRows = () => db.prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='ru'`).all()
  .map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind) }));

function buildMatchers(extra = []) {
  const list = libRows().concat(extra.map((e) => ({ morpheme: String(e.morpheme), kind: String(e.kind) })));
  list.sort((a, b) => { const k = (RANK[a.kind] ?? 3) - (RANK[b.kind] ?? 3); return k !== 0 ? k : String(b.morpheme).length - String(a.morpheme).length; });
  return list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = raw.replace(/\u0451/g, '\u0435');
    const patterns = [{ pat: stem, core: false }];
    if (m.kind === 'suffix' && stem.length >= 5 && /[\u044c\u0439\u043e\u0430\u044f\u0435\u044b\u0438\u0443\u044e]$/.test(stem)) { const c = stem.slice(0, -1); if (c.length >= 3) patterns.push({ pat: c, core: true }); }
    return { m, stem, patterns };
  });
}

/** 生产语义（GATES_STRICT）：threshold .55 / leadGap / gapExplain(start>=1) / suffixPos / prefixPos / oneCharPre */
function bd(word, all) {
  const w = NORM(word);
  if (w.length < 2) return [];
  const byFirst = new Map();
  for (const e of all) for (const { pat } of e.patterns) { const c = pat[0]; let a = byFirst.get(c); if (!a) { a = []; byFirst.set(c, a); } a.push(e); }
  const cands = (pos) => {
    const out = []; const entries = byFirst.get(w[pos]); if (!entries) return out;
    for (const { m, stem, patterns } of entries) for (const { pat, core } of patterns) {
      const minLen = m.kind === 'prefix' ? 1 : 2;
      if (pat.length < minLen || !w.startsWith(pat, pos)) continue;
      if (m.kind === 'prefix' && pos !== 0 && !core) continue;
      let end = pos + (core ? w.length - pos : pat.length);
      if (core) { if (w.length - (pos + pat.length) > 3) continue; end = w.length; }
      else if (m.kind === 'prefix' && pat.length === 1) {
        const rest = w.slice(pos + 1);
        if (!all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem))) continue;
      }
      if (m.kind === 'suffix' && pos < 3) continue;
      out.push({ m, start: pos, end });
    }
    return out;
  };
  const n = w.length;
  const cov = new Int32Array(n + 1), pcs = new Int32Array(n + 1);
  const to = new Int32Array(n + 1), en = new Int32Array(n + 1), mm = new Array(n + 1).fill(null);
  to[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    let bc = cov[i + 1], bp = pcs[i + 1], bt = i + 1, be = i + 1, bm = null;
    for (const c of cands(i)) { const v = c.end - c.start + cov[c.end]; const pc = 1 + pcs[c.end]; if (v > bc || (v === bc && (pc < bp || (pc === bp && rankOf(c.m) < rankOf(bm))))) { bc = v; bp = pc; bt = c.end; be = c.end; bm = c.m; } }
    cov[i] = bc; pcs[i] = bp; to[i] = bt; en[i] = be; mm[i] = bm;
  }
  const parts = []; let i = 0;
  while (i >= 0 && i < n && parts.length < 8) { const m = mm[i]; if (m) { parts.push({ morpheme: m.morpheme, start: i, end: en[i] }); i = en[i]; } else i = to[i]; }
  const c = parts.reduce((s, p) => s + (p.end - p.start), 0) / n;
  if (c < 0.55) return [];
  if (parts.length === 1 && parts[0].start === 1) return [];
  if (parts.length && parts[0].start >= 1) {
    const gap = w.slice(0, parts[0].start);
    if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return [];
  }
  return parts.sort((a, b) => a.start - b.start);
}

const BASE = buildMatchers();
const fmt = (p) => (p.length ? `{${p.map((x) => x.morpheme + '@' + x.start + '-' + x.end).join(' ')} }` : '[]');

/* ---- 1. 反事实：能否让某片段文本含 "ной" 的最小代价候选 ---- */
const VARIANTS = [
  ['基线（无新增）', []],
  ['+ -ной', [{ morpheme: '-\u043d\u043e\u0439', kind: 'suffix' }]],
  ['+ -ой', [{ morpheme: '-\u043e\u0439', kind: 'suffix' }]],
  ['+ -н', [{ morpheme: '-\u043d', kind: 'suffix' }]],
  ['+ -н + -ой', [{ morpheme: '-\u043d', kind: 'suffix' }, { morpheme: '-\u043e\u0439', kind: 'suffix' }]],
  ['+ -ный 已有(对照,无新增)', []],
];

console.log('='.repeat(112));
console.log('§1 D4.4 больной 反事实：断言判据 = bd(больной) 中存在【文本含 ной】的片段');
console.log('='.repeat(112));
for (const [name, extra] of VARIANTS) {
  const all = extra.length ? buildMatchers(extra) : BASE;
  const p = bd('\u0431\u043e\u043b\u044c\u043d\u043e\u0439', all);
  const hasNoy = p.some((x) => String(x.morpheme).includes('\u043d\u043e\u0439'));
  console.log(`  ${name.padEnd(26)} ${fmt(p).padEnd(42)} 含"ной"片段: ${hasNoy ? '✅' : '❌'}`);
}

/* ---- 2. 全库规模：-ной 与 -ой/-н 的代价对比 ---- */
console.log('\n' + '='.repeat(112));
console.log('§2 全库代价对比（101,512 词）：哪个候选最省？');
console.log('='.repeat(112));
const ALL_W = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
function metrics(all) {
  let br = 0, ca = 0, cb = 0; const set = new Set();
  for (const w of ALL_W) {
    const p = bd(w, all);
    if (!p.length) continue;
    br++; set.add(w);
    const n = NORM(w).length; const cv = new Array(n).fill(false);
    for (const q of p) for (let i = q.start; i < q.end; i++) cv[i] = true;
    let tot = 0, cur = 0, mx = 0;
    for (let i = 0; i < n; i++) { if (!cv[i]) { tot++; cur++; if (cur > mx) mx = cur; } else cur = 0; }
    if (tot >= 3) ca++;
    if (mx >= 3) cb++;
  }
  return { br, set, ca, cb };
}
const M0 = metrics(BASE);
console.log(`  ${'候选'.padEnd(22)}${'可拆'.padEnd(9)}${'Δ'.padEnd(8)}${'口径A'.padEnd(9)}${'ΔA'.padEnd(7)}${'口径B'.padEnd(9)}ΔB`);
console.log(`  ${'基线'.padEnd(22)}${String(M0.br).padEnd(9)}${'—'.padEnd(8)}${String(M0.ca).padEnd(9)}${'—'.padEnd(7)}${String(M0.cb).padEnd(9)}—`);
for (const [name, extra] of VARIANTS.slice(1, 5)) {
  const M = metrics(buildMatchers(extra));
  const d = (a, b) => `${b - a > 0 ? '+' : ''}${b - a}`;
  console.log(`  ${name.padEnd(22)}${String(M.br).padEnd(9)}${d(M0.br, M.br).padEnd(8)}${String(M.ca).padEnd(9)}${d(M0.ca, M.ca).padEnd(7)}${String(M.cb).padEnd(9)}${d(M0.cb, M.cb)}`);
}

/* ---- 3. -ной 代价来源取样 ---- */
console.log('\n' + '='.repeat(112));
console.log('§3 -ной 使哪些词由「完整覆盖」变为「有空洞」（前 15 例）');
console.log('='.repeat(112));
const ALL2 = buildMatchers([{ morpheme: '-\u043d\u043e\u0439', kind: 'suffix' }]);
const holesOf = (p, w) => { const n = NORM(w).length; const cv = new Array(n).fill(false); for (const q of p) for (let i = q.start; i < q.end; i++) cv[i] = true; let t = 0; for (let i = 0; i < n; i++) if (!cv[i]) t++; return t; };
let shown = 0, worse = 0, better = 0;
for (const w of ALL_W) {
  const a = bd(w, BASE), b = bd(w, ALL2);
  if (!a.length || !b.length) continue;
  const ha = holesOf(a, w), hb = holesOf(b, w);
  if (hb > ha) { worse++; if (shown < 15) { shown++; console.log(`  ${w.padEnd(20)} 基线洞${ha} ${fmt(a)}  →  加-ной 洞${hb} ${fmt(b)}`); } }
  else if (hb < ha) better++;
}
console.log(`\n  汇总：变差 ${worse} 词 · 变好 ${better} 词`);

db.close();
