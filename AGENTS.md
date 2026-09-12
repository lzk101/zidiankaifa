# AGENTS.md — zidiankaifa 开发规范（AI 代理必读）

> 本文件的目的：让每次会话都不必重新摸索环境、不重复踩同一个坑、不陷入无效循环。
> 新增踩坑经验时，直接追加到第 3、4 节，不要另开文档。

---

## 1. 项目速览

| 部分 | 路径 | 说明 |
| --- | --- | --- |
| 共享类型/数据层 | `packages/core/src/` | `types.ts`(契约) / `lang.ts`(标签映射) / `db/index.ts`(查词·拆解·词源) / `db/lexicon.ts`(词根词缀表) / `db/schema.ts` / `graph.ts` |
| 数据管线 | `packages/data-pipeline/` | `build_db.py` / `build_wiktextract.py` / `build_ru_etym.py` / `roots.json` / `roots_ru.json` |
| Web 前端 | `apps/web/src/` | React18+TS+Vite，**手写 CSS**（无 UI 库）；`api.ts` 双后端(rest/electron) |
| 桌面端 | `apps/desktop/src/` | `main.mjs`(主进程+IPC) / `preload.mjs` / `updater.mjs` |
| 同步服务 | `apps/sync-server/src/index.ts` | Node http，端口 4570 |
| 词库 | `data/db/dict.db` | ~494MB，**不入 git**（.gitignore） |

**测试**：`pnpm --filter @zidiankaifa/core test` → 跑 `test/regress.mjs` + `test/lexicon.mjs` + `test/related.mjs`（需本地 `data/db/dict.db`）。

---

## 2. 铁律

1. **不要用 `git add -A`**。`data/db/` 下有数百 MB 文件，历史上曾误提交 509MB 备份。只 `git add <明确路径>`。
2. **改 `roots.json`/`roots_ru.json` 后必须重建词素表**，否则代码改动不生效：
   ```powershell
   $env:PYTHONIOENCODING='utf-8'; python packages/data-pipeline/build_db.py morphemes
   ```
   不设 `PYTHONIOENCODING` 会报 `UnicodeEncodeError: 'gbk' codec can't encode character`（**入库其实已成功**，只是打印校验时崩）。
3. **改 `packages/core` 后必须 `pnpm --filter @zidiankaifa/core build`**，且**重启 sync-server**（它读 `dist`，不热更新）。
4. **禁止 `sandbox_permissions` 升级**：本会话审批已禁用，请求会被自动拒绝。
5. **桌面端词库升级**：`apps/desktop/src/main.mjs` 的 `resolveDbPath()` 调用 `dbmigrate.mjs` 的 `ensureUserDb()` —— 用内置库 `size:mtime` 指纹与 userData 旁的 `dict.db.stamp` 比对，不一致即换库，并迁移 `book` 表（**含墓碑**），旧库改名 `.bak-<ts>` 备份。**改动这段逻辑必须跑 `pnpm --filter @zidiankaifa/desktop test`**（5 场景 22 项断言）。

---

## 3. 环境事实（勿重复试探）

**Shell / 工具**
- pwsh 引号极脆：`node -e` 内嵌 SQL/正则易报 `Expected unicode escape`。**多行代码一律写临时 `.mjs` 再 `node 文件`**。
- PowerShell 里 SQL 的 `COUNT(*)` 会被展开报错，用 `COUNT(1)`。
- 中文路径/`@` 开头目录用 `-LiteralPath` 或先 `cd`。
- `node:sqlite` 的 `DatabaseSync.prepare().all()` 返回**行对象**，不是数组。

**打包**（三件套必须同时给）
```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:electron_config_cache='D:\lzk17\Documents\zidiankaifa\.electron-cache'
$env:ELECTRON_BUILDER_CACHE='D:\lzk17\Documents\zidiankaifa\.eb-cache'
pnpm --filter @zidiankaifa/desktop build
```

**GitHub 认证 / 推送**
- `git push` 曾因 GCM 交互弹窗卡死 180s；现凭据已存入 GCM，`.git/config` 已配 `http.proxy`。
- 系统代理为 `127.0.0.1:7897`（Clash），**git 不读系统代理**，必须显式配；`gh` 需 `$env:HTTP_PROXY`/`HTTPS_PROXY`。
- 取 token：`$cred = "protocol=https`nhost=github.com`n`n" | git credential fill` → `$env:GH_TOKEN = ($cred | Select-String '^password=').Line -replace '^password=',''`。

**Electron 调试钩子**（前缀是 `ZIDIANKAFA_`，**不是** ZIDIANKAIFA_）
`ZIDIANKAFA_SHOT`(png 路径) / `ZIDIANKAFA_SHOT_WORD` / `ZIDIANKAFA_SHOT_LANG` / `ZIDIANKAFA_SHOT_DELAY` / `ZIDIANKAFA_DUMP` / `ZIDIANKAFA_DIAG`。

- ⚠️ **截图只截视口**：`capturePage` 不会截视口外的内容。**不要因为截图里某张卡片空白就判定"数据为空"** —— v0.7.1 排查中曾据此误判「词根词缀拆解」为空，实际拆解卡在词源卡**下方、视口之外**，数据完全正常。
- **正确做法**：用 `ZIDIANKAFA_DUMP` 导出 innerText，或起 `_serve_static.mjs` + sync-server 用浏览器验证（`browser_snapshot` 能拿到完整无障碍树，含视口外元素）。
- `ZIDIANKAFA_DUMP` 的面板状态不稳定（reload 后可能停在设置页），**以浏览器验证为准**。
- 用 `--user-data-dir=<目录>` 可以让 exe 使用指定的 userData，便于端到端验证换库逻辑。

**UI 验证（无需 dev server）**
```powershell
node _serve_static.mjs 5180          # 静态托管 apps/web/dist
$env:ZIDIANKAIFA_DB='D:\lzk17\Documents\zidiankaifa\data\db\dict.db'; node apps/sync-server/dist/index.js
```
`pnpm --filter @zidiankaifa/web dev` 在受限沙箱下会 `spawn EPERM`；用上面的静态方案替代。

**Playwright / 浏览器**
- 搜索框是 React 受控组件：`browser_fill` **必须先填空字符串再填值**，否则值被回滚。
- 页面有两个 `.search-input`（header + main），用 `css=.search-input >> nth=1`。

---

## 4. 防循环熔断规则 ⚠️

> 背景：本项目历史上反复出现无效循环——算法调参来回回退、工具用法反复失败重试、同一环境坑跨会话重踩、以及长上下文下的**输出自指循环**（把"该输出了"这个决策本身当成内容反复重写）。
> 以下规则是**硬性熔断**，不满足条件就停下来，而不是再试一次。

### 4.1 重试熔断
| 情形 | 上限 | 到限后必须做什么 |
| --- | --- | --- |
| 同一操作、同一方法失败 | **2 次** | 换方法（换工具/换入口/换数据源），或直接问用户 |
| 同一文件同一函数改动仍不通过断言 | **3 轮** | 停止调参。写清「假设 A/B」并做**判别实验**，而非继续微调阈值 |
| 同一环境类错误（引号/权限/端口/编码） | **1 次** | 立刻查本文件第 3 节，按既定解法执行 |

**反面教材（本项目真实发生，勿重演）**：
- `breakdownWord` 调参链：`root minLen 2→3`（未拆开 361→941，回退）→ `hasRootBefore`（俄语拆解率 61.6%→17.1%，回退）→ `insideRoot`（误杀 `учитель` 的 `-тель`，回退）→ 阈值 0.5→0.55。**连续 4 次回退**才改用「全局最优 DP + 覆盖率阈值」的正解。
- 词首 gap 规则三版：直接拒绝 → 误杀 `acknowledge`；放宽 `startsWith` → `сегодня` 假命中复现；直到第三版「前缀精确匹配 `x.stem === gap`」才成立。**应在前两版失败时就抽 5 个正例 + 5 个反例建判别集**。

### 4.2 验证回路（先小后大）
- 改拆解/查词算法 → **先用 20 词小样本秒级验证**（含正例与反例），全绿再跑全量重建（分钟级）。
- **先写断言，再改代码**。期望值先落进 `packages/core/test/*.mjs`，再改实现。
- 全量重建/打包前自问：「这一步能否先用小样本否定我的假设？」

### 4.3 输出自指循环
长上下文（>120K 新增 token）下，模型可能把"下一步该做什么"的元描述当作输出反复重写，形成数百行无意义文本。
**对策**：一轮内若已决定动作，**直接发工具调用**；不要在思考区复述"我要输出了"。发现自己在重复同一句式 → 立刻发工具调用或结束回合。

### 4.4 文档即记忆
- 任何花费 >15 分钟才搞清的环境/数据事实，**当场写进本文件或 `docs/`**，不要只留在上下文里。
- 会话结束前，把关键结论落盘。下一个会话读文档，而不是重新勘察。

---

## 5. 数据管线注意

- `word_etymology` / `morphemes` 有 `lang` 列（`'en'`/`'ru'`）；老库由 `migrateAddColumn()` 自动 `ALTER`。
- **不要在 `SCHEMA_SQL` 里给新列写 `CREATE INDEX`**：老库表已存在会跳过建表、建索引时列不存在 → 启动崩 `Error: no such column: lang`。索引单独 `try/catch` 建。
- SQLite `COLLATE NOCASE` **只折叠 ASCII**，对西里尔无效。查俄语专名（`Китай`/`Москва`）必须用 `caseVariants()` 做大小写宽容。
- 词素库现状：`morphemes` 909 条（英语 468 / 俄语 441）；`roots` 476 / `affixes` 403 为全量拆解建成的倒排表。
- 已知数据上限：俄语词源覆盖 30.8%（en/zh/ru 三转储已挖到头，需第四源）；`words_i18n` 屈折形污染已清 58,195 条。

---

## 6. 发布流程

1. 四个 `package.json` + 3 处文本（`apps/web/src/App.tsx`、`apps/web/src/components/SettingsPanel.tsx`、`apps/sync-server/src/index.ts`）统一 bump 版本。
2. `pnpm --filter @zidiankaifa/core build` && `pnpm --filter @zidiankaifa/web build`。
3. 打包（见第 3 节三件套）→ `dist-release/` 产出 exe + portable + `latest.yml` + `.blockmap`。
4. `git add <明确文件>` → commit → push → `git tag vX.Y.Z` → push tag。
5. `gh release create vX.Y.Z <4 个附件> --notes-file docs/release-vX.Y.Z.md`。
6. 更新 `docs/需求总结.md`（新增章节）与 `README.md`（功能行 + Roadmap）。

---

## 7. 已知未闭环事项

- ~~【P0】桌面端升级不换库~~ → **已修复（v0.7.1）**：`ensureUserDb()` 做指纹比对换库 + 生词本迁移，见第 2 节铁律 5。端到端复现方法：用 `--user-data-dir=<临时目录>` 启动 exe，观察是否生成 `dict.db.stamp` 与 `dict.db.bak-*`。
- 桌面端升级换库时，旧库中**时间戳早于内置库同名墓碑**的墓碑记录不会被 `syncMerge` 带入（last-write-wins），对活跃生词无影响。
- 俄语 `suggest` 已接 `lang`；中文反查建议仍可能混合（auto 模式按设计交错）。
- 词源覆盖率与屈折形反查的残余缺口见 `docs/需求总结.md` 遗留章节。
