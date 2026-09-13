# 项目结构 — zidiankaifa 电子辞典

> **本文件是「文件放哪儿、能不能改、是死是活」的唯一指针。**
> 权威数值不在这里（在 `.board/BASELINE.md` §4 与 `docs/交接文档.md` §5），环境坑不在这里（在 `AGENTS.md` §3）。
> 整理时间：`2026-09-16` · 对应版本 **v0.10.0** · HEAD **`041c6e7`**（+ `7a5c653` / `04deb37` / `c6dcbdd`）· 15 个 tag
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
├── 🔧 工具 ─────── scripts/（133 个只读探针/实验台，**不是产品代码**）· _serve_static.mjs（UI 验证）
├── 📦 数据 ─────── data/raw（源数据 3.0 GB）· data/db/dict.db（**494 MB，冻结，不入 git**）
└── 🗑 产物/缓存 ── dist-release/（安装包 4.7 GB）· node_modules · .pnpm-store · .electron-cache · .eb-cache
```

**三条最容易被新人踩错的**：
1. `scripts/` 里**绝大多数是历史实验脚本**（含 3 个结论已被推翻的），**不是**要维护的产品工具 —— 新增工具请另立名字并登记到本文 §3。
2. `data/db/dict.db` 是**冻结的权威词库**（494 MB，不入 git）。测试与探针**只读**；重建需按 `AGENTS.md` §2 铁律 2 走 `build_db.py`。
3. 根目录 4 个 `.md` + `check_requirements.py` 是**僵尸产物**，`DEC-008` 禁止运行、禁止写入 —— 见 §6。

---

## 1. 顶层清单（含性质与写权限）

| 路径 | 性质 | 入库 | 独占写者 | 说明 |
|---|---|---|---|---|
| `packages/core/` | **产品代码** | ✅ 22 文件 | 开发 agent | 共享数据层：类型契约 + `node:sqlite` 查询库（桌面/服务端共用） |
| `packages/data-pipeline/` | **产品代码 + 数据定义** | ✅ 24 文件 | 开发 agent | 数据管线；`roots.json`(en 468) / `roots_ru.json`(ru 450) 是**词素库唯一来源** |
| `apps/web/` | **产品代码** | ✅ 26 文件 | 开发 agent | React 18 + TS + Vite，**手写 CSS**（无 UI 库） |
| `apps/desktop/` | **产品代码** | ✅ 7 文件 | 开发 agent | Electron 壳 + 词库升级/迁移 + 自动更新 |
| `apps/sync-server/` | **产品代码** | ✅ 5 文件 | 开发 agent | Node http，端口 4570；读 `dist`，**不热更新** |
| `scripts/` | **只读工具 + 历史留痕** | ✅ 133 文件 | 各角色自建、只读他人 | 见 §3 —— **产品代码不在这里** |
| `.board/` | **多 agent 台账** | ✅ 9 文件 | **按文件分角色** | 见 §4 |
| `docs/` | **人读权威文档** | ✅ 7 文件 | 需求管理 agent | 见 §5 |
| `data/` | **数据与产物** | 仅 `.gitkeep` | —— | 见 §7（3.8 GB，全部 gitignore） |
| `dist-release/` | **打包产物** | ❌ gitignored | —— | 见 §8（4.7 GB 历史安装包） |
| `node_modules/` `.pnpm-store/` `.electron-cache/` `.eb-cache/` | 依赖与缓存 | ❌ | —— | 可删可重建 |

**已核验的入库计数**（`2026-09-16` 实测）：`git ls-files` 共 **245** 个文件 = `scripts/` **133** + `packages/` 43 + `apps/` 38 + `.board/` 9 + `docs/` 7 + 根目录 15。

**门禁现状**（结构整理后复跑确认）：`pnpm --filter @zidiankaifa/core test` → **core 621 通过 / 0 失败 exit 0**；`pnpm --filter @zidiankaifa/desktop test` → **22 通过 / 0 失败 exit 0** ⇒ 合计 **643 / 0**。


**根目录文件**：`AGENTS.md`（AI 规范，**全员必读**）· `PROJECT_CHARTER.md`（主管章程）· `PROJECT_STRUCTURE.md`（本文件）· `README.md`（对外）· `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `tsconfig.base.json` · `.gitignore` / `.gitattributes` · `_serve_static.mjs`（**仅用于 UI 冒烟**，静态托管 `apps/web/dist`）· 僵尸产物（§6）。

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

## 3. `scripts/` — 133 个文件的性质与保留策略

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
| 无前缀 | 2 | 主管 | **活跃工具** ↓ | 长期维护 |

**两个活跃工具（唯一需要维护的）**：
- `scripts/check_v10_ui_contract.mjs` — UI 文本级契约检查（**53 通过 / 0 失败**；`REQ.md` AC-16/AC-17 的机械判定入口。块 F 为条件式：`book_lang.mjs` 未加链时只 warn）
- `scripts/build_web_nospawn.mjs` — 受限沙箱期写的 vite 内联配置绕行脚本，**诊断用**（`AGENTS.md` §3 有说明）

**⚠ 已知结论错误、引用即错**（保留是为了留痕，**不得作为证据**）：
| 文件 | 错在哪 |
|---|---|
| `scripts/exp_ru_recoverable.mjs` | 允许词素**任意位置**子串匹配 ⇒ 假命中，天花板虚高到 86.7%（修正版 `exp_ru_recoverable2.mjs` 为 70.0%） |
| `scripts/exp_ru_gap.mjs` | 分类器 bug（A/B/C 三类不互斥，`310+182≠492`） |
| `scripts/exp_ru_head_gap.mjs` | 只**计数**「词首存在已知词素」的词，从未验证真能拆出 ⇒ 58.0% 是把启发式上界当可达性，**已作废**（真上限 36.54% = 289/791） |

**⚠ 临时脚本不得作为证据来源**（`DEC-022`）：`scripts/_tmp/`、`.board/_tmp/` 下的 `_tmp*` 文件是**一次性**的，会话结束应删；引用结论必须落到被保留的探针或 `.board/EVIDENCE.md`。

**⚠ `scripts/_tmp/` 会被测试自己重建**（不是垃圾，也不是应保留内容）：
- `packages/core/test/book_lang.mjs` 每次运行都在 `scripts/_tmp/booklang_tmp/run-<随机>/` 建临时合成库；
- **全绿时它尝试自动清理，但该分支会报 `EPERM, Permission denied`**（句柄未释放）⇒ 每跑一次 `pnpm test` 就留下一个 `run-*` 目录（本项目已实测复现）。**这是已知残余项**（`docs/交接文档.md` §6.C 有登记），非本次结构整理引入；
- 处置：定期手动 `Remove-Item scripts/_tmp -Recurse -Force`（可安全删；被占用时报错则稍后重试）。


---

## 4. `.board/` — 多 agent 文件中枢（9 个文件 · 约 0.9 MB）

| 文件 | 行数 | **独占写者** | 内容 |
|---|---|---|---|
| `BASELINE.md` | 87 | **主管** | 冻结基线：HEAD/测试/词库指纹 + **三把尺子口径表 §4** |
| `TASKS.md` | 951 | **主管** | 调度板：任务派单、阶段门、熔断记录、裁决索引 |
| `BOARD.md` | 2432 | **主管**（各 agent 只能**追加自己的小节**，R6） | 议题板：历代裁决（裁决一…二十一） |
| `REQ.md` | 1336 | **需求管理 agent** | 需求与验收标准（`REQ-V9-001`/`REQ-V10-001`；§8 = v0.10.0 的 AC-12…AC-19 / DoD / 不做清单 / 红线 / 行号对照） |
| `DECISIONS.md` | 672 | **需求管理 agent** | 决策台账 `DEC-001 … DEC-027` |
| `EVIDENCE.md` | 2451 | **测试 agent** | 独立验证证据链（§1–§45） |
| `CHANGELOG.md` | 179 | **需求管理 agent** | 迭代变更记录 |
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

## 6. ⚠ 根目录僵尸产物（**保留，但永久禁用**）

| 文件 | 行数 | 状态 |
|---|---|---|
| `check_requirements.py` | 146 | **已停摆**（2026-08-31）。**绝不运行** —— 它会重写下面 4 个 `.md`，**覆盖废弃横幅** |
| `需求总结.md` | 12 | 废弃（由上面的脚本生成，内容仅提 R2） |
| `已完成需求.md` | 35 | 废弃 |
| `任务排序.md` | 17 | 废弃 |
| `运行日志.md` | 16 | 废弃 |

- **权威文档在 `docs/`**，不要在根目录这 4 个文件里找进度。
- `DEC-008`：禁止运行该脚本、禁止写入这 4 个文件。
- **它们已入库**（`git ls-files` 可见，各带废弃横幅）。曾考虑迁入 `docs/archive/`，**主管裁定保留原位**：四处文档（`PROJECT_CHARTER.md:98`、`docs/交接文档.md:356`、`.board/REQ.md:220/566`、`.board/DECISIONS.md:167`）的禁令均以「根目录」为坐标，移动会使规则失锚；脚本 `ROOT = __file__ 所在目录`，就地留在根目录时**恰好是最安全状态**（即便误跑也只会覆盖自带横幅的几行，不会生成新文件）。

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

## 8. 产物与缓存（**合计约 7.5 GB**，均可安全删除 / 重建，全部 gitignore）

| 路径 | 体量 | 可否删 | 备注 |
|---|---|---|---|
| `dist-release/` | **5.49 GB / 121 文件** | ⚠ **见下** | 构成：**顶层 44 个**（v0.2.0–v0.10.0 的 `nsis` + `portable` 安装包 + `.blockmap` + 当前 `latest.yml`）= **4.70 GB**；**`win-unpacked/` 77 文件 = 0.79 GB**（electron-builder 的免安装展开目录，可直接删） |
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

## 10. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-09-16 | 新建本文件（结构主文档） | 用户指令「整理项目结构」 |
| 2026-09-16 | 清理 `.tmp/` · `.pip-tmp/` · `.gh-config/` · `.board/_tmp/` · `scripts/_tmp/`（含 1925 文件 / 88 MB 的临时 dist 副本）· `.board/._append16.tmp.md.*.tmpdir/`（全部 gitignored，**未触及任何已跟踪文件**） | 同上 |
| 2026-09-16 | **修复 README.md:144 字节损坏**：该行原含 `CR(U+000D) + BEL(U+0007)` 混入（西里尔词被按错误码位写入），已还原为 `корни(476) / аффиксы(403)`；修复脚本 `scripts/fix_readme_l144_corruption.mjs`（保留，可复核） | 同上（普查中意外发现） |
| 2026-09-16 | 订正 README 过期数字：词素库 `909（468/441）` → **918（468/450）**；测试 `204 项` → **643 项**；Roadmap 补 v0.10.0 竣工条目、原「v0.10.0 计划」改为 **v0.11.0 计划**；§目录结构 补 `.board`/`docs`/`scripts`/`dist-release` 并指向本文件 | 同上 |
| 2026-09-16 | 新增只读普查脚本 `scripts/audit_text_health.mjs`（控制字符 + 旧口径残留抽查） | 同上 |
| 2026-09-16 | 门禁复跑确认：**core 621/0 + desktop 22/0 = 643/0**（结构整理零影响） | 同上 |
| 2026-09-16 | 裁定根目录 4 个废弃文档**保留原位**（不迁 `docs/archive/`），理由见 §6 | 同上 |
| 2026-09-16 | 裁定 `dist-release/` 历史安装包（4.7 GB）**本轮不删**，登记影响面待用户拍板 | 同上 |
