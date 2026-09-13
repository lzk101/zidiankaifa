# 项目结构 — zidiankaifa 电子辞典

> **本文件是「文件放哪儿、能不能改、是死是活」的唯一指针。**
> 权威数值不在这里（在 `.board/BASELINE.md` §4 与 `docs/交接文档.md` §5），环境坑不在这里（在 `AGENTS.md` §3）。
> 整理时间：`2026-09-16`（T55 后订正）· 对应版本 **v0.10.0** · HEAD **`2a796c9`**（T55 结构快检裁决；此前 `05788be` / `224ce73` / `d558aa0`）· 15 个 tag
> 维护纪律：**结构变更（新增顶层目录、移动文件、改归属）必须同步本文件；行数/计数类数字以实测为准并写明口径。**

---

## 0. 三十秒

```
zidiankaifa/
├── 📘 人读文档 ─── AGENTS.md（AI 规范） · PROJECT_CHARTER.md（主管章程）
│                   PROJECT_STRUCTURE.md（本文件） · README.md（对外）
│                   docs/（交接文档 · 需求总结 · release-*.md）· .board/（多 agent 台账）
├── 💻 代码 ─────── packages/core（数据层） · packages/data-pipeline（数据管线）
│                   apps/web（React 前端） · apps/desktop（Electron） · apps/sync-server（同步服务）
├── 🔧 工具 ─────── scripts/（**135** 个只读探针/实验台，**不是产品代码**）· _serve_static.mjs（UI 验证）
├── 📦 数据 ─────── data/raw（源数据 2.93 GB）· data/db/dict.db（**494 MB，冻结，不入 git**）
└── 🗑 产物/缓存 ── dist-release/（安装包 **0.652 GiB / 8 文件 ✅ 额度内** —— T55 已清 12 个历史版本）· node_modules · .pnpm-store · .electron-cache · .eb-cache
```

**三条最容易被新人踩错的**：
1. `scripts/` 里**绝大多数是历史实验脚本**（含 3 个结论已被推翻的），**不是**要维护的产品工具 —— 新增工具请另立名字并登记到本文 §3。
2. `data/db/dict.db` 是**冻结的权威词库**（494 MB，不入 git）。测试与探针**只读**；重建需按 `AGENTS.md` §2 铁律 2 走 `build_db.py`。
3. **归档区 `docs/legacy/`（5 文件）= 僵尸产物**，`DEC-008` 禁止运行、禁止写入（禁令按**文件身份**、不按位置）—— 见 §6。**根目录已无僵尸文档**（2026-09-16 迁入 `docs/legacy/`）。

> 🧹 **结构治理**：本项目有**第 4 个常驻 agent = 项目结构管理 agent**，**每次版本发布后**做一次结构体检与清理。额度 / 权限 / 保护清单见 **§10**。

---

## 1. 顶层清单（含性质与写权限）

| 路径 | 性质 | 入库 | 独占写者 | 说明 |
|---|---|---|---|---|
| `packages/core/` | **产品代码** | ✅ 22 文件 | 开发 agent | 共享数据层：类型契约 + `node:sqlite` 查询库（桌面/服务端共用） |
| `packages/data-pipeline/` | **产品代码 + 数据定义** | ✅ 24 文件 | 开发 agent | 数据管线；`roots.json`(en 468) / `roots_ru.json`(ru 450) 是**词素库唯一来源** |
| `apps/web/` | **产品代码** | ✅ 26 文件 | 开发 agent | React 18 + TS + Vite，**手写 CSS**（无 UI 库） |
| `apps/desktop/` | **产品代码** | ✅ 7 文件 | 开发 agent | Electron 壳 + 词库升级/迁移 + 自动更新 |
| `apps/sync-server/` | **产品代码** | ✅ 5 文件 | 开发 agent | Node http，端口 4570；读 `dist`，**不热更新** |
| `scripts/` | **只读工具 + 历史留痕** | ✅ **135** 文件 | 各角色自建、只读他人 | 见 §3 —— **产品代码不在这里**；**无任何 tracked 子目录文件 ⇒ 顶层 ≡ 递归** |
| `.board/` | **多 agent 台账** | ✅ **14** 文件（**顶层 9 个 `.md`** + `roles/` 3 + `structure/` 2） | **按文件分角色** | 见 §4 |
| `docs/` | **人读权威文档** | ✅ 7 文件 | 需求管理 agent | 见 §5 |
| `data/` | **数据与产物** | 仅 `.gitkeep` | —— | 见 §7（3.67 GB，全部 gitignore） |
| `dist-release/` | **打包产物** | ❌ gitignored | —— | 见 §8（**0.652 GiB / 8 文件** —— T55 已清 12 个历史版本 ＋ `win-unpacked/`） |
| `node_modules/` `.pnpm-store/` `.electron-cache/` `.eb-cache/` | 依赖与缓存 | ❌ | —— | 可删可重建 |

**已核验的入库计数**（**时点 `17ef659`**，T62 清理后实测）：`git ls-files` 共 **219** 个文件 = `scripts/` **99** + `packages/` 43 + `apps/` 38 + `.board/` **15** + `docs/` **13** + `data/` 1（`.gitkeep`）+ 根目录 **10**。
> ⚠ **上一版（T55 后）为 253 = `scripts/` 135 + …**；本行因 **T62 删除 39 个零引用脚本**而下降（135 → 99 中另含 T55→T62 间新增 3 个）。
> ⚠ **读 `git ls-files` 输出时勿被引号误导**：git **默认对非 ASCII 路径加引号并做八进制转义**（如 `"docs/legacy/\344\273\273\345\212\241\346\216\222\345\272\217.md"`），
> 按首段分组会**凭空多出**一个名为 `"docs` 的「目录」。⇒ **需要分组统计时用 `git ls-files -z`**（或 `core.quotepath=false`）。**磁盘上不存在任何含字面引号的路径**（已实测证伪）。

**门禁现状**（结构整理后复跑确认）：`pnpm --filter @zidiankaifa/core test` → **core 621 通过 / 0 失败 exit 0**；`pnpm --filter @zidiankaifa/desktop test` → **22 通过 / 0 失败 exit 0** ⇒ 合计 **643 / 0**。


**根目录文件**：`AGENTS.md`（AI 规范，**全员必读**）· `PROJECT_CHARTER.md`（主管章程）· `PROJECT_STRUCTURE.md`（本文件）· `README.md`（对外）· `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `tsconfig.base.json` · `.gitignore` / `.gitattributes`（共 **10** 个已跟踪）· `_serve_static.mjs`（**仅用于 UI 冒烟**，静态托管 `apps/web/dist`，**未跟踪**）· ~~僵尸产物~~ ⇒ **已全部迁入 `docs/legacy/`（§6），根目录已无僵尸文档**。

---

## 2. 按任务找文件（导航表）

| 我要… | 看/改这里 |
|---|---|
| 查一个词为什么这样拆 | `packages/core/src/db/index.ts` → `breakdownWord()`（约 `:961`）；阈值 `BREAKDOWN_MIN_COVERAGE = 0.55` |
| 改词素库（加词根/后缀） | `packages/data-pipeline/roots_ru.json` → **必须**重建词素表（`AGENTS.md` §2 铁律 2）→ 过质量门（`.board/REQ.md` §8 的 AC-11） |
| 改查词/词源/同根词族 | `packages/core/src/db/index.ts`（`lookupWord` `:770` / `getEtymology` `:632` / `relatedByMorpheme` `:1148`） |
| 改词根词缀表页 | `packages/core/src/db/lexicon.ts` + `apps/web/src/components/LexiconPanel.tsx` |
| 改生词本行为 | `packages/core/src/db/index.ts` book 段（`:1194` 起）+ `apps/web/src/api.ts`（**双后端：SQLite 与 localStorage 都要改**）+ `apps/desktop/src/main.mjs` IPC |
| 改「词根分类」面板 | `apps/web/src/components/RootClassPanel.tsx` + `packages/core/src/graph.ts`（`groupBookByMorphemeData`） |
| 改界面 | `apps/web/src/App.tsx`（面板/导航）+ `apps/web/src/components/*.tsx` + `apps/web/src/styles.css` |
| 改数据来源/构建词库 | `packages/data-pipeline/build_db.py` / `build_wiktextract.py` / `build_ru*.py` / `download.py` |
| 重建倒排表（词根页用） | `node packages/data-pipeline/build_roots_tables.mjs`，**随后须同步** `packages/core/test/lexicon.mjs:122-141` 的 4 条统计快照 |
| 跑测试 | `pnpm --filter @zidiankaifa/core test` · `pnpm --filter @zidiankaifa/desktop test`（共 **643**） |
| 看留红台账 | `packages/core/test/ru_morph_defects.mjs` / `ru_morph_goals.mjs` / `ru_morph_semantic.mjs` / `ru_morph_v090_guard.mjs` / `book_lang.mjs`（手动跑，**不接入** `pnpm test` 的见 `AGENTS.md` §1） |
| 验 UI（免 dev server） | `node _serve_static.mjs 5180` + `node apps/sync-server/dist/index.js`（`AGENTS.md` §3） |
| 打包 | `pnpm --filter @zidiankaifa/desktop build`（**必须先跑 core + web + sync-server 三个 build**，`AGENTS.md` §6） |
| 查历史决策/验收标准 | `.board/` —— `REQ.md`（AC）· `DECISIONS.md`（决策）· `BOARD.md`（裁决）· `EVIDENCE.md`（证据）· `TASKS.md`（调度） |
| 查交接与版本时间线 | `docs/交接文档.md`（§0 三十秒概览 / §9 交接检查清单）· `docs/需求总结.md`（§1–§23 编年史） |
| 查逐版本发布说明 | `docs/release-v0.7.0 … v0.10.0.md` |

---

## 3. `scripts/` — **135** 个文件的性质与保留策略

> **定位：全部是只读工具/历史留痕，不是产品代码。** 产品逻辑一律在 `packages/` 与 `apps/`。
> 命名前缀原本用于区分作者与阶段 —— 但**发生过一次编号返工**（`T35` 重号），故**按前缀分类只作导航，不作权威**。

| 前缀 | 数量 | 作者 | 性质 | 保留策略 |
|---|---|---|---|---|
| `probe_*` | 23 | 主管（早期） | 只读探针，多用于 v0.8.0 的 D1 调查 | 保留（证据可追溯） |
| `probe_sup_*` | 13 | 主管（v0.9.0+） | 决策/审计探针 | 保留 |
| `probe_t*` | 54 | **测试 agent** | 独立验证探针（t15/t18/t20/t28/t29/t32/t36/t42/t46/t50 轮次） | 保留 |
| `exp_*` | 29 | 开发 agent | 实验台（复刻引擎 + 机制判别） | 保留 |
| `out_*` | 10 | 各 agent | **输出快照**（`.txt`/`.json`，约 0.9 MB） | 保留（报告引用它们） |
| `apply_*` | 2 | 主管 | 一次性落库脚本（v0.9.0 词素） | **不得重跑**（已落库，重跑会重复写入） |
| 无前缀 | **4** | 主管 | **活跃工具** ↓（T55 新增 `audit_text_health.mjs` · `fix_readme_l144_corruption.mjs`） | 长期维护 |

**两个活跃工具（唯一需要维护的）**：
- `scripts/check_v10_ui_contract.mjs` — UI 文本级契约检查（**53 通过 / 0 失败**；`REQ.md` AC-16/AC-17 的机械判定入口。块 F 为条件式：`book_lang.mjs` 未加链时只 warn）
- `scripts/build_web_nospawn.mjs` — 受限沙箱期写的 vite 内联配置绕行脚本，**诊断用**（`AGENTS.md` §3 有说明）

**⚠ 已知结论错误、引用即错**（保留是为了留痕，**不得作为证据**）：
| 文件 | 错在哪 |
|---|---|
| `scripts/exp_ru_recoverable.mjs` | 允许词素**任意位置**子串匹配 ⇒ 假命中，天花板虚高到 86.7%（修正版 `exp_ru_recoverable2.mjs` 为 70.0%） |
| `scripts/exp_ru_gap.mjs` | 分类器 bug（A/B/C 三类不互斥，`310+182≠492`） |
| `scripts/exp_ru_head_gap.mjs` | 只**计数**「词首存在已知词素」的词，从未验证真能拆出 ⇒ 58.0% 是把启发式上界当可达性，**已作废**（真上限 36.54% = 289/791） |
| `scripts/probe_t15_reconcile_and_harm.mjs` | **仅 §B**「96 词真误伤」**已作废**（`BOARD.md:687` 自查纠错 ＋ `EVIDENCE.md:645`）⇒ **不得引其 §B 数字**；⚠ **其余各节未作废，不得整文件作废** |
| `scripts/exp_v9_criterion_d.mjs` | **仅 `:97` 的 `EX_ALL`**（`суч-`/`суд-`/`-ной`/`пад-`/`тряс-`/`столп-`/`стат-`）系**未经来源核证的注入件**（`TASKS.md:332` · `BOARD.md:2144`）；⚠ **该文件其余部分被 `BOARD.md:1949` 引为「★★ 权威表（单一实现 `scripts/exp_v9_criterion_d.mjs`）」⇒ 判整文件入 D = 连带作废一条权威实现** |

**D 档判据（主管裁决 5 · 边界详见 `.board/STRUCTURE.md` §4.3）**：**充分条件 = 「结论已错 / 已作废」∧「无任何『把它当有效依据』的引用」** —— **作废声明 / 取代声明 / 「勿引用」警告本身不算活跃引用**（否则 D 档成空集：`DEC-014` 强制原地加取代声明 ⇒ 必产生引用）。**仅含「推翻」字样、或仅时间久，都不够**（反例：`probe_t28_*` / `probe_t29_*` / `probe_sup_bolnoy_mincost.mjs` 所在文档行含「推翻」字样，但它们**正是做出推翻的一方** ⇒ **保持 C 档**）。
**粒度纪律**：D 档条目**支持定位到 `文件:行/节`** —— 上表**后两条为「部分作废」**（`§B` / `:97`），**按整文件处理会连带作废仍有效的部分**。

**⚠ 临时脚本不得作为证据来源（`DEC-022` ＋ T55 `_tmp` 判据 · 主管裁决 6）**：
- **硬判据**：**`_tmp*` 目录（`scripts/_tmp/`、`.board/_tmp/`）下的任何文件，无论任何文档怎么写「保留 / 勿删 / 有意保留」，一律按「可清理」处理**；**凡结论必须落在非 `_tmp` 路径或 `DEC`/`AC` 正文中**，否则视为**未固化的证据**。
- **根因（制度自相矛盾，**不是**证据丢失）**：委任书 §3.1① **授权结构 agent 自主清理** `scripts/_tmp/` 与 `.board/_tmp/`，而 `REQ.md:383` / `REQ.md:1318` / `BOARD.md:2440` 同时写「有意保留勿清理」⇒ **同一份制度里一处说保留、另一处说可清**。**准确措辞 = 「声称要保留的文件，本就放在一个被设计为可丢弃的目录里」**。
- **已消失的目标清单（留痕；遵 `DEC-014`：不改历史措辞，只加状态）**：`.board/_tmp/count_defects.mjs` · `.board/_tmp/defects_out.txt` · `.board/_tmp/probe_t47_backup_fail.mjs` · `scripts/_tmp/out_t24d_diff.txt` —— **四者均不存在**；另 `scripts/probe_sup_wal_snapshot.mjs` **未 tracked 且磁盘不存在**（**不在 `_tmp` 下**，属另一类：已删脚本被当既有物引用）。**逐条状态与三方订正分工见 `.board/STRUCTURE.md` §4.4**。
- **⚠ 边界（防过度执行）**：「按可清理处理」**≠「必须立即清理」** —— ① **正被进程使用的临时目录不得清理**（如门禁运行中的 `scripts/_tmp/booklang_tmp/run-*`）；② **§11 熔断优先于本判据**（同一清理动作复发 **2 次**即停手、改查根因）。
- **⚠ 配套义务（结构 agent 侧）**：若体检中发现某 `_tmp` 文件**被文档当作某结论的唯一证据来源**，**须报警（报主管一次）而非静默清理**（依本项目「宁可报警也不误标」纪律）。

**⚠ `scripts/_tmp/` 会被测试自己重建**（不是垃圾，也不是应保留内容）：
- `packages/core/test/book_lang.mjs` 每次运行都在 `scripts/_tmp/booklang_tmp/run-<随机>/` 建临时合成库；
- **全绿时它尝试自动清理，但该分支会报 `EPERM, Permission denied`**（句柄未释放）⇒ 每跑一次 `pnpm test` 就留下一个 `run-*` 目录（本项目已实测复现）。**这是已知残余项**（`docs/交接文档.md` §6.C 有登记），非本次结构整理引入；
- 处置（**依主管裁决 7 ＋ §11 熔断，T55 更新**）：**结构 agent 不得第三次重删** —— 同一清理动作已触发 **2 次**（主管 v0.10.0 收尾 ＋ 结构 agent T55 首轮）⇒ 按 §11 停手，**改查根因**。根因修法已派 **T60**（测试 agent 写域，候选：`rmSync` 加 `maxRetries`/`retryDelay` · 夹具根改 `os.tmpdir()` · 清理前 `db.close()`）。**修复前结构 agent 每轮只记录 `scripts/_tmp/booklang_tmp/run-*` 当前数量（不删）**；若其中含留红取证快照则**只列清单**。


---

## 4. `.board/` — 多 agent 文件中枢（**顶层 9 个 `.md`** · tracked **14** 文件 · 约 1.0 MB）

| 文件 | 行数 | **独占写者** | 内容 |
|---|---|---|---|
| `BASELINE.md` | 118 | **主管** | 冻结基线：HEAD/测试/词库指纹 + **三把尺子口径表 §4** + §7 结构预算（T55 订正；**agent 总数 = 14**） |
| `TASKS.md` | 1180 | **主管** | 调度板：任务派单、阶段门、熔断记录、裁决索引（§11.9 = label 只读规则 · §11.10 裁决 E = 孙代理结案 · §11.11 收口 · §11.12 T55 五条裁决） |
| `BOARD.md` | 2555 | **主管**（各 agent 只能**追加自己的小节**，R6） | 议题板：历代裁决（裁决一…二十一）＋ 结构 agent 区 |
| `REQ.md` | 1338 | **需求管理 agent** | 需求与验收标准（`REQ-V9-001`/`REQ-V10-001`；§8 = v0.10.0 的 AC-12…AC-19 / DoD / 不做清单 / 红线 / 行号对照） |
| `DECISIONS.md` | 710 | **需求管理 agent** | 决策台账 `DEC-001 … DEC-027`（`DEC-008` 含 2026-09-16 修订块） |
| `EVIDENCE.md` | 2542 | **测试 agent** | 独立验证证据链（§1–§47，§48 由 T64 追加中） |
| `CHANGELOG.md` | 179 | **需求管理 agent** | 迭代变更记录 |
| `STRUCTURE.md` | 488 | **结构管理 agent** | 结构台账：九项体检实测 · 清理记录 · §4.1–§4.4 档位与判据（含 `_tmp` 判据）· §17 裁决落地对照 · 越线提请 |
| `agents.md` | 250 | **结构管理 agent** | **agent 登记册**：受保护 4 · 业务常驻 3 · 结构常驻 1（**常驻合计 5**）· **agent 总数 14** · 临时 9 · 异常六类 · 处置建议（委任书 §14） |
| `roles/*.md` | dev 71 / test 89 / **structure 261** | 各自 | 三份委任书；**structure-agent.md §14 = agent 结构管理** |
| `structure/*.mjs` | 2 个只读工具 | **结构管理 agent** | `classify_mece.mjs`（§7 档位 MECE 校验）· `scan_dead_refs.mjs`（死引用扫描）；**须在仓库根运行** |
| `roles/dev-agent.md` | 5.1 KB | 开发 agent | 开发委任书（独占写 `src/`，**不可改测试断言**） |
| `roles/test-agent.md` | 5.6 KB | 测试 agent | 测试委任书（**绝不改 `src/`**） |
| `inbox/` | 空 | —— | 预留 |

**纪律（硬性）**：
- 各 agent **只写自己那本台账**；写他人或主管台账 = 越界（`R6`）。
- 主管的**写权限也不覆盖他人独占写域**（v0.9.0 曾发生过一次越界写入并已报备）。
- 主管小节被后续实验推翻时，**不删原文**，按 `DEC-014` 原地加「取代声明」。
- `.board/` 下 `_tmp/` 属临时区，**不入 git**（`.gitignore` 已覆盖）。

---

## 5. `docs/` — 人读权威文档（7 个文件）

| 文件 | 行数 | 用途 |
|---|---|---|
| `交接文档.md` | 409 | **接手第一份**：§0 三十秒概览 / §1 结构与技术栈 / §2 最小运行路径 / §3 需求与完成状态 / §4 版本时间线 / §5 数据与代码终态 / §6 未完成任务 / §7 已知约束与「非缺陷」 / §8 关键文档索引 / §9 交接检查清单 |
| `需求总结.md` | 1478 | 编年史 §1–§23（每迭代一节） |
| `release-v0.10.0.md` | 270 | 当前版本发布说明（含已知代价与豁免） |
| `release-v0.9.0.md` | 151 | 词素语义核证 · 防假拆解 |
| `release-v0.8.0.md` | 187 | D1 假词根误拆修复 |
| `release-v0.7.1.md` | 73 | 桌面端升级不换库 |
| `release-v0.7.0.md` | 66 | 较早版本（历史保留） |

**注意**：`docs/` 的写者是**需求管理 agent**；主管只在发布时写 `release-vX.Y.Z.md`。

---

## 6. ⚠ 归档区 `docs/legacy/`（**禁用，且禁令按「文件身份」不按位置**）

> ★★ **本节已于 2026-09-16 由主管事实性重写（`98613ac`）** —— 原文写的「**保留原位**」裁定
> **已被用户当轮决策取代**。原文保留于下「历史裁定留痕」段（依 `DEC-014` 留痕不删）。
> **结构 agent `2d4ba4d0` 会话 `[diagnostic: corrupt]` 且 `PROJECT_STRUCTURE.md` 属其写域，
> 因此本节由主管代写**，待该角色恢复后由它接管后续维护。

**位置**：`docs/legacy/`（2026-09-16 由仓库根 `git mv` 迁入，**5 个文件均 `R100` 历史完整**）

| 文件（全路径） | 行数 | 状态 |
|---|---|---|
| `docs/legacy/check_requirements.py` | 146 | **已停摆**（2026-08-31）。**绝不运行** —— 它会重写下面 4 个 `.md`，**覆盖废弃横幅** |
| `docs/legacy/需求总结.md` | 12 | 废弃（由上面的脚本生成，内容仅提 R2） |
| `docs/legacy/已完成需求.md` | 35 | 废弃 |
| `docs/legacy/任务排序.md` | 17 | 废弃 |
| `docs/legacy/运行日志.md` | 16 | 废弃 |
| `docs/legacy/README.md` | — | **归档区机械防线**（禁令 + 机制原因 + 同名不同物对照表） |

- **权威文档在 `docs/`（注意是全路径）**，不要在归档区里找进度。
- `DEC-008`（2026-09-16 修订块）：**禁止运行该脚本、禁止写入这 5 个文件**。
  禁令指代 = **文件身份**（识别判据 = `ROOT` 由 `__file__` 推导），
  ⇒ **归档前在仓库根 / 归档后在 `docs/legacy/` / 再移动禁令仍成立**；禁令面与原文**完全等价**。
- ⚠ **同名不同物**：`docs/legacy/需求总结.md`（僵尸件，**12 行 / 920 B**，禁写）
  **≠** `docs/需求总结.md`（**权威编年史 23 章 / 1478 行，必读**）⇒ **引用一律写全路径**。
- ⚠ **改名不等于解除禁令**：即便改名成 `*.archived`，**运行它仍被禁止**（禁令对象是脚本的
  **身份**，不是文件名或路径）。—— 需求 agent 曾建议改名以「移除可执行性」，**主管否决**
  （理由：本项目口径陷阱已 10+ 次，为同一件东西制造第二个合法文件名形态会生成新的口径歧义）。

### 历史裁定留痕（**已被取代，勿再据以行动** —— 依 `DEC-014` 保留原措辞）
> **原文（2026-09-16 之前）**：「**它们已入库**（`git ls-files` 可见，各带废弃横幅）。
> 曾考虑迁入 `docs/archive/`，**主管裁定保留原位**：四处文档（`PROJECT_CHARTER.md:98`、
> `docs/交接文档.md:356`、`.board/REQ.md:220/566`、`.board/DECISIONS.md:167`）的禁令均以
> 「根目录」为坐标，移动会使规则失锚；脚本 `ROOT = __file__ 所在目录`，就地留在根目录时
> **恰好是最安全状态**（即便误跑也只会覆盖自带横幅的几行，不会生成新文件）。」
>
> **★ 该裁定错在哪（根因，供后续会话吸取）**：它**把「禁令的坐标系」当成了不可变给定条件**，
> 于是「坐标会失锚」反过来变成了**阻止移动**的理由。但坐标系**本身是可以改的** ——
> 正解是把禁令指代从「位置」改写为「文件身份」（`DEC-008` 修订块已如此办），
> 而非为了保住旧坐标而放弃结构治理。**这与 `DEC-023`（行号仅作指示，不得据以行动）同类。**

---

## 7. `data/` — 数据与产物（**3.67 GB** / 53 文件，**全部 gitignore**）

| 路径 | 大小 | 说明 |
|---|---|---|
| `data/db/dict.db` | **494.2 MB** | **权威词库（冻结）**。测试与探针**只读**；`-wal`/`-shm` 由 SQLite 管理 |
| `data/db/dict.db.bak-v02pipe` | 260.1 MB | v0.2 期老结构库，**迁移夹具**（`book` 主键仍是 `["word"]`），**勿删** |
| `data/raw/` | **2.93 GB** | 源数据：`ecdict.csv` 62.9 MB · `wiktextract-all.jsonl.gz` 2695.7 MB · `wiktextract-zh.jsonl.gz` 214.2 MB · `etymwn-20130208.zip` 26.2 MB |
| `data/py-deps/` | 1.1 MB | 便携 python 依赖（opencc 等，36 文件） |
| `data/sync-data/` | 0.3 MB | 同步服务的 `sync.db`（+ WAL 与一份 `.bak-<ISO>`） |
| `data/toska_run.log` | 1.3 KB | 早期调试日志（gitignored） |

> 提示：若确要重下源数据，走 `packages/data-pipeline/download.py`（README「快速开始」第 2 步）。


---

## 8. 产物与缓存（**T55 清理后约 1.9 GB**，均可安全删除 / 重建，全部 gitignore）

| 路径 | 体量 | 可否删 | 备注 |
|---|---|---|---|
| `dist-release/` | **0.652 GiB / 8 文件** ✅ **额度内** | ✅ 已按 §3.1② 清理完毕 | **T55 已删**：12 个历史版本（v0.2.0/0.2.1/0.3.0/0.4.0–0.4.4/0.5.0/0.6.0/0.7.0/0.7.1）各 3 件套 = **36 文件 / 4,345,641,661 B** ＋ `win-unpacked/` **77 文件 / 853,615,479 B** ⇒ 5,899,319,384 B → **700,062,244 B**（实测逐字节一致）。**保留 8 件**：v0.10.0 三件套 ＋ v0.9.0 三件套 ＋ `latest.yml` ＋ `builder-debug.yml` —— 依据：**自动更新走 GitHub Release 的 `latest.yml`，不读本地 `dist-release/`**（`apps/desktop/package.json:67-73` `publish.provider=github`），全部历史 exe 已在 `https://github.com/lzk101/zidiankaifa/releases` |
| `node_modules/` | 0.45 GB | ✅ `pnpm install` 重建 | |
| `.pnpm-store/` | 0.65 GB | ✅ | pnpm 内容寻址存储（`.gitignore` 已覆盖） |
| `.electron-cache/` | 0.12 GB | ✅ | electron 二进制缓存；重打包会重新下载（打包三件套见 `AGENTS.md` §3） |
| `.eb-cache/` | 0.02 GB | ✅ | electron-builder 下载缓存 |
| `apps/*/dist/` `packages/core/dist/` | —— | ✅ 但**必须重建** | `core` 改后不 build ⇒ 测试测的是旧实现（`AGENTS.md` §2 铁律 3） |

**关于 `dist-release/` 的历史包**：
- **所有版本的安装包都已在 GitHub Releases**（`https://github.com/lzk101/zidiankaifa/releases`），本地副本不是唯一来源；
- 而**应用内自动更新的下载源**由 `apps/desktop/package.json:67-73` 的 `publish.provider = github` 决定，即走 GitHub Release 的 `latest.yml`，**不读本地 `dist-release/`**；
- ⇒ 历史 `zidiankaifa-*-x64.exe`（v0.2.0–v0.9.0）与整个 `win-unpacked/`（0.79 GB）可安全清理；**当前版本的 4 个附件**（exe + portable + blockmap + `latest.yml`，共 ~334 MB）建议保留，便于复测与离线核对。
- **本轮未删**（涉及 4.7 GB 的破坏性操作与「是否保留历史产物」的策略选择，须由用户拍板；本文仅登记事实与影响面）。


---

## 9. 命名与结构约定（新增文件时遵守）

1. **产品代码只放 `packages/` 与 `apps/`**；根目录不放源码（`_serve_static.mjs` 是唯一例外，因它要相对仓库根解析 `apps/web/dist`）。
2. **测试文件命名**：`packages/core/test/<域>.mjs`；留红台账与门禁测试分开命名（`*_defects` / `*_goals` / `*_guard`），并在 `AGENTS.md` §1 登记是否接入 `pnpm test`。
3. **测试文件的词库路径必须与 cwd 无关**（`AGENTS.md` §2 铁律 6）：`process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db')`，且**两种 cwd 各跑一次**。
4. **探针脚本**：新建放 `scripts/`，前缀表明作者/轮次（`probe_<作者>_<主题>.mjs`）；`scripts/` 内引用 core 用 **`../packages/core/dist/db/index.js`**（只退一级 —— 写成 `../../packages/...` 会解析到仓库外，本项目已踩 3 次）。
5. **临时文件**：`_tmp/` `.tmp/` `*.tmpdir/` `_commit*.txt` 已被 `.gitignore` 结构性屏蔽（背景见 `.gitignore` 注释）；但仍**禁止目录式 `git add scripts/` `.board/`** —— 历史上有过 3 次误提交，`git add` 后**必须**先看 `git diff --cached --name-only`。
6. **指标必须带口径**（`AGENTS.md` §2 铁律 7）：三把尺子 R/A/B 不可互比；「空洞」有总数/最大单段两口径；门禁计数按**每文件**核对（`ru_morph.mjs` 的计数行**无「结果：」前缀**，按该前缀汇总会静默漏 60 条 —— 本项目第 5 次同类陷阱）。

---

## 10. 🧹 结构治理（第 4 个常驻 agent，**每迭代必做**）

> **用户指令（2026-09-16 原词）**：「添加一个agent，专门做定期的项目结构管理，避免项目结构臃肿，每完成一次版本发布进行一次项目结构调整」

| 项 | 内容 |
| --- | --- |
| 角色 | **项目结构管理 agent**（第 4 个常驻角色，与需求/开发/测试并列） |
| 委任书 | `.board/roles/structure-agent.md` |
| 台账（其独占写） | `.board/STRUCTURE.md` + **`.board/agents.md`（agent 登记册）** + `.board/structure/**` |
| **触发节奏** | **每次版本发布 + push 之后做快检**；每 5 个 release 或大版本（词库重建/批量落库）后做全量审计 |
| 额度依据 | `.board/BASELINE.md` §7「结构预算冻结」 |
| 权限一句话 | **能删产物，不能删代码；能出方案，不能改架构。** |

**九项体检**（每次快检逐项实测）：① 已跟踪文件总数 ② `scripts/` 文件数 ③ `scripts/` 顶层文件数 ④ `dist-release/` 递归体量 ⑤ `data/` 体量（**只报不删**）⑥ 缓存合计 ⑦ 临时残留 ⑧ 僵尸/废弃产物 ⑨ 单文件规模（字节 + 行数）⑩ **常驻 agent 数（恒为 4）**。

**agent 结构管理**（用户 2026-09-16 追加）：结构 agent 还负责**清理临时 agent**与**协助主管管理 agent 结构** —— 受保护名单 = **主 agent + 三个业务常驻**（需求管理 / 开发编程 / 功能测试）；临时 agent 逐条登记，**「可回收」需四判据全满足**（不再运行 · 结论已落盘可指认 · 主管不再派单 · 孙代理的父已回收）。⚠ **本工具 agent 层无删除 API** ⇒ 清理 = 台账化 + 标记 + 报主管 `interrupt`；结构 agent **不得向任何 agent `send_message`**（那是唤醒，不是清理）。详见 `.board/agents.md`。

**额度硬上限**：已跟踪 **300** · `scripts/` **165** · `scripts/` 顶层 **35** · `dist-release/` **1.5 GB** · `data/` **4.5 GB** · 缓存 **1.2 GB** · 临时残留 **0** · 单文件 **20 MB** · `.board/*.md` **3000 行**。

**保护清单（任何情况下不得删改）**：`data/**` 整棵树 —— `dict.db` 是冻结词库，`data/db/dict.db.bak-v02pipe`（272,752,640 B / 2026-09-09）是**唯一的真实老结构迁移夹具**，`data/raw/` 2.93 GB 是**词库重建原料**。**不得用体积或路径名判断可删性**（`raw/` 看着像垃圾，其实是原料）。其余：全部**已跟踪文件**只报不删；**未被 gitignore 覆盖的未跟踪文件**只列清单提请核准。

**与既有字节普查的分工**：字节健康（控制字符 / 行中 CR / CR+BEL 同行）由 `scripts/audit_text_health.mjs` 覆盖（§3 已登记），结构 agent **复用不重复实现**；它负责的是结构维度（文件数 / 体量 / 额度 / 分类 MECE / 引用完整性）。

**§8 的一条历史越线 —— ✅ T55 已消解**：`dist-release/` 曾实测 **5.49 GB（递归 121 文件）** vs 额度 1.5 GB；T55 已按 §3.1② 清理历史包，**现为 0.652 GiB / 8 文件（额度内）**。已核实自动更新走 GitHub Release 的 `latest.yml`（`apps/desktop/package.json:67-73` `publish.provider=github`），**不读本地目录** ⇒ 历史包可安全清理，清理清单由结构 agent 首轮产出后报主管核准。

---

## 11. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-09-16 | 新建本文件（结构主文档） | 用户指令「整理项目结构」 |
| 2026-09-16 | 清理 `.tmp/` · `.pip-tmp/` · `.gh-config/` · `.board/_tmp/` · `scripts/_tmp/`（含 1925 文件 / 88 MB 的临时 dist 副本）· `.board/._append16.tmp.md.*.tmpdir/`（全部 gitignored，**未触及任何已跟踪文件**） | 同上 |
| 2026-09-16 | **修复 README.md:144 字节损坏**：该行原含 `CR(U+000D) + BEL(U+0007)` 混入（西里尔词被按错误码位写入），已还原为 `корни(476) / аффиксы(403)`；修复脚本 `scripts/fix_readme_l144_corruption.mjs`（保留，可复核） | 同上（普查中意外发现） |
| 2026-09-16 | 订正 README 过期数字：词素库 `909（468/441）` → **918（468/450）**；测试 `204 项` → **643 项**；Roadmap 补 v0.10.0 竣工条目、原「v0.10.0 计划」改为 **v0.11.0 计划**；§目录结构 补 `.board`/`docs`/`scripts`/`dist-release` 并指向本文件 | 同上 |
| 2026-09-16（**T55 事实性订正**） | 本文件 9 处数字与实测不符，全部按实测订正（**仅事实，未改架构与归属**）：① `scripts/` **158 → 135**（§0 图 · §1 表 · §3 标题；且 `scripts/` **无任何 tracked 子目录文件 ⇒ 顶层 ≡ 递归**）② 已跟踪 **245 → 253** = `scripts/` 135 + `packages/` 43 + `apps/` 38 + `.board/` 14 + `docs/` 7 + `data/` 1 + 根 15 ③ `.board/` **9 个文件 → 顶层 9 个 `.md`（tracked 14**，含 `roles/` 3 · `structure/` 2）④ `.board/` 行数 **BASELINE 87→111 · TASKS 951→1109 · BOARD 2432→2508** ⑤ `dist-release/` **5.49 GB/121 文件 → 0.652 GiB/8 文件**（T55 已按 §3.1② 清 36 个历史包 ＋ `win-unpacked/`，实测 5,899,319,384 → 700,062,244 B）⑥ §3 前缀表 **无前缀 2 → 4** ⑦ 新增台账行：`STRUCTURE.md` 321 · `agents.md` 199 · `roles/structure-agent.md` 261 · `structure/*.mjs` 2 ⑧ HEAD `041c6e7` → **`2a796c9`** ⑨ §8 越线标注改为「✅ 已消解」 | 结构 agent T55 首轮快检 + 主管 `2a796c9` 授权订正 |
| 2026-09-16 | 新增只读普查脚本 `scripts/audit_text_health.mjs`（控制字符 + 旧口径残留抽查） | 同上 |
| 2026-09-16 | 门禁复跑确认：**core 621/0 + desktop 22/0 = 643/0**（结构整理零影响） | 同上 |
| 2026-09-16（**已被取代**） | 裁定根目录 4 个废弃文档**保留原位**（不迁 `docs/archive/`），理由见 §6 —— ⚠ **该裁定已被用户当轮决策取代**（5 文件已迁 `docs/legacy/`，见 §6） | 同上 |
| 2026-09-16（**主管事实性重写**） | §6 重写为「归档区 `docs/legacy/`」：5 文件由 `git mv` 迁入（均 `R100`）；禁令指代改为**文件身份**；补「同名不同物」全路径对照、「改名不等于解除禁令」、及**旧裁定错在哪的根因**（把禁令坐标系当成不可变给定条件 ⇒ 与 `DEC-023` 同类）。新章 **T62**：`scripts/` 零引用脚本清理 **39 个**（`scripts/` 138 → **99**；已跟踪 257 → **218**），依据 = 新增 `.board/structure/recheck_zero_refs.mjs` 四通道复核（**救回 11 个**，修正「brace 声明式引用」与「路径未 normalize」两层盲点）。**因结构 agent `2d4ba4d0` 会话 `[diagnostic: corrupt]`、本文件属其写域，故由主管代写** | `.board/TASKS.md` §11.13 · `.board/DECISIONS.md` `DEC-008` 修订块 · commit `98613ac` / `17ef659` |
| 2026-09-16 | 裁定 `dist-release/` 历史安装包（4.7 GB）**本轮不删**，登记影响面待用户拍板 | 同上 |
| 2026-09-16（**T55 二轮订正**） | ① **上一行已作废**：`dist-release/` 已按主管核准**执行清理**（删 36 文件 / 4,345,641,661 B ＋ `win-unpacked/` 77 文件 / 853,615,479 B ⇒ **8 文件 / 700,062,244 B = 0.652 GiB**）② §3 **D 档 3 → 5 条**（新增 `probe_t15_reconcile_and_harm.mjs`〔仅 §B〕· `exp_v9_criterion_d.mjs`〔仅 `:97` `EX_ALL`〕）＋ **D 档判据**（「结论已错 ∧ 无把它当有效依据的引用」；作废声明不算引用）＋ **粒度纪律**（支持 `文件:行/节`）③ §3 新增 **`_tmp` 判据**（硬判据 ＋ 根因＋已消失目标清单 5 条 ＋ 边界 ＋ 配套义务）④ §3 `scripts/_tmp` **处置改为「不再重删，改查根因（T60）」**（§11 熔断）⑤ §4 行数刷新 **BASELINE 111→116 · TASKS 1109→1180 · BOARD 2508→2537 · STRUCTURE 321→488 · agents 199→242→250**（`agents.md` 当轮又被本 agent 增量维护 8 行）⑥ **订正**：主管 F 项清单给的值（`git ls-files` 251 · `.board` 12 · `TASKS.md` 1054）**均过时**，与本文件已写入值（253 / 14 / 1180）不符 ⇒ **以实测为准，主管清单值不采纳** | 主管终局裁定（裁决 1/3/4/5/6/7）＋ 结构 agent T55 二轮实测 |
| 2026-09-16（**计数纪律**） | 本文件所有**易变计数（行数 / 文件数 / 字节数）均须视为「带时点的观测值」**，引用时必须带日期或 commit SHA —— T55 中同一批数字在同一天内因多次提交而**四次过时**（`git ls-files` 251→253 · `.board` 12→14 · `TASKS.md` 1054→1109→1180 · `agents.md` 199→242→250）。**变更行数即须同步本表** | 结构 agent T55 提请（主管已采纳「须带时点」纪律） |
