// scripts/apply_v9_morphemes2.mjs
// v0.9.0 词素落库（第二批 T29b）——**幂等**，带备份。
//
// 依据：主管判分探针 scripts/out_sup_v9_decide.txt「★★ 落库终案」段（§0 保真 0 例不一致）
//   → 可拆 33495(+94) · ΔA −28 · ΔB −28 · Δ率A −0.2539pp · Δ率B −0.2418pp
//   → 真前缀组 63 ✅ · да- 63 ✅ · R 241=30.47% ✅ · L4 132 ✅ · D1 0 ✅ · loses 0 ✅
//
// 落库 2 条（复合词第二词根，均有 ru.wiktionary {{морфо-ru}} 硬词源）：
//   пад-   root  落、坠   修 водопад   （D2 6 条断言中的 1 条 + 语义 §4 1 条）
//   тряс-  root  抖、震   修 землетрясение（D2 的 2 条 + 语义 §4 2 条）
//
// ⚠ 明确**不落** стат-：实测代价为丢 экстатический（空洞 13）+ 68 词中段出现 {до- стат- -ать} 类假词根，
//    唯一收益是 термостат（1 条断言）⇒ 依 DEC-002「正确性 > 覆盖率」否决，термостат 归 D2 类留红。
//
// ★ 注意 build_db.py 的 build_morphemes 只做 INSERT OR REPLACE、**不清表** ⇒ 从 JSON 删条目会残留 stale 行。
//    本脚本只新增，不删除，故无此风险。
//
// 用法: node scripts/apply_v9_morphemes2.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const FILE = path.join(REPO, 'packages', 'data-pipeline', 'roots_ru.json');
const CHECK = process.argv.includes('--check');

const NEW = [
  {
    morpheme: 'пад-', kind: 'root', meaningZh: '落、坠', meaningEn: 'fall',
    origin: '原始斯拉夫语 *pasti；来源 https://ru.wiktionary.org/wiki/водопад {{морфо-ru|вод|-о-|пад|и=т}}（падать = {{морфо-ru|пад|-а|+ть|и=т}}）',
    examples: ['водопад', 'звездопад', 'падение', 'листопадный', 'нападать'],
  },
  {
    morpheme: 'тряс-', kind: 'root', meaningZh: '抖、震', meaningEn: 'shake, quake',
    origin: '原始斯拉夫语 *tręsti；来源 https://ru.wiktionary.org/w/index.php?oldid=13948603 {{морфо-ru|земл|-е-|тряс|-ениj|+е|и=т}}（трясти = {{морфо-ru|тряс|+ти|и=т}}）',
    examples: ['землетрясение', 'трясти', 'потрясать', 'сотрясать', 'натрясать'],
  },
];

const raw = fs.readFileSync(FILE, 'utf8');
const arr = JSON.parse(raw);
const before = arr.length;
const existing = new Set(arr.map((e) => e.morpheme));

const toAdd = NEW.filter((e) => !existing.has(e.morpheme));
const skipped = NEW.filter((e) => existing.has(e.morpheme)).map((e) => e.morpheme);

console.log(`【落库前】roots_ru.json 条目 ${before}`);
console.log(`  已存在跳过：${skipped.length ? skipped.join(' ') : '（无）'}`);
console.log(`  待新增：${toAdd.length ? toAdd.map((e) => `${e.morpheme}(${e.kind})`).join(' ') : '（无）'}`);

if (CHECK) { console.log('--check 模式：未写入。'); process.exit(0); }
if (!toAdd.length) { console.log('全部已存在 ⇒ 幂等，未改动。'); process.exit(0); }

const bak = `${FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(FILE, bak);
console.log(`  已备份 → ${path.basename(bak)}`);

const merged = [...arr, ...toAdd];
merged.sort((a, b) => (a.morpheme < b.morpheme ? -1 : a.morpheme > b.morpheme ? 1 : 0));
fs.writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`【落库后】条目 ${merged.length}（+${merged.length - before}）`);

const check = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const kinds = {};
for (const e of check) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log(`  各 kind：${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
let bad = 0;
for (const e of NEW) {
  const hit = check.find((x) => x.morpheme === e.morpheme);
  if (!hit || hit.kind !== e.kind) { console.error(`  ❌ 校验失败：${e.morpheme}`); bad++; }
}
if (bad) process.exit(1);
console.log('  ✔ 2 条全部校验通过');
console.log('\n下一步：$env:PYTHONIOENCODING=\'utf-8\'; python packages/data-pipeline/build_db.py morphemes');
