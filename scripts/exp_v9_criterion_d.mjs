/**
 * T19-C §11（权威版）：按主管【更正后】的验收口径，用**单一实现**逐变体计算全部冻结护栏指标。
 * 冻结护栏见 packages/core/test/ru_morph_d1guard.mjs:95-107：
 *   breakableMin 33162 · truePrefixMin 63 · daCoreMin 63 · rNonEmptyMin 238 · rRateMin 0.30 · l4Hole3Max 134
 * 真前缀组判定严格复刻 d1guard.mjs:176-199（gap=1 且 gap ∈ 前缀 stem 集）。
 *
 * 用法：node scripts/exp_v9_criterion_d.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });
const NORM = (w) => String(w).trim().toLowerCase().replace(/\u0451/g, '\u0435');
const RANK = { prefix: 0, suffix: 1, root: 2 };
const rankOf = (m) => (m ? RANK[m.kind] : 3);
const libRows = () => db.prepare('SELECT morpheme, kind FROM morphemes WHERE lang = ?').all('ru');

function buildMatchers(extra = []) {
  const list = libRows().map((r) => ({ morpheme: String(r.morpheme), kind: String(r.kind) }))
    .concat(extra.map((e) => ({ morpheme: String(e.morpheme), kind: String(e.kind) })));
  list.sort((a, b) => { const k = (RANK[a.kind] ?? 3) - (RANK[b.kind] ?? 3); return k !== 0 ? k : String(b.morpheme).length - String(a.morpheme).length; });
  const all = list.map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = raw.replace(/\u0451/g, '\u0435');
    const patterns = [{ pat: stem, core: false }];
    if (m.kind === 'suffix' && stem.length >= 5 && /[\u044c\u0439\u043e\u0430\u044f\u0435\u044b\u0438\u0443\u044e]$/.test(stem)) { const c = stem.slice(0, -1); if (c.length >= 3) patterns.push({ pat: c, core: true }); }
    return { m, stem, patterns };
  });
  const byFirst = new Map();
  for (const e of all) for (const { pat } of e.patterns) { const c = pat[0]; let a = byFirst.get(c); if (!a) { a = []; byFirst.set(c, a); } a.push(e); }
  return { all, byFirst };
}

function bd(word, bundle, gates = {}, veto = null) {
  const g = { threshold: true, leadGap: true, gapExplain: true, suffixPos: true, prefixPos: true, oneCharPre: true, gapMin: 1, gapLevel: 'letter', ...gates };
  const { all, byFirst } = bundle;
  const w = NORM(word);
  if (w.length < 2) return [];
  const cands = (pos) => {
    const out = []; const entries = byFirst.get(w[pos]); if (!entries) return out;
    for (const { m, stem, patterns } of entries) for (const { pat, core } of patterns) {
      const minLen = m.kind === 'prefix' ? 1 : 2;
      if (pat.length < minLen || !w.startsWith(pat, pos)) continue;
      if (g.prefixPos && m.kind === 'prefix' && pos !== 0 && !core) continue;
      let end = pos + (core ? w.length - pos : pat.length);
      if (core) { if (w.length - (pos + pat.length) > 3) continue; end = w.length; }
      else if (g.oneCharPre && m.kind === 'prefix' && pat.length === 1) {
        const rest = w.slice(pos + 1);
        if (!all.some((x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem))) continue;
      }
      if (g.suffixPos && m.kind === 'suffix' && pos < 3) continue;
      if (veto && veto(m.morpheme, m.kind, word, pos, stem)) continue;
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
  if (g.threshold && c < 0.55) return [];
  if (g.leadGap && parts.length === 1 && parts[0].start === 1) return [];
  if (g.gapExplain && parts.length && parts[0].start >= (g.gapMin ?? 2)) {
    const gap = w.slice(0, parts[0].start);
    if (!all.some((x) => x.m.kind === 'prefix' && x.stem === gap)) return [];
    if (g.gapLevel === 'morpheme' && gap.length === 1 && parts[0].start !== 0) return [];
  }
  return parts.sort((a, b) => a.start - b.start);
}

/* ---- 词源 veto ---- */
const st = (s) => String(s).replace(/[\u0300-\u036f]/g, '');
const np = (s) => st(String(s)).toLowerCase().replace(/\([^)]*\)/g, '').replace(/-/g, '').replace(/\u0451/g, '\u0435').trim();
const ety = db.prepare(`SELECT chain FROM word_etymology WHERE word = ? AND lang='ru' LIMIT 1`);
const EC = new Map();
function partsOfEtym(w) {
  if (EC.has(w)) return EC.get(w);
  let out = null;
  const e = ety.get(w);
  if (e) { try { const ch = JSON.parse(e.chain ?? '[]'); const sp = ch.filter((s) => Array.isArray(s.parts) && s.parts.length >= 2); if (sp.length) { const ps = sp.reduce((a, b) => (b.parts.length > a.parts.length ? b : a), sp[0]).parts.map(np).filter(Boolean); if (ps.length >= 2) out = ps; } } catch { /* ignore */ } }
  EC.set(w, out); return out;
}
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const vetoA = (m, k, w, pos, stem) => { const ps = partsOfEtym(w); return ps ? !ps.some((p) => p.startsWith(stem) || stem.startsWith(p)) : false; };
const vetoB = (m, k, w, pos, stem) => { const ps = partsOfEtym(w); return ps ? !(stem.length <= 2 || ps.some((p) => lcp(p, stem) >= 3)) : false; };
const HA = [{ m: '\u0443\u0447-', after: '\u0441' }, { m: '\u0434\u043d-', after: '\u043e' }];
const vetoHa = (m, k, w, pos) => pos === 1 && HA.some((r) => r.m === m && NORM(w)[0] === r.after);

const EX_SUCH = [{ morpheme: '\u0441\u0443\u0447-', kind: 'root' }];
const EX_ALL = [{ morpheme: '\u0441\u0443\u0447-', kind: 'root' }, { morpheme: '\u0441\u0443\u0434-', kind: 'root' }, { morpheme: '-\u043d\u043e\u0439', kind: 'suffix' }, { morpheme: '\u043f\u0430\u0434-', kind: 'root' }, { morpheme: '\u0442\u0440\u044f\u0441-', kind: 'root' }, { morpheme: '\u0441\u0442\u043e\u043b\u043f-', kind: 'root' }, { morpheme: '\u0441\u0442\u0430\u0442-', kind: 'root' }];

const VARIANTS = [
  ['V0 基线（现状）', {}, null, null],
  ['VH-a 人工负向规则(2条)', {}, vetoHa, null],
  ['VH-a\u2032 词素级(仅第2步)', { gapLevel: 'morpheme' }, null, null],
  ['VH-a\u2033 支撑关闭+词素级', { gapLevel: 'morpheme', oneCharPre: false }, null, null],
  ['VH-c veto HC-A(词源严格)', {}, vetoA, null],
  ['VH-c veto HC-B(词源宽松)', {}, vetoB, null],
  ['VH-e1 补 1 条詞素 суч-', {}, null, EX_SUCH],
  ['VH-e4 补全 8 条词素', {}, null, EX_ALL],
];

const ALL = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru'`).all().map((r) => String(r.word));
const R = db.prepare(`SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0`).all().map((r) => String(r.word));
const PSTEMS = new Set(libRows().filter((r) => String(r.kind) === 'prefix').map((r) => String(r.morpheme).replace(/^-+|-+$/g, '').replace(/\u0451/g, '\u0435')));

function holeTotal(w, p) { const n = NORM(w).length; const c = p.reduce((s, x) => s + (x.end - x.start), 0); return n - c; }
const head = (p) => (p[0]?.morpheme ?? null);
const cov0 = (p) => p.some((x) => x.start === 0 && x.end > 0);
const T12 = ['сучить', 'сучение', 'сучильный', 'сучка', 'сучковатость', 'сучковатый', 'сучковый', 'сучкорезка', 'сучкорезный', 'сучок', 'сучёный', 'однако'];
function reds(pf) {
  const bad = [];
  if (pf('землетрясение').some((m) => m.morpheme.includes('лет-'))) bad.push('D2.1');
  if (holeTotal('землетрясение', pf('землетрясение')) >= 3) bad.push('D2.2');
  if (holeTotal('водопад', pf('водопад')) >= 3) bad.push('D2.3');
  if (pf('столп').some((m) => m.morpheme.includes('стол-'))) bad.push('D4.1');
  if (pf('казус').some((m) => m.morpheme.includes('каз-'))) bad.push('D4.2');
  if (pf('доминировать').some((m) => m.morpheme.includes('дом-'))) bad.push('D4.3');
  if (!pf('больной').some((m) => m.morpheme.includes('ной'))) bad.push('D4.4');
  if (!pf('самосуд').some((m) => m.morpheme.includes('суд'))) bad.push('D4.5');
  const t = pf('термостат');
  if (t.length === 1 && t[0].morpheme === 'термо-') bad.push('D4.6');
  for (const w of T12.slice(0, 11)) { if (head(pf(w)) === '\u0443\u0447-') bad.push(w + '.i'); if (!cov0(pf(w))) bad.push(w + '.ii'); }
  if (head(pf('однако')) === '\u0434\u043d-') bad.push('однако.i');
  if (!cov0(pf('однако'))) bad.push('однако.ii');
  return bad;
}

console.log('§0 保真自检：');
{
  const { breakdownWord } = await import('../packages/core/dist/db/index.js');
  let bad = 0;
  for (const w of R) if (breakdownWord(db, w, 'ru').map((p) => `${p.morpheme}@${p.start}`).join('|') !== bd(w, buildMatchers()).map((p) => `${p.morpheme}@${p.start}`).join('|')) bad++;
  console.log(`  尺子 R 791 词与官方 breakdownWord 不一致 ${bad} 例 ${bad ? '✗ 中止' : '✔'}`);
  if (bad) { db.close(); process.exit(1); }
}

console.log('\n' + '='.repeat(112));
console.log('§11.1 ★★ 权威表：更正后验收口径（冻结护栏逐项判红绿）');
console.log('='.repeat(112));
console.log(`  ${'变体'.padEnd(30)}${'可拆'.padEnd(8)}${'≥33162'.padEnd(8)}${'真前缀'.padEnd(7)}${'≥63'.padEnd(6)}${'да-'.padEnd(5)}${'=63'.padEnd(5)}${'R'.padEnd(5)}${'率≥.30'.padEnd(8)}${'L4'.padEnd(5)}${'≤134'.padEnd(6)}33红`);
const SUMMARY = [];
for (const [name, gates, veto, extra] of VARIANTS) {
  const bundle = buildMatchers(extra ?? []);
  let br = 0, tp = 0, da = 0, l4 = 0;
  for (const w of ALL) {
    const p = bd(w, bundle, gates, veto);
    if (!p.length) continue;
    br++;
    const start = p[0].start;
    if (start >= 1) { const gap = NORM(w).slice(0, start); if (gap.length === 1 && PSTEMS.has(gap)) { tp++; if (head(p) === '\u0434\u0430-') da++; } }
    if (holeTotal(w, p) >= 3) l4++;
  }
  let rh = 0; for (const w of R) { const p = bd(w, bundle, gates, veto); if (p.length) { rh++; } }
  // L4 按主管口径 = 尺子 R 口径（冻结值 134 系 R 口径）
  let l4r = 0; for (const w of R) { const p = bd(w, bundle, gates, veto); if (p.length && holeTotal(w, p) >= 3) l4r++; }
  const bad = reds((w) => bd(w, bundle, gates, veto));
  const C = {
    br: br >= 33162, tp: tp >= 63, da: da === 63, r: rh >= 238, rate: rh / 791 >= 0.30, l4: l4r <= 134,
  };
  const m = (b, v) => `${(b ? '\u2705' : '\u274c')}${v}`.padEnd(8).slice(0, 8);
  console.log(`  ${name.padEnd(30)}${String(br).padEnd(8)}${m(C.br, br)}${String(tp).padEnd(7)}${m(C.tp, tp)}${String(da).padEnd(5)}${m(C.da, '').slice(0, 5).padEnd(5)}${String(rh).padEnd(5)}${m(C.rate, (rh / 791 * 100).toFixed(2) + '%')}${String(l4r).padEnd(5)}${m(C.l4, '')}${bad.length}/33`);
  SUMMARY.push({ name, br, tp, da, rh, l4r, reds: bad.length, pass: Object.values(C).every(Boolean), fail: Object.entries(C).filter(([, v]) => !v).map(([k]) => k) });
}
console.log('\n  ── 总判（6 项冻结护栏全过 = 通过）');
for (const s of SUMMARY) console.log(`  ${s.pass ? '✅ 全过' : '❌ 挂 ' + s.fail.join('/')}  ${s.name}   (可拆 ${s.br} · 真前缀 ${s.tp} · да- ${s.da} · R ${s.rh} · L4 ${s.l4r} · 红 ${s.reds})`);

console.log('\n' + '='.repeat(112));
console.log('§11.2 ★ 75 词进出核对（只有 H-a 命中「恰好 75→63、零新增」）');
console.log('='.repeat(112));
const base = ALL.filter((w) => { const p = bd(w, buildMatchers()); if (!p.length) return false; const s = p[0].start; return s >= 1 && NORM(w).slice(0, s).length === 1 && PSTEMS.has(NORM(w).slice(0, s)); });
console.log(`  基线真前缀组 = ${base.length} 词`);
for (const [name, gates, veto, extra] of VARIANTS) {
  const bundle = buildMatchers(extra ?? []);
  const now = ALL.filter((w) => { const p = bd(w, bundle, gates, veto); if (!p.length) return false; const s = p[0].start; return s >= 1 && NORM(w).slice(0, s).length === 1 && PSTEMS.has(NORM(w).slice(0, s)); });
  const set = new Set(now);
  const gone = base.filter((w) => !set.has(w));
  const added = now.filter((w) => !base.includes(w));
  console.log(`  ${name.padEnd(30)} 现存 ${String(now.length).padEnd(4)} 消失 ${String(gone.length).padEnd(4)} 新增 ${String(added.length).padEnd(4)} ${gone.length <= 13 ? '消失: ' + gone.join(' ') : '消失: ' + gone.slice(0, 13).join(' ') + ' …'}`);
}

console.log('\n' + '='.repeat(112));
console.log('§11.3 各变体剩余红名单（供 H-d 冻结名单参考）');
console.log('='.repeat(112));
for (const [name, gates, veto, extra] of VARIANTS) {
  const bad = reds((w) => bd(w, buildMatchers(extra ?? []), gates, veto));
  console.log(`  ${name.padEnd(30)} ${bad.length}/33  ${bad.length ? bad.join(' ') : '（全绿）'}`);
}

console.log('\n' + '='.repeat(112));
console.log('§11.4 哨兵词（主管更正清单第 3/4 条）');
console.log('='.repeat(112));
const show = (p) => (p.length ? `{${p.map((x) => x.morpheme + '@' + x.start).join(' ')}` + '}' : '[]');
const SENT = ['вдаваться', 'одалживать', 'сдабривать', 'удачный', 'смекать', 'вода'];
console.log(`  ${'词'.padEnd(14)}${'V0'.padEnd(26)}${'VH-a'.padEnd(12)}${'VH-e1'.padEnd(26)}VH-e4`);
for (const w of SENT) {
  console.log(`  ${w.padEnd(14)}${show(bd(w, buildMatchers())).padEnd(26)}${show(bd(w, buildMatchers(), {}, vetoHa)).padEnd(12)}${show(bd(w, buildMatchers(EX_SUCH))).padEnd(26)}${show(bd(w, buildMatchers(EX_ALL)))}`);
}
db.close();
