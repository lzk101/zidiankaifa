# 结构台账 — zidiankaifa

> **写者**：项目结构管理 agent（第 4 个常驻角色）。**其他角色只读。**
> 委任书：`.board/roles/structure-agent.md`　额度依据：`.board/BASELINE.md` §7
> 台账建立：2026-09-16（角色建立时 HEAD `d558aa0`，版本 v0.10.0）

---

## 使用说明（结构 agent 必读）

1. **每次版本发布 + push 之后**追加一节「快检」；每 5 个 release 或大版本后追加一节「全量审计」。
2. 每节必须含 **§九项实测表**（逐项：实测值 · 额度 · 达标/越线）+ **本轮清理**（路径 · 字节 · 递归数 · 权限依据）+ **门禁复核**（清理后复跑 core/desktop）。
3. **清理前先记录证据再执行**；**已跟踪文件一律只列清单提请核准**，不自行删。
4. 体量必带「是否递归」；文件数必带口径（`git ls-files` / 只读 / 只增）。
5. 回执按委任书 §12 格式发给主管；**需要裁决的事项同时追加到 `.board/BOARD.md` 的 `## [项目结构管理 agent]` 区**。
6. **agent 层结构另立台账**：`.board/agents.md`（委任书 §14）。

---

## 节次索引

| # | 日期 | 节奏 | 触发版本 | 结论摘要 |
| --- | --- | --- | --- | --- |
| — | 2026-09-16 | 建账 | v0.10.0 | 台账建立（HEAD `d558aa0`） |
| 1 | 2026-09-16 | 快检 | v0.10.0 | 九项全测：**2 项越线**（`dist-release/` −3.99 GB ⛔ · 临时残留 1 处**已清**）；**BASELINE §7 两行数字不成立已提请订正**；`scripts/` MECE **不通过（覆盖 109/135）**；死引用 **81 条 / 31 目标**（其中 **3 处「保留声明 vs 磁盘不存在」矛盾**）；「清了又长」根因**已确证**且**已触 §11 熔断**；门禁复跑 **core 621 / desktop 22 全绿** |

---

## 待办（首轮，已由主管派单）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 九项体检实测；与 `BASELINE.md` §7 不符者在本文件提请主管订正（不直接改 BASELINE） | ✅ 见 §1 / §2 |
| 2 | `dist-release/` 超线的**具体清理清单**（文件名 + 字节数 + 保留理由），先报核准不执行 | ✅ 见 §9（⏸ 未执行） |
| 3 | `scripts/` 分类 MECE 校验（A/B/C/D/E 覆盖全部且两两不相交） | ✅ 已校验 → **不通过**，见 §4 |
| 4 | 「清了又长」根因诊断（`run-*` 由 `book_lang.mjs` 重建） | ✅ 根因确证，见 §7 |
| 5 | 引用完整性 / 死引用清单 | ✅ 见 §6 |

---

## 首轮快检（v0.10.0 发布后）

### §0 快检坐标

| 项 | 值 |
| --- | --- |
| 时点 | 2026-09-14 03:10–03:25（本机时钟） |
| 起始 HEAD | `224ce73`（`git describe` = `v0.10.0-5-g224ce73`），已跟踪 **250** |
| **终结 HEAD** | **`05788be`**（`roles: 结构管理 agent 扩权`，快检进行中由主管提交），已跟踪 **251** |
| 版本 | 当前 **v0.10.0** · 上一版本 **v0.9.0** |

> ⚠ 本节的「已跟踪文件总数」一律以**终结 HEAD `05788be` = 251** 为准；凡在 §2 引用 `d558aa0` 的 248，均已注明时点。

---

### §1 九项实测表

| # | 维度 | 实测值（**口径**） | 额度 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 已跟踪文件总数 | **251**（`git ls-files` 行数；HEAD `05788be`） | ≤300 | ✅ 余 49 |
| 2 | `scripts/` 文件数 | **135**（`git ls-files scripts`） | ≤165 | ✅ 余 30 |
| 3 | `scripts/` 顶层文件数 | **135**（`Get-ChildItem scripts -File`，**非递归**）／递归亦 **135** | ≤35 | ⛔ **越线 +100**（但口径存疑，见 §3） |
| 4 | `dist-release/` 体量（**递归**） | **5,899,319,384 B = 5.494 GiB**（121 文件） | ≤1.5 GB | ⛔ **越线 −3.99 GB** |
| 5 | `data/` 体量（**递归**，只报不删） | **3,937,209,363 B = 3.667 GiB**（53 文件） | ≤4.5 GB | ✅ 余 0.83 GB |
| 6 | 缓存合计（**递归**） | **849,084,159 B = 0.791 GiB** = `.pnpm-store` 695,044,170 ＋ `.electron-cache` 133,848,303 ＋ `.eb-cache` 20,191,686 | ≤1.2 GB | ✅ 余 0.41 GB |
| 7 | 临时残留 | **0**（清理前 **1 处**：162 文件 / 7,410,444 B）—— `*.tmpdir` 0 · `.tmp` 0 · `.pip-tmp` 0 · `.board/_tmp` 不存在 | 0 | ✅（清理后达标） |
| 8 | 僵尸产物 | **5 个**（根目录 4 个 `.md` ＋ `check_requirements.py`）—— **已裁定保留原位，只报不动** | — | ✅（按裁定） |
| 9 | 单文件 ≤20 MB · `.board/*.md` ≤3000 行 | 最大已跟踪文件 = `scripts/out_v9_admission.json` **639,777 B**（占额度 3.0%）；最长 `.board/*.md` = `.board/EVIDENCE.md` **2451** 行 | 20 MB / 3000 | ✅ 双达标 |

补充（不计入九项，供参考）：`node_modules/` **485,527,046 B = 0.452 GiB**（9,890 文件，**递归**）—— 依保护清单**不删**。

`.board/*.md` 行数（**换行符计数**；下表为 **T55 收尾时点**，与 §2 冻结值对比时请注意时点差）：`BASELINE` 111 · `BOARD` **2460** · `CHANGELOG` 179 · `DECISIONS` 672 · `EVIDENCE` **2451** · `REQ` 1336 · `STRUCTURE` **320** · `TASKS` **1054** · `agents` 100 · `roles/dev-agent` 71 · `roles/structure-agent` **261** · `roles/test-agent` 89。
> ⚠ **时点差说明（本轮实测）**：T55 起始时 `BOARD` = 2441 · `TASKS` = 1019 · `roles/structure-agent` = 188；收尾时为 2460 / 1054 / 261 —— 差额分别来自 ① 我追加本区（+19）② 主管提交 `05788be` 的 §14 扩权（`TASKS` +35 · 委任书 +73）。⇒ 项 9 的 3000 行判定**以 2460 为准**（余 540 行）。

`.board` 已跟踪文件 = **12**（`BASELINE` `BOARD` `CHANGELOG` `DECISIONS` `EVIDENCE` `REQ` `STRUCTURE` `TASKS` `agents` ＋ `roles/`×3）。

---

### §2 ★ `BASELINE.md` §7 提请订正（依 `BASELINE.md:111`，我不直接改 BASELINE）

| §7 冻结维度 | 冻结值 | 本轮实测 | 差 | 判定 |
| --- | --- | --- | --- | --- |
| `scripts/` 文件数 | **158** | **135** | **−23** | ⛔ **数字不成立** |
| `scripts/` 顶层文件数 | **33** | **135** | **+102** | ⛔ **数字不成立** |
| 已跟踪文件总数 | 248 | `d558aa0` 时点 = **248 ✅** · 现 HEAD `05788be` = **251** | +3 | ✅ 248 正确（时点须注明） |
| `dist-release/` | 5.49 GB | 5.494 GiB | ✅ 一致 | ✅ |
| `data/` | 3.67 GB | 3.667 GiB | ✅ 一致 | ✅ |
| 缓存合计 | 0.79 GB | 0.791 GiB | ✅ 一致 | ✅ |
| 临时残留 | 0 | 1 处（已清） | 越线 | 见 §7 |
| `.board/*.md` 行数 | BOARD 2432 · EVIDENCE 2451 | BOARD **2441**（T55 起始，+9）→ **2460**（收尾，+28）· EVIDENCE **2451**（**完全一致**） | +28 | ⚠ 增速正常（含我追加本区 +19） |

**关于「158」的出处（未查明，如实声明）**：委任书 §4「其中 `scripts/` 158」与 §7 同源。已试验的组合：`scripts/` 顶层 135 ＋ `.board/roles` 3 = **138**；`.board` 全树 12 ＋ 135 = **147**；均 ≠ 158。**未找到任一实测组合等于 158** ⇒ 标注「**未验证**」，请主管核原始取数口径。

---

### §3 项 3 的口径订正建议（真问题是口径，不是「越线」）

「`scripts/` 顶层 ≤35」这一维度在**本项目当前物理形态下与项 2 恒等**：
`git ls-files scripts` 中匹配 `^scripts/[^/]+$` 的 = **135** = 全部 ⇒ **`scripts/` 无任何被跟踪的子目录**（唯一子目录 `_tmp/` 被 `.gitignore:42:_tmp/` 忽略，本轮已清空）。

⇒ 建议**二选一**：**(a)** 删去该项（与项 2 恒等，冗余）；**(b)** 改为「`scripts/` **递归** ≤165 ∧ **顶层** ≤35，且两数分列」，并强制标注递归与否。
⇒ 现冻结值「文件数 158 / 顶层 33」**自身不自洽**：若 158 全在顶层则顶层应 = 158；若顶层仅 33 则必有 125 个在子目录，而**实测被跟踪子目录文件 = 0**。两行须由主管重取后重新冻结。

---

### §4 MECE 校验（待办 3）—— ★ **不通过：A∪B∪C∪D∪E 只覆盖 109 / 135（80.7%）**

工具：`.board/structure/classify_mece.mjs`（只读；**须在仓库根运行**）

| 档 | 判据 | 命中数 |
| --- | --- | --- |
| **A 活跃工具** | 委任书 §7 点名 ＋ 门禁/发布路径直接依赖 | **5** |
| **B 证据产出** | `out_*` | **10** |
| **C 一次性探针** | `probe_*`（非 D） | **89** |
| **D 结论已错** | 文档明写「作废/推翻」 | **5** |
| **E 临时件** | `_tmp*` / `*.tmpdir` / `.tmp/` | **0**（被跟踪中已无） |
| **U 五档无归属** | — | **26**（`exp_*` 24 ＋ `apply_*` 2） |

- **A 档 5 个**：`check_v10_ui_contract.mjs`（37 处引用）· `audit_text_health.mjs`（6）· `fix_readme_l144_corruption.mjs`（3）· `build_web_nospawn.mjs`（2）· `exp_ru_ceiling.mjs`（16，B-5 已修复、自检 0 例不一致 exit 0）。
- **前缀实测分布**：`probe_*` **90** · `exp_*` **29** · `out_*` **10** · `apply_*` **2** · 无前缀 **4** = 135。

**⇒ 根因（结构性，非个别漏登记）**：§7 的档位**以「前缀」编码**（`probe_*`/`out_*`/`_tmp*`），而 **`exp_*`（29 个，第二大前缀）与 `apply_*`（2 个）从未被任何档位定义覆盖** —— `exp_*` 只作为 **D 档的示例**出现（「`exp_ru_recoverable.mjs` 等三个」），**其非错者（24 个）无家可归**。
⇒ **请求裁决**：新增 **F 档「实验台（`exp_*`）」**（保留至其结论被取代，被取代者转 D），并把 `apply_*` 归入 F 或 A。

**重叠需显式消解**：`probe_*` 亦可属 A（被裁决/门禁直接依赖，如 `probe_sup_d1_authoritative.mjs` 被 `DEC-004` ② 定为强制测法）或 D ⇒ 建议**明文声明优先级 `D > E > A > B > C > F`**（本轮分类器即按此序，先命中先归类 ⇒ 两两不相交）。

---

### §5 D 档（结论已错 · 引用即错）：3 已登记 ＋ 2 本轮新增提案

| 脚本 | 失效原因（出处） | 状态 |
| --- | --- | --- |
| `exp_ru_recoverable.mjs` | 86.7% 假天花板 | 已登记 |
| `exp_ru_gap.mjs` | 分类器不互斥（`310 + 182 ≠ 492`） | 已登记 |
| `exp_ru_head_gap.mjs` | 58.0% 把**启发式上界当可达性**（真上限 36.54% = 289/791）；`BOARD.md:887-890` 主管自述方法错误（**只计数「词首存在已知词素」的词**），修正后 **39.95%（316/791）** | 已登记 |
| **`probe_t15_reconcile_and_harm.mjs`** | **§B「96 词真误伤」已作废**（`BOARD.md:620` 自查纠错 ＋ `EVIDENCE.md:645`）⇒ **不得引其 §B 数字** | ★ **新增提案** |
| **`exp_v9_criterion_d.mjs`** | `:97` 的 `EX_ALL`（`суч-`/`суд-`/`-ной`/`пад-`/`тряс-`/`столп-`/`стат-`）**经主管自查作废** —— 系**未经来源核证的注入件**（`TASKS.md:332`） | ★ **新增提案** |

> **★ 反向澄清（防误登记，重要）**：`probe_t28_baseline.mjs` · `probe_t28_variants.mjs` · `probe_t29_verify/contrib/noi_check.mjs` · `probe_sup_bolnoy_mincost.mjs` · `probe_t15_hole_visibility.mjs` 所在文档行**亦含「推翻/作废」字样**，但它们**正是做出推翻的那一方**（其结论有效）⇒ **保持 C 档**。
> ⇒ 纪律：**「脚本名与作废字样同行」≠「该脚本结论已错」**，须读语义（谁被推翻）。

---

### §6 死引用清单（待办 5）—— **81 条 / 31 个目标**

工具：`.board/structure/scan_dead_refs.mjs`（只读；扫 **23** 个 `.md` = `.board/**` 12 ＋ `docs/**` 7 ＋ 根 4）

- **`.board/_tmp/*`**：**10 个目标 / 20 条** —— `probe_ru_measure.mjs` · `probe_ru_denominator.mjs` · `probe_ru_ceiling2.mjs` · `probe_ru_headroom.mjs` · `probe_counts.mjs` · `probe_d4_gloss.mjs` · `probe_t30_inverted.mjs` · `probe_t47_backup_fail.mjs` · `count_defects.mjs` · `defects_out.txt`
- **`scripts/_tmp/*`**：**21 个目标 / 61 条** —— `exp_t24{,b,c,d,e,f,g,h,i,j}.mjs` · `fetch_wikt{,2,3,4,5}.mjs` · `out_t24d_diff.txt` · `probe_sup_{degraded_write2,loud_fail,vacuum_backup,wal_snapshot2}.mjs` · `_tmp_readme_v090.mjs`

**按原因分类（关键：只有第 2 类是真缺陷）**

1. **静默型（预期消失 · 低危）**：绝大多数。`_tmp*` 依 `DEC-022` **本就不得作为证据来源**，其消失符合设计意图。
2. **★ 真死引用 ——「保留声明」与磁盘状态矛盾（高危，3 处）**：
   - `REQ.md:383`「⚠ **有意保留的证据脚本，勿当垃圾清理**：`.board/_tmp/count_defects.mjs` ＋ `.board/_tmp/defects_out.txt`」—— **两个文件均不存在** ⇒ 被声明为「有意保留」的证据**已丢失**。
   - `REQ.md:1318` `.board/_tmp/probe_t47_backup_fail.mjs`「**未删除**，也未被引用为证据来源」—— **实际不存在**。
   - `BOARD.md:2440` `scripts/_tmp/out_t24d_diff.txt`「**（保留）**」并给出「75,622 B = 73.8 KB · 1,081 行」—— **实际不存在**。
   ⇒ **须由需求 agent 订正措辞**（非我写域）；我不改他人文件。
3. **历史事故引用（有意为之，**非缺陷**）**：`scripts/_tmp_readme_v090.mjs`（5 条）—— 它是 `DEC-022` 的**起因案例**，文档讲的正是「`loses = 2` 曾被引到已删除的临时脚本」这一事故本身。
4. **已删除历史脚本被当既有物引用**：`scripts/probe_sup_wal_snapshot.mjs`（`TASKS.md:745` · `DECISIONS.md:537`）—— **未被跟踪且磁盘不存在**（其缺陷版已被 `_tmp/probe_sup_wal_snapshot2.mjs` 取代，后者亦不存在，属第 1 类）。
5. **花括号展开伪命中（工具噪声）**：`scripts/_tmp/fetch_wikt{.mjs`（`EVIDENCE.md:2249`）—— 原文残缺所致，非真实引用。

---

### §7 「清了又长」根因诊断（待办 4）—— ★ **已确证，且已触 §11 熔断**

**根因（实测）**：`packages/core/test/book_lang.mjs` 在 `scripts/_tmp/booklang_tmp/` 下用 `mkdtempSync('run-…')` 建**临时合成库目录**，收尾 `rmSync` 清理；**`rmSync` 报 `EPERM` 时目录被留下**（Windows 上稳定复现）。

**本轮直接证据 —— 3 次运行 → 恰好 3 个 run 目录（1:1，每目录恒 54 文件 / 2,470,148 B）**：

| 目录 | mtime | 产生者 |
| --- | --- | --- |
| `run-xjFfpf` | 03:10:36 | 首轮基线时点**已存在**（更早一次运行） |
| `run-CoBz9Z` | 03:12:16 | 复跑 1 |
| `run-bDANnc` | 03:12:59 | 复跑 2 |

**EPERM 原文**（`book_lang.mjs` 收尾打印，逐字）：
`临时库清理失败（不影响结论）：EPERM, Permission denied: \\?\D:\lzk17\Documents\zidiankaifa\scripts\_tmp\booklang_tmp\run-CoBz9Z '\\?\D:\lzk17\Documents\zidiankaifa\scripts\_tmp\booklang_tmp\run-CoBz9Z'`

**内容核验（判定是否含「留红取证快照」）**：目录内容**全部为合成夹具** —— `a35_backup_accum_obs.db(＋.bak×3)` · `a35_backup_fail_obs.db` · `a5_old_with_lang.db(＋.bak)` · `b_isolation.db` · `c_sync.db` · `d_lang.db` · `d_override.db` · `d_types.db` · `e_busy/` · `e_prod/` · `e_remnant/` · `e_remnant_src/` · `e_vacuum_ctl/` · `e_variant/` · `dist_variant/` —— **无任何断言输出 / 差分 / 快照文件**；留红证据只存在 stdout，**不落在该目录**。
⇒ **不构成 §3.1④ 的「测试留红取证快照」**，故按 §3.1 ①＋④ 删除。

**⚠ §11 熔断已到**：同一清理动作（删 `scripts/_tmp`）已触发 **2 次**（① 主管 v0.10.0 收尾 ② 本轮）⇒ **我不得再第三次重删**。
**下一次出现时的正确动作 = 报根因 ＋ 请主管派单修根因**。候选修法（**均动 `packages/core/test/`，属测试 agent 写域，不在我权限内**）：
1. `fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })`（Windows EPERM 通常由杀软/句柄延迟导致，重试可解）；
2. 把夹具根从 `scripts/_tmp/` 改到 `os.tmpdir()`（**顺带消除 `scripts/` 递归污染**，且 `.gitignore` 规则可退役）；
3. 清理前显式 `db.close()` 所有连接（EPERM 常见根因是仍有打开的句柄）。

---

### §8 本轮清理（逐条权限依据，**先记录后执行**）

| 路径 | 递归文件数 | 字节 | 权限依据 | 结果 |
| --- | --- | --- | --- | --- |
| `scripts/_tmp/`（含 `booklang_tmp/run-{xjFfpf,CoBz9Z,bDANnc}`） | **162** | **7,410,444** | §3.1 ① 删 `scripts/_tmp/` ＋ ④ 删已确认被测试重建的 `run-*` | ✅ 已删（`Test-Path` = False） |
| `.board/structure/_tmp/`（我自建的 scratch） | 3 | — | §3.1 ①（`_tmp/`） | ✅ 已删 |
| `.board/structure/{dead_refs_out,mece_out}.txt`（原始输出，数字已折入 §4/§6） | 2 | — | §3.1 ①（临时产出） | ✅ 已删 |
| `dist-release/` 历史包（36 文件）＋ `win-unpacked/`（77 文件） | 113 | **5,199,257,140** | §3.1 ② **但 `BASELINE.md:109` 要求清单先报主管核准** | ⏸ **未执行**（清单见 §9） |

- **清理后复核**：`scripts/` **递归 135 = 顶层 135** ⇒ 递归残留归零；`*.tmpdir` / `.tmp` / `.pip-tmp` = **0**；`.board/_tmp` **不存在**。
- **已跟踪文件删除数 = 0**（`git status` 除新增 `?? .board/structure/` 外干净）—— 全程遵守保护清单（`data/**`、全部已跟踪文件、`node_modules/`、缓存目录本身）。
- **新增未跟踪**：`.board/structure/classify_mece.mjs`（MECE 分类器）· `.board/structure/scan_dead_refs.mjs`（死引用扫描器）—— 两个**只读、仓库根运行**的可复用工具，供 **T57 全量审计**复用。**是否入 git 请主管定**（我无 git 写权限）。

---

### §9 `dist-release/` 越线处置清单（待办 2 · ⏸ **先报不执行**）

坐标：当前 **v0.10.0**，上一版本 **v0.9.0**（`dist-release/` 中**无 v0.8.0 安装包**）。

**A. 保留（8 文件 / 700,062,244 B = 0.652 GiB）**

| 文件 | 字节 | mtime |
| --- | --- | --- |
| `zidiankaifa-0.10.0-x64.exe` | 175,041,867 | 2026-09-14 01:43 |
| `zidiankaifa-0.10.0-x64.exe.blockmap` | 182,886 | — |
| `zidiankaifa-portable-0.10.0-x64.exe` | 174,812,071 | — |
| `latest.yml` | 350 | — |
| `zidiankaifa-0.9.0-x64.exe` | 175,032,818 | 2026-09-13 23:35 |
| `zidiankaifa-0.9.0-x64.exe.blockmap` | 182,907 | — |
| `zidiankaifa-portable-0.9.0-x64.exe` | 174,803,084 | — |
| `builder-debug.yml` | 6,261 | 小，随留 |

**B. 待删：12 个历史版本 × 3 件套 = 36 文件 / 4,345,641,661 B = 4.047 GiB**（每版本 = `zidiankaifa-<v>-x64.exe` ＋ `.blockmap` ＋ `zidiankaifa-portable-<v>-x64.exe`，**逐个实测**）：

| 版本 | 三件套合计 B | mtime |
| --- | --- | --- |
| 0.2.0 | 311,047,468 | 2026-08-31 02:18 |
| 0.2.1 | 373,306,145 | 2026-09-10 06:58 |
| 0.3.0 | 376,234,299 | 2026-09-13 01:22 |
| 0.4.0 | 376,885,726 | 01:42 |
| 0.4.1 | 377,039,941 | 02:24 |
| 0.4.2 | 377,040,782 | 02:40 |
| 0.4.3 | 377,041,121 | 03:11 |
| 0.4.4 | 378,002,867 | 03:25 |
| 0.5.0 | 349,062,609 | 03:36 |
| 0.6.0 | 349,958,078 | 04:21 |
| 0.7.0 | 350,009,727 | 05:43 |
| 0.7.1 | 350,012,898 | 07:31 |

**C. 另待删**：`win-unpacked/` **77 文件 / 853,615,479 B = 0.795 GiB** —— electron-builder 在 NSIS/portable 打包中的中间展开目录，**每次 `desktop build` 重建**。
依据 = `apps/desktop/package.json` `build.directories.output = "../../dist-release"` ＋ 产物 mtime 与 Release 同批；**未做重建实验验证** ⇒ 标注「**未验证**」（见 §12-1）。

**D. 删除后预期体量** = 5,899,319,384 − 4,345,641,661 − 853,615,479 = **700,062,244 B = 0.652 GiB** ✅ **远低于 1.5 GB 额度**（余 0.848 GiB）。

**E. 安全性依据（为何删历史包不影响自动更新）**：`apps/desktop/package.json:67-73` 的 `build.publish = [{ provider: "github", owner: "lzk101", repo: "zidiankaifa" }]` ⇒ 自动更新走 **GitHub Release 的 `latest.yml`**，**不读本地 `dist-release/`**；且全部安装包**已在** `https://github.com/lzk101/zidiankaifa/releases`。

**F. 唯一风险**：删 `win-unpacked/` 后，若需**离线**复现某历史版本的解包态，须重跑 `desktop build`（分钟级）。

---

### §10 门禁复核（清理后复跑 · **两条命令分别判定，不合并 643**）

| 命令 | 结果 | 退出码 |
| --- | --- | --- |
| `pnpm --filter @zidiankaifa/core test` | **621 通过 / 0 失败** —— `regress` 99 · `lexicon` 67 · `related` 38 · `ru_morph` **60**（**无「结果：」前缀，勿用 `Select-String '结果：'` 抓**）· `ru_morph_d1fix` 194 · `ru_morph_d1guard` 26 · `book_lang` 137 | **0** |
| `pnpm --filter @zidiankaifa/desktop test` | **22 通过 / 0 失败** | **0** |

⇒ 与 `AGENTS.md` §1 的 **core 621 / desktop 22** 一致；**清理未造成任何回归**。
`book_lang.mjs` 五块明细：`[A] 42 · [B] 26 · [C] 18 · [D] 25 · [E] 26`。

⚠ `book_lang.mjs` 打印的 **3 条未闭环缺陷登记（非断言）** 本轮实测仍在 —— **属测试/开发写域，我只登记不动**：
1. **备份失败路径绕过后置校验**（T48 已把校验上移到 `openDatabase()` 出口 `index.ts:144 assertBookCompositeOrThrow`）；
2. **反复失败的启动累积整库大小 `.bak`**（T51 收紧判据后跨启动不再复用 ⇒ 累积回归；一次自愈仍只 1 份，但**首次那份无清理机制**）；
3. **「已清除并重试一次迁移」警告在索引情形不实**（实测 `sqlite_master` 中 `book_new` 仍为 `index`；后果安全，但日志会误导排查）。

---

### §11 僵尸产物（项 8，**只报不动**）

| 文件 | 字节 | 行数 |
| --- | --- | --- |
| `check_requirements.py` | 5,826 | 146 |
| `需求总结.md`（根目录） | 920 | 12 |
| `已完成需求.md` | 1,968 | 35 |
| `任务排序.md` | 843 | 17 |
| `运行日志.md` | 1,250 | 16 |

⇒ 依 `DEC-008`（禁运行 / 禁写）＋ 主管裁定（**不迁 `docs/archive/`**，理由 = 四处禁令以「根目录」为坐标，移动会使规则**失锚**）⇒ **原位保留，本轮未动**。

---

### §12 我的假设与未验证（逐条写明）

1. **「`win-unpacked/` 每次 build 重建」未做重建实验** —— 依据仅为 `package.json` 的 `output` 配置 ＋ mtime 与 Release 同批。⇒ 删前若要 100% 确定，请主管授权跑一次 `desktop build` 验证（**我无构建授权，且会重产 1.7 GB 包**，与「防臃肿」相悖）。
2. **`run-xjFfpf` 的「绿」是推断** —— 判据 = ① 目录内容全为合成夹具、无断言输出文件；② 本轮 3 次全绿运行各留 1 个同尺寸（54 文件 / 2,470,148 B）目录；③ `.board` 无该时点留红记录。**若该目录实际来自某次留红运行，其取证价值也不存在于目录内**（留红只打 stdout）⇒ 结论不变，但**该推断本身未经留红复现实验**。
3. **「`scripts/` 子目录 = 0」是 tracked 口径** —— 磁盘上被 `.gitignore` 忽略的 `_tmp/` 曾存在（已清）。若未来新增**被跟踪**的 `scripts/` 子目录，项 2 / 项 3 的口径等式即失效（§3 的订正建议须同时生效）。
4. **`PROJECT_STRUCTURE.md` 本轮未改（主动延后）** —— 快检进行中主管正并发编辑该文件（并提交了 `05788be`），为避免**写覆盖**我延后。其现存的 5 处事实性错误见 §13，**下轮补写或请主管自行订正**。
5. **未复核项（超出结构 agent 职责）**：`/health` 版本号、`lexicon.mjs:122-141` 冻结快照、`apps/web/dist` 内嵌版本号、`docs/*.md` 行数明细（本轮仅记：交接文档 410 · 需求总结 1478 · release-v0.10.0 270 · v0.7.0 66 · v0.7.1 73 · v0.8.0 187 · v0.9.0 151）。

---

### §13 `PROJECT_STRUCTURE.md` 待订正（事实性 · 本轮延后）

| 位置 | 现值 | 实测 | 备注 |
| --- | --- | --- | --- |
| `:19` | `scripts/`（**158 个**只读探针/实验台） | **135** | 与同行下文的 `:42`/`:81` **自相矛盾** |
| `:42` · `:81` | `scripts/` **133** 文件 | **135** | 差 **−2** = `d558aa0` 新增的 `audit_text_health.mjs` ＋ `fix_readme_l144_corruption.mjs` |
| `:49` | `git ls-files` 共 **245** = `scripts/` 133 ＋ `packages/` 43 ＋ … | 总数 **251**（HEAD `05788be`）· `scripts/` **135** | 须按现 HEAD 重取整表 |
| §4 | `.board/` **9 个文件** | **12** | 增 `STRUCTURE.md` · `agents.md` · `roles/structure-agent.md` |
| §4 | `TASKS.md` **951** 行 | **1019** | 已过时 |
| §3 D 档 | 3 个 | 建议补 2 个 | 见 §5（`probe_t15_reconcile_and_harm.mjs` · `exp_v9_criterion_d.mjs`） |

---

### §14 agent 结构管理（委任书 §14 新职责 · 本轮**只报**）

- `.board/agents.md` 已由**主管**于本轮建立并提交（`05788be`），**已含**：受保护名单 4 个（`4ce66e63` 需求 / `6c6cedb8` 开发 / `7ff57407` 测试 / `2d4ba4d0` 结构）＋ 临时 agent 10 个登记（depth1 = 8 · depth2 = 2）＋ 常驻 label 过时问题。
- **我本轮未改该册**：依 **§14.5**，登记册的数据源是**主管提供的 `list_agents` 快照**，而**本轮派单未附快照**；我自己 `scope=descendants` 通常为空 ⇒ **无新数据可写，凭猜改写将违反 §14.5「不得把『我这里看不到』写成『不存在』」**。
- ⇒ 已在回执【阻塞】中**索要下一轮的 `list_agents` 快照**；同时提请您确认：该册已由您填充，**我是否只需增量维护**（而非重写）。

---

### §15 未跟踪未清 / 留给 T57

- `?? .board/structure/`（2 个只读工具，见 §8）—— **未跟踪未清**，是否入 git 待主管定。
- **T57 全量审计复用入口**（**必须在仓库根运行**；两脚本已内置 cwd 自检，跑错目录会 `exit 1` 而**不是**静默扫 0 个文件）：
  ```powershell
  node .board/structure/classify_mece.mjs     # A–F 档分类 + MECE 覆盖统计 + 零引用清单 + 作废语境命中
  node .board/structure/scan_dead_refs.mjs    # 死引用扫描（含花括号展开）
  ```
- **未清（不属我权限）**：§11 僵尸产物 5 个（主管已裁定保留）· §6 第 2 类的 3 处「保留声明 vs 磁盘不存在」矛盾（须**需求 agent** 订正措辞）· §7 根因修法（须**测试 agent** 改 `packages/core/test/book_lang.mjs`）。
