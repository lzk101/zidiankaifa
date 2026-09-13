/**
 * book_lang.mjs —— 生词本**语言分离**判别集（功能测试 agent · T36）
 *
 * 被测对象：`packages/core/dist/**`（**不是** `src`）—— 本项目测试一律测 dist，
 *   因 `dist` 才是 core / desktop / sync-server 三条入口实际加载的产物。
 * 判据来源：`.board/REQ.md` §8.2 的 **AC-12 / AC-13 / AC-14 / AC-16（存储侧）** 与
 *   **DEC-021**（`DECISIONS.md:444`，用户三项架构拍板）。
 *
 * ------------------------------------------------------------------ *
 * 0. 为什么要独立建这一份（作者 = 测试 agent，开发 agent 不得改）
 * ------------------------------------------------------------------ *
 * `(word, lang)` 复合主键是**会动用户数据**的迁移：写错一个 `ON CONFLICT` 或漏掉墓碑，
 * 用户的生词本会**静默丢失**。AC-12 / AC-13 / AC-14 要求「可机械判定」⇒ 必须有独立判别集，
 * 且**不得**与开发 agent 的实现自测共享同一份（共享即自我验证）。
 *
 * ★ 定位声明（沿用 `REQ.md` §8.1-A，**不得**夸大）：本组断言保护的是**设计正确性**，
 *   不是「正在丢数据」。实测英俄同形词 = 0 ⇒ **当前无触发条件，但约束缺失**。
 *
 * ------------------------------------------------------------------ *
 * 1. 五块 + 块级计数行
 * ------------------------------------------------------------------ *
 *   [A] 迁移（AC-12）        —— 新库直建复合主键 / 老库两变体（有 `lang` / 无 `lang`）自动迁移
 *                                + 逐字段保真（含墓碑）+ 幂等 + 备份文件 + 失败不改老库
 *   [B] 跨语言隔离（AC-13）  —— 同 `word` 不同 `lang` 互不影响；★ 墓碑 `lang` 不得被写成 `'en'`
 *   [C] 同步合并键（AC-14）  —— `syncMerge` 按 `(word, lang)`；`sync-server` 协议不变
 *   [D] 语言判定与既有数据（AC-16 存储侧 / AC-13⑦）
 *   [E] 备份一致性（AC-12⑧ · T41 提出 / T42 升级为红断言 / **T46 随实现变更重写**）
 *        —— ★ 非空 WAL 下「备份含全部已提交行」+ 备份**逻辑等价**于迁移前源库 + 变体 dist 鉴别力自证
 *           + 「busy 放弃迁移」缺陷**已消除**的正面证明（E15 由「登记缺陷」反转为「证明缺陷不存在」）
 * 每块末尾输出块级计数行，格式承接 `ru_morph_d1guard.mjs`：
 *   `[A] 迁移（AC-12）：<p> 通过 / <f> 失败（共 <n> 条断言）`
 * 末行输出总计：`结果：<p> 通过 / <f> 失败（共 <n> 条断言）`
 * 退出码：**0 = 五块全绿 · 1 = 任一块有失败**（AC-18②「任一块失败即 exit ≠ 0」）
 *   ⇒ 失败项**即真实发现**，不得为迎合实现而弱化（`test-agent.md` 铁律 5 / `REQ.md` §8.6-4）。
 *
 * ------------------------------------------------------------------ *
 * 1b. T46 变更说明（★ 为什么 7 条旧断言曾变红 —— 记录在案，勿再误读为「测试写错了」）
 * ------------------------------------------------------------------ *
 * T42 建的块 E 有 23 条断言，**当时全绿**；主管 T45 换实现后 7 条变红（T46 重写后块 E = 26 条，
 * 全文件 121 → **132** 条；T50 随 T49 复用策略再 **+2** → **134** 条，见 §1c；
 * **T52 随 T51 判据收紧再 +3 → 137 条**，见 §1d）。这不是断言写错，而是
 * **断言有鉴别力**的证据：
 *   · E6/E20 断言「备份与主库**逐字节相等**」—— 那是**方案 A**（`wal_checkpoint(TRUNCATE)` +
 *     `copyFileSync`）的同构性质，名字里已写明「换成 `VACUUM INTO` 即红」。T45 改用 `VACUUM INTO`
 *     （一致性快照导出，页布局重排）⇒ 按设计变红 ⇒ 本文件据 T45 实现改为**逻辑内容比较**，
 *     并把「逐字节相等」**反转**为反向守卫（E6b/E21b：生产不得再逐字节相等）。
 *   · E11–E14 的变体补丁删的是 checkpoint 代码段；生产已无该段 ⇒ 补丁失配 ⇒ 守卫按设计变红
 *     （「补丁失配即红，强制人工复核」机制**保留**）。现改为：把 `VACUUM INTO` 换成
 *     `fs.copyFileSync(主库文件)` = 方案0，重做鉴别力自证。
 *   · E15 登记的是「checkpoint 遇并发读者 ⇒ busy ⇒ 放弃迁移」这一**降级路径**；T45 用
 *     `VACUUM INTO`（单读事务内完成、**无 busy 分支**）从根上消除它 ⇒ E15 **反转**为
 *     「持未结束读事务时备份仍成功 ∧ 迁移仍完成 ∧ 无放弃迁移警告」。
 * ★ 结论：块 E 的鉴别力来自「同一夹具 + 同一判据在**变体实现**下必须变红」，与实现细节解耦。
 *
 * ------------------------------------------------------------------ *
 * 1c. T50 变更说明（★ 受 T49 影响的断言**全部**在下面列出 —— 其余 130 余条未受影响）
 * ------------------------------------------------------------------ *
 * 主管 T49 把迁移前备份抽成独立函数 `ensurePreMigrationBackup(db)` 并**复用**（采纳需求 agent T47 异议 4）：
 *   `book_new` 残留触发的**重试**会第二次进入备份段 —— 若不判断，**一次自愈落两份整库快照**
 *   （桌面端 `dict.db` 约 **494 MB** ⇒ 约 **1 GB** 磁盘占用）。
 *   ⇒ **T49 语义（已被 T51 取代，见 §1d）**：同目录内已存在**非空**的
 *     `<库文件名>.bak-<任意后缀>` 即**复用**、不新建（刻意不校验内容与新鲜度，属磁盘卫生优化）。
 * 对本文件的影响（T50 已逐条复核）：
 *   · **A33（红 → 绿）**：备份数期望 `== 2` → **`== 1`**。份数**不再**是迁移尝试次数的上界；
 *     「至多一次重试 / 不递归」的证据改由「恰 2 条警告」承担，「复用确实发生」由复用日志承担。
 *   · **A28 / A28b**：断言在复用语义下仍成立，但**原文推理已过期**（「重试必落第 2 份」、
 *     「备份数即尝试次数上界」）⇒ 改写为「被复用的那份仍是有效迁移前快照」+「复用日志恰 1 条
 *     ∧ 备份数 == 1」。
 *   · **新增 A12b**（正常路径对照）：真迁移路径仍**新建**备份（迁移前 0 份 + 无复用日志），
 *     防止「一律复用」破坏 A4「新库不产生备份」/ A12「每库各一份备份」。
 *   · **新增 A33b**：被复用的那份备份**内容**仍是迁移前一致快照（行数 + 逐字段 + 主键 [word]
 *     + `integrity_check`），即复用不会把半迁移态文件当回退点。
 *
 * ------------------------------------------------------------------ *
 * 1d. T51 变更说明 —— ★★ 复用判据被**收紧**，日志文案随之改变（勿把它当成「只是改了个字」）
 * ------------------------------------------------------------------ *
 * 测试 agent 在 T50 用 `scripts/probe_t50_reuse_edges.mjs` 证明 T49 的**目录扫描式**判据过宽：
 *   · **S2（AC-12⑧ 第二道防线落空）**：真备份被删/从未建立、只剩 `<db>.bak-<ISO>-wal` sidecar，
 *     前缀匹配会命中该 sidecar ⇒ 打印「复用」、**不再新建** ⇒ **零可用快照**下完成迁移。
 *   · **S1（回退点数据不匹配）**：目录里留有**上一代**库的 `.bak-<ISO>` ⇒ 被当作本次迁移的回退点。
 * 主管 T51 采纳收紧方向，但用了**比我建议的「mtime 新鲜度」更窄的精确判据**（新鲜度是启发式：
 *   时钟回拨/同秒多库都会误判）：不再扫目录，只复用「**同一次迁移调用内、本次刚创建并
 *   `statSync().size > 0` 验证过**」的那一份 ——
 *   新增 `interface MigrationState { bak: string | null }`，`migrateBookCompositeKey(db, st, isRetry)`
 *   携带它（`packages/core/src/db/index.ts:240-290`），重试递归传**同一个** `st`。
 *   ⇒ sidecar 永远不会被记入 `st.bak`；跨代陈旧文件不在 `st` 里 ⇒ 一律新建；
 *     T49 的体积诉求（**一次自愈不落两份** 494 MB）由「重试复用同一份 `st.bak`」继续保住。
 * ★ 唯一变更点 = **日志文案**（判据语义变了 ⇒ 旧文案「复用已有迁移前备份」会误导后来者以为还在扫目录）：
 *     T49（旧）：`[zidiankaifa] 复用已有迁移前备份：<文件名>`
 *     T51（新）：`[zidiankaifa] 复用本次迁移已创建的快照：<文件名>`
 *   ⇒ 本文件把文案收进**唯一常量** `REUSE_LOG_RE` + 取值器 `reuseLogNames()`：A12b 的反向断言、
 *     A28b、A33、A28c–A28e **全部**经它匹配。⚠ 这是硬要求：反向断言（`== 0`）若仍匹配**旧串**，
 *     在新实现下恒为 0 ⇒ **假绿**（T52 修红时若只改正向两条，A12b 会静默失去鉴别力）。
 *   ⇒ 新增 **A28c / A28d / A28e** 三条断言把 T51 的收紧判据钉死（S2 正常路径 / S2 重试路径 / S1）。
 *   ⇒ ⚠ **T51 的代价（T52 新发现，见 A35 ⓘ③ 实测）**：**跨启动**复用消失 —— `openDatabase()`
 *     调用 `migrateBookCompositeKey(db)` **不传 `st`**（`packages/core/src/db/index.ts:133`），
 *     每次调用都是新的 `{ bak: null }` ⇒ 迁移**持续失败**时备份数由 T49 的 `[1,1,1]`
 *     回到 **`[1,2,3]`**（与 T46 同值）。即 T49「顺带修掉的累积」被 T51 交回，
 *     属**残余缺陷**（非断言登记，判定权在主管）：一次自愈仍是 1 份 ✔，但反复失败的启动会累积。
 *
 * ------------------------------------------------------------------ *
 * 2. 独立临时库（AC-12 判定载体要求）
 * ------------------------------------------------------------------ *
 * 全部夹具在 `scripts/_tmp/booklang_tmp/run-<随机>/` 下现建现拆，**不依赖 `data/db/dict.db`**
 * （`REQ.md` §8.2 通用口径：本迭代新增测试用独立临时库 ⇒ 天然两种 cwd 均可跑）。
 * ⇒ 本文件**只读**、**不写生产库**；`data/db/dict.db` 一次都不打开。
 * 全绿时自动清理临时目录；**有失败时保留**并打印路径，便于取证。
 *
 * ⚠ 预期噪声：以下 stderr 警告都是**被断言的对象**（不是本测试的故障）——
 *   · A25–A28：`检测到残留的 book_new 表，已清除并重试一次迁移`（有界重试路径）；
 *   · A30–A31：`book 表向 (word, lang) 复合主键迁移失败：view book_new already exists`（后置校验前的告警）；
 *   · A33–A34：`…迁移重试仍失败：there is already an index named book_new`（有界性证据）；
 *   · A25–A28 / A33：**stdout** 的 `[zidiankaifa] 复用本次迁移已创建的快照：<文件名>`
 *     （T51 语义的直接证据 —— 复用的是**本次迁移调用内刚创建**的那份，**不是**目录里任意旧件；
 *     被 A28b/A28d/A33 断言；⚠ 它是 `console.log` 不是 `console.warn`；T49 的旧文案
 *     `复用已有迁移前备份` 已随判据收紧废弃，本文件**不再**匹配该串，见 §1d）；
 *   · ⓘ 缺陷登记夹具：`备份失败（unable to open database: …），放弃迁移（数据优先）`。
 *
 * ------------------------------------------------------------------ *
 * 3. 已声明的**未覆盖**项（如实声明，不含糊）
 * ------------------------------------------------------------------ *
 *   ① `localStorage` 路径（`apps/web/src/api.ts`）**无法在 node 下执行**（无 `localStorage`）
 *      ⇒ 块 D 退化为**文本级契约断言**（AC-16⑤⑥ 明写「静态托管模式走的就是这条路径」，故仍须有判定）。
 *      文本级契约**不替代**真实渲染验证 ⇒ 仍须 `REQ.md` §8.4 的一次 UI 冒烟。
 *   ② ~~备份文件在 **WAL 模式下是否可独立恢复**~~ → **T36 提出（F1）· 主管复核成立 · T41 首版修复
 *      （方案 A）· T42 本文件升级为红断言 = 块 E · T45 主管换实现（方案 A → `VACUUM INTO`）
 *      · T46 本文件按新实现重写块 E**。现行实现：`db.exec(\`VACUUM INTO '<库>.bak-<ISO>'\`)`
 *      —— SQLite 官方一致性快照导出，**单个读事务内完成、无 busy 分支**（要么成功要么抛错）；
 *      代价是备份**不是**主库的逐字节副本（页布局重排 + `journal_mode=delete`）⇒ 判据从
 *      「逐字节相等」改为「**逻辑内容等价 + 独立可打开 + `integrity_check = ok`**」。
 *      受控实验见 `scripts/probe_t42_wal_fixture{,2,3}.mjs`、`scripts/probe_t46_*.mjs`。
 *      块 A 的 A29 仍保留**观察行**，但已标注「已被 T41 修复 / 充分性判定移至块 E」，不再留作悬案。
 *   ③ AC-12⑥ 的「异常 ROLLBACK」用**注入式故障**触发。★ T46 后该夹具（残留 `book_new` 表）
 *      **不再**导致「保留原表」—— 主管新增**有界重试**（清除残留后重试一次）⇒ 迁移**自愈成功**
 *      （A25–A28 据实测改写；★ T49 起该重试路径**复用首次备份**、不再落第二份，
 *       T51 起复用判据收紧为「**本次调用内**已创建并验证过」，见 §1d）；
 *      「迁移无法完成」这条分支改用**无法被 `DROP TABLE IF EXISTS` 清除**
 *      的残留对象（`book_new` 视图 / 索引）触发，见 A30–A34。
 *      **仍不覆盖**磁盘满 / 断电等物理故障。
 *   ④ 块 E 的夹具是**进程内**多连接（同进程 2–3 条连接）；**未覆盖**「跨进程（另一进程持库）」。
 *      「真断电/崩溃后残留 WAL」由 E18–E21b 以「主库 + 非空 `-wal`、无人持有」的副本形态覆盖。
 *      E8 的 VACUUM 对照是**机制级合成**对照，**不证生产路径**（已在断言名中写明）。
 *   ⑤ ★ **T46 实测发现的未闭环缺陷**（**登记为 ⓘ 观察行 + 末段 ⚠ 块，不写成红断言** ——
 *      本文件的硬约束是「两种 cwd 都必须 exit 0」，留红会破坏门禁；判定权在主管）：
 *      · **备份失败路径绕过后置校验**：`migrateBookCompositeKey` 内的 `catch { warn('备份失败…放弃迁移'); return; }`
 *        与 `取不到主库文件路径…return;` 两处 **`return` 都在后置校验之前** ⇒ 这条路径下
 *        `openDatabase()` **不抛错**，返回一个老结构连接（`bookList` 正常、`bookAdd` 全抛 ON CONFLICT）
 *        —— 即变更②要消除的静默降级**仍存在于该路径**。判别实验：冻结 `Date` + 预占备份名
 *        ⇒ `VACUUM INTO` 报 `output file already exists` ⇒ 实测未抛、主键 `["word"]`、
 *        `bookAdd(en)`/`bookAdd(ru)` 均抛 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`。
 *        复核：`scripts/probe_t46_backup_fail.mjs` ②。
 *      · **反复失败的启动累积整库大小的 `.bak`** —— ★ **状态随实现往复，勿照抄旧结论**：
 *        后置校验抛错前已落一份备份，而失败后 `book` 仍非复合主键 ⇒ 下次启动**再落一份**。
 *        T46 实测 `[1,2,3]` → **T49 复用策略曾把「累积」修掉**（第二次启动发现同目录已有非空
 *        `.bak-` 即复用 ⇒ `[1,1,1]`）→ **T51 收紧判据后回到 `[1,2,3]`**（复用的判据变成
 *        「**本次调用内**已创建」，跨 `openDatabase()` 调用不再复用，见 §1d）。
 *        **残余**：一次自愈仍只落 1 份 ✔，但**跨启动**会累积（首次的那份仍在、**无清理机制**）。
 *        复核：同上 ③（实测值随 A35 ⓘ 行打印）。
 *      · 警告文案`已清除并重试一次迁移`在残留对象是**索引**时**不实**（`sqlite_master` 里索引仍在）
 *        —— 后果安全（最终抛错），但日志会误导排查。复核：同上 ④。
 *
 * 运行（**两种 cwd 都必须 exit 0**，`AGENTS.md` 铁律 6）：
 *   cd <仓库根>                && node packages/core/test/book_lang.mjs
 *   cd <仓库根>/packages/core  && node test/book_lang.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
  bookAdd,
  bookGet,
  bookList,
  bookListAll,
  bookRemove,
  bookUpdate,
  syncMerge,
} from '../dist/db/index.js';
import { isCyrillic } from '../dist/lang.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP_ROOT = path.join(REPO_ROOT, 'scripts', '_tmp', 'booklang_tmp');

/* ================================================================== *
 * 断言脚手架（体例承接 packages/core/test/ru_morph_d1guard.mjs）
 * ================================================================== */
let totalPass = 0;

class Block {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.pass = 0;
    this.n = 0;
    this.fails = [];
  }
  ok(name, cond, detail = '') {
    this.n++;
    if (cond) {
      this.pass++;
      console.log(`  ✓ ${name}`);
    } else {
      const d = detail ? `  —— ${detail}` : '';
      this.fails.push(name + d);
      console.log(`  ✗ ${name}${d}`);
    }
  }
  eq(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    this.ok(name, a === e, `期望 ${e} / 实测 ${a}`);
  }
  /** 先打印块级计数行，再把失败项汇总抛给调用方 */
  done() {
    totalPass += this.pass;
    console.log(
      `[${this.id}] ${this.title}：${this.pass} 通过 / ${this.fails.length} 失败（共 ${this.n} 条断言）`,
    );
    return this.fails;
  }
}

/* ================================================================== *
 * 夹具：老结构 `book` 表（两种变体，AC-12②）
 *
 * 老结构 = `word TEXT PRIMARY KEY`（主键**不含** lang）。
 * 变体 1：有 `lang` 列（v0.7.x 起的老库，`migrateBookLang` 已加过列）
 * 变体 2：无 `lang` 列（更老的库；`migrateBookLang` 会先 ADD COLUMN）
 *
 * ⚠ 夹具设计要点（覆盖需求 agent 指出的盲区）：
 *   · 含 **拉丁词 + `lang='ru'`** 的行（`['test','ru']`）—— 与「用户手工把拉丁串以 ru 入库」同形，
 *     迁移**必须**保住 `'ru'`（不得按 `isCyrillic` 反推语言，`REQ.md` §8.5 第 4 条）。
 *   · 含 **墓碑**行（`deleted=1`）—— 迁移丢墓碑会破坏跨端同步的删除传播。
 *   · 含 **空串 `lang`** 行 —— 迁移的 `COALESCE(NULLIF(lang,''),'en')` 归一路径。
 * ================================================================== */
const COLS_WITH_LANG = `word TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'en',
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0`;
const COLS_NO_LANG = `word TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0`;

const FIXTURE_WITH_LANG = [
  // word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted
  ['abandon', 'en', 1000, 2000, 'learning', 'note-en', '["a","b"]', 3, 1500, 0],
  ['telephone', 'en', 1100, 2100, 'mastered', null, '[]', 7, null, 1], // en 墓碑
  ['test', 'ru', 1200, 2200, 'new', 'заметка', '["ru"]', 0, null, 0], // 拉丁词 + ru
  ['city', '', 1300, 2300, 'new', null, '[]', 1, 1400, 0], // 空串 lang
  ['проверка', 'ru', 1400, 2400, 'mastered', 'заметка-2', '["ru2"]', 2, 1450, 1], // ★ ru 墓碑
];
const FIXTURE_NO_LANG = [
  ['abandon', 1000, 2000, 'learning', 'note-en', '["a","b"]', 3, 1500, 0],
  ['telephone', 1100, 2100, 'mastered', null, '[]', 7, null, 1], // 墓碑
  ['city', 1300, 2300, 'new', null, '[]', 1, 1400, 0],
];

/** 建一个「老结构」库（含 idx_book_updated，AC-12⑦ 的迁移前基线） */
function makeOldDb(file, withLang, rows, extraSql = null) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE book (${withLang ? COLS_WITH_LANG : COLS_NO_LANG})`);
  db.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const stmt = withLang
    ? db.prepare(
        `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
    : db.prepare(
        `INSERT INTO book (word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
  for (const r of rows) stmt.run(...r);
  if (extraSql) db.exec(extraSql);
  db.close();
}

/** 逐字段快照（**显式列名 + ORDER BY** —— 迁移后列序会变，不能用 `SELECT *`） */
const SNAP_COLS = 'word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted';
function snapWithLang(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare(`SELECT ${SNAP_COLS} FROM book ORDER BY word, lang`).all();
  db.close();
  return rows.map((r) => [
    r.word, r.lang, r.added_at, r.updated_at, r.status, r.note, r.tags, r.review_count,
    r.last_reviewed_at, r.deleted,
  ]);
}
function snapNoLang(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT word, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted
       FROM book ORDER BY word`,
    )
    .all();
  db.close();
  return rows.map((r) => [
    r.word, r.added_at, r.updated_at, r.status, r.note, r.tags, r.review_count,
    r.last_reviewed_at, r.deleted,
  ]);
}
/** 只读探针：`PRAGMA table_info(book)` 的主键列集合 */
function pkCols(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const cols = db.prepare('PRAGMA table_info(book)').all();
  db.close();
  return cols
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => c.name);
}
function indexExists(file, name) {
  const db = new DatabaseSync(file, { readOnly: true });
  const n = db
    .prepare("SELECT COUNT(1) AS n FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name).n;
  db.close();
  return Number(n);
}
/* --- T46 新增只读探针（对应主管变更①`VACUUM INTO` / 变更②后置校验与有界重试） --- */

/** `PRAGMA journal_mode`：`VACUUM INTO` 产物 ⇒ `delete`；`copyFileSync(主库)` 产物 ⇒ 保持 `wal`
 *  （实测见 scripts/probe_t46_variant.mjs：生产 3 行/delete · 方案0 2 行/wal） */
function journalMode(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const m = db.prepare('PRAGMA journal_mode').get().journal_mode;
  db.close();
  return m;
}
/** `PRAGMA integrity_check` 是否为 `ok`（备份作为回退库的最低要求） */
function integrityOk(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const r = db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close();
  return r === 'ok';
}
/** `sqlite_master` 里名为 name 的对象类型（不存在 ⇒ null）。用于证明「残留 book_new 已清除」**属实** */
function sqliteObject(file, name) {
  const db = new DatabaseSync(file, { readOnly: true });
  const r = db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(name);
  db.close();
  return r ? r.type : null;
}
/** 备份作为**可独立打开的回退库**：能否按 `(word, lang)` 定位到那条只存在于 `-wal` 的行 */
function bakProbe(bakFile, word, lang) {
  const db = new DatabaseSync(bakFile, { readOnly: true });
  const rows = Number(db.prepare('SELECT COUNT(1) AS n FROM book').get().n);
  const hit = Number(
    db.prepare('SELECT COUNT(1) AS n FROM book WHERE word = ? AND lang = ?').get(word, lang).n,
  );
  db.close();
  return { rows, hit };
}
/** 目录内 `<db 文件名>.bak-<ISO>` 备份文件（AC-12⑧）
 *  ⚠ 必须**严格**匹配 `<ISO>` 结尾：用 `startsWith` 会把**我们自己打开备份文件时**
 *  SQLite 生成的 sidecar（`<bak>-wal` / `<bak>-shm`，因备份头里仍写着 `journal_mode=wal`）
 *  也算成「第二个备份」⇒ 假红（本文件初版就踩了这个坑，已订正）。 */
const ISO_SUFFIX_RE = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
function bakFiles(file) {
  const dir = path.dirname(file);
  const base = path.basename(file) + '.bak-';
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${ISO_SUFFIX_RE}$`);
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f));
  } catch {
    return [];
  }
}
const fullSnapshot = (it) => JSON.stringify(it);
const newBookItem = (word, lang, over = {}) => ({
  word,
  lang,
  addedAt: 5000,
  updatedAt: 5000,
  status: 'new',
  note: null,
  tags: [],
  reviewCount: 0,
  lastReviewedAt: null,
  deleted: false,
  ...over,
});

/* ================================================================== *
 * 块 E 夹具：**非空 `-wal` + 保持打开的写连接**（T42）
 *
 * 为什么必须这样造（判别实验 `scripts/probe_t42_wal_fixture{,2,3}.mjs` 的实测结论，勿凭直觉重写）：
 *   · 建完老库后**最后一个连接 close** 会触发 clean-shutdown checkpoint ⇒ `-wal` 被并回主库并删除
 *     —— 本文件早期 A29 的夹具正是这样，所以那一段只能打印观察值，**抓不到**「备份漏行」。
 *   · 第二个连接写完就 close，**只要没有别的连接「活着」**，同样会把现场 checkpoint 掉
 *     （实测拓扑 v1：B 已打开但从未使用 ⇒ 未持任何锁 ⇒ `-wal` 被删、副本不丢行 = 假绿）。
 *   · 唯一可靠拓扑：**写入的连接保持打开**，且另有一条「活」连接（先执行过一次查询）。
 *     实测：该拓扑下 `-wal` = 12392 B（主库缺新行），checkpoint busy = 0（迁移可正常进行），
 *     而删掉 checkpoint 的变体 dist 备份确实缺行 ⇒ 夹具**同时**满足「现场有效」与「可鉴别」。
 *   ⚠ 反例（已登记为 E15–E17）：若另一条连接**持未结束的读事务**，`wal_checkpoint(TRUNCATE)`
 *     返回 busy=1 ⇒ 迁移按「数据优先」被放弃（`-wal` 实测 log=3 / checkpointed=0）。
 * ================================================================== */
const NEW_WORD = 'waldelta';
const OLD_BOOK_DDL = `CREATE TABLE book (${COLS_WITH_LANG})`;
const OLD_BOOK_INSERT = `INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
  VALUES (?, ?, ?, ?, 'new', NULL, '[]', 0, NULL, 0)`;

/** `-wal` 字节数（文件不存在返回 -1：「已并回并删除」与「空文件」不是一回事） */
const walSize = (file) => (fs.existsSync(file + '-wal') ? fs.statSync(file + '-wal').size : -1);
const fileBytes = (file) => fs.readFileSync(file);

/** 只读探针：`book` 行数 + 词表。**每次新连接** ⇒ 不受他人未结束读事务的快照隔离影响 */
function bookRows(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const n = db.prepare('SELECT COUNT(1) AS n FROM book').get().n;
  const words = db.prepare('SELECT word FROM book ORDER BY word').all().map((r) => r.word);
  db.close();
  return { n: Number(n), words };
}

/** 只复制**主库文件**（不复制 `-wal`/`-shm`）= 方案0 的机制；返回该单文件副本里能看到什么 */
function mainOnlyRows(file, dest) {
  fs.copyFileSync(file, dest);
  return bookRows(dest);
}

/** 捕获 fn 期间的 `console.warn`（迁移的「放弃迁移」提示是**可断言对象**，不是噪声）
 *  ★ T50：**同时**把 `console.log` 收进 `logs` —— 复用语义用 `console.log`（**stdout**）打印
 *  「复用…快照：<文件名>」，而它是「复用分支确实走到」的**直接**证据（比「备份数 == 1」更强：
 *  份数只是间接推断）。`openDatabase()` 期间的 stdout 只有实现消息。 */
function captureWarns(fn) {
  const messages = [];
  const logs = [];
  const orig = console.warn;
  const origLog = console.log;
  console.warn = (...a) => messages.push(a.join(' '));
  console.log = (...a) => logs.push(a.join(' '));
  let value = null;
  let error = null;
  try {
    value = fn();
  } catch (e) {
    error = e;
  } finally {
    console.warn = orig;
    console.log = origLog;
  }
  return { value, error, messages, logs };
}

/* --- ★★ T52：复用日志文案的**唯一来源**（勿在任何断言里手写字符串，见文件头 §1d） -----------
 * 判据语义在 T51 变了（「目录里已有」→「**本次**迁移已创建」），文案随之变（见 §1d 表格）：
 *   T49 旧：`[zidiankaifa] 复用已有迁移前备份：<文件名>`
 *   T51 新：`[zidiankaifa] 复用本次迁移已创建的快照：<文件名>`
 * ⚠ 反向断言（「不得出现复用日志」）若匹配**旧串**，在新实现下恒为 0 ⇒ **假绿**；
 *   故正向（A28b/A33/A28d）与反向（A12b/A28c/A28e）**统一**走 `REUSE_LOG_RE`。 */
const REUSE_LOG_RE = /复用本次迁移已创建的快照：(.+)$/;
/** 从捕获到的 stdout 行里取「被复用的文件名」（匹配不到 ⇒ 返回 null） */
const reuseLogName = (line) => line.match(REUSE_LOG_RE)?.[1] ?? null;
/** 全部复用日志指向的文件名（长度 = 复用日志条数；每条日志至多贡献 1 个名字） */
const reuseLogNames = (logs) => logs.map(reuseLogName).filter((n) => n !== null);
/** 任何含「复用」字样的 stdout 行（用于失败提示里原样展示，避免用旧文案兜底而被误导） */
const reuseLogs = (logs) => logs.filter((l) => l.includes('复用'));

/**
 * 跑一次「非空 WAL + 保持打开的写连接」迁移场景（块 E 核心夹具）。
 * @param {string} tag     临时子目录名
 * @param {(f: string) => unknown} openFn  openDatabase 实现（生产 dist / 变体 dist）
 * @param {string} runDir  运行目录
 */
function walBackupScenario(tag, openFn, runDir) {
  const dir = path.join(runDir, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.db`);

  // ① 老结构 book（PRIMARY KEY (word)）+ 两行「老数据」；建库连接 close ⇒ base 行落到**主库文件**、-wal 清空
  //    （这正是真实形态：用户上次正常退出时的老数据在主库里）
  const c0 = new DatabaseSync(file);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_BOOK_DDL);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const ins0 = c0.prepare(OLD_BOOK_INSERT);
  ins0.run('alpha', 'en', 1000, 2000);
  ins0.run('beta', 'en', 1001, 2001);
  c0.close();

  // ② 保持打开的写连接 B（= 桌面端一直开着的那个连接）；先查一次，确保它是「活」的
  const B = new DatabaseSync(file);
  opened.push(B);
  B.prepare('SELECT COUNT(1) AS n FROM book').get();

  // ③ 第二个连接 C 写入「用户刚加的生词」——★ 写完**不 close**（close 会 checkpoint 掉现场）
  const C = new DatabaseSync(file);
  opened.push(C);
  C.prepare(OLD_BOOK_INSERT).run(NEW_WORD, 'ru', 3000, 4000);

  const walBefore = walSize(file);
  const visibleBefore = Number(B.prepare('SELECT COUNT(1) AS n FROM book').get().n);
  const wordsBefore = B.prepare('SELECT word FROM book ORDER BY word').all().map((r) => r.word);
  const before = snapWithLang(file); // 迁移前源库可见快照（含只存在于 -wal 的那条新行）
  const mainOnly = mainOnlyRows(file, path.join(dir, 'mainonly.db'));
  const baksPre = bakFiles(file).length; // 迁移前不应有备份

  // ④ 触发迁移（生产 dist 或变体 dist）
  const call = captureWarns(() => openFn(file));
  if (call.value) opened.push(call.value);

  const baks = bakFiles(file);
  const bakPath = baks.length === 1 ? path.join(dir, baks[0]) : null;
  // ★ 字节证据必须**即时**取：此后任何 close / 再 checkpoint 都会改写主库文件
  const byteEqToMain = bakPath ? fileBytes(bakPath).equals(fileBytes(file)) : null;
  const bakSize = bakPath ? fs.statSync(bakPath).size : -1;
  const mainSize = fs.statSync(file).size;
  const walAfter = walSize(file);
  const pkAfter = pkCols(file);
  const bakSnap = bakPath ? snapWithLang(bakPath) : null;
  const srcAfter = snapWithLang(file);
  // T46 新增：备份作为**回退库**的三项逻辑性质（VACUUM INTO 产物 ⇒ 只能比逻辑内容，不比字节）
  const bakIntegrity = bakPath ? integrityOk(bakPath) : null;
  const bakJm = bakPath ? journalMode(bakPath) : null;
  const bakProbeNew = bakPath ? bakProbe(bakPath, NEW_WORD, 'ru') : null;

  return {
    dir, file, walBefore, visibleBefore, wordsBefore, before, mainOnly, baksPre, baks, bak: bakPath,
    bakSnap, bakWords: bakSnap ? bakSnap.map((r) => r[0]) : [], byteEqToMain, bakSize, mainSize,
    walAfter, pkAfter, srcAfter, bakIntegrity, bakJm, bakProbeNew, warns: call.messages, error: call.error,
  };
}

/** busy 分支场景（T46 **反转**）：另一条连接**持未结束的读事务** ⇒ 方案 A 会 checkpoint busy 而放弃迁移；
 *  现行 `VACUUM INTO` **无 busy 分支** ⇒ 备份成功 ∧ 迁移完成。释放读事务后再开一次仅为**幂等**验证。 */
function walBusyScenario(runDir) {
  const dir = path.join(runDir, 'e_busy');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'e_busy.db');

  const c0 = new DatabaseSync(file);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_BOOK_DDL);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const ins0 = c0.prepare(OLD_BOOK_INSERT);
  ins0.run('alpha', 'en', 1000, 2000);
  ins0.run('beta', 'en', 1001, 2001);
  c0.close();

  const B = new DatabaseSync(file);
  opened.push(B);
  B.exec('BEGIN'); // ★ 未结束的读事务 ⇒ 持 WAL read-mark（真实形态：另一处正在遍历结果集）
  B.prepare('SELECT COUNT(1) AS n FROM book').get();
  const C = new DatabaseSync(file);
  opened.push(C);
  C.prepare(OLD_BOOK_INSERT).run(NEW_WORD, 'ru', 3000, 4000);

  const first = captureWarns(() => openDatabase(file));
  if (first.value) opened.push(first.value);
  const baks1 = bakFiles(file);
  const pk1 = pkCols(file);
  const srcWords1 = bookRows(file).words; // 新连接 ⇒ 不受 B 快照隔离影响
  const srcSnap1 = snapWithLang(file);
  const bak1Snap = baks1.length ? snapWithLang(path.join(dir, baks1[0])) : null;

  B.exec('COMMIT');
  B.close();
  const second = captureWarns(() => openDatabase(file)); // 幂等重跑
  if (second.value) opened.push(second.value);
  const baks2 = bakFiles(file);
  const pk2 = pkCols(file);
  const srcSnap2 = snapWithLang(file);

  return {
    file, firstWarns: first.messages, secondWarns: second.messages, firstError: first.error,
    secondError: second.error, baks1, pk1, srcWords1, srcSnap1,
    bak1Words: bak1Snap ? bak1Snap.map((r) => r[0]) : [],
    baks2, pk2, srcSnap2,
  };
}

/**
 * 「崩溃残留」形态（**单连接、无人持有**）—— 最贴近真实的触发场景：
 * 上次进程被强杀 / 断电 ⇒ 主库文件老化、`-wal` 里留着已提交事务，**没有任何连接**持有它。
 * 造法：先用一条打开的写连接造出现场，再把 `主库 + -wal`（**不带 `-shm`**，让接收端自行恢复）
 * 复制出来 ⇒ 副本就是「崩溃后残留的库」。
 */
function walRemnantScenario(tag, openFn, runDir) {
  const sdir = path.join(runDir, `${tag}_src`);
  fs.mkdirSync(sdir, { recursive: true });
  const sfile = path.join(sdir, 'src.db');

  const c0 = new DatabaseSync(sfile);
  c0.exec('PRAGMA journal_mode = WAL');
  c0.exec(OLD_BOOK_DDL);
  c0.exec('CREATE INDEX idx_book_updated ON book(updated_at)');
  const ins0 = c0.prepare(OLD_BOOK_INSERT);
  ins0.run('alpha', 'en', 1000, 2000);
  ins0.run('beta', 'en', 1001, 2001);
  c0.close();

  const W = new DatabaseSync(sfile); // 写入连接保持打开 ⇒ 新行只落在 -wal
  opened.push(W);
  W.exec('BEGIN');
  W.prepare(OLD_BOOK_INSERT).run(NEW_WORD, 'ru', 3000, 4000);
  W.exec('COMMIT');

  const ddir = path.join(runDir, tag);
  fs.mkdirSync(ddir, { recursive: true });
  const file = path.join(ddir, `${tag}.db`);
  fs.copyFileSync(sfile, file);
  fs.copyFileSync(sfile + '-wal', file + '-wal'); // ★ 只带 -wal，不带 -shm（崩溃残留的真实形态）
  W.close(); // 源库就此收尾；副本已独立

  const walBefore = walSize(file);
  const before = snapWithLang(file); // 接收端自行恢复 WAL 后可见的快照
  const mainOnly = mainOnlyRows(file, path.join(ddir, 'mainonly.db'));

  const call = captureWarns(() => openFn(file));
  if (call.value) opened.push(call.value);
  const baks = bakFiles(file);
  const bakPath = baks.length === 1 ? path.join(ddir, baks[0]) : null;
  const byteEqToMain = bakPath ? fileBytes(bakPath).equals(fileBytes(file)) : null;
  const bakSnap = bakPath ? snapWithLang(bakPath) : null;

  return {
    file, walBefore, before, mainOnly, baks, bak: bakPath, bakSnap,
    bakWords: bakSnap ? bakSnap.map((r) => r[0]) : [], byteEqToMain,
    bakIntegrity: bakPath ? integrityOk(bakPath) : null,
    bakProbeNew: bakPath ? bakProbe(bakPath, NEW_WORD, 'ru') : null,
    pkAfter: pkCols(file), warns: call.messages, error: call.error,
  };
}

/** 合成负对照：同一源库上 `fs.copyFileSync` 与 `VACUUM INTO` 的产物字节性质不同 */function vacuumControl(runDir) {
  const dir = path.join(runDir, 'e_vacuum_ctl');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ctl.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
  for (let i = 0; i < 400; i++) ins.run('x'.repeat(40));
  db.exec('DELETE FROM t WHERE id % 2 = 0'); // 留出空闲页 ⇒ VACUUM 必然重排/紧凑
  db.close(); // clean shutdown ⇒ WAL 并回，主库自洽

  const copy = path.join(dir, 'copy.db');
  fs.copyFileSync(file, copy);
  const vac = path.join(dir, 'vacuum.db');
  const vdb = new DatabaseSync(file);
  vdb.exec(`VACUUM INTO '${vac.replace(/\\/g, '/')}'`);
  vdb.close();

  return {
    mainSize: fs.statSync(file).size,
    vacuumSize: fs.statSync(vac).size,
    copyEq: fileBytes(copy).equals(fileBytes(file)),
    vacuumEq: fileBytes(vac).equals(fileBytes(file)),
  };
}

/**
 * 变体 dist（**方案0**）：把 `packages/core/dist` 整份复制到临时目录，**只在副本里**把
 * `VACUUM INTO` 那条**可执行语句**换成 `fs.copyFileSync(主库文件)` —— 即「只复制主库、不顾 `-wal`」。
 * 生产 `dist/**` 全程只读 ⇒ 这是「红断言有无鉴别力」的自证手段（T42 需求③，T46 换实现后重做）。
 *
 * ⚠ 定位必须用**可执行语句**正则（`/db\.exec\(`VACUUM INTO/`），**不可**写成 `includes('VACUUM INTO')`：
 *   该语句上方有 20 行注释在解释 `VACUUM INTO`（方案 A 的历史与代价）。T46 首版探针就误改了注释行，
 *   结果变体里 `copyFileSync` 先把备份文件写出来、紧接着 `VACUUM INTO` 报
 *   `output file already exists` ⇒ 备份失败 ⇒ 反而复现了「备份失败 ⇒ 静默降级」（见文件头未闭环项⑤）。
 */
async function makeVariantDist(runDir, distDir) {
  const dst = path.join(runDir, 'dist_variant');
  fs.cpSync(distDir, dst, { recursive: true });
  // dist 是 ESM（`packages/core/package.json` 的 `"type": "module"`），副本落在 scripts/_tmp 下
  // 没有 type 声明 ⇒ 必须自带 package.json，否则 .js 会被当 CommonJS 解析而 import 失败
  fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
  const idx = path.join(dst, 'db', 'index.js');
  const prodJs = fs.readFileSync(path.join(distDir, 'db', 'index.js'), 'utf8');
  const js = fs.readFileSync(idx, 'utf8');
  const VACUUM_STMT_RE = /db\.exec\(`VACUUM INTO/;
  const lines = js.split('\n');
  const hit = lines.findIndex((l) => VACUUM_STMT_RE.test(l));
  const patched = hit >= 0; // 失配 ⇒ 补丁未生效 ⇒ E11 红，强制人工复核，绝不静默放过
  if (patched) {
    const indent = lines[hit].match(/^\s*/)[0];
    lines[hit] = `${indent}fs.copyFileSync(file, bak); // T46 变体：方案0（只复制主库文件，不顾 -wal）`;
    fs.writeFileSync(idx, lines.join('\n'));
  }
  const patchedJs = patched ? lines.join('\n') : js;
  const mod = await import(pathToFileURL(idx).href);
  return {
    patched, patchedJs, prodJs, openDatabase: mod.openDatabase, dst,
    hitLine: hit + 1,
    prodHasVacuumStmt: VACUUM_STMT_RE.test(prodJs),
    variantHasVacuumStmt: VACUUM_STMT_RE.test(patchedJs),
    variantHasCopy: patchedJs.includes('fs.copyFileSync(file, bak)'),
  };
}

/* ================================================================== *
 * 主流程
 * ================================================================== */
const tStart = Date.now();
fs.mkdirSync(TMP_ROOT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(TMP_ROOT, 'run-'));
const allFails = [];
const opened = []; // 需要 close 的连接
/** ⚠ T46 实测发现的未闭环缺陷（**非断言**，末段汇总打印；判定权在主管） */
const KNOWN_GAPS = [];

/* ================================================================== *
 * T60 修复：**连接登记表**（只登记、不改行为）—— 收尾 EPERM 的根因对策
 *
 * 缺陷现象（结构 agent T55 结构快检发现，主管派单 T60）：
 *   收尾 `fs.rmSync(RUN, { recursive: true, force: true })` 在 Windows 报
 *   `EPERM, Permission denied: \\?\…\scripts\_tmp\booklang_tmp\run-<随机>`
 *   ⇒ **每跑一次门禁就残留一个 `run-*`**（实测 54 文件 / 2,470,148 B），与结构体检
 *   「临时残留 = 0」互斥（跑绿与体检只能保一个）。
 *
 * 根因（判别实验 `scripts/probe_t60_rm_forensics.mjs` + `scripts/probe_t60_handle_hook.mjs`，实测）：
 *   ① 新进程立刻能删该目录 ⇒ 锁**在本进程内**，不是杀软、也不是「Windows 延迟释放」
 *      （⇒ `maxRetries`/退避**无用**，实测延迟重试 3 次仍 EPERM）。
 *   ② `--import` 钩子在**本文件自己的进程内**登记每一个 `DatabaseSync` 实例后实测：
 *      收尾时**有 6 个连接从未被 close**（`close` 调用次数 = 0），全部由 `openDatabase()`
 *      创建（`packages/core/dist/db/index.js:16`），调用点 = 本文件 1009 / 1033 / 1090 / 1128×3；
 *      被锁条目 = 4 个临时库 × (`db` / `-wal` / `-shm`) = **12 个**（rename 探测 EBUSY）。
 *   ③ 补 close 这 6 个句柄后：rename 探测 12 被锁 → **0 被锁** ∧ `rmSync` **成功**。
 *   ⇒ `openDatabase()` 在**抛错路径**上（A30/A31/A33 断言的正是「迁移无法完成 ⇒ 必须抛错」）
 *     先 `new DatabaseSync(file)`、再抛错 —— **该连接既不返回、也不关闭**。
 *     测试侧因此**永远拿不到它**（`captureWarns()` 的 `value === null` ⇒ `if (r.value)` 跳过 push）
 *     ⇒ 原来的 `opened` 表按构造就收不到它，故「清理失败但不影响结论」一直静默。
 *
 * ★★ 缺陷归属（主管 T60 追加裁决 A，2026-09-14）：**根因不在本测试文件**。
 *   根因 = **被测实现 `openDatabase()` 的抛错路径**（源 `packages/core/src/db/index.ts` ⇒ 产物 `packages/core/dist/db/index.js:14-34`）：
 *   `const db = new DatabaseSync(path)`（`:15`）之后，`db.exec(SCHEMA_SQL)`（`:16`）/ `migrateBookLang`（`:18`）/
 *   `migrateBookCompositeKey`（`:19`）/ **`assertBookCompositeOrThrow`（`:30`，v0.10.0 新增的「响亮失败」防线）** /
 *   `migrateAddColumn`（`:31-32`）**任一抛错**都直接冒泡出函数 ⇒ 该连接既不返回、也不关闭（`:33` 只在成功路径）。
 *   ⇒ 本文件**无权重写 `packages/core/src/**`**；下方 `reclaimLeakedConnections()` 是**当前唯一的止血手段**，
 *     **不是**根因修复，**不得**因「根因在 src」而删除。真正修复 = 抛错前 `db.close()`：
 *     `try { … } catch (e) { db.close(); throw e; }` ⇒ **已登记为 v0.11.0 候选 `V11-OPENDB-LEAK`**
 *     （正式立项由主管写 `REQ.md` / `TASKS.md`；本文件只作登记，见 `.board/EVIDENCE.md` §47）。
 *
 * ★ 影响级别（主管 T60 追加裁决 C）：**P1，不是 P0 —— 当前无用户可见后果**（不得升级表述为「用户数据风险」）。
 *   桌面端两个入口都是「`openDatabase()` 抛错 ⇒ `dialog.showErrorBox` + `app.exit(1)`」⇒ **进程随即退出**，
 *   泄漏句柄在**该路径上不可观测**（实测：进程退出后另一进程可立即删除，见 `scripts/probe_t60_rm_forensics.mjs`）；
 *   浏览器端走 `apps/web/src/api.ts` 的 localStorage 路径，**不碰 SQLite**。
 *   ⇒ 真正会暴露的是「**长驻进程内反复打开失败库**」（反复重试 / 未来把 core 用进常驻服务）—— 属**未来风险（潜在）**。
 *   本仓库**当前**唯一可观测后果 = 本条注释开头那段：收尾 `EPERM` ⇒ 残留 `run-*` 目录（与结构体检互斥）。
 *
 * 登记方式：只打印 ⚠ 行（含**实测泄漏数**）+ 收尾 warn（**不新增断言、不改退出码语义** —— 断言数须保持 137）。
 *   主管裁决 B：src 未修好前写红会让**门禁链永久红**（参照 `ru_morph_defects.mjs` 必须隔离在链外的教训）⇒ 维持 `0`/`1` 语义。
 * ================================================================== */
const connSeen = new Set(); // 本进程内出现过的**所有** SQLite 连接
const connClosed = new Set(); // 其中**确实 close 成功**的
{
  const P = DatabaseSync.prototype;
  for (const m of ['exec', 'prepare']) {
    const orig = P[m];
    if (typeof orig !== 'function') continue;
    P[m] = function patched(...args) {
      connSeen.add(this); // ★ 唯一新增行为：登记引用；其余逐字转发
      return orig.apply(this, args);
    };
  }
  const origClose = P.close;
  P.close = function patchedClose(...args) {
    connSeen.add(this);
    const out = origClose.apply(this, args); // 抛错照旧抛出（`opened` 的 finally 语义不变）
    connClosed.add(this);
    return out;
  };
}
/** 收尾回收被测实现**漏关**的连接。返回 { leaked, reclaimed } —— **只用于打印**（不参与断言/退出码） */
function reclaimLeakedConnections() {
  const leaked = [...connSeen].filter((db) => !connClosed.has(db));
  let reclaimed = 0;
  for (const db of leaked) {
    try {
      db.close();
      reclaimed += 1;
    } catch {
      /* 仍关不掉 ⇒ 由随后的 rmSync warn 兜底，不静默 */
    }
  }
  return { leaked: leaked.length, reclaimed };
}

console.log('='.repeat(96));
console.log('book_lang.mjs —— 生词本语言分离判别集（AC-12 / AC-13 / AC-14 / AC-16 存储侧）');
console.log(`被测产物：packages/core/dist/** · 临时库目录：${path.relative(REPO_ROOT, RUN)}`);
console.log('='.repeat(96));

try {
  /* ---------------------------------------------------------------- *
   * [A] 迁移（AC-12）
   * ---------------------------------------------------------------- */
  console.log('\n[A] 迁移 —— 复合主键 / 自动迁移 / 逐字段保真 / 幂等 / 备份（AC-12）');
  {
    const A = new Block('A', '迁移（AC-12）');

    // --- A1 新库：建表即复合主键，不靠迁移补齐（AC-12①） ---
    const newDbPath = path.join(RUN, 'a1_new.db');
    const newDb = openDatabase(newDbPath);
    opened.push(newDb);
    A.eq('A1 新库 PRAGMA table_info(book) 主键列 == [word, lang]（AC-12①⑤）', pkCols(newDbPath), [
      'word',
      'lang',
    ]);
    A.ok(
      'A2 新库 word 与 lang 两列 pk > 0（逐列判定，不依赖列序；AC-12⑤）',
      (() => {
        const c = newDb.prepare('PRAGMA table_info(book)').all();
        const w = c.find((x) => x.name === 'word');
        const l = c.find((x) => x.name === 'lang');
        return Number(w?.pk) > 0 && Number(l?.pk) > 0;
      })(),
    );
    A.eq('A3 新库 idx_book_updated 存在（AC-12⑦）', indexExists(newDbPath, 'idx_book_updated'), 1);
    A.eq('A4 新库**不产生**备份文件（备份只在检测到老结构时发生；AC-12⑧）', bakFiles(newDbPath).length, 0);

    // --- A5 老库变体 1：有 lang 列（AC-12②③） ---
    const old1 = path.join(RUN, 'a5_old_with_lang.db');
    makeOldDb(old1, true, FIXTURE_WITH_LANG);
    const before1 = snapWithLang(old1);
    A.eq('A5 老库（有 lang 列）迁移**行数**保真（5 行 = 3 存活/墓碑混排 + 1 空串 lang + 1 ru 墓碑）', before1.length, 5);
    // T50：捕获 stdout（复用日志）+ 迁移前备份数（A12b 的**正常路径**对照前置）
    const preBaks1 = bakFiles(old1);
    const open1 = captureWarns(() => openDatabase(old1));
    if (open1.error) throw open1.error; // 正常路径不得抛（原有行为；此处不新增断言）
    const db1 = open1.value;
    opened.push(db1);
    A.eq('A6 老库（有 lang 列）迁移后主键列 == [word, lang]（AC-12②⑤）', pkCols(old1), ['word', 'lang']);
    const after1 = snapWithLang(old1);
    // ⚠ 唯一**许可**的差异：空串 lang 由迁移的 COALESCE(NULLIF(lang,''),'en') 归一为 'en'（见 A10）。
    //   其余 9 个字段 + 另外 3 行必须逐字段逐字相等。
    const expect1 = before1.map((r) => (r[1] === '' ? [r[0], 'en', ...r.slice(2)] : r));
    A.eq('A7 老库（有 lang 列）迁移**逐字段**保真（word/lang/added_at/updated_at/status/note/tags/review_count/last_reviewed_at/deleted；AC-12③；唯一许可差异=空串 lang⇒en，见 A10）', after1, expect1);
    A.ok(
      "A8 拉丁词 + lang='ru' 的行迁移后 lang 仍为 'ru'（不得按 isCyrillic 反推；§8.5 第 4 条）",
      after1.find((r) => r[0] === 'test')?.[1] === 'ru',
      `实测 ${JSON.stringify(after1.find((r) => r[0] === 'test'))}`,
    );
    A.ok(
      'A9 墓碑保真：telephone 迁移后 deleted = 1 且仍在表内（AC-12③）',
      after1.some((r) => r[0] === 'telephone' && r[9] === 1),
      JSON.stringify(after1.filter((r) => r[0] === 'telephone')),
    );
    A.ok(
      'A9b ★ ru 墓碑（`проверка`）迁移后 `lang` 仍为 `\'ru\'` ∧ `deleted = 1`（§8.1-B-3 缺陷类在**迁移路径**上的对应覆盖）',
      (() => {
        const r = after1.find((x) => x[0] === 'проверка');
        return r && r[1] === 'ru' && r[9] === 1;
      })(),
      JSON.stringify(after1.find((x) => x[0] === 'проверка')),
    );
    A.ok(
      "A10 空串 lang 归一为 'en'（迁移的 COALESCE(NULLIF(lang,''),'en') 路径）",
      after1.find((r) => r[0] === 'city')?.[1] === 'en',
      `实测 ${JSON.stringify(after1.find((r) => r[0] === 'city'))}`,
    );
    A.eq('A11 迁移后 idx_book_updated 仍在（AC-12⑦：DROP TABLE 会连带删索引，必须重建）', indexExists(old1, 'idx_book_updated'), 1);
    const baks1 = bakFiles(old1);
    A.eq('A12 真迁移产生**恰好 1 个** `<db>.bak-<ISO>` 备份（AC-12⑧）', baks1.length, 1);
    A.ok(
      'A13 备份文件名为 `<库文件名>.bak-<ISO 时间戳>`（同目录；AC-12⑧）',
      baks1.length === 1 && /\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(baks1[0]),
      JSON.stringify(baks1),
    );
    A.ok(
      'A14 备份内容 == 迁移**前**的老库快照（备份先于迁移；AC-12⑧）',
      baks1.length === 1 && JSON.stringify(snapWithLang(path.join(RUN, baks1[0]))) === JSON.stringify(before1),
      baks1.length === 1 ? `备份行数 ${snapWithLang(path.join(RUN, baks1[0])).length} / 迁移前 ${before1.length}` : '无备份文件',
    );
    A.ok(
      'A12b ★ 复用语义的**正常路径对照**（防「一律复用」把既有性质破坏）：无重试的真迁移路径仍**新建**备份 —— 迁移前同目录内 `<db>.bak-<ISO>` == 0（没有旧文件可被复用 ⇒ A12 的那 1 份只能是本次新建，A4「新库不产生备份」仍成立）∧ 全程**无**复用日志（T51 判据下复用分支**只在**「本次调用内已创建过非空快照」时进入 ⇒ 首次进入备份段必为新建）',
      preBaks1.length === 0 &&
        reuseLogNames(open1.logs).length === 0 &&
        baks1.length === 1,
      `迁移前备份数=${preBaks1.length} · 复用日志=${JSON.stringify(reuseLogs(open1.logs))} · 迁移后备份数=${baks1.length}`,
    );

    // --- A15 幂等：再开一次（AC-12④⑧） ---
    const db1b = openDatabase(old1);
    opened.push(db1b);
    A.eq('A15 幂等重跑后主键列不变（AC-12④）', pkCols(old1), ['word', 'lang']);
    A.eq('A16 幂等重跑后行内容不变（AC-12④）', snapWithLang(old1), after1);
    A.eq('A17 幂等重跑**不产生第二个备份**（AC-12⑧）', bakFiles(old1).length, 1);
    A.eq('A18 幂等重跑后 idx_book_updated 仍在', indexExists(old1, 'idx_book_updated'), 1);

    // --- A19 老库变体 2：无 lang 列（AC-12②） ---
    const old2 = path.join(RUN, 'a19_old_no_lang.db');
    makeOldDb(old2, false, FIXTURE_NO_LANG);
    const before2 = snapNoLang(old2);
    const db2 = openDatabase(old2);
    opened.push(db2);
    A.eq("A19 老库（无 lang 列）迁移后主键列 == [word, lang]（AC-12②）", pkCols(old2), ['word', 'lang']);
    const after2 = snapWithLang(old2);
    A.eq('A20 老库（无 lang 列）迁移后逐字段保真（不含 lang 的 9 个字段）', after2.map((r) => r.filter((_, i) => i !== 1)), before2);
    A.ok(
      "A21 老库（无 lang 列）迁移后 lang 全部补为 'en'（AC-12③）",
      after2.length === 3 && after2.every((r) => r[1] === 'en'),
      JSON.stringify(after2.map((r) => [r[0], r[1]])),
    );
    A.ok(
      'A22 老库（无 lang 列）墓碑保真：telephone deleted = 1',
      after2.some((r) => r[0] === 'telephone' && r[9] === 1),
      JSON.stringify(after2.filter((r) => r[0] === 'telephone')),
    );
    A.eq('A23 老库（无 lang 列）备份文件恰 1 个', bakFiles(old2).length, 1);
    A.eq('A24 老库（无 lang 列）idx_book_updated 仍在', indexExists(old2, 'idx_book_updated'), 1);

    // --- A25–A28 「迁移失败」的**现行**语义（T46 据主管变更②改写；原为「失败 ⇒ 保留原表」） ---
    // 故障注入：预置同名 `book_new` 表 ⇒ 建新表那一步抛 "table book_new already exists"。
    // ★ T45 变更②：该错误信息含 `book_new` ⇒ 主管新增**有界重试**（DROP TABLE IF EXISTS book_new
    //   后重试一次）⇒ 迁移**自愈成功**（不再是「保留原表」）。故旧断言「主键仍是 [word]」按设计变红。
    //   本组断言据此改为「自愈后迁移成功 + 残留确已清除 + 备份均为迁移前形态的一次性快照」。
    const old3 = path.join(RUN, 'a25_migrate_fails.db');
    makeOldDb(old3, true, FIXTURE_WITH_LANG.slice(0, 2), 'CREATE TABLE book_new (x TEXT)');
    const before3 = snapWithLang(old3);
    let db3 = null;
    let threw = null;
    const heal = captureWarns(() => openDatabase(old3));
    db3 = heal.value;
    threw = heal.error;
    if (db3) opened.push(db3);
    A.ok(
      'A25 注入式故障（残留 `book_new` 表）**不向外抛**：`openDatabase()` 返回可用连接（自愈重试在内部完成；AC-12⑥）',
      threw === null && db3 !== null,
      threw ? `抛出 ${threw.message}` : '',
    );
    A.ok(
      'A26 ★ 自愈后**迁移成功**（T45 变更②）：`openDatabase()` 成功 ∧ 主键列 == [word, lang] ∧ 残留 `book_new` 已从 sqlite_master 清除（原断言「主键仍是 [word]」按新实现改写）',
      threw === null &&
        db3 !== null &&
        JSON.stringify(pkCols(old3)) === JSON.stringify(['word', 'lang']) &&
        sqliteObject(old3, 'book_new') === null,
      `抛出=${threw ? threw.message : 'null'} · 主键=${JSON.stringify(pkCols(old3))} · sqlite_master 里 book_new=${JSON.stringify(sqliteObject(old3, 'book_new'))}`,
    );
    A.ok(
      'A26b 自愈走的是**有界重试**分支：恰 1 条「已清除并重试一次迁移」警告 ∧ 0 条「重试仍失败」警告（分支存在且只走一次）',
      heal.messages.filter((w) => w.includes('已清除并重试一次迁移')).length === 1 &&
        heal.messages.filter((w) => w.includes('重试仍失败')).length === 0,
      `warn=${JSON.stringify(heal.messages)}`,
    );
    A.eq('A27 自愈迁移后老数据逐字段可读且不变（迁移前的 2 行 == 迁移后；AC-12③⑥）', snapWithLang(old3), before3);
    {
      // A28 ★ T50 改写（随 T49 复用策略）· T52 复核（T51 收紧判据后**仍成立**）：
      //   重试路径**不再落第二份备份** —— `ensurePreMigrationBackup` 在「**本次调用内**已创建
      //   并验证过非空快照」时**复用**它、不新建（理由：一次自愈若落两份，桌面端 494 MB 库
      //   ⇒ ≈1 GB 磁盘占用，见 `packages/core/src/db/index.ts:247-275`）。
      //   ⇒ **份数不再是尝试次数的上界**，可断言的性质是「**那份被复用的**备份仍是迁移前形态的
      //   一次性一致性快照」，而「复用确实发生」由 A28b 的日志（stdout）直接钉住；
      //   份数由 A28b/A33 钉住 == 1。
      const baks3 = bakFiles(old3);
      const bakSnaps3 = baks3.map((b) => snapWithLang(path.join(RUN, b)));
      const bakPks3 = baks3.map((b) => pkCols(path.join(RUN, b)));
      const bakIcs3 = baks3.map((b) => integrityOk(path.join(RUN, b)));
      A.ok(
        'A28 ★ AC-12⑧ 重试路径的备份充分性：备份数 ≥ 1 ∧ **每一份**都是「迁移前形态」的一次性一致性快照（主键 == [word] ∧ 逐字段 == 迁移前快照 ∧ integrity_check = ok）—— 故**复用**来的那份也仍是有效回退点，不会把「半迁移态」文件当快照；份数不在此硬编码（T51 复用 ⇒ 实测 1 份，由 A28b/A33 钉住）',
        baks3.length >= 1 &&
          bakPks3.every((p) => JSON.stringify(p) === JSON.stringify(['word'])) &&
          bakSnaps3.every((s) => JSON.stringify(s) === JSON.stringify(before3)) &&
          bakIcs3.every((x) => x === true),
        `备份数=${baks3.length} · 各备份主键=${JSON.stringify(bakPks3)} · 各备份逐字段==迁移前=${JSON.stringify(bakSnaps3.map((s) => JSON.stringify(s) === JSON.stringify(before3)))} · 各备份 integrity ok=${JSON.stringify(bakIcs3)}`,
      );
      A.ok(
        'A28b ★ 复用策略的**直接证据**（不再靠份数推断）：自愈重试第二次进入备份段时**恰好**打印 1 条 `复用本次迁移已创建的快照：<文件名>`（stdout）∧ 该文件名 == **本目录内唯一的那份** `<db>.bak-<ISO>`（即复用的是本次新建的真实快照）∧ 最终备份数 == **1**（一次自愈只落一份整库快照）—— ⇒ 有界性（至多一次重试、不递归）的证据由「恰 2 条警告」承担（A26b/A33），**备份数不再**充当尝试次数上界；本夹具 T46 时实测为 2 份，T49 起为 1 份',
        reuseLogNames(heal.logs).length === 1 &&
          baks3.length === 1 &&
          reuseLogName(heal.logs.find((l) => reuseLogName(l)) ?? '') === baks3[0] &&
          heal.messages.filter((w) => w.includes('book_new')).length <= 2,
        `复用日志=${JSON.stringify(reuseLogs(heal.logs))} · 复用日志指向=${JSON.stringify(reuseLogName(heal.logs.find((l) => reuseLogName(l)) ?? ''))} · 唯一备份=${JSON.stringify(baks3[0] ?? null)} · 备份数=${baks3.length}（复用 ⇒ 期望 1）· 含 book_new 的警告条数=${heal.messages.filter((w) => w.includes('book_new')).length}`,
      );
      // ⓘ 观察（非断言）：复用 ⇒ 重试**不再**新建第二个备份文件 ⇒ T46 曾担心的
      //   「两次尝试落在同一毫秒 ⇒ `VACUUM INTO` 目标已存在」这一窗口在重试路径上**已不可达**。
      //   备份失败的残余可达性只剩物理原因（磁盘不足 / 目录不可写 / I-O 错误 / 同名占位），
      //   见下方 ⓘ ①（冻结时钟 + 预占备份名）与 ⓘ ③。
      console.log(
        `  ⓘ 观察：重试路径最终备份 = ${JSON.stringify(baks3)}（复用本次已创建的那份 ⇒ 恰 1 份；「同毫秒撞名」窗口随第二份备份的消失而关闭）`,
      );
    }

    /* --- ★★ A28c–A28e（T52 新增）：把 T51 收紧后的复用判据钉死 -------------------------------
     * 来源：测试 agent T50 的只读探针 `scripts/probe_t50_reuse_edges.mjs` 的两个受控场景（S1 / S2），
     *   它们证明 T49 的**目录扫描式**判据过宽 ⇒ 主管 T51 把判据收紧为「只复用**本次调用内**
     *   刚创建并 `statSync().size > 0` 验证过的那份」（`packages/core/src/db/index.ts:247-275`）。
     *   ⇒ 本节把「不扫目录」这一新语义写成**红/绿可判**的断言（此前只有探针，不进门禁）。
     * 夹具与探针 S2/S1 **同构**（确定性、无时钟依赖；不冻结 `Date`）。
     * ⚠ 反向断言一律走 `reuseLogNames()`：若手写**旧**文案（`复用已有迁移前备份`），
     *   在 T51 实现下恒为 0 ⇒ 断言**假绿**（这正是 §1d 强调的陷阱）。 */
    {
      // A28c（S2 同类 · 正常路径）：目录里**只有** `<db>.bak-<ISO>-wal` sidecar，真备份不存在。
      //   T49 的前缀匹配（`startsWith(base + '.bak-')`）会命中该 sidecar ⇒ 判定「已有备份」并跳过
      //   新建 ⇒ **磁盘上没有任何可用快照**，而迁移照常完成 = AC-12⑧「与事务并列的第二道独立防线」落空。
      //   T51：`st.bak` 为 null ⇒ 必新建。
      const s2File = path.join(RUN, 'a28c_sidecar_only.db');
      makeOldDb(s2File, true, FIXTURE_WITH_LANG.slice(0, 2));
      const s2Before = snapWithLang(s2File);
      const s2Sidecar = `${s2File}.bak-2020-01-01T00-00-00-000Z-wal`;
      fs.writeFileSync(s2Sidecar, Buffer.alloc(4096, 7)); // 非空 ⇒ 满足 T49 的 `size > 0` 复用条件
      const s2 = captureWarns(() => openDatabase(s2File));
      if (s2.value) opened.push(s2.value);
      const s2Baks = bakFiles(s2File);
      const s2BakSnap = s2Baks.length === 1 ? snapWithLang(path.join(RUN, s2Baks[0])) : null;
      A.ok(
        'A28c ★ T51 收紧判据（S2 同类 · 正常路径）：目录里**只有**先前的 `<db>.bak-<ISO>-wal` sidecar（真备份不存在）⇒ 必须**新建**一份**可用**快照 ∧ **无**任何复用日志 ∧ 迁移仍成功完成 —— ' +
          '这正是 T50 探针证明的「AC-12⑧ 第二道防线落空」：T49 的前缀匹配会命中 sidecar 并跳过新建 ⇒ **零可用快照**下完成迁移；T51 判据（只看本次已创建）使该洞消失（`bakFiles` 严格 `<ISO>Z` 结尾，sidecar 不计入）',
        s2Baks.length === 1 &&
          s2BakSnap !== null &&
          JSON.stringify(s2BakSnap) === JSON.stringify(s2Before) &&
          reuseLogNames(s2.logs).length === 0 &&
          JSON.stringify(pkCols(s2File)) === JSON.stringify(['word', 'lang']) &&
          s2.error === null,
        `可用快照数=${s2Baks.length}（期望 1：必须新建）· 新建份内容==迁移前=${JSON.stringify(s2BakSnap) === JSON.stringify(s2Before)} · 复用日志=${JSON.stringify(reuseLogs(s2.logs))}（期望 []）· 主键=${JSON.stringify(pkCols(s2File))} · 抛出=${s2.error ? s2.error.message : 'null'} · sidecar 仍在=${fs.existsSync(s2Sidecar)}`,
      );

      // A28d（S2 同类 · **重试路径**，T51 判据的最强形式）：sidecar + 残留 `book_new` 表 ⇒ 自愈重试
      //   会**第二次**进入备份段。T51 下第二次复用到的必须是**本次第一次新建的那份**（`st.bak`），
      //   而不是被前缀命中的 sidecar ⇒ 断言「日志里的文件名 == 目录内唯一的真实备份文件」。
      const s2rFile = path.join(RUN, 'a28d_sidecar_retry.db');
      makeOldDb(s2rFile, true, FIXTURE_WITH_LANG.slice(0, 2), 'CREATE TABLE book_new (x TEXT)');
      const s2rBefore = snapWithLang(s2rFile);
      const s2rSidecar = `${s2rFile}.bak-2020-01-01T00-00-00-000Z-wal`;
      fs.writeFileSync(s2rSidecar, Buffer.alloc(4096, 7));
      const s2r = captureWarns(() => openDatabase(s2rFile));
      if (s2r.value) opened.push(s2r.value);
      const s2rBaks = bakFiles(s2rFile);
      const s2rNames = reuseLogNames(s2r.logs);
      A.ok(
        'A28d ★ T51 收紧判据（S2 同类 · **重试路径** = 复用的唯一合法场景）：目录里只有 sidecar 且残留 `book_new` 表 ⇒ 自愈重试时复用的**必须**是「本次刚创建的真实快照」—— 恰 1 条复用日志 ∧ 日志里的文件名 == 目录内**唯一**的 `<db>.bak-<ISO>`（≠ sidecar）∧ 该文件内容 == 迁移前快照 ∧ 迁移自愈成功（主键 [word, lang]）∧ 可用快照数 == 1',
        s2rNames.length === 1 &&
          s2rBaks.length === 1 &&
          s2rNames[0] === s2rBaks[0] &&
          JSON.stringify(snapWithLang(path.join(RUN, s2rBaks[0]))) === JSON.stringify(s2rBefore) &&
          JSON.stringify(pkCols(s2rFile)) === JSON.stringify(['word', 'lang']) &&
          s2r.error === null,
        `复用日志=${JSON.stringify(reuseLogs(s2r.logs))} · 日志指向=${JSON.stringify(s2rNames[0] ?? null)} · 唯一真实备份=${JSON.stringify(s2rBaks[0] ?? null)} · 可用快照数=${s2rBaks.length} · 内容==迁移前=${s2rBaks.length === 1 ? JSON.stringify(snapWithLang(path.join(RUN, s2rBaks[0]))) === JSON.stringify(s2rBefore) : 'n/a'} · 主键=${JSON.stringify(pkCols(s2rFile))}`,
      );

      // A28e（S1 同类）：目录里预置**陈旧异库** `.bak-<ISO>`（2020 年、内容 = 另一个库的行）。
      //   T49 会把它当「已有备份」复用 ⇒ 本次迁移的**回退点不是本次迁移前的数据**（用户还原/替换过
      //   库、或上一代安装留下的备份时就会命中）。T51：不在 `st` 里 ⇒ 一律新建 ⇒ 目录里应出现
      //   **恰好一份内容 == 本次迁移前快照**的备份，且陈旧文件**原样未被改写**。
      const s1File = path.join(RUN, 'a28e_stale_foreign_bak.db');
      makeOldDb(s1File, true, FIXTURE_WITH_LANG.slice(0, 2));
      const s1Before = snapWithLang(s1File);
      const s1Stale = `${s1File}.bak-2020-01-01T00-00-00-000Z`;
      makeOldDb(s1Stale, true, [['legacy-row', 'ru', 1, 2, 'new', null, '[]', 0, null, 0]]);
      const s1StaleSnap = snapWithLang(s1Stale);
      const s1 = captureWarns(() => openDatabase(s1File));
      if (s1.value) opened.push(s1.value);
      const s1Baks = bakFiles(s1File);
      const s1StaleBase = path.basename(s1Stale);
      const s1Fresh = s1Baks.filter((b) => b !== s1StaleBase);
      const s1FreshSnap = s1Fresh.length === 1 ? snapWithLang(path.join(RUN, s1Fresh[0])) : null;
      A.ok(
        'A28e ★ T51 收紧判据（S1 同类）：目录里预置**陈旧异库** `.bak-<ISO>`（内容 = 另一个库的行）⇒ **不得**把它当作本次迁移的回退点 —— 应**新建** 1 份（总数 == 2）∧ 新建的那份内容 == **本次**迁移前快照 ∧ 陈旧文件内容**原样未被改写** ∧ **无**复用日志。' +
          'T49 语义下这里会复用陈旧文件（备份数 == 1 且内容 != 本次迁移前数据 ⇒ 回退点错库）',
        s1Baks.length === 2 &&
          s1Fresh.length === 1 &&
          s1FreshSnap !== null &&
          JSON.stringify(s1FreshSnap) === JSON.stringify(s1Before) &&
          JSON.stringify(snapWithLang(s1Stale)) === JSON.stringify(s1StaleSnap) &&
          reuseLogNames(s1.logs).length === 0 &&
          JSON.stringify(pkCols(s1File)) === JSON.stringify(['word', 'lang']),
        `备份总数=${s1Baks.length}（期望 2 = 陈旧 1 + 新建 1）· 新建份=${JSON.stringify(s1Fresh[0] ?? null)} · 新建份内容==本次迁移前=${JSON.stringify(s1FreshSnap) === JSON.stringify(s1Before)} · 陈旧份内容未被改写=${JSON.stringify(snapWithLang(s1Stale)) === JSON.stringify(s1StaleSnap)} · 复用日志=${JSON.stringify(reuseLogs(s1.logs))}（期望 []）· 主键=${JSON.stringify(pkCols(s1File))}`,
      );
    }

    /* --- A30–A34 ★ T45 变更②：后置校验（响亮失败）+ 有界重试（最多一次） --- */
    // 夹具设计（判别实验 scripts/probe_t46_postcheck.mjs，勿凭直觉改）：
    //   · 残留 `book_new` 是**视图** ⇒ `CREATE TABLE book_new` 报 `view book_new already exists`
    //     （含 `book_new`）⇒ 进入重试分支；但 `DROP TABLE IF EXISTS <视图>` 抛错 ⇒ `dbTryDropTable`
    //     返回 false ⇒ **不进重试** ⇒ 落入后置校验 ⇒ 抛错。→ 用于 A30–A32。
    //   · 残留 `book_new` 是**索引** ⇒ 同样进重试分支、`DROP TABLE IF EXISTS` **静默返回成功但未删掉索引**
    //     ⇒ 重试再失败 ⇒ 走 `isRetry` 分支（只告警、**不再递归**）⇒ 后置校验抛错。→ 用于 A33–A34。
    const old4 = path.join(RUN, 'a30_postcheck_view.db');
    makeOldDb(old4, true, FIXTURE_WITH_LANG.slice(0, 2), 'CREATE VIEW book_new AS SELECT 1 AS x');
    const before4 = snapWithLang(old4);
    const post = captureWarns(() => openDatabase(old4));
    if (post.value) opened.push(post.value);
    A.ok(
      'A30 ★ 后置校验（T45 变更②）：迁移**无法完成**的库（残留 `book_new` 视图，`DROP TABLE IF EXISTS` 清不掉）⇒ `openDatabase()` **抛错** ∧ 错误信息含「复合主键」（不再静默降级运行）',
      post.error !== null && String(post.error?.message).includes('复合主键'),
      post.error ? `抛出 ${JSON.stringify(post.error.message.slice(0, 60))}…` : `未抛错（err=${post.error}）· warn=${JSON.stringify(post.messages)}`,
    );
    A.ok(
      'A31 ★ 「无静默降级」的直接否证：抛错场景下**拿不到**任何连接（`openDatabase` 无法返回老结构可用连接），且错误信息点明后果（含 `ON CONFLICT`）—— 即用户不会得到「能打开、列表正常、但一条也加不进去」的库',
      post.value === null && String(post.error?.message).includes('ON CONFLICT'),
      `返回值=${post.value === null ? 'null' : '有连接'} · 含 ON CONFLICT=${String(post.error?.message).includes('ON CONFLICT')}`,
    );
    A.ok(
      'A32 后置校验的报错内容与**实测**一致（不是套话）：错误信息里报告的主键列 == 实测库内主键列 == [word] ∧ 库确实未被改动（仍老结构）',
      post.error !== null &&
        String(post.error.message).includes(JSON.stringify(['word'])) &&
        JSON.stringify(pkCols(old4)) === JSON.stringify(['word']),
      `错误信息含 ${JSON.stringify(JSON.stringify(['word']))}=${post.error ? String(post.error.message).includes(JSON.stringify(['word'])) : 'n/a'} · 实测主键=${JSON.stringify(pkCols(old4))}`,
    );
    A.eq('A32b 后置校验抛错时**数据零损失**：老结构下 2 行逐字段 == 迁移前快照（响亮失败不损坏数据；AC-12⑥）', snapWithLang(old4), before4);

    const old5 = path.join(RUN, 'a33_retry_bounded.db');
    makeOldDb(old5, true, FIXTURE_WITH_LANG.slice(0, 2), 'CREATE INDEX book_new ON book(word)');
    const before5 = snapWithLang(old5);
    const bounded = captureWarns(() => openDatabase(old5));
    if (bounded.value) opened.push(bounded.value);
    const baks5 = bakFiles(old5);
    A.ok(
      'A33 ★ 有界重试（重试仍失败路径）：残留 `book_new` 是**索引** ⇒ 恰 2 条警告（1× 已清除并重试 + 1× 重试仍失败）∧ **不递归**（警告数不随递归增长）∧ 备份数 == **1** ∧ 恰 1 条 `复用本次迁移已创建的快照` 日志（其文件名 == 目录内唯一的那份备份）∧ 最终**抛错**（含「复合主键」）—— ' +
        '备份数期望由 T46 的 `== 2` 改为 **`== 1`**：`ensurePreMigrationBackup(db, st, isRetry)` 复用**本次迁移已创建**的那份快照（T49 引入复用、**T51 把判据由「目录里已有非空 `.bak-`」收紧为「本次调用内刚创建并验证过」**，采纳需求 agent T47 异议 4 —— 一次自愈若落两份，桌面端 `dict.db` 约 **494 MB** ⇒ 约 **1 GB** 磁盘占用），故**份数不再是「迁移尝试次数」的上界**；有界性（至多一次重试、不递归）的证据改由「恰 2 条警告」承担，而「复用确实发生」由那条 stdout 日志直接钉住（见 A28b/A33b）',
      bounded.messages.filter((w) => w.includes('已清除并重试一次迁移')).length === 1 &&
        bounded.messages.filter((w) => w.includes('重试仍失败')).length === 1 &&
        reuseLogNames(bounded.logs).length === 1 &&
        reuseLogName(bounded.logs.find((l) => reuseLogName(l)) ?? '') === baks5[0] &&
        baks5.length === 1 &&
        bounded.error !== null &&
        String(bounded.error.message).includes('复合主键'),
      `警告=${JSON.stringify(bounded.messages.map((w) => w.slice(0, 40)))} · 复用日志=${JSON.stringify(reuseLogs(bounded.logs))} · 复用日志指向=${JSON.stringify(reuseLogName(bounded.logs.find((l) => reuseLogName(l)) ?? ''))} · 唯一备份=${JSON.stringify(baks5[0] ?? null)} · 备份数=${baks5.length}（复用 ⇒ 期望 1）· 抛出=${bounded.error ? '是' : '否'}`,
    );
    A.ok(
      'A33b ★ 被**复用**的那份备份仍是有效的「迁移前」一致快照（复用策略的安全性）：备份行数 == 迁移前 2 行 ∧ 逐字段 == 迁移前快照 ∧ 主键仍是老结构 `[word]` ∧ `integrity_check` = ok —— 即「复用」复用到的确实是**首次尝试在改动数据之前**落下的快照，不是半迁移态/被改写的文件（与 A34 互补：A34 管**源库**数据无损，本条管**回退点内容**有效。T51 收紧判据后该性质更强：可复用的只有**本次**刚创建的那份）',
      baks5.length === 1 &&
        JSON.stringify(snapWithLang(path.join(RUN, baks5[0]))) === JSON.stringify(before5) &&
        JSON.stringify(pkCols(path.join(RUN, baks5[0]))) === JSON.stringify(['word']) &&
        integrityOk(path.join(RUN, baks5[0])) === true,
      baks5.length === 1
        ? `备份 ${snapWithLang(path.join(RUN, baks5[0])).length} 行（迁移前 ${before5.length}）· 逐字段==迁移前=${JSON.stringify(snapWithLang(path.join(RUN, baks5[0]))) === JSON.stringify(before5)} · 主键=${JSON.stringify(pkCols(path.join(RUN, baks5[0])))} · integrity=${integrityOk(path.join(RUN, baks5[0]))}`
        : `备份数=${baks5.length}（期望 1；无法取内容）`,
    );
    A.ok(
      'A34 ★ 响亮失败仍保住数据与回退点（端到端崩前/崩后一致）：A33 场景下库内数据逐字段 == 迁移前快照 ∧ 已留下**迁移前形态**（主键 [word]）的一致性快照备份 ⇒ 抛错不等于数据受损（复用 ⇒ 实测**恰 1 份**；其内容有效性见 A33b）',
      JSON.stringify(snapWithLang(old5)) === JSON.stringify(before5) &&
        baks5.length >= 1 &&
        baks5.every((b) => JSON.stringify(pkCols(path.join(RUN, b))) === JSON.stringify(['word'])),
      `数据==迁移前=${JSON.stringify(snapWithLang(old5)) === JSON.stringify(before5)} · 备份数=${baks5.length} · 备份主键=${JSON.stringify(baks5.map((b) => pkCols(path.join(RUN, b))))}`,
    );

    /* --- ⓘ T46 缺陷登记（**非断言**）：备份失败路径**绕过**后置校验 ---
     * 判别手段（确定性，不依赖时序）：冻结 `Date` ⇒ 备份名可预测 ⇒ 预先在该路径放一个**目录**占位
     * ⇒ `VACUUM INTO` 报 `unable to open database: <路径>`（目标已存在）⇒ 走 `catch{…放弃迁移}` 的 `return`
     * ⇒ 该 `return` 在**后置校验之前** ⇒ `openDatabase()` 不抛错、返回老结构连接。
     * 复核：scripts/probe_t46_backup_fail.mjs ②；同一机制在生产上的可达性：磁盘空间不足（VACUUM INTO
     * 需额外 ~494 MB）、目标目录不可写、I/O 错误。 */
    const obsFile = path.join(RUN, 'a35_backup_fail_obs.db');
    makeOldDb(obsFile, true, FIXTURE_WITH_LANG.slice(0, 2));
    const FIXED_MS = Date.UTC(2026, 0, 2, 3, 4, 5, 678);
    const RealDate = Date;
    const bakName = `${obsFile}.bak-${new RealDate(FIXED_MS).toISOString().replace(/[:.]/g, '-')}`;
    fs.mkdirSync(bakName, { recursive: true }); // 占位（目录）⇒ 备份目标已存在 ⇒ VACUUM INTO 必失败
    class FrozenDate extends RealDate {
      constructor(...a) {
        if (a.length === 0) super(FIXED_MS);
        else super(...a);
      }
      static now() {
        return FIXED_MS;
      }
    }
    let obsCall = { value: null, error: null, messages: [] };
    try {
      globalThis.Date = FrozenDate;
      obsCall = captureWarns(() => openDatabase(obsFile));
    } finally {
      globalThis.Date = RealDate;
    }
    const obsPk = pkCols(obsFile);
    let obsAdd = 'n/a';
    let obsList = 'n/a';
    if (obsCall.value) {
      const addEn = captureWarns(() => bookAdd(obsCall.value, 'obsprobe', [], 'en'));
      const addRu = captureWarns(() => bookAdd(obsCall.value, 'обспроб', [], 'ru'));
      const list = captureWarns(() => bookList(obsCall.value, 'en'));
      obsAdd = addEn.error && addRu.error ? 'both-throw' : 'ok';
      obsList = list.error ? 'throw' : `${list.value.length}-ok`;
      opened.push(obsCall.value);
    }
    console.log(
      `  ⓘ 缺陷登记（**非断言**，判定权在主管）：**备份失败**路径绕过 T45 后置校验 —— ` +
        `冻结时钟 + 预占备份名 ⇒ VACUUM INTO 失败 ⇒ ${obsCall.error ? 'openDatabase 抛出（= 已修 ✔）' : `openDatabase **未抛** ∧ 主键 ${JSON.stringify(obsPk)} ∧ bookList ${obsList} ∧ bookAdd(en/ru) ${obsAdd}（实测均抛 ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint）`}` +
        `；warn=${JSON.stringify(obsCall.messages.map((w) => w.slice(0, 52)))}`,
    );
    fs.rmSync(bakName, { recursive: true, force: true });
    KNOWN_GAPS.push(
      `备份失败路径绕过后置校验：openDatabase() 未抛 ∧ 主键 ${JSON.stringify(obsPk)} ∧ bookList ${obsList} ∧ bookAdd ${obsAdd}` +
        `（复核 scripts/probe_t46_backup_fail.mjs ②；可达性：磁盘不足 / 目录不可写 / I-O 错误）`,
    );
    {
      // ⓘ ③ 反复失败的启动累积整库大小的备份（复核脚本 ③）—— ★ 状态随实现**往复**，勿照抄旧结论：
      //   T46 实测 [1,2,3]（每次失败启动各落一份）→ T49 复用（目录扫描式判据）顺带修掉「累积」
      //   ⇒ T50 实测 [1,1,1] → ★ **T51 收紧判据后回到 [1,2,3] 的形态**：复用判据变成
      //   「**同一次 `openDatabase()` 调用内**刚创建并验证过」，而 `openDatabase` 调
      //   `migrateBookCompositeKey(db)` **不传 `st`**（`packages/core/src/db/index.ts:133`）
      //   ⇒ 每次启动都是新的 `{ bak: null }` ⇒ 第二次启动**不会**复用第一次那份，各落一份。
      //   ★ 结论分两层，勿混：**一次自愈仍只落 1 份 ✔**（A28b/A33 钉住 = T49 的体积诉求仍成立）；
      //     **跨启动**的累积回来了 ✘（本条登记，判定权在主管 —— 是否值得再收一条「清理/复用」策略）。
      const accFile = path.join(RUN, 'a35_backup_accum_obs.db');
      makeOldDb(accFile, true, FIXTURE_WITH_LANG.slice(0, 2), 'CREATE VIEW book_new AS SELECT 1 AS x');
      const counts = [];
      for (let i = 0; i < 3; i++) {
        const r = captureWarns(() => openDatabase(accFile));
        if (r.value) opened.push(r.value);
        counts.push(bakFiles(accFile).length);
      }
      const accum = JSON.stringify(counts) === JSON.stringify([1, 2, 3]);
      console.log(
        `  ⓘ 缺陷登记（**非断言**）：迁移持续失败时**每次启动各落一份整库大小的备份** —— 连续 3 次 openDatabase ⇒ 备份数 ${JSON.stringify(counts)}。` +
          `史实：T46 = [1,2,3] → T49 复用（扫目录）曾修掉累积 = [1,1,1] → ★ T51 收紧判据（只复用「本次调用内已创建」）⇒ **回到累积形态**：` +
          `${accum ? '仍累积 ⚠ = 与 T51 判据一致（跨 openDatabase 调用不复用），属**已知残余**：一次自愈仍只 1 份 ✔、首次那份无清理机制 ✘' : '未复现 [1,2,3]（与 T51 判据的预期不符，请复核）'}`,
      );
      KNOWN_GAPS.push(
        `反复失败的启动累积整库大小的 .bak：连续 3 次 openDatabase ⇒ 备份数 ${JSON.stringify(counts)}` +
          `（T46=[1,2,3] → T49 扫目录式复用=[1,1,1] → T51 收紧为「本次调用内」⇒ 跨启动不再复用、累积回归；` +
          `一次自愈仍只 1 份 ✔；残余：首次 1 份 + 无清理机制）`,
      );
    }
    {
      // ⓘ ④ 「已清除并重试一次迁移」警告在残留对象是**索引**时**不实**（后果安全：最终抛错）
      console.log(
        `  ⓘ 缺陷登记（**非断言**）：A33 场景里警告称「已清除」，但实测 sqlite_master 中 book_new 仍为 ${JSON.stringify(sqliteObject(old5, 'book_new'))}` +
          `（DROP TABLE IF EXISTS 对索引静默无效）—— 后果安全（A33 最终抛错），但日志会误导排查`,
      );
      KNOWN_GAPS.push(`「已清除并重试一次迁移」警告在索引情形不实：实测 sqlite_master 中 book_new 仍为 ${JSON.stringify(sqliteObject(old5, 'book_new'))}`);
    }

    // --- A29 观察行（T36 提出的观察项；**T41 已修**、T42 已在块 E 升级为红断言） ---
    // 保留此行只为「现场证据仍可一眼看到」；充分性判定**不在 A 块**，见 [E]。
    const walDb = path.join(RUN, 'a29_wal.db');
    const wdb = openDatabase(walDb);
    opened.push(wdb);
    bookAdd(wdb, 'walprobe', [], 'ru');
    const jm = wdb.prepare('PRAGMA journal_mode').get();
    const walFile = walDb + '-wal';
    const walSizeObs = fs.existsSync(walFile) ? fs.statSync(walFile).size : -1;
    // 备份侧证据：A14 打开过 `.bak`（其头部仍写着 journal_mode=wal）⇒ SQLite 为它生成 sidecar
    const bakWalPath = baks1[0] ? path.join(RUN, baks1[0] + '-wal') : null;
    const bakWalSize = bakWalPath && fs.existsSync(bakWalPath) ? fs.statSync(bakWalPath).size : null;
    console.log(
      `  ⓘ 观察（非断言，判定权已移交块 E）：SCHEMA_SQL 置 journal_mode=${jm.journal_mode}；本夹具 -wal 现 ${walSizeObs} B；` +
        `备份实现 = 先 PRAGMA wal_checkpoint(TRUNCATE) 再 fs.copyFileSync(主库文件) ⇒ 备份 = 主库同构镜像；` +
        `A14 读备份后其 sidecar -wal = ${bakWalSize} B（0 = 无待回放事务）。` +
        '⚠ 本夹具建库走 close ⇒ clean-shutdown checkpoint 已把 WAL 并回 ⇒ 此处**抓不到**「备份漏行」；' +
        '能抓到它的是块 E（夹具刻意保持写连接打开，见 [E] E1–E3）。',
    );

    allFails.push(...A.done());
  }

  /* ---------------------------------------------------------------- *
   * [B] 跨语言隔离（AC-13）
   * ---------------------------------------------------------------- */
  console.log('\n[B] 跨语言隔离 —— 同 word 不同 lang 互不影响（AC-13）');
  {
    const B = new Block('B', '跨语言隔离（AC-13）');
    const bPath = path.join(RUN, 'b_isolation.db');
    const db = openDatabase(bPath);
    opened.push(db);

    bookAdd(db, 'test', ['enTag'], 'en');
    bookAdd(db, 'test', ['ruTag'], 'ru');
    const all0 = bookListAll(db);
    B.eq('B1 同拼写 en + ru 两条并存：bookListAll().length === 2（AC-13①）', all0.length, 2);
    B.eq(
      'B2 两条 lang 分别为 en / ru（AC-13①）',
      all0.map((x) => x.lang).sort(),
      ['en', 'ru'],
    );
    B.ok(
      'B3 tags 各自独立（en=[enTag] / ru=[ruTag]；AC-13①）',
      JSON.stringify(bookGet(db, 'test', 'en').tags) === '["enTag"]' &&
        JSON.stringify(bookGet(db, 'test', 'ru').tags) === '["ruTag"]',
      `en=${JSON.stringify(bookGet(db, 'test', 'en').tags)} ru=${JSON.stringify(bookGet(db, 'test', 'ru').tags)}`,
    );
    const enSnap0 = fullSnapshot(bookGet(db, 'test', 'en'));
    const ruSnap0 = fullSnapshot(bookGet(db, 'test', 'ru'));

    // B4-B6 更新 ru 不得触碰 en（AC-13③）
    bookUpdate(db, { word: 'test', lang: 'ru', note: 'x', status: 'learning' });
    const enAfterRuUpdate = bookGet(db, 'test', 'en');
    B.eq('B4 en 条任何字段不变（含 updated_at）—— 更新 ru 之后（AC-13③）', fullSnapshot(enAfterRuUpdate), enSnap0);
    B.eq('B5 ru 条按 (word,lang) 正确定位并已更新（note=x / status=learning）', [bookGet(db, 'test', 'ru').note, bookGet(db, 'test', 'ru').status], ['x', 'learning']);
    B.ok('B6 status 各自独立：en 仍 new（AC-13①状态独立）', enAfterRuUpdate.status === 'new', enAfterRuUpdate.status);
    const ruSnap1 = fullSnapshot(bookGet(db, 'test', 'ru'));

    // B7-B11 删除 ru：墓碑保语言、en 不受影响（AC-13②⑤）
    bookRemove(db, 'test', 'ru');
    const enAfterRuRemove = bookGet(db, 'test', 'en');
    const ruTomb = bookGet(db, 'test', 'ru');
    B.ok('B7 ru 条 deleted = 1（AC-13②）', ruTomb.deleted === true, JSON.stringify(ruTomb));
    B.ok(
      "B8 ★ 墓碑 lang **不得**被写成 'en'（消除 `existing?.lang ?? 'en'` 回退；AC-13⑤ / §8.1-B-3）",
      ruTomb.lang === 'ru',
      `实测 lang=${JSON.stringify(ruTomb.lang)}`,
    );
    B.ok('B9 en 条 deleted = 0（AC-13②）', enAfterRuRemove.deleted === false, JSON.stringify(enAfterRuRemove));
    B.eq('B10 en 条全部字段（含 updated_at）在 ru 被删后逐字不变（AC-13②）', fullSnapshot(enAfterRuRemove), enSnap0);
    B.ok('B11 ru 墓碑除 deleted 外其余字段沿用既有行（note=x / status=learning）', ruTomb.note === 'x' && ruTomb.status === 'learning', JSON.stringify([ruTomb.note, ruTomb.status]));

    // B12-B15 查询语义（AC-13④⑥）
    B.ok("B12 bookGet(db,'test','ru') 返回 ru 条（墓碑仍可按 (word,lang) 定位）", ruTomb.word === 'test' && ruTomb.lang === 'ru');
    B.ok("B13 bookGet(db,'test')（省略 lang）返回 lang='en' 条（AC-13⑥）", bookGet(db, 'test').lang === 'en', JSON.stringify(bookGet(db, 'test').lang));
    B.eq("B14 bookList(db,'ru') 只含 ru 条（ru 已删 ⇒ 0 条；AC-13④）", bookList(db, 'ru').length, 0);
    B.eq("B15 bookList(db,'en') 只含 en 条（1 条）", bookList(db, 'en').length, 1);
    B.eq('B16 bookList(db)（省略 lang）**不过滤**，返回全部语言的未删除条（AC-13⑥ 有意的不对称）', bookList(db).length, 1);
    B.eq('B17 bookListAll(db) 含墓碑 ⇒ 仍 2 条（同步语义）', bookListAll(db).length, 2);

    // B18-B20 反向：删 en 不动 ru
    const ruSnap2 = fullSnapshot(bookGet(db, 'test', 'ru'));
    bookRemove(db, 'test', 'en');
    B.ok("B18 反向同理：删 en ⇒ en 墓碑 lang 仍为 'en'", bookGet(db, 'test', 'en').lang === 'en');
    B.eq('B19 删 en 后 ru 墓碑逐字不变（AC-13②反向同理）', fullSnapshot(bookGet(db, 'test', 'ru')), ruSnap2);
    B.eq('B20 双墓碑：bookList(db,lang) 两个语言皆 0 条，bookListAll 仍 2 条', [bookList(db, 'en').length, bookList(db, 'ru').length, bookListAll(db).length], [0, 0, 2]);

    // B21-B22 ★ 缺省 lang 的删除语义（裁决十九 / AC-13⑦）：ru-only 词删后必须留在 ru
    bookAdd(db, 'руonly', [], 'ru');
    bookRemove(db, 'руonly'); // 省略 lang
    const t2 = bookGet(db, 'руonly', 'ru');
    B.ok(
      "B21 ★ 省略 lang 删除 ru-only 词 ⇒ 墓碑 lang 仍为 'ru'（缺省走 existingLangForWord，不隐式回退 'en'；裁决十九）",
      t2 !== null && t2.deleted === true && t2.lang === 'ru',
      JSON.stringify(t2),
    );
    B.ok("B22 省略 lang 删除后**不产生**一条多余的同名 'en' 墓碑（回退缺陷的直接否证）", bookGet(db, 'руonly', 'en') === null, JSON.stringify(bookGet(db, 'руonly', 'en')));

    // B23 隔离性对照：合成词（本事实测英俄同形词 = 0，故用合成词，AC-13 判定式明写）
    bookAdd(db, 'zzz', [], 'en');
    bookAdd(db, 'zzz', [], 'ru');
    B.eq('B23 合成词 zzz 双语言并存（bookListAll 计 5 条：test×2 墓碑 + руonly 墓碑 + zzz×2）', bookListAll(db).length, 5);

    // --- B24-B25 ★ 裁决十九：缺省 `lang` 路径的**现行行为**登记（既有语义，**非规范**） ---
    // 红线原文：核心 `lang` 缺省回退**仅作向后兼容**，**UI/IPC 依赖缺省即视为缺陷**。
    bookAdd(db, 'dual', [], 'en');
    bookUpdate(db, { word: 'dual', lang: 'ru', updatedAt: 9_000_000_000_000 }); // ru 的 updated_at 更大
    const dualBeforeEn = fullSnapshot(bookGet(db, 'dual', 'en'));
    const dualBeforeRu = fullSnapshot(bookGet(db, 'dual', 'ru'));
    B.eq('B24a 前置：同词 en/ru 两条**皆存活**（bookListAll 计 7 条）', bookListAll(db).length, 7);
    bookRemove(db, 'dual'); // ★ 省略 lang —— 走 existingLangForWord()
    const dEn = bookGet(db, 'dual', 'en');
    const dRu = bookGet(db, 'dual', 'ru');
    B.ok(
      'B24 缺省 lang 删除：**恰好一条**变墓碑 ∧ 另一条**逐字不变**（含 updated_at）∧ 无多余行',
      dEn.deleted !== dRu.deleted &&
        bookListAll(db).length === 7 &&
        (dEn.deleted ? fullSnapshot(dRu) === dualBeforeRu : fullSnapshot(dEn) === dualBeforeEn),
      JSON.stringify([dEn, dRu]),
    );
    B.ok(
      'B25 登记（**非规范**）：现行缺省选择规则 = `existingLangForWord` 的 `ORDER BY deleted ASC, updated_at DESC LIMIT 1` ⇒ 本夹具落到**updated_at 较大的 ru**；若本条变红说明缺省语义被改动，须复核裁决十九与 UI 契约',
      dRu.deleted === true && dEn.deleted === false && fullSnapshot(dEn) === dualBeforeEn,
      JSON.stringify({ enDeleted: dEn.deleted, ruDeleted: dRu.deleted }),
    );

    allFails.push(...B.done());
  }

  /* ---------------------------------------------------------------- *
   * [C] 同步合并键 = (word, lang)（AC-14）
   * ---------------------------------------------------------------- */
  console.log('\n[C] 同步合并键 —— syncMerge 按 (word, lang) 定位（AC-14）');
  {
    const C = new Block('C', '同步合并键（AC-14）');
    const cPath = path.join(RUN, 'c_sync.db');
    const db = openDatabase(cPath);
    opened.push(db);

    const T1 = 1_700_000_000_000;
    // 先存 en(T1)
    bookUpdate(db, { word: 'test', lang: 'en', updatedAt: T1, addedAt: T1, note: 'EN' });
    const enEn = fullSnapshot(bookGet(db, 'test', 'en'));

    // C1-C2 推 ru(T1-100)：另一语言的 updatedAt 不得决定本条是否被推
    const r1 = syncMerge(db, [newBookItem('test', 'ru', { updatedAt: T1 - 100, addedAt: T1 - 100, note: 'RU' })]);
    C.eq('C1 先存 en(T1) 再推 ru(T1−100) ⇒ pushed === 1（AC-14①）', r1.pushed, 1);
    C.eq('C2 被推入的 ru 条 updated_at === T1−100', bookGet(db, 'test', 'ru').updatedAt, T1 - 100);
    C.eq('C3 en 条未被覆盖（AC-14①：en 保留）', fullSnapshot(bookGet(db, 'test', 'en')), enEn);

    // C4-C5 同 (word,lang) 的 last-write-wins（AC-14②）
    const r2 = syncMerge(db, [newBookItem('test', 'en', { updatedAt: T1, note: 'STALE' })]);
    C.eq('C4 同 (word,lang) 且 updatedAt **等于**当前值 ⇒ 不推（严格 >；AC-14②）', r2.pushed, 0);
    const r3 = syncMerge(db, [newBookItem('test', 'en', { updatedAt: T1 - 1, note: 'OLDER' })]);
    C.eq('C5 同 (word,lang) 且 updatedAt **更旧** ⇒ 不推（AC-14②）', r3.pushed, 0);
    C.eq('C6 不推时 en 条逐字不变（旧值不得落库）', fullSnapshot(bookGet(db, 'test', 'en')), enEn);

    // C7-C8 EN/RU 的 updatedAt 互不干扰（AC-14③）
    const ruBefore = bookGet(db, 'test', 'ru').updatedAt;
    const r4 = syncMerge(db, [newBookItem('test', 'en', { updatedAt: T1 + 500, note: 'NEWER' })]);
    C.eq('C7 同 (word,lang) 且 updatedAt 更新 ⇒ 推入（正向对照，防「一律不推」骗绿）', r4.pushed, 1);
    C.eq('C8 ★ EN 更新后 RU 的 updated_at **不变**（消除按 word 比对；AC-14③）', bookGet(db, 'test', 'ru').updatedAt, ruBefore);
    C.eq('C9 正向推入确已生效：en.note === NEWER', bookGet(db, 'test', 'en').note, 'NEWER');

    // C10-C12 bookListAll 含墓碑 + items 全量（AC-14④）
    bookAdd(db, 'gone', [], 'ru');
    bookRemove(db, 'gone', 'ru');
    const rAll = syncMerge(db, []);
    C.eq('C10 syncMerge(db,[]) 的 items == bookListAll（全量含墓碑；AC-14④）', rAll.items.length, bookListAll(db).length);
    C.ok(
      'C11 items 内含墓碑且 deleted === true（同步删除传播不变；AC-14④）',
      rAll.items.some((x) => x.word === 'gone' && x.lang === 'ru' && x.deleted === true),
      JSON.stringify(rAll.items.map((x) => [x.word, x.lang, x.deleted])),
    );
    C.eq('C12 pulled == 全量条数（含墓碑；AC-14④）', rAll.pulled, bookListAll(db).length);
    C.eq('C13 bookList(db,lang) 不含墓碑（列表语义不变）', [bookList(db, 'en').length, bookList(db, 'ru').length], [1, 1]);

    // C14-C18 sync-server 协议不改（AC-14⑤，文本级契约）
    const syncSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'sync-server', 'src', 'index.ts'), 'utf8');
    C.ok(
      "C14 sync-server 路由不变：GET /api/v1/book · GET /api/v1/book-groups · POST|PUT /api/v1/sync(+book)（AC-14⑤）",
      syncSrc.includes("p === '/api/v1/book'") &&
        syncSrc.includes("p === '/api/v1/book-groups'") &&
        syncSrc.includes("p === '/api/v1/sync'"),
      '路由字符串缺失',
    );
    C.ok(
      'C15 分组路由仅多一个 query 参数，过滤发生在该层（bookList(syncDb, lang)；AC-17⑤⑥）',
      /bookList\(syncDb,\s*lang\)/.test(syncSrc),
    );
    C.ok(
      'C16 sync 响应 payload 结构不变：{ ok, pushed, pulled, items }（AC-14⑤）',
      /ok:\s*true,\s*pushed:\s*merged\.pushed,\s*pulled:\s*merged\.pulled,\s*items:\s*merged\.items/.test(syncSrc.replace(/\s+/g, ' ')),
      '未匹配到 payload 字段序列',
    );
    C.ok(
      'C17 入参契约不变：body.items 数组（Array.isArray(body.items)）',
      syncSrc.includes('Array.isArray(body.items)'),
    );
    const typesSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'core', 'src', 'types.ts'), 'utf8');
    const biMatch = typesSrc.match(/export interface BookItem \{([\s\S]*?)\n\}/);
    const biFields = biMatch ? [...biMatch[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]) : [];
    C.eq(
      'C18 `BookItem` 字段**未增删**（word/lang?/addedAt/updatedAt/status/note/tags/reviewCount/lastReviewedAt/deleted?；AC-14⑤）',
      biFields,
      ['word', 'lang', 'addedAt', 'updatedAt', 'status', 'note', 'tags', 'reviewCount', 'lastReviewedAt', 'deleted'],
    );

    allFails.push(...C.done());
  }

  /* ---------------------------------------------------------------- *
   * [D] 语言判定与既有数据（AC-16 存储侧 / AC-13⑦）
   * ---------------------------------------------------------------- */
  console.log('\n[D] 语言判定与既有数据（AC-16⑤⑥ 存储侧 / AC-13⑦ 显式传 lang）');
  {
    const D = new Block('D', '语言判定与既有数据（AC-16 存储侧 / AC-13⑦）');

    // D1-D5 isCyrillic 判定路径（AC-16④）
    D.eq("D1 isCyrillic('тест') === true（西里尔 ⇒ 'ru'）", isCyrillic('тест'), true);
    D.eq("D2 isCyrillic('test') === false（拉丁 ⇒ 'en'）", isCyrillic('test'), false);
    D.eq("D3 isCyrillic('Краков') === true（专名同样判定）", isCyrillic('Краков'), true);
    D.eq("D4 isCyrillic('水') === false（CJK 不计入西里尔 —— 自动判定会落 'en'，属既有设计边界）", isCyrillic('水'), false);
    D.ok(
      "D5 存储侧一致性：isCyrillic 判定的语言与 bookAdd 实际落库的 lang 一致（合成词）",
      (() => {
        const p = path.join(RUN, 'd_lang.db');
        const db = openDatabase(p);
        opened.push(db);
        const w = 'проверка';
        const l = isCyrillic(w) ? 'ru' : 'en';
        bookAdd(db, w, [], l);
        const got = bookListAll(db);
        return got.length === 1 && got[0].lang === 'ru' && !isCyrillic('check');
      })(),
    );

    // D6-D8 拉丁词 + lang='ru' 的存储往返（§8.5 第 2 条的存储侧对应）
    const p = path.join(RUN, 'd_override.db');
    const db = openDatabase(p);
    opened.push(db);
    bookAdd(db, 'test', [], 'ru'); // 用户手工覆盖：拉丁串以 ru 入库
    D.eq("D6 手动覆盖优先：拉丁词 'test' 以 lang='ru' 入库后 bookGet(word,'ru') 命中", bookGet(db, 'test', 'ru')?.lang, 'ru');
    D.ok('D7 同一拉丁词另存 en 后两条并存（覆盖不冲突）', (() => { bookAdd(db, 'test', [], 'en'); return bookListAll(db).length === 2; })());
    D.ok("D8 bookGet('test') 缺省仍返回 en 条（不因存在 ru 条而错位；AC-13⑥）", bookGet(db, 'test').lang === 'en');

    // D24-D25 ★ 口径登记：`deleted` 的**类型**（主管第 8 次同类陷阱：整数 0/1 vs boolean 混用比较）
    // `rowToBook`（packages/core/src/db/index.ts）做 `deleted: r.deleted === 1` ⇒ **API 层是 boolean**、SQL 原样是 0/1。
    const tp = path.join(RUN, 'd_types.db');
    const tdb = openDatabase(tp);
    opened.push(tdb);
    bookAdd(tdb, 't1', [], 'en');
    bookAdd(tdb, 't2', [], 'ru');
    bookRemove(tdb, 't2', 'ru');
    const rawDel = tdb.prepare('SELECT word, deleted FROM book ORDER BY word').all().map((r) => [r.word, r.deleted]);
    const apiAll = bookListAll(tdb);
    D.ok(
      'D24 口径登记：API 层（`bookGet`/`bookList`/`bookListAll`）的 `deleted` 是 **boolean** —— 三个来源一致，不得与 `1` 直接比较',
      bookGet(tdb, 't2', 'ru').deleted === true &&
        bookGet(tdb, 't1', 'en').deleted === false &&
        apiAll.every((b) => typeof b.deleted === 'boolean') &&
        apiAll.find((b) => b.word === 't2').deleted === true &&
        bookList(tdb, 'en').every((b) => b.deleted === false),
      JSON.stringify(apiAll.map((b) => [b.word, typeof b.deleted, b.deleted])),
    );
    D.ok(
      'D25 口径登记：SQL 原样 `deleted` 是 **0/1 整数**（`typeof === "number"`，`!== true`）⇒ API 与 SQL 两个口径**不可混用比较**',
      rawDel.length === 2 &&
        rawDel.every(([, v]) => typeof v === 'number') &&
        rawDel.find(([w]) => w === 't2')[1] === 1 &&
        rawDel.find(([w]) => w === 't1')[1] === 0,
      JSON.stringify(rawDel),
    );

    // D9-D18 localStorage 路径：node 下无法执行 ⇒ 文本级契约（如实声明）
    console.log('  ⓘ localStorage（apps/web/src/api.ts）在 node 下**无法执行**（无 localStorage 全局）');
    console.log('    ⇒ 以下 D9–D18 为**文本级契约断言**（不替代真实渲染；仍须 REQ §8.4 的 UI 冒烟）');
    let apiSrc = '';
    try {
      apiSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'src', 'api.ts'), 'utf8');
    } catch (e) {
      apiSrc = '';
    }
    const has = (s) => apiSrc.includes(s);
    D.ok("D9 BOOK_LOCAL_KEY 未变（'zidian-book-local'；AC-16⑤）", has("const BOOK_LOCAL_KEY = 'zidian-book-local';"));
    D.ok('D10 存储结构带版本号 BOOK_LOCAL_VERSION = 2（AC-16⑥）', /const BOOK_LOCAL_VERSION = 2;/.test(apiSrc));
    D.ok(
      "D11 inferLang 复用 isCyrillic：`isCyrillic(word) ? 'ru' : 'en'`（AC-16④⑥同规则）",
      /return isCyrillic\(word\) \? 'ru' : 'en';/.test(apiSrc),
    );
    D.ok(
      'D12 itemLang：已有 lang 不再改写，缺 lang 才按词形推断（幂等的判定基础；AC-16⑥）',
      /return b\.lang && b\.lang !== 'auto' \? b\.lang : inferLang\(b\.word\);/.test(apiSrc),
    );
    D.ok(
      'D13 旧**裸数组**识别 + 首次读取写回一次（legacyArray ⇒ migrated ⇒ writeLocalBook；AC-16⑥）',
      has('const legacyArray = Array.isArray(parsed);') && has('let migrated = legacyArray;') && has('if (migrated) writeLocalBook(items);'),
    );
    D.ok(
      'D14 写回结构 = { version, items } ⇒ 写回后不再满足「裸数组」条件 ⇒ **天然幂等**（AC-16⑥判定式 = 幂等）',
      /const file: LocalBookFile = \{ version: BOOK_LOCAL_VERSION, items \};/.test(apiSrc),
    );
    D.ok(
      'D15 bookAdd 去重按 **(word, lang)**（AC-16⑤）',
      /b\.word\.toLowerCase\(\) === word\.toLowerCase\(\) && itemLang\(b\) === l && !b\.deleted/.test(apiSrc),
    );
    D.ok(
      'D16 bookList(lang?) 按 lang 过滤 · 缺省不过滤（与核心缺省语义一致；AC-16⑤ / D17）',
      /async bookList\(lang\?: string\): Promise<BookItem\[\]> \{/.test(apiSrc) &&
        /return lang \? items\.filter\(\(b\) => itemLang\(b\) === lang\) : items;/.test(apiSrc),
    );
    D.ok(
      'D17 bookRemove(word, lang?) / bookUpdate 均按 **(word, lang)** 定位（AC-16⑤）',
      /async bookRemove\(word: string, lang\?: string\): Promise<void> \{/.test(apiSrc) &&
        /lang \?\? items\.find\(\(b\) => b\.word\.toLowerCase\(\) === w\)\?\.lang \?\? inferLang\(word\);/.test(apiSrc) &&
        /b\.word\.toLowerCase\(\) === w && itemLang\(b\) === l \? \{ \.\.\.item, lang: l \} : b/.test(apiSrc),
    );
    D.ok(
      'D18 bookGroups(lang?) 按 lang 过滤 + lookup 的 inBook 叠加按 (word, lang)（AC-16⑤ / AC-17⑤）',
      /const items = lang \? all\.filter\(\(b\) => itemLang\(b\) === lang\) : all;/.test(apiSrc) &&
        apiSrc.includes('itemLang(b) === entryLang'),
    );

    // D19-D23 AC-13⑦ / AC-16④⑦：UI / IPC 调用点**必须显式传 lang**（文本级）
    const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'desktop', 'src', 'main.mjs'), 'utf8');
    const clipSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'apps', 'web', 'src', 'components', 'ClipboardPopup.tsx'),
      'utf8',
    );
    const bookSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'apps', 'web', 'src', 'components', 'BookPanel.tsx'),
      'utf8',
    );
    D.ok(
      "D19 desktop IPC 'book:remove' 显式接 lang 并透传（AC-13⑦）",
      /ipcMain\.handle\('book:remove',\s*\(_e,\s*word,\s*lang\)/.test(mainSrc) &&
        /bookRemove\(db,\s*String\(word\),\s*lang \? String\(lang\) : undefined\)/.test(mainSrc),
    );
    D.ok('D20 ClipboardPopup 删除显式传 lang（AC-13⑦）', /bookRemove\(detail\.word,\s*lang\)/.test(clipSrc));
    D.ok(
      'D21 BookPanel 删除显式传 lang（item.lang ?? 当前子页签；AC-13⑦）',
      /bookRemove\(item\.word,\s*item\.lang \?\? lang\)/.test(bookSrc),
    );
    D.ok(
      'D22 BookPanel 列表读取显式传 lang（不得依赖核心缺省「不过滤」；AC-16⑦）',
      /\.bookList\(lang\)/.test(bookSrc),
    );
    D.ok(
      "D23 BookPanel 添加框：自动判语言 + 手动覆盖（choice === 'auto' ? isCyrillic(w) ? 'ru' : 'en' : choice；AC-16④）",
      /choice === 'auto' \? \(isCyrillic\(w\) \? 'ru' : 'en'\) : choice/.test(bookSrc),
    );

    allFails.push(...D.done());
  }

  /* ---------------------------------------------------------------- *
   * [E] 备份一致性（AC-12⑧ · T45 实现：`VACUUM INTO` 一致性快照）—— T42 新增 / T46 改写
   *
   * T42 时本块断言的是**方案 A**（`wal_checkpoint(TRUNCATE)` + `copyFileSync`）。主管 T45 把生产
   * 实现换成 `VACUUM INTO`，理由是方案 A 自带一条 busy ⇒ **放弃迁移**的降级路径，而放弃迁移的后果
   * 极严重：老结构库上「能打开、列表正常，但一条也加不进去」（`bookAdd/bookRemove/bookUpdate`
   * 全部抛 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`）。
   * ⇒ 本块为方案 A 而写的**性质断言**按设计变红（这正是它们有鉴别力的证据），T46 改写为：
   *   ① 源库有未并回的 WAL 时，备份含全部已提交行                 → E4 / E5（不变，仍是最强判据）
   *   ② 备份与主库**逻辑等价**（行数 / 逐字段 / integrity / 可独立打开） → E6
   *      ②' 反向守卫：备份与主库**逐字节不相等**（= 实现未被换回 copyFileSync） → E6b
   *      ②'' 备份 `journal_mode == delete`（`VACUUM INTO` 导出的完整独立库；copyFileSync 产物为 wal） → E7
   *   ③ 变体 dist（删 `VACUUM INTO`、换成 `copyFileSync(主库)` = 方案0）⇒ 断言必须变红 → E11–E14
   *   ④ 并发读者下**不再有** busy 放弃分支（T45 消除的缺陷，正面证明）    → E15–E17
   * ---------------------------------------------------------------- */
  console.log('\n[E] 备份一致性 —— 非空 WAL 下的备份充分性（AC-12⑧ · T45 `VACUUM INTO` / T46 改写）');
  {
    const E = new Block('E', '备份一致性（AC-12⑧ · T45）');
    const DIST_DIR = path.join(REPO_ROOT, 'packages', 'core', 'dist');

    /* --- E1–E3 夹具有效性自证（★ 防「clean-shutdown checkpoint 抹平现场」复辟） --- */
    const prod = walBackupScenario('e_prod', openDatabase, RUN);
    E.ok(
      'E1 夹具有效性①：迁移前 `-wal` 字节数 > 0（有已提交事务尚未并回主库）—— 本条即防「夹具被 clean-shutdown checkpoint 抹平」而复现 T36 的假绿',
      prod.walBefore > 0,
      `实测 -wal = ${prod.walBefore} B（-1 表示文件不存在 = 已被 checkpoint 并删除 = 夹具无效）`,
    );
    E.ok(
      `E2 夹具有效性②：**只复制主库文件**得到的单文件副本**缺**那条刚写入的行（= 方案0 的失效机制在夹具上确实成立，不是合成假设）`,
      prod.mainOnly.n === 2 && !prod.mainOnly.words.includes(NEW_WORD),
      `单文件副本 ${prod.mainOnly.n} 行 ${JSON.stringify(prod.mainOnly.words)}`,
    );
    E.ok(
      'E3 夹具有效性③：保持打开的写连接 B 在迁移前读得到 3 行（alpha/beta + 刚写入的新行）⇒ 新行「已提交且在源库可见」',
      prod.visibleBefore === 3 && prod.wordsBefore.includes(NEW_WORD),
      `B 可见 ${prod.visibleBefore} 行 ${JSON.stringify(prod.wordsBefore)}`,
    );
    E.eq('E3b 前置：迁移前不存在任何备份文件（备份确由本次迁移产生，非历史残留）', prod.baksPre, 0);

    /* --- E4 / E5 ★ 需求①：备份必须含全部已提交行 --- */
    E.ok(
      'E4 ★ 源库有未并回的 WAL 时，迁移产生的备份**含全部已提交行**：备份行数 == 迁移前源库可见行数 ∧ 含那条只存在于 `-wal` 的新行（T36-F1 的直接否证）',
      prod.bak !== null && prod.bakWords.length === prod.visibleBefore && prod.bakWords.includes(NEW_WORD),
      `备份 ${prod.bakWords.length} 行 ${JSON.stringify(prod.bakWords)} / 迁移前可见 ${prod.visibleBefore} 行 ${JSON.stringify(prod.wordsBefore)}`,
    );
    E.ok(
      'E5 ★ 备份逐行逐字段 == 迁移前源库快照（把 A14 从「WAL 已清空」的弱场景推广到「WAL 非空」的真场景：10 个字段全覆盖，含 lang/deleted）',
      prod.bakSnap !== null && JSON.stringify(prod.bakSnap) === JSON.stringify(prod.before),
      `备份 ${JSON.stringify(prod.bakSnap)} / 迁移前 ${JSON.stringify(prod.before)}`,
    );

    /* --- E6 / E6b / E7 ★ 需求②（T46 改写）：`VACUUM INTO` 的**逻辑等价**（不再是逐字节副本） --- */
    E.ok(
      'E6 ★ 备份与源库**逻辑等价**（T45 `VACUUM INTO` 的性质，取代 T42 的「逐字节相等」）：① 备份行数 == 迁移前源库可见行数 ② 逐行逐字段 == 迁移前 10 字段快照 ③ `PRAGMA integrity_check` = ok ④ 备份可**独立打开**且读到那条只存在于 `-wal` 的行（= 备份本身是完整可用的回退点）',
      prod.bak !== null &&
        prod.bakWords.length === prod.visibleBefore &&
        JSON.stringify(prod.bakSnap) === JSON.stringify(prod.before) &&
        prod.bakIntegrity === true &&
        prod.bakProbeNew?.hit >= 1,
      `备份 ${prod.bakWords.length} 行（迁移前可见 ${prod.visibleBefore}）· 逐字段==迁移前=${JSON.stringify(prod.bakSnap) === JSON.stringify(prod.before)} · integrity=${prod.bakIntegrity} · 独立打开读到只存在于 -wal 的行=${JSON.stringify(prod.bakProbeNew)}`,
    );
    E.ok(
      'E6b ★ **反向守卫**（接管 T42 原 E6 的定位）：备份与主库**逐字节不相等** ∧ 文件尺寸不同 —— 方案 A（`copyFileSync`）的产物必然逐字节相等，故本断言保证实现**没有被换回** copyFileSync（其鉴别力由变体 E14 自证：变体下本判据为 false）',
      prod.byteEqToMain === false && prod.bakSize !== prod.mainSize,
      `备份 ${prod.bakSize} B / 主库 ${prod.mainSize} B · 逐字节相等=${prod.byteEqToMain}`,
    );
    E.ok(
      "E7 ★ 备份的 `journal_mode` == `delete`（`VACUUM INTO` 导出库的书面标识：快照是一份**独立完整库**，不继承源库的 WAL 模式）—— 与 E6b 互补的实现标识；`copyFileSync` 产物必然是 `wal`（变体实测 wal，见 E14）",
      prod.bakJm === 'delete',
      `备份 journal_mode=${JSON.stringify(prod.bakJm)}（VACUUM INTO 期望 delete / copyFileSync 期望 wal）`,
    );
    E.ok(
      'E7b E6b/E7 的**成立条件**（明示，避免将来变红时无从解释）：迁移的写事务仍留在 `-wal` 中（迁移后 `-wal` 非空）⇒ 主库文件并不含全部数据，故「逐字节复制主库」= 方案0 必然缺行，而 `VACUUM INTO` 不受影响',
      prod.walAfter > 0,
      `迁移后 -wal = ${prod.walAfter} B`,
    );
    const vacCtl = vacuumControl(RUN);
    E.ok(
      'E8 负对照（**机制级合成对照，不证生产路径**）：同一源库上 `copyFileSync` 产物与主库逐字节相等、`VACUUM INTO` 产物**不相等**且尺寸不同 ⇒ E6b 不是恒真式，确实区分方案 A（copy）与方案 B（VACUUM INTO）（生产路径由 E6/E6b 覆盖，变体鉴别力由 E14 自证）',
      vacCtl.copyEq && !vacCtl.vacuumEq && vacCtl.vacuumSize !== vacCtl.mainSize,
      `copyFileSync 相等=${vacCtl.copyEq} · VACUUM INTO 相等=${vacCtl.vacuumEq} · 尺寸 ${vacCtl.mainSize} / ${vacCtl.vacuumSize} B`,
    );

    /* --- E9 / E10 迁移本身成功、源库保真 --- */
    E.eq('E9 上述场景下迁移**确已完成**（有另一条打开的连接 ⇒ checkpoint 未 busy）：主键列 == [word, lang]（AC-12②⑤）', prod.pkAfter, ['word', 'lang']);
    E.ok(
      'E10 迁移后**源库**数据保真：3 行且逐字段 == 迁移前快照（新行连同 lang 一起进入复合主键表，无改写）',
      JSON.stringify(prod.srcAfter) === JSON.stringify(prod.before),
      `迁移后 ${JSON.stringify(prod.srcAfter)}`,
    );
    E.ok('E10b 迁移未抛异常（备份段与迁移段都不向外抛；AC-12⑥）', prod.error === null && !prod.warns.some((w) => w.includes('放弃迁移')), prod.error ? `抛出 ${prod.error.message}` : `warn=${JSON.stringify(prod.warns)}`);

    /* --- E11–E14 ★ 需求③（T46 重做）：变体 dist（删 `VACUUM INTO`、换回 `copyFileSync` = 方案0）⇒ 断言必须变红 --- */
    const variant = await makeVariantDist(RUN, DIST_DIR);
    E.ok(
      'E11 变体 dist 准备就绪：**副本内** `VACUUM INTO` 那条可执行语句已被换掉（命中行号 > 0）且写入 `fs.copyFileSync(file, bak)`（补丁失配即红，强制人工复核）∧ 生产 `dist` 文本**仍含** `VACUUM INTO` 语句（文本级守卫：实现未被换回方案0）',
      variant.patched &&
        variant.hitLine > 0 &&
        variant.variantHasCopy &&
        !variant.variantHasVacuumStmt &&
        variant.prodHasVacuumStmt,
      `补丁生效=${variant.patched}（命中第 ${variant.hitLine} 行）· 生产 dist 含 VACUUM INTO 语句=${variant.prodHasVacuumStmt} · 副本仍含 VACUUM INTO 语句=${variant.variantHasVacuumStmt} · 副本含 copyFileSync=${variant.variantHasCopy}`,
    );
    const vari = walBackupScenario('e_variant', variant.openDatabase, RUN);
    E.ok(
      'E12 ★ **鉴别力自证**：把 `VACUUM INTO` 换成 `copyFileSync(主库)`（= 方案0）后，同一夹具下备份**缺行**（备份行数 < 迁移前可见行数 ∧ 不含只存在于 `-wal` 的新行）⇒ E4/E6 确实抓得到方案0，不是恒真断言',
      vari.bak !== null && vari.bakWords.length < vari.visibleBefore && !vari.bakWords.includes(NEW_WORD),
      `变体备份 ${vari.bakWords.length} 行 ${JSON.stringify(vari.bakWords)} / 迁移前可见 ${vari.visibleBefore} 行 ${JSON.stringify(vari.wordsBefore)}`,
    );
    E.ok(
      'E13 ★ 同一夹具、同一判据下，变体（方案0）的「备份逐字段 == 迁移前快照」为**伪** ⇒ E5/E6 同样有鉴别力',
      vari.bakSnap !== null && JSON.stringify(vari.bakSnap) !== JSON.stringify(vari.before),
      `变体 备份 ${JSON.stringify(vari.bakSnap?.map((r) => r[0]))} vs 迁移前 ${JSON.stringify(vari.before.map((r) => r[0]))}`,
    );
    E.ok(
      'E14 ★ 变体（方案0）的备份与主库**逐字节相等** ∧ `journal_mode == wal` ⇒ E6b/E7 这两条「实现标识」**确有鉴别力**（方案 A 会被它们抓住）。如实声明（不得夸大）：抓「备份缺行」这一**实质性**缺陷的是 E4/E5/E6，E6b/E7 的职责只是识别实现形态',
      vari.byteEqToMain === true && vari.bakJm === 'wal' && vari.bakJm !== prod.bakJm,
      `变体 逐字节相等=${vari.byteEqToMain} · 变体 journal_mode=${JSON.stringify(vari.bakJm)} vs 生产 ${JSON.stringify(prod.bakJm)}`,
    );

    /* --- E15–E17 ★【T46 反转】并发读者下**不再有** busy 放弃分支（原为「边界登记」，现为「缺陷已消除」的正面证明） --- */
    const busy = walBusyScenario(RUN);
    E.ok(
      'E15 ★【反转】另一连接**持未结束的读事务**时：`VACUUM INTO` 备份**仍然成功**（备份数 ≥ 1 ∧ 该唯一备份含全部 3 行含新行）∧ 迁移**仍然完成**（主键 == [word, lang]）∧ **不出现任何「放弃迁移」警告** ∧ 不抛错 —— 即「checkpoint 遇并发读者 ⇒ busy ⇒ 放弃迁移 ⇒ 静默降级」这一缺陷路径已被 T45 从根上消除（原 T42 断言「busy ⇒ 放弃迁移 ∧ 无备份 ∧ 主键保持老结构」按设计反转）',
      busy.baks1.length >= 1 &&
        busy.bak1Words.length === 3 &&
        busy.bak1Words.includes(NEW_WORD) &&
        JSON.stringify(busy.pk1) === JSON.stringify(['word', 'lang']) &&
        !busy.firstWarns.some((w) => w.includes('放弃迁移')) &&
        busy.firstError === null,
      `warn=${JSON.stringify(busy.firstWarns)} · 备份数=${busy.baks1.length} · 备份 ${busy.bak1Words.length} 行 ${JSON.stringify(busy.bak1Words)} · 主键=${JSON.stringify(busy.pk1)} · 抛出=${busy.firstError ? busy.firstError.message : 'null'}`,
    );
    E.eq('E16 并发读者场景下源库数据完好且**已升级**（新连接可见 3 行含新行；主键 [word, lang]）', busy.srcWords1, ['alpha', 'beta', NEW_WORD]);
    E.ok(
      'E17 ★ 幂等（busy 分支不存在 ⇒ 本条的判别对象改为**重复调用不产生副作用**）：再 `openDatabase()` 一次**不再迁移** ⇒ 备份数不增加（不产生第二份备份）∧ 主键仍 [word, lang] ∧ 源库数据逐字段不变 ∧ 无异常无警告 —— 说明「不再有 busy 放弃」不会以「每次启动都重做迁移 / 每次都落备份」为代价',
      busy.baks2.length === busy.baks1.length &&
        JSON.stringify(busy.pk2) === JSON.stringify(['word', 'lang']) &&
        JSON.stringify(busy.srcSnap2) === JSON.stringify(busy.srcSnap1) &&
        busy.secondError === null &&
        !busy.secondWarns.some((w) => w.includes('放弃迁移')),
      `备份数 ${busy.baks1.length} → ${busy.baks2.length} · 主键=${JSON.stringify(busy.pk2)} · 数据不变=${JSON.stringify(busy.srcSnap2) === JSON.stringify(busy.srcSnap1)} · 二次 warn=${JSON.stringify(busy.secondWarns)}`,
    );

    /* --- E18–E21 补充形态：崩溃残留（主库 + 非空 `-wal`，**无任何连接持有**） ---
     * 这是**最贴近真实**的触发场景（上次进程被强杀 / 断电 ⇒ 下次启动即迁移），
     * 且比 E1–E10 的多连接夹具更弱：单个迁移连接自己就能把 WAL 并回。 */
    console.log('  —— 补充形态：崩溃残留（主库 + 非空 -wal，无人持有；= 上次进程被强杀/断电）');
    const rem = walRemnantScenario('e_remnant', openDatabase, RUN);
    E.ok(
      'E18 崩溃残留形态夹具有效性：`-wal` 字节数 > 0 ∧ 只复制主库文件的副本**缺**新行 ∧ 源库（含 WAL 恢复后）可见 3 行',
      rem.walBefore > 0 && rem.mainOnly.n === 2 && !rem.mainOnly.words.includes(NEW_WORD) && rem.before.length === 3,
      `-wal=${rem.walBefore} B · 单文件副本 ${rem.mainOnly.n} 行 · 源库可见 ${rem.before.length} 行`,
    );
    E.ok(
      'E19 ★ 崩溃残留形态下迁移备份**同样含全部已提交行**（备份 3 行 ∧ 含新行）—— 说明 T41 修复覆盖的是「WAL 非空」这一本质，不依赖是否有多连接',
      rem.bak !== null && rem.bakWords.length === 3 && rem.bakWords.includes(NEW_WORD),
      `备份 ${rem.bakWords.length} 行 ${JSON.stringify(rem.bakWords)}`,
    );
    E.ok(
      'E20 崩溃残留形态下（T46 改判据）：迁移完成（主键 [word, lang]）∧ 备份与源库**逻辑等价**（备份行数 == 迁移前 3 行 ∧ 逐字段 == 迁移前快照 ∧ `integrity_check` = ok）∧ 未走「放弃迁移」分支',
      JSON.stringify(rem.pkAfter) === JSON.stringify(['word', 'lang']) &&
        rem.bakWords.length === rem.before.length &&
        JSON.stringify(rem.bakSnap) === JSON.stringify(rem.before) &&
        rem.bakIntegrity === true &&
        !rem.warns.some((w) => w.includes('放弃迁移')),
      `主键=${JSON.stringify(rem.pkAfter)} · 备份 ${rem.bakWords.length}/${rem.before.length} 行 · 逐字段==迁移前=${JSON.stringify(rem.bakSnap) === JSON.stringify(rem.before)} · integrity=${rem.bakIntegrity} · warn=${JSON.stringify(rem.warns)}`,
    );
    E.eq('E21 崩溃残留形态下备份逐字段 == 迁移前源库快照（与 E5 同判据、不同形态）', rem.bakSnap, rem.before);
    E.ok(
      'E21b ★ 崩溃残留形态下备份与主库**逐字节不相等**（与 E6b 同判据、不同形态）∧ 备份可**独立打开**并读到只存在于 `-wal` 的行 ⇒「实现未被换回 copyFileSync」的反向守卫在本形态同样成立',
      rem.byteEqToMain === false && rem.bakProbeNew?.hit >= 1,
      `逐字节相等=${rem.byteEqToMain} · 独立打开读到只存在于 -wal 的行=${JSON.stringify(rem.bakProbeNew)}`,
    );

    console.log(
      '  ⓘ 证据留痕：本块的实测数值（供独立复核）—— ' +
        `生产：-wal(迁移前)=${prod.walBefore} B · 备份 ${prod.bakWords.length} 行 · 备份/主库 ${prod.bakSize}/${prod.mainSize} B · 备份==主库字节 ${prod.byteEqToMain} · 备份 journal_mode=${JSON.stringify(prod.bakJm)} · 备份 integrity=${prod.bakIntegrity} · 迁移后 -wal=${prod.walAfter} B；` +
        `变体(方案0)：备份 ${vari.bakWords.length} 行 · 备份==主库字节 ${vari.byteEqToMain} · journal_mode=${JSON.stringify(vari.bakJm)}；` +
        `崩溃残留形态：-wal=${rem.walBefore} B · 备份 ${rem.bakWords.length} 行 · 逐字节相等=${rem.byteEqToMain} · integrity=${rem.bakIntegrity}；` +
        '复核脚本：scripts/probe_t42_wal_fixture{,2,3}.mjs（T42 建夹具）· scripts/probe_t46_variant.mjs（变体 dist 造法）· scripts/probe_t46_postcheck.mjs、scripts/probe_t46_backup_fail.mjs（后置校验/备份失败路径）',
    );

    allFails.push(...E.done());
  }
} finally {
  for (const db of opened) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/* ================================================================== *
 * 总计
 * ================================================================== */
const totalMs = Date.now() - tStart;
console.log('\n' + '='.repeat(96));
console.log(`结果：${totalPass} 通过 / ${allFails.length} 失败（共 ${totalPass + allFails.length} 条断言）`);
if (allFails.length) {
  console.log('失败项：');
  for (const f of allFails) console.log(`  - ${f}`);
  console.log(`临时库保留（取证）：${RUN}`);
} else {
  /* T60：先回收**被测实现漏关**的连接，再删目录 —— 否则 Windows 下必报 EPERM（见上文「连接登记表」） */
  const { leaked, reclaimed } = reclaimLeakedConnections();
  try {
    fs.rmSync(RUN, { recursive: true, force: true });
    console.log(`临时库已清理：${path.relative(REPO_ROOT, RUN)}`);
    /* 顺手收掉空的 TMP_ROOT（结构体检把 `scripts/_tmp/**` 记为临时残留；只在**空**时删 ⇒ 与并发运行安全） */
    try {
      if (fs.readdirSync(TMP_ROOT).length === 0) fs.rmdirSync(TMP_ROOT);
    } catch {
      /* 不存在/非空/被并发占用 ⇒ 无害，忽略 */
    }
  } catch (e) {
    console.log(`临时库清理失败（不影响结论）：${e.message}`);
    console.log(`  残留目录：${RUN}`);
    console.log(`  本次漏关连接 ${leaked} 个 / 补关成功 ${reclaimed} 个 ⇒ 若仍为 EPERM/EBUSY，说明有句柄连兜底 close 也关不掉（须人工取证）`);
  }
  if (leaked > 0) {
    console.log(
      `  ⚠ 收尾回收：被测实现**漏关连接 ${leaked} 个**（补关成功 ${reclaimed} 个）—— ` +
        '**归属 = `openDatabase()` 的抛错路径**（源 `packages/core/src/db/index.ts`；**非本测试文件**，本文件只能兜底回收）；' +
        'v0.11.0 候选 **`V11-OPENDB-LEAK`**（修法：抛错前 `db.close()`）',
    );
    console.log(
      `     被锁条目 = 各漏关连接持有其库文件的 3 件套（\`db\` / \`-wal\` / \`-shm\`）；` +
        `**T60 实测基线：${leaked} 个连接 ⇒ 4 个库 × 3 = 12 个条目被锁**（rename 探测 EBUSY；补 close 后 0 被锁 ∧ rmSync 成功）。`,
    );
    console.log(
      '     ⚠ 影响级别 **P1（非 P0）**：桌面端 `openDatabase()` 抛错即 `dialog.showErrorBox` + `app.exit(1)` ⇒ 进程随即退出，' +
        '该路径上**不可观测**；浏览器端 localStorage 路径不碰 SQLite ⇒ **当前无用户可见后果**；' +
        '潜在暴露面 = 长驻进程内反复打开失败库（未来风险）。不新增断言：断言数须保持 137，退出码语义不变，判定权在主管',
    );
  }
}
/* ⚠ T46 实测发现的**未闭环缺陷**（**非断言**：本文件不留红，判定权在主管）。
 * 呈现方式固定为「ⓘ 观察 + 本节汇总」，与新实现是否已修无关（若已修，ⓘ 观察处会直接打印「已修 ✔」）。 */
if (KNOWN_GAPS.length) {
  console.log(`\n⚠ 未闭环缺陷登记（非断言 · 供主管判定 · 共 ${KNOWN_GAPS.length} 条）：`);
  for (const g of KNOWN_GAPS) console.log(`  ⚠ ${g}`);
} else {
  console.log('\n⚠ 未闭环缺陷登记（非断言）：0 条（本次运行未复现任何已登记缺陷）');
}
console.log(`耗时：${totalMs} ms`);
console.log('退出码语义：0=五块全绿（AC-12/13/14/16 存储侧 + AC-12⑧ 备份充分性成立）· 1=任一块有失败（失败项即真实发现）');
console.log('='.repeat(96));

process.exit(allFails.length > 0 ? 1 : 0);
