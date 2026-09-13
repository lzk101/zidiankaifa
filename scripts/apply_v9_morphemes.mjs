// scripts/apply_v9_morphemes.mjs
// v0.9.0 词素落库（T29）——**幂等**，带备份。
//
// 依据：
//   - 主管判分探针 scripts/out_sup_v9_decide.txt（§0 保真自检 0 例不一致）
//   - 开发 agent T24 完整回执的联网来源（ru.wiktionary {{морфо-ru}}，URL 见下）
//   - 需求 agent AC-11 词素落库门（.board/REQ.md:441）与 DEC-004-R1 审定流程
//
// 落库条目（8 条）：
//   ① 真词素（附来源 + 实测边际增益）
//      суч-    root    «сук» 的软腭交替形           修复 V9-2 суч- 家族 11 词
//      суд-    root    审判、判断                    修复 D4.5 самосуд
//      домин-  root    支配（拉丁 dominari）         修复 D4.3 доминировать
//      -ной    suffix  -ный 的重音变体               修复 D4.4 больной（并使 90 词空洞变少、0 词变差）
//   ② 整词兜底条目（AC-11(f)：non-真实词素，单列 + origin 注明「抑制假词根、非语义切分」）
//      столп-     抑制 столп→стол- 假词根
//      казус-     抑制 казус→каз- 假词根（拉丁 cāsus 单词素）
//      однако-    抑制 однако→дн- 假词根（单词素）
//      термостат- 该词为 терм-+-о-+стат 复合，但 стат- 入库会污染 достать/застать/верстать 等 68 词 ⇒ 采用兜底
//
// 用法: node scripts/apply_v9_morphemes.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const FILE = path.join(REPO, 'packages', 'data-pipeline', 'roots_ru.json');
const CHECK = process.argv.includes('--check');

const NEW = [
  {
    morpheme: 'суч-', kind: 'root', meaningZh: '节、枝节', meaningEn: 'knot, branch',
    origin: '原始斯拉夫语 *sǫkъ（сук 的软腭交替形 суч-）；来源 https://ru.wiktionary.org/w/index.php?oldid=13801399 {{морфо-ru|суч|-ок|+∅|и=т}}',
    examples: ['сучок', 'сучковатый', 'сучковый', 'сучить', 'сучкорезка', 'сучение'],
  },
  {
    morpheme: 'суд-', kind: 'root', meaningZh: '审判、判断', meaningEn: 'judge, court',
    origin: '原始斯拉夫语 *sǫdъ；来源 https://ru.wiktionary.org/wiki/самосуд {{морфо-ru|сам|-о-|суд|и=т}}',
    examples: ['суд', 'судить', 'самосуд', 'осудить', 'правосудие'],
  },
  {
    morpheme: 'домин-', kind: 'root', meaningZh: '支配、统治', meaningEn: 'dominate',
    origin: '拉丁语 dominari（经德语 dominieren）；来源 https://ru.wiktionary.org/w/index.php?oldid=13281907 {{морфо-ru|домин|-ир-|-ова|+ть|и=т}}',
    examples: ['доминировать', 'доминирование', 'доминанта'],
  },
  {
    morpheme: '-ной', kind: 'suffix', meaningZh: '形容词（具有…性质的，重音变体）', meaningEn: 'adj. (stressed variant of -nyj)',
    origin: '原始斯拉夫语 *-ьnъ 的重音变体（库内已有 -ный；本地词源 chain 记 больной = ["боль","-ной"]）',
    examples: ['больной', 'внеземной', 'головной', 'заводной', 'выходной'],
  },
  {
    morpheme: 'столп-', kind: 'root', meaningZh: '柱（整词兜底）', meaningEn: 'pillar (whole-word guard)',
    origin: '⚠ 兜底条目·非语义切分：抑制 столп→стол- 假词根。столп 为单词素 https://ru.wiktionary.org/wiki/столп {{морфо-ru|столп|и=т}}；本条目仅用于阻断假词族，不代表构词分析',
    examples: ['столп', 'столпиться', 'столпотворение'],
  },
  {
    morpheme: 'казус-', kind: 'root', meaningZh: '案例（整词兜底）', meaningEn: 'case (whole-word guard)',
    origin: '⚠ 兜底条目·非语义切分：抑制 казус→каз- 假词根。казус 借自拉丁 cāsus，为单词素 https://ru.wiktionary.org/wiki/казус {{морфо-ru|казус|и=т}}',
    examples: ['казус', 'казусный'],
  },
  {
    morpheme: 'однако-', kind: 'root', meaningZh: '然而（整词兜底）', meaningEn: 'however (whole-word guard)',
    origin: '⚠ 兜底条目·非语义切分：抑制 однако→дн- 假词根。однако 为单词素 https://ru.wiktionary.org/wiki/однако {{морфо-ru|однако|и=т}}',
    examples: ['однако'],
  },
  {
    morpheme: 'термостат-', kind: 'root', meaningZh: '恒温器（整词兜底）', meaningEn: 'thermostat (whole-word guard)',
    origin: '⚠ 兜底条目·非语义切分：термостат 实为 терм-+-о-+стат 复合（https://ru.wiktionary.org/w/index.php?oldid=5359108 ，корень -стат- ← 希腊语 στᾰτός），但 стат- 入库会使 достать/застать/верстать/вырастать 等 68 词产生中段误配、并使 экстатический 失去拆解 ⇒ 本迭代采用兜底，语义正解记入 v0.10.0',
    examples: ['термостат'],
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

if (CHECK) {
  console.log('--check 模式：未写入。');
  process.exit(0);
}
if (!toAdd.length) {
  console.log('全部已存在 ⇒ 幂等，未改动。');
  process.exit(0);
}

// 备份
const bak = `${FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(FILE, bak);
console.log(`  已备份 → ${path.basename(bak)}`);

const merged = [...arr, ...toAdd];
// 维持原文件的 morpheme 字典序（原 441 条即按此排序）
merged.sort((a, b) => (a.morpheme < b.morpheme ? -1 : a.morpheme > b.morpheme ? 1 : 0));

fs.writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`【落库后】条目 ${merged.length}（+${merged.length - before}）`);

// 校验
const check = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const kinds = {};
for (const e of check) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log(`  各 kind：${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
for (const e of NEW) {
  const hit = check.find((x) => x.morpheme === e.morpheme);
  if (!hit) { console.error(`  ❌ 校验失败：${e.morpheme} 未写入`); process.exit(1); }
  if (hit.kind !== e.kind) { console.error(`  ❌ 校验失败：${e.morpheme} kind=${hit.kind} 期望 ${e.kind}`); process.exit(1); }
}
console.log('  ✔ 8 条全部校验通过（morpheme/kind 一致）');
console.log('\n下一步：$env:PYTHONIOENCODING=\'utf-8\'; python packages/data-pipeline/build_db.py morphemes');
