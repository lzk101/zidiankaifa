# agent 登记册 — zidiankaifa

> **写者**：项目结构管理 agent（第 4 个常驻角色）。**其他角色只读。**
> 职责依据：`.board/roles/structure-agent.md` **§14「agent 结构管理」**
> 数据源：**主管每轮提供的 `list_agents` 快照**（我自己调用 `scope=descendants` 只能看到自己的子代理 ⇒ **看不到 ≠ 不存在**）
> 建立：2026-09-16 · 快照时点：2026-09-16（v0.10.0 发布后）

---

## 0. ⚠ 三条必读（否则会误用本册）

1. **本工具没有「删除 agent」的 API。** 可用通道只有 `list_agents`（只读）、`interrupt_agent`（停当前一轮）、`send_message`（**发起新一轮 = 唤醒**）。⇒ **「清理临时 agent」的实际含义是：台账化 + 标记可回收 + 报主管请其止损**，**不是物理删除**。本册**禁止**把「标记已回收」写成「已删除」。
2. **`ready` ≠ 会话结束、上下文已释放。** 它表示「可被 `send_message` 续跑」。⇒ **把 `ready` 的临时 agent 当成「已死」而随手重派，会重复消耗上下文并可能产出与既有结论冲突的第二版** —— 这正是本册要防的主要浪费。
3. **label 是 agent 创建时的任务描述，不等于当前职责。** 本项目三个常驻 agent 的 label 已过时（见 §2 ⚠），**真实职责以 `.board/roles/*.md` 为准**。

---

## 1. 受保护名单（**恒 4 个 · 绝不可清理 · 不可 `interrupt`**）

| # | 角色 | 登记 id | 写域（权威） | 委任书 |
| --- | --- | --- | --- | --- |
| 0 | **主 agent / 项目主管** | 本会话顶层（各常驻 agent 的 `parent`） | `.board/TASKS.md` · `BASELINE.md` · `BOARD.md`；git 写操作唯一执行者 | `PROJECT_CHARTER.md` |
| 1 | **需求管理 agent** | `4ce66e63-8f5f-4b15-8203-c23b3dccce6f` | `.board/REQ.md` · `DECISIONS.md` · `CHANGELOG.md` | `.board/roles/`（需求侧） |
| 2 | **开发编程 agent** | `6c6cedb8-f03d-49d3-ab1a-c1aa2d9dc62c` | `packages/*/src/**` · `apps/*/src/**` · `packages/data-pipeline/**` | `.board/roles/dev-agent.md` |
| 3 | **功能测试 agent** | `7ff57407-f229-40e9-ba31-3d3e58b9655b` | `packages/core/test/*.mjs` · `apps/desktop/test/*.mjs` · `scripts/**` · `.board/EVIDENCE.md` | `.board/roles/test-agent.md` |
| 4 | **项目结构管理 agent**（本册写者，2026-09-16 增） | `2d4ba4d0-64b5-4449-a295-66c327942977` | `.board/STRUCTURE.md` · **`.board/agents.md`** · `.board/structure/**` · `PROJECT_STRUCTURE.md`（仅事实性）· `.gitignore`（只增） | `.board/roles/structure-agent.md` |

> ⚠ **注意「三个常驻」的准确含义**：用户原话「只有主agent和三个常驻agent不能清理」指的是 **#0 主 + #1/#2/#3 三个业务常驻**；**结构管理 agent 自身（#4）是执行者，不在被清理的对象里**，也不由自己清理。

---

## 2. 常驻 agent 的 label 过时问题（**已登记为结构不良项**）

| id | snapshot label（创建时的任务名） | **真实职责** |
| --- | --- | --- |
| `4ce66e63` | 需求管理 agent 启动 | 需求管理（跨 T1/T4/T21/T23/T25/T26/T30/T33/T34/T37/T38/T40/T47/T54…） |
| `6c6cedb8` | **开发 agent 启动+可达性判别** | 开发编程（label 停留在一个早已完成的判别任务上） |
| `7ff57407` | **测试 agent 启动+判别集** | 功能测试（同上） |
| `2d4ba4d0` | 结构管理 agent 常驻角色 | 项目结构管理（同） |

⇒ **每条 label 都只记录了首轮任务**，看不出「这三个 id 就是当前的三大常驻角色」。
⇒ **处置**：本册承担**职责映射**这一层（真实来源）；label 本身的修正**属主管决定**（可新建 label 更准的 agent 顶替，但会丢上下文，**不建议仅为改名而重建**）。**在主管裁定前，一律以本表为准。**

---

## 3. 临时 agent 登记（**由主管快照得来**）

> 说明：临时 agent = 为有界任务创建、任务已结束的子代理。**「产出落盘」列仅登记可指认的落盘位置**；标记「待主管补注」者 = 我无法从当前证据确证其产出，**不作回收判定**（宁可报警也不误标）。

### 3.1 depth = 1（直属于主 agent）

| id | label（创建时任务） | 状态 | 产出落盘（可指认） | 回收判定 |
| --- | --- | --- | --- | --- |
| `fa74d552-876e-4f94-b7c5-cf5af79bb297` | v0.9.0 准入条件实验 | ready | `scripts/exp_v9_admission.mjs` · `scripts/out_v9_admission.json`（611 KB）· `.board/EVIDENCE.md` §41 | **可回收**（结论已入 `.board/BOARD.md` 裁决十三） |
| `bb19ba01-5ddb-46f4-a093-f21b2b7bc7f8` | V9-3 全库 D1 计数守卫 | ready | `packages/core/test/ru_morph_d1guard.mjs`（26 断言，已入 `pnpm test` 链）· `scripts/probe_t18_*.mjs` · `.board/EVIDENCE.md` §40 | **可回收**（已提交 `99c9992`） |
| `843b7bf5-6f12-44f4-b51a-9b87c4037bdd` | T42 WAL backup red assertion | ready | `scripts/probe_t42_wal_fixture{,2,3}.mjs` · `packages/core/test/book_lang.mjs` 块 E | **可回收**（后继 T46/T50/T52 已接管该文件） |
| `6e6acfbe-4056-4d89-87ed-2857d3b50a5e` | T46 update block E assertions | ready | `scripts/probe_t46_*.mjs` ×3 · `book_lang.mjs` 块 E 扩写 | **可回收**（约束已由 T50/T52 覆盖） |
| `18a79f6a-d575-48eb-932e-23bb90cc77e4` | T47 sync AC-12 to VACUUM INTO | ready | `.board/REQ.md` AC-12⑨（`:816-847`）· `.board/DECISIONS.md` `DEC-026` · `.board/CHANGELOG.md` · 四条异议 | **可回收**（四条异议已全部被主管采纳并闭环） |
| `3d2dc17e-ac96-4d93-83a0-48bb24fa3ad3` | T50 update A33 backup-count assertion | ready | `book_lang.mjs` A33/A12b/A33b 等 5 处 · `scripts/probe_t50_reuse_edges.mjs`（S1/S2 两个洞） | **可回收**（S1/S2 已由主管 T51 修掉） |
| `6b08a4c5-d52d-46ae-8812-910498a18076` | T52 sync reuse log assertion | ready | `book_lang.mjs` `REUSE_LOG_RE` 单一来源 + A28c/A28d/A28e（137/0） | **可回收**（已随 v0.10.0 发布 `041c6e7`） |

### 3.2 depth = 2（孙子代理由 `fa74d552` 创建）

| id | label | 状态 | 产出落盘 | 回收判定 |
| --- | --- | --- | --- | --- |
| `9db3c4d0-f68d-4f1d-b579-8e1cfed96cdf` | Audit etymology batch A | ready | 待主管补注（父 `fa74d552` 的准入实验子任务） | ⚠ **不判定**（结果未单独落盘；其结论已并入父任务） |
| `0f53feaa-6945-4c5f-bdda-b3ab87621256` | Audit etymology batch B | ready | 同上 | ⚠ **不判定**（同上） |

---

## 4. 统计（快照时点 2026-09-16）

| 项 | 值 |
| --- | --- |
| **常驻 agent**（含 #4 结构管理） | **4**（额度恒为 4，体检第 10 项） |
| **临时 agent 累计** | **10**（depth1 = 8 · depth2 = 2） |
| 其中 `running` | 0（快照时 `2d4ba4d0` 正在跑首轮，属常驻） |
| 标记「可回收」 | **7** |
| 标记「不判定 · 待补注」 | **3**（两个孙代理 + 一个需主管核实的归属） |
| 标记「异常」 | 0 孤儿 / 0 重复 / 0 未落盘 |

---

## 5. 异常分类（本册的报警口径）

| 类别 | 判据 | 处置 |
| --- | --- | --- |
| **孤儿** | 父链指向的 agent 已不在快照中 | 报主管，登记父子关系断裂 |
| **失效** | 结论已被更晚的结论取代（如 v0.8.0 期的判别实验代 agent） | 标「失效」，**不再唤醒** |
| **未落盘** | 任务完成但证据未进 `.board/`/`docs/` | **优先报警**；**绝不标可回收** |
| **重复** | 同一任务存在两个并行 agent | 报主管（串行链如 T42→T46→T50→T52 改同一文件属**合理**，不报） |
| **label 与职责不符** | 见 §2 | 已登记；以职责映射为准 |

---

## 6. 变更记录

| 日期 | 变更 | 依据 |
| --- | --- | --- |
| 2026-09-16 | 建立本册：受保护名单 4 个 · 临时 agent 10 个登记 · 常驻 label 过时问题登记 | 用户指令「负责清理临时agent … 帮助主agent管理agent结构」+ 主管 `list_agents` 快照 |
