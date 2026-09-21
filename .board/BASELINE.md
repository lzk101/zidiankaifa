# 基线冻结 — zidiankaifa

> 由项目主管冻结。**任何 agent 声称"提升/回归"之前，必须与本文数字对比，并声明用的是哪把尺子。**
> 冻结时间：2026-09-16　冻结人：项目主管 agent

---

## 1. 代码与仓库状态

| 项 | 值 |
| --- | --- |
| HEAD | `055c753` — `docs: 新增交接文档 + 标注已停摆的需求管理自动化产物为废弃` |
| 与远端 | `origin/main` 同步（`rev-list --left-right --count` = `0  0`） |
| 工作区 | 干净（`git status --short` 为空） |
| 最新版本 / tag | v0.7.1 |
| 全部 tag | v0.2.0, v0.2.1, v0.3.0, v0.4.0, v0.4.1, v0.4.2, v0.4.3, v0.4.4, v0.5.0, v0.6.0, v0.7.0, v0.7.1 |

> 注：`docs/交接文档.md` §0 记的 HEAD 是 `aada652`，它是 `055c753` 的前一个提交；文档写作时交接文档自身尚未提交。以本文 `055c753` 为准。

## 2. 测试基线（实测）

```
pnpm --filter @zidiankaifa/core test     →  regress 99 通过 / 0 失败
                                            lexicon 67 通过 / 0 失败
                                            related 38 通过 / 0 失败
                                            合计 204 通过 / 0 失败
pnpm --filter @zidiankaifa/desktop test  →  dbmigrate 22 通过 / 0 失败
                                            合计 226 通过 / 0 失败
```

## 3. 词库指纹

| 项 | 值 |
| --- | --- |
| 路径 | `data/db/dict.db` |
| 大小 | 494.23 MB（518,204,xxx bytes 量级，精确值以 `(Get-Item).Length` 为准） |
| 不入 git | 是（`.gitignore`） |

关键表行数（`docs/交接文档.md` §5.1，本次未逐表复核，开发/测试 agent 若依赖某表请自行复核）：

| 表 / 视图 | 行数 |
| --- | --- |
| `words`（英语词条） | 770,611 |
| `words_i18n` (ru) | 101,512 |
| `word_etymology` (en) | 154,984 |
| `word_etymology` (ru) | 31,256（实测有词源俄语词条 **31,193**，口径略有差异，见 §4 尺子 B） |
| `morphemes` (en / ru) | 468 / 441 = **909** |
| `morphemes` ru 细分 | prefix 185 / root 163 / suffix 93 = 441 |
| `roots` | 476 |
| `affixes` | 403 |
| `i18n_forms` | 633,514 |
| `word_forms` | 196,396 |

## 4. ⚠️ 俄语拆解覆盖率 —— 三把尺子（本文件最重要的内容）

项目里存在**三把分母互不相同的尺子**，百分数**不可互相比较**。历史上 `docs/交接文档.md` 与 `README.md` 记录的 30.8% / 19.6% 之差正是口径混淆所致（见 `docs/需求总结.md` §17.5）。

| 尺子 | 分母定义 | 实现位置 | **实测值** |
| --- | --- | --- | --- |
| **R（★权威★）** | `SELECT word FROM words_i18n WHERE lang='ru' AND length(word) BETWEEN 4 AND 12 AND rowid % 97 = 0` → 791 词 | `packages/core/test/related.mjs:144` | **30.8%**（244 / 791） |
| A（参考） | 全体俄语主词条 | 无既有实现 | **32.9%**（33,441 / 101,512） |
| B（参考） | 仅「有词源」的俄语词条，固定种子 LCG 抽样 `seed=20260913, N=800` | `packages/data-pipeline/measure_ru_breakdown.mjs` | **38.1%**（305 / 800） |

**采用裁定：迭代验收以尺子 R 为准。** 理由：它是三把中**唯一被自动化断言固化**的尺子（`related.mjs` 的 `俄语拆解覆盖率 X% ≥ 25%`），因此是唯一能防回归、且能写进测试的尺子。

**探针**：`scripts/probe_ru_coverage.mjs`（只读，一次跑出三把尺子）。用法：

```powershell
node scripts/probe_ru_coverage.mjs 800
```

## 5. 冻结基线的两处已知缺陷（本轮发现）

1. **`packages/data-pipeline/measure_ru_breakdown.mjs` 已损坏**。其导入写作 `./packages/core/dist/db/index.js`（按 repo 根目录书写），但文件位于 `packages/data-pipeline/` 下，实际应为 `../../packages/core/dist/db/index.js`。直接运行报 `ERR_MODULE_NOT_FOUND`。尺子 B 的数值目前只能由 `scripts/probe_ru_coverage.mjs` 复现。
2. **`words_i18n` 中存在纯词缀条目**（`-ед` / `-ец` / `-ировать` / `-кать` / `-ость` / `-ский` …）与**专名**（`Абакан` / `Австралия` / `Иисусъ` 旧正字法形）。它们进入分母拉低覆盖率，且**原理上不可拆解**——这直接构成尺子 A 的天花板，也是评估"45% 是否可达"时必须先量化的部分。

## 6. 相关数据上限（来自 `docs/交接文档.md` §5.2，供可达性评估）

| 指标 | 数值 | 备注 |
| --- | --- | --- |
| 俄语词源覆盖 | 30.8% | 31,256 / 101,512；en/zh/ru 三转储已挖到头（第三源 44.3 万词条仅可新增 128 条） |
| 俄语拆解覆盖 | 30.8%（下限断言 ≥25%） | 词素库 441 条限制 |
| 俄语词族覆盖 | 30.6%（≥20%） | 受拆解覆盖率限制 |
| 英语词族覆盖 | 23.2%（≥15%） | — |
| 俄语音标 / 音频 | 64.2% / 10.4% | 受源数据限制 |

**已知不可拆解（A6）**：`луна` / `небо` / `река` / `гора` 等 50/106 常用基础词为单词根词，**原理上无拆解**，已用词源链接补足。这类词构成覆盖率天花板。

---

## 7. ★ 结构预算冻结（2026-09-16 增，用户指令「添加一个 agent 专门做定期项目结构管理」）

> **执行者**：项目结构管理 agent（第 4 个常驻角色，委任书 `.board/roles/structure-agent.md`）。
> **节奏**：**每完成一次版本发布即做一次结构体检**（快检）＋ 每 5 个 release 或大版本后做全量审计。
> **台账**：`.board/STRUCTURE.md`。**额度只能由项目主管经用户拍板后上调；结构 agent 不得自行上调。**

| 维度 | 硬上限 | 每迭代净增配额 | 冻结时实测（2026-09-16，T55 清理后终局） | 余量 |
| --- | --- | --- | --- | --- |
| 已跟踪文件总数 | **300** | ≤ 25 | **253**（时点 `1787775`） | 47 |
| `scripts/` 文件数（递归） | **165** | ≤ 15 | **135** | 30 |
| `dist-release/` 体量（递归） | **1.5 GB** | 只留当前 + 上一版本 | **0.652 GiB（8 文件 / 700,062,244 B）** | **✅ 越线已消解** |
| `data/` 体量（**只报不删**） | **4.5 GB** | 0 | 3.667 GB（53 文件） | 0.83 GB |
| 缓存合计（`.pnpm-store`/`.electron-cache`/`.eb-cache`） | **1.2 GB** | — | 0.791 GB | 0.41 GB |
| 临时残留（`_tmp/` `*.tmpdir/` `.tmp/`） | **0** | — | **0**（`scripts/_tmp` 已清空。⚠ 复跑门禁后允许为 N，见下 ⚠⚠） | — |
| 单文件字节 | **20 MB** | — | 最大已跟踪 = `scripts/out_v9_admission.json` **639,777 B**（3.0%） | — |
| `.board/*.md` 单文件行数 | **3000** | — | BOARD **2537** · EVIDENCE **2451** | ⚠ 余 463 / 549 |

> **★ 2026-09-16 订正（主管，依据结构 agent T55 实测 + 主管独立复跑）**
> 1. **`scripts/` 原记 158、冻结时实测原记 33，两个数字全错** —— 实测 **135**（`git ls-files scripts` = 135；磁盘递归亦 135；**未跟踪残留 0**）。「158」是主管历次会话中的**未复核估计值**，非任何命令输出，**已作废**（本项目第 10 次同类错误：拿未复核计数当事实）。
> 2. **原「`scripts/` 顶层文件数 ≤ 35」这一维度已删除** —— `scripts/` **不存在任何子目录**（`Get-ChildItem scripts -Directory` = 0）⇒ 「顶层」与「递归」**恒等**，该维度**不携带独立信息**，保留只会制造「两数不一致」的假告警。体检项目由十项降为**九项**。
> 3. **`.board/` 文件数**：`git ls-files .board` = **14** —— **原记 9、其后记 12 均已过时**。12 那一版在写下的那一刻确实正确，**是同一提交 `2a796c9` 新增的 `.board/structure/classify_mece.mjs` ＋ `scan_dead_refs.mjs` 让它变旧的**（结构 agent 字节级溯源）。⇒ **纪律：凡「已跟踪文件总数 / 目录文件数」必须带时点或 commit SHA**，否则同一数字在不同时刻都"正确"却互相矛盾。
> 4. ⚠ **`scripts/_tmp/booklang_tmp/run-*` 每跑一次 `pnpm test` 新增 1 个目录**（约 2.4 MB / 54 文件）—— 根因是 `packages/core/test/book_lang.mjs` 收尾 `rmSync` 在 Windows 报 `EPERM, Permission denied`（句柄未释放）。**属既存缺陷，已派 T60 修根因（测试 agent 写域）**；修复前**结构 agent 只登记数量、不得反复重删**（已触委任书 §11 熔断：同一清理复发 2 次）。
> 5. ⚠⚠ **新增操作性约束（结构 agent 提出，主管采纳为纪律）**：**在 `scripts/_tmp` 根因修好之前，任何一次 `pnpm --filter @zidiankaifa/core test` 都会重新制造 1 个 `run-*` ⇒ 本表「临时残留 = 0」与「门禁跑绿」互斥，二者只能保证其一。**
>    ⇒ **执行细则**：结构 agent 复跑门禁后，本项**允许为「本次复跑产生的 N 个 `run-*`」，不得据此判越线**，须与**本次复跑次数**对账（跑 1 次 → 允许 1 个）。这正是结构 agent 首轮**未复跑门禁**的理由（防主动制造越线）。

**越线处置**：`dist-release/` 的 5.49 GB 中，**只有当前与上一版本的安装包有留存价值**——自动更新走 GitHub Release 的 `latest.yml`（`apps/desktop/package.json:67-73` `publish.provider=github`），**不读本地目录** ⇒ 历史包可安全清理。清理动作由结构 agent 执行（属其自主权限 §3.1 第 2 条），**但清单须先报主管核准一次**。

**📌 本文件 §1–§6 的数字为 `055c753`/v0.7.1 时点的冻结快照**（§4 三把尺子的**定义**长期有效，数值以最新实测为准）。当前版本事实以 `PROJECT_STRUCTURE.md` §10 与 `docs/交接文档.md` 为准；**结构 agent 如发现本节数字与实测不符，写入 `.board/STRUCTURE.md` 提请主管订正，不直接改本文件**。

---

## 8. ★★ 门禁账本（v0.11.0 现行口径，2026-09-20 主管亲测）

> **写者**：项目主管（本节属主管写域 `.board/BASELINE.md`）。**构成式变更必须同时改「总数」与「A + B + C」两处**，否则即为本项目反复发生的计数陷阱。

### 8.1 core 626 = 99 + 67 + 38 + 60 + 194 + 26 + 142

| 测试文件 | 断言数 | 说明 |
| --- | --- | --- |
| `packages/core/test/regress.mjs` | 99 | 查词/回归主链 |
| `packages/core/test/lexicon.mjs` | 67 | 词源 + 词根表 + 词缀表 + 词表分离 |
| `packages/core/test/related.mjs` | 38 | 词源关联 & 同根词（**尺子 R 的权威实现** `:144`） |
| `packages/core/test/ru_morph.mjs` | 60 | 俄语拆解「独立判别集」（⚠ 无「结果：」前缀） |
| `packages/core/test/ru_morph_d1fix.mjs` | 194 | D1 修复回归 |
| `packages/core/test/ru_morph_d1guard.mjs` | 26 | 全库 D1 计数守卫（含 `FROZEN` 常量） |
| `packages/core/test/book_lang.mjs` | **142** | 生词本语言分离 + AC-27 复合主键（**137 → 142**） |
| **core 合计** | **626** | exit 0 |

**desktop**：`apps/desktop/test/dbmigrate.test.mjs` = **22 / 0** exit 0
⇒ **门禁合计 = 648 = 626 + 22**（2026-09-20 亲测，工作区无并行写入时采集）

> ⚠ **旧式 `621 = 99+67+38+60+194+26+137` 已作废**。`book_lang.mjs` **137 → 142** 的原因是 AC-27：`book` 表主键由 `(word, lang)` 升为 `(user_id, word, lang)`，测试 agent 更新了 12 条旧主键断言并净增 5 条。
> ⚠ **`book_lang.mjs` 不读冻结词库**（全程临时合成库），测的是 `packages/core/dist/` 产物 ⇒ **改 `packages/core/src/db/**` 后必须先 build**。
> ⚠ **链外手工台账**（不接入 `pnpm test`，数字不变）：`ru_morph_defects.mjs` **55/1 exit 1**（唯一余红 `термостат`）· `ru_morph_goals.mjs` **0/2 exit 2** · `ru_morph_semantic.mjs` **44/1 exit 2**（回归项 0）· `ru_morph_v090_guard.mjs` **107/0 exit 0** · `scripts/check_sync_dto_contract.mjs` **22/0** · `scripts/check_user_scope.mjs`（AC-27 后新增）。

### 8.2 ★★ 冻结词库完整性纪律（2026-09-20 事故后新增，**硬性**）

**指纹（权威）**：`data/db/dict.db` = **518,242,304 B** · mtime = **2026-09-13T23:13:53**（本地）/ `2026-09-13T15:13:53Z`。

1. 🔴 **只读打开冻结库必须用 `new DatabaseSync(path, { readOnly: true })`，严禁 `openDatabase(path)`。**
   `openDatabase()` 会跑 `book` 迁移（`migrateBookLang` → `migrateBookUserId` → `migrateBookCompositeKey` → 后置校验），而迁移**开始前先落一份 `VACUUM INTO` 整库快照** ⇒ 每跑一次门禁就**写一次冻结词库 + 多一个 ~493 MB 的 `dict.db.bak-<ISO>`**。
   **实测事故**：`lexicon.mjs:11` / `related.mjs:25` / `ru_morph.mjs:43` 三处曾用可写 `openDatabase()` ⇒ `data/db/` 膨胀到 **1.700 GiB**（无界增长）。已修（提交 `b37dd2f`）⇒ 备份份数 **0 → 0 不新增**、`dict.db-wal` **0 B**、size/mtime 与基线逐位一致，门禁仍 **648/0**，`data/db/` 回落 **0.737 GiB**。
2. 🔴 **冻结库的「已迁移形态」不可作为基线。** v0.10.0 与 v0.11.0 **两次 `book` 迁移都只存在于 WAL 里**，主文件一直是**最初**的词库 —— 删掉 `-wal` 后实测 `book` 主键 = **`["word"]`（单列）**、`lang` 在末位。
3. 🔴 **判断冻结库是否被污染须三项并查，缺一不可**：① `size` + `mtime` ② **`-wal` / `-shm` 是否存在及其大小** ③ **主文件字节里是否有迁移痕迹**（`idx_book_user_updated` / `book_new` / `PRIMARY KEY (user_id`）。
   ⛔ **只看 size/mtime 会漏判**：主文件未被写、改动全在 WAL 时，二者与基线**完全一致**（本次事故正是如此）。
4. ✅ **恢复手法（已验证）**：**删除 `-wal` / `-shm` 即回到逐字节原状** —— 主文件本身就是最后一个 checkpoint。恢复后须复核 `PRAGMA integrity_check = ok` 与基准表行数：`words` **770611** · `words_i18n`(ru) **101512** · `morphemes` **918** · `roots` **492** · `affixes` **416**。
5. ⚠ **结构性推论**：只要**任何一个**会进入 `pnpm test` 链的文件用可写方式打开冻结库，上述无界增长就会重现。**新增测试文件时必须逐项确认打开方式**。
6. ⚠ **链外同类未修**（手动跑仍会写库，不阻塞门禁）：`packages/core/test/ru_morph_defects.mjs:43` · `ru_morph_goals.mjs:32` · `ru_morph_v090_guard.mjs:36`；`scripts/probe_ru_coverage.mjs:24` · `scripts/exp_v9_admission.mjs:26` · `scripts/exp_ru_ceiling.mjs:30` · `scripts/probe_t32_noi_claims.mjs:14`。另 `packages/data-pipeline/build_roots_tables.mjs:21` **设计上就要写库**（词库重建工具）⇒ **必须在副本上跑**。

### 8.3 `data/` 体量对照（事故前 → 后）

| 项 | 事故峰值 | 修复+清理后 |
| --- | --- | --- |
| `data/db/` 合计 | **1.700 GiB** | **0.737 GiB** |
| 自动迁移快照 `dict.db.bak-<ISO>` | **2 份 / 986 MB** | **0 份** |
| `dict.db-wal` | 每跑一次门禁重建（98,912 B） | **0 B** |

> §7 的 `data/` 预算（**4.5 GB · 只报不删**）**未变**；本次清理对象是**自动生成的迁移快照**（`ensurePreMigrationBackup` 产物），**不是** `data/` 保护清单里的 `dict.db.bak-v02pipe`（272,752,640 B，2026-09-09，**唯一真实老结构迁移夹具，禁删**）与 `data/raw/`（2.93 GiB 词库重建原料）。
