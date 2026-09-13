#!/usr/bin/env node
/**
 * v0.10.0 UI 契约脚本（REQ-V10-001 · AC-16⑦ / AC-17 · DoD D20）
 *
 * 作用：**只读源文件文本断言** —— 在没有浏览器/桌面的情况下，机械判定
 *       「语言分离」与「第 5 面板」这两件事是否真的落进了代码。
 *
 * ★ 免责声明（DoD D20 要求必须写明）：**文本级契约不替代真实渲染验证**。
 *   本脚本只能证明「代码里有这些结构」，不能证明「界面长得对、点得动」。
 *   ⇒ 必须配合 REQ.md §8.4 的**一次 UI 冒烟**（浏览器 localStorage 路径 + 桌面 SQLite 路径各一遍）。
 *
 * 用法（任意 cwd 均可，路径以本脚本位置解析）：
 *   node scripts/check_v10_ui_contract.mjs
 * 退出码：全部通过 = 0；任一断言失败 = 1。
 *
 * ★ 已知豁免（**有意为之，非遗漏**）：`apps/web/src/App.tsx` 的 `refreshBook()` 用
 *   `bookList()`（不传 lang）读取**全量**生词 —— 它服务的是「跨语言状态判定」
 *   （`toggleBook` 需要知道 (word, lang) 到底在不在生词本里），**不是列表展示读取**。
 *   列表展示读取全部发生在子面板内，且**必须显式传 lang**（下方断言 ③④）。
 *   判定口径依据 AC-16 第 7 条：「UI 层的每一处列表读取都必须显式传 lang」——
 *   `App.tsx` 这一处不是列表读取，故豁免；两处子面板才是。
 *
 *   ★ T39 更正记档：主管曾一度把该处列为「剩余缺口」要求改为显式传 lang；
 *   **该判定已撤回**（若此处只取单一语言，`(b.lang ?? 'en') === entryLang` 的跨语言判定会误判）。
 *   ⇒ 本豁免**继续有效**，并由下方 `lacks` 断言反向锁定（App 不得改成带语言的读取）。
 *   App 持有的 `bookLang` 仅用于**面板子页签语言**（并按 AC-16② 持久化），不参与该次读取。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

let pass = 0;
let fail = 0;
const failures = [];

/** 断言：文件存在且内容含 pattern（正则或字符串） */
function has(file, label, pattern) {
  const src = read(file);
  const ok =
    src !== null && (pattern instanceof RegExp ? pattern.test(src) : src.includes(pattern));
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}  ← ${file} 缺 ${pattern}`);
    console.log(`  ✗ ${label}  ← ${file} 缺 ${String(pattern)}`);
  }
}

/** 断言：文件内容**不含** pattern（用于「不得再出现旧写法」） */
function lacks(file, label, pattern) {
  const src = read(file) ?? '';
  const bad = pattern instanceof RegExp ? pattern.test(src) : src.includes(pattern);
  if (!bad) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}  ← ${file} 仍含 ${String(pattern)}`);
    console.log(`  ✗ ${label}  ← ${file} 仍含 ${String(pattern)}`);
  }
}

function warn(label, detail) {
  console.log(`  ⚠ ${label}${detail ? `  ← ${detail}` : ''}`);
}

console.log('== v0.10.0 UI/契约检查（文本级，不替代渲染验证）==\n');

/* ---------------- 块 A：AC-17 第 5 面板 ---------------- */
console.log('[块 A] AC-17 词根分类独立面板（第 5 面板）');
has('apps/web/src/App.tsx', "Panel 联合类型含 'rootclass'", /type Panel\s*=[^;]*'rootclass'/);
has(
  'apps/web/src/App.tsx',
  "Panel 联合类型恰 5 个成员（lookup/book/lexicon/rootclass/settings）",
  /type Panel\s*=\s*'lookup'\s*\|\s*'book'\s*\|\s*'lexicon'\s*\|\s*'rootclass'\s*\|\s*'settings'/,
);
has('apps/web/src/App.tsx', '顶层导航渲染「🌱 词根分类」按钮', /🌱 词根分类/);
has('apps/web/src/App.tsx', 'App.tsx 引用 RootClassPanel', /RootClassPanel/);
has(
  'apps/web/src/App.tsx',
  "activePanel === 'rootclass' 时渲染 RootClassPanel",
  /activePanel === 'rootclass'[\s\S]{0,120}<RootClassPanel/,
);
has('apps/web/src/components/RootClassPanel.tsx', 'RootClassPanel.tsx 存在', /export default function RootClassPanel/);
has(
  'apps/web/src/components/RootClassPanel.tsx',
  'AC-17② 面板内分英/俄两个子页签',
  /🇬🇧 英语[\s\S]*🇷🇺 俄语/,
);
has(
  'apps/web/src/components/RootClassPanel.tsx',
  'AC-17④ 代码注释写明与 LexiconPanel 的职责区分',
  /职责区分[\s\S]{0,200}LexiconPanel/,
);
has(
  'apps/web/src/components/RootClassPanel.tsx',
  'AC-17④ 生词本为空时显示空态（不得回退成全库词根表）',
  /生词本为空/,
);
has(
  'apps/web/src/components/LexiconPanel.tsx',
  'AC-17④ LexiconPanel 侧同样写明职责区分',
  /全库.*词根\/词缀表[\s\S]{0,200}RootClassPanel|RootClassPanel[\s\S]{0,200}生词本/,
);
has('apps/web/src/styles.css', '子页签/下拉有样式（.book-lang-tabs / .lang-tab）', /\.book-lang-tabs\s*\{[\s\S]*?\.lang-tab\s*\{/);
console.log('');

/* ---------------- 块 B：AC-16 生词本语言分离（UI 层） ---------------- */
console.log('[块 B] AC-16 生词本 UI 语言分离');
has('apps/web/src/components/BookPanel.tsx', 'AC-16② 面板内英/俄两个子页签', /🇬🇧 英语[\s\S]*🇷🇺 俄语/);
has(
  'apps/web/src/components/BookPanel.tsx',
  'AC-16③ 计数按语言分别计算（使用当前语言的 list 计数）',
  /共 \{list\.length\} 词/,
);
has(
  'apps/web/src/components/BookPanel.tsx',
  'AC-16③ 状态筛选计数按语言分别计算',
  /list\.filter\(\(i\) => i\.status === f\.key\)\.length/,
);
has(
  'apps/web/src/components/BookPanel.tsx',
  'AC-16④ 添加框保留 isCyrillic 自动判语言',
  /isCyrillic\(w\)\s*\?\s*'ru'\s*:\s*'en'/,
);
has('apps/web/src/components/BookPanel.tsx', 'AC-16④ 提供手动覆盖语言的控件', /<select[\s\S]{0,300}book-lang-select|book-lang-select/);
// ★ T39 更正（主管复核后定稿）：App 的 `bookList()`（不传 lang，全量）**是刻意的豁免**，
//   不是缺陷 —— 它服务跨语言状态判定（`(b.lang ?? 'en') === entryLang`），见文件头豁免段。
//   列表展示读取全部在子面板内，且**必须显式传 lang**（下方两条断言）。
lacks('apps/web/src/App.tsx', 'AC-16⑦ App 的跨语言判定读取是全量（无 lang 过滤，见文件头豁免段）', /\.bookList\(\s*bookLang\s*\)/);
has(
  'apps/web/src/App.tsx',
  'AC-16② 子页签语言由 App 持有并持久化（zidian-book-lang）',
  /zidian-book-lang/,
);
has(
  'apps/web/src/components/BookPanel.tsx',
  'AC-16② 子页签值来自 props（lang / onLangChange）',
  /onClick=\{\(\) => \{[\s\S]{0,80}onLangChange\(t\.key\)/,
);
has(
  'apps/web/src/components/BookPanel.tsx',
  'AC-16⑦ 面板列表读取显式传 lang（bookList(lang)）',
  /\.bookList\(\s*lang\s*\)/,
);
lacks('apps/web/src/components/BookPanel.tsx', 'AC-16⑦ 面板无「不传 lang」的列表读取', /\.bookList\(\s*\)/);
has(
  'apps/web/src/components/BookPanel.tsx',
  'AC-16⑦ 分组读取显式传 lang（bookGroups?.(lang)）',
  /\.bookGroups\?\.\(\s*lang\s*\)/,
);
has(
  'apps/web/src/components/BookPanel.tsx',
  '删除按 (word, lang) 传语言',
  /bookRemove\(item\.word,\s*item\.lang \?\? lang\)/,
);
has('apps/web/src/App.tsx', 'AC-16⑦ toggleBook 按 (word, lang) 判定（跨语言可见）', /\(b\.lang \?\? 'en'\) === entryLang/);
has('apps/web/src/App.tsx', 'AC-16⑦ toggleBook 删除时传 entryLang', /bookRemove\(word,\s*entryLang\)/);
has(
  'apps/web/src/components/ClipboardPopup.tsx',
  'AC-16 剪贴板浮窗同样按语言加入/删除',
  /bookRemove\(detail\.word,\s*lang\)/,
);
console.log('');

/* ---------------- 块 C：D18 localStorage 语言隔离 ---------------- */
console.log('[块 C] D18 localStorage 语言隔离 + 一次性迁移');
has('apps/web/src/api.ts', 'BOOK_LOCAL_KEY 仍在（键名不变，兼容老数据）', /BOOK_LOCAL_KEY\s*=\s*'zidian-book-local'/);
has('apps/web/src/api.ts', '存储结构带 version', /BOOK_LOCAL_VERSION\s*=\s*2/);
has('apps/web/src/api.ts', '条目结构含 lang（写入时带 lang）', /interface LocalBookFile[\s\S]{0,120}items:\s*BookItem\[\]/);
has('apps/web/src/api.ts', '旧数据按 isCyrillic 归语言', /inferLang\([\s\S]{0,80}isCyrillic/);
has('apps/web/src/api.ts', '兼容旧的裸数组结构（v1）', /Array\.isArray\(parsed\)/);
has('apps/web/src/api.ts', '读取时校验并直接显示（不依赖缺省 lang）', /function itemLang\(/);
has('apps/web/src/api.ts', 'restBackend.bookList 支持 lang 过滤', /async bookList\(lang\?: string\)/);
has('apps/web/src/api.ts', 'electronBackend 透传 lang', /bookList:\s*\(lang\)\s*=>\s*api\.bookList\(lang\)/);
console.log('');

/* ---------------- 块 D：D19 契约与 IPC 贯通 ---------------- */
console.log('[块 D] D19 契约与 IPC 贯通');
has('packages/core/src/types.ts', 'DictBackend.bookList(lang?)', /bookList\(lang\?: string\)/);
has('packages/core/src/types.ts', 'DictBackend.bookRemove(word, lang?)', /bookRemove\(word: string, lang\?: string\)/);
has('packages/core/src/types.ts', 'DictBackend.bookGroups(lang?)', /bookGroups\?\(lang\?: string\)/);
has('apps/desktop/src/preload.mjs', 'preload bookList 透传 lang', /bookList:\s*\(lang\)\s*=>\s*ipcRenderer\.invoke\('book:list',\s*lang\)/);
has('apps/desktop/src/preload.mjs', 'preload bookRemove 透传 lang', /bookRemove:\s*\(word,\s*lang\)/);
has('apps/desktop/src/preload.mjs', 'preload bookGroups 透传 lang', /bookGroups:\s*\(lang\)/);
has('apps/desktop/src/main.mjs', "IPC book:list 接收 lang", /ipcMain\.handle\('book:list',\s*\(_e,\s*lang\)/);
has('apps/desktop/src/main.mjs', "IPC book:remove 接收 lang", /ipcMain\.handle\('book:remove',\s*\(_e,\s*word,\s*lang\)/);
has('apps/desktop/src/main.mjs', "IPC book:groups 接收 lang", /ipcMain\.handle\('book:groups',\s*\(_e,\s*lang\)/);
// ★ T39（裁决十九）：IPC 通道是弱类型，`book:update` 的 `item.lang` 若缺失，核心
//   `bookUpdate` 会落到 `item.lang ?? existingLangForWord(db, w) ?? BOOK_DEFAULT_LANG` —— 按
//   「未删除优先 + 最近更新」挑一条，**不按语言** ⇒ 同词双语言时可能改错语言条。
//   故本层**必须**校验 `item.lang` 后放行（缺省即拒绝），下面四条把该红线锁死：
has(
  'apps/desktop/src/main.mjs',
  'AC-13⑦/裁决十九 IPC book:update 取到 item 后先校验（不裸透传）',
  /ipcMain\.handle\('book:update',\s*\(_e,\s*item\)[\s\S]{0,300}?const lang = it\.lang;/,
);
has(
  'apps/desktop/src/main.mjs',
  'AC-13⑦/裁决十九 book:update 校验 item.lang 合法（en|ru），非法即拒绝',
  /if \(lang !== 'en' && lang !== 'ru'\)\s*\{[\s\S]{0,200}?throw new Error\(/,
);
has(
  'apps/desktop/src/main.mjs',
  'AC-13⑦/裁决十九 校验通过后才调 bookUpdate（传已校验的 it）',
  /return bookUpdate\(db,\s*it\);/,
);
lacks(
  'apps/desktop/src/main.mjs',
  'AC-13⑦/裁决十九 已消除「无校验裸透传 item」的旧写法',
  /ipcMain\.handle\('book:update',[^)]*\)\s*=>\s*bookUpdate\(db,\s*item\)/,
);
has(
  'apps/sync-server/src/index.ts',
  'sync-server /book-groups 读 lang 入参',
  /book-groups'\)[\s\S]{0,200}searchParams\.get\('lang'\)/,
);
console.log('');

/* ---------------- 块 E：AC-12/D16 数据层（复核，防 UI 先行而底层没改） ---------------- */
console.log('[块 E] AC-12 / D16 数据层复核');
has('packages/core/src/db/schema.ts', 'SCHEMA_SQL 新库直接建复合主键', /PRIMARY KEY\s*\(word,\s*lang\)/);
has(
  'packages/core/src/db/schema.ts',
  'D14 未给新列写 CREATE INDEX（铁律）',
  /CREATE INDEX IF NOT EXISTS idx_book_updated ON book\(updated_at\)/,
);
has('packages/core/src/db/index.ts', 'D13 迁移在 openDatabase 内调用', /migrateBookLang\(db\);[\s\S]{0,80}migrateBookCompositeKey\(db\);/);
has('packages/core/src/db/index.ts', 'D15 迁移事务化（BEGIN IMMEDIATE）', /BEGIN IMMEDIATE/);
has('packages/core/src/db/index.ts', 'D15/AC-12⑧ 迁移前备份 .bak-<ISO>', /\.bak-\$\{new Date\(\)\.toISOString\(\)/);
has('packages/core/src/db/index.ts', 'AC-12⑧ 备份失败 ⇒ 放弃迁移', /备份失败[\s\S]{0,200}放弃迁移/);
has('packages/core/src/db/index.ts', 'D16 冲突目标 = (word, lang)', /ON CONFLICT\(word,\s*lang\) DO UPDATE/);
lacks('packages/core/src/db/index.ts', "D16 已消除 ON CONFLICT(word) 旧写法", /ON CONFLICT\(word\) DO UPDATE/);
lacks('packages/core/src/db/index.ts', "D16 已消除 `it.lang ?? 'en'` 隐式回退", /it\.lang \?\? 'en'/);
has('packages/core/src/db/index.ts', 'AC-13⑤ 墓碑保留原语言（bookRemove 带 lang）', /export function bookRemove\(db: DatabaseSync, word: string, lang\?: string\)/);
has('packages/core/src/db/index.ts', 'AC-14 syncMerge 按 (word, lang) 比对 updated_at', /SELECT updated_at FROM book WHERE word = \? AND lang = \?/);
console.log('');

/* ---------------- 块 F：D21 新增测试是否已接入门禁（条件式） ---------------- */
console.log('[块 F] D21 门禁接入（条件式；加链责任方 = 主管，见 AC-18②）');
{
  const testExists = fs.existsSync(path.join(ROOT, 'packages/core/test/book_lang.mjs'));
  const pkg = read('packages/core/package.json') ?? '';
  const chained = /book_lang\.mjs/.test(pkg);
  if (!testExists) {
    warn('packages/core/test/book_lang.mjs 尚未落地（作者 = 测试 agent，T36）⇒ 加链断言暂缓，不判失败');
    if (chained) {
      fail++;
      failures.push('book_lang.mjs 未落地却已加进门禁链（会崩 pnpm test）');
      console.log('  ✗ 门禁链已含 book_lang.mjs，但测试文件不存在 ⇒ 会崩 pnpm test');
    } else {
      pass++;
      console.log('  ✓ 门禁链未提前加链（符合 AC-18② 顺序要求：文件落地后才加）');
    }
  } else if (chained) {
    pass++;
    console.log('  ✓ book_lang.mjs 已落地且已接入门禁链');
  } else {
    fail++;
    failures.push('book_lang.mjs 已落地但未接入 pnpm test 链（AC-18②）');
    console.log('  ✗ book_lang.mjs 已落地但未接入门禁链（应由主管执行加链）');
  }
}
console.log('');

/* ---------------- 汇总 ---------------- */
console.log(`== 结果：${pass} 通过 / ${fail} 失败 ==`);
if (fail) {
  console.log('\n失败项：');
  for (const f of failures) console.log(`  - ${f}`);
  console.log('\n提醒：本脚本是**文本级契约**，通过 ≠ 界面可用；仍须按 REQ.md §8.4 做一次 UI 冒烟。');
  process.exit(1);
}
console.log('\n提醒：文本级契约已通过 ≠ 界面可用 —— 请按 REQ.md §8.4 走一次 UI 冒烟（两条存储路径都要走）。');
process.exit(0);
