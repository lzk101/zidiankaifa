# v0.7.1 — 修复：升级安装后仍读旧词库（词源/拆解全空）

**发布日期**：2026-09-13

## 问题

安装 v0.7.0 后查询俄语 `тоска`，界面显示：

- 「词源 · 语言发展」→ **暂无词源数据**
- 「词根词缀拆解」→ **暂未拆解**

但同一台机器上用命令行/浏览器查同一份词库却完全正常（有原始斯拉夫语词源、有 `тоск-` 拆解）。

## 根因

`apps/desktop/src/main.mjs` 的 `resolveDbPath()` 逻辑为：

1. 优先使用 **userData 副本**：`%APPDATA%\<productName>\dict.db`
2. **只在副本不存在时**才把内置库复制过去

于是只要用户装过任意旧版本，userData 里就会留下一份旧词库，**此后无论安装多少个新版本，都永远读那一份旧库**。

实测该机器上的 userData 副本：

| 项 | userData 旧副本（v0.2.x，509.10MB） | 内置新库（v0.7.0，518.24MB） |
| --- | --- | --- |
| `words_i18n` 俄语词条 | 159,127（含未清理的屈折形污染） | 101,512 |
| `word_etymology` 俄语词源 | **0** | **31,256** |
| `morphemes` 俄语词素 | **0** | **441** |
| `roots` 表 | **不存在** | 476 |
| `morphemes` 英语词素 | 437 | 468 |

俄语词源与词素均为 0 → 界面"正确地"显示了「暂无数据」，但用户看到的是**跨越 5 个版本的升级全部失效**。

## 修复

新增 `apps/desktop/src/dbmigrate.mjs`（纯 Node，不依赖 electron，便于单测）：

- **指纹比对**：以内置库的 `size:mtime` 作为指纹，写入 userData 旁的 `dict.db.stamp`
- **自动换库**：启动时若指纹不一致，替换 userData 副本并刷新 stamp
- **生词本迁移**：换库前用 `openDatabase` + `bookListAll` 读出旧库 `book` 表（含墓碑，保留删除状态），换库后 `syncMerge` 写回 —— **生词本不丢**
- **旧库备份**：旧副本改名为 `dict.db.bak-<时间戳>` 而非删除
- **容错**：读取旧生词本失败、甚至旧库损坏时仍完成换库（不能因为读不到生词本就把用户卡在旧库上）；换库本身异常则回退到内置库（只读）以保证数据正确

`main.mjs` 的 `resolveDbPath()` 改为调用 `ensureUserDb()`。

## 测试

新增 `apps/desktop/test/dbmigrate.test.mjs`，用**小库**（非 500MB 真库）秒级验证 5 个场景、**22 项断言全通过**：

1. 首次运行 → `created`
2. **核心：旧库（含生词本 + 墓碑）→ 新内置库** → `upgraded`；生词本 3 条完整迁移（含墓碑与状态）；旧库备份存在且内容仍为旧库；重复调用变 `kept`
3. 连续升级（内置库再次变更）→ 再次 `upgraded`
4. 内置库缺失 → `no-bundled`
5. 旧库损坏 → 仍 `upgraded`，副本为可用新库

```powershell
node apps/desktop/test/dbmigrate.test.mjs
```

## 影响与操作

- **已有安装**：本次修复已在本机执行完毕，userData 已换成新库（俄语词源 31,256 / 俄语词素 441 / roots 476），生词本 `тоска`、`international` 保留 → **重开应用即可看到词源与拆解**
- **升级路径**：自 v0.7.1 起，每次安装新版本都会自动比对指纹并换库，不再出现"装了新版还是旧数据"
- **备份位置**：`%APPDATA%\@zidiankaifa\desktop\dict.db.bak-<时间戳>`，确认无误后可手动删除

## 文件

- 新增 `apps/desktop/src/dbmigrate.mjs`
- 新增 `apps/desktop/test/dbmigrate.test.mjs`
- 修改 `apps/desktop/src/main.mjs`（`resolveDbPath()`）
- 新增 `AGENTS.md`（项目开发规范：环境事实 + 防循环熔断规则）
- 版本号 0.7.0 → 0.7.1（4 个 `package.json` + 3 处界面/服务文本）
