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

**测试**：`pnpm --filter @zidiankaifa/core test` → 跑 `test/regress.mjs`(99) + `test/lexicon.mjs`(67) + `test/related.mjs`(38) + `test/ru_morph.mjs`(60) + `test/ru_morph_d1fix.mjs`(194) + `test/ru_morph_d1guard.mjs`(26)（需本地 `data/db/dict.db`）→ **core 484 / 0**；`apps/desktop/test/dbmigrate.test.mjs`(22) ⇒ **门禁 506 通过 / 0 失败**（v0.9.0 后）。
⚠ **断言计数陷阱**：`ru_morph.mjs` 打印「回归护栏（…）：60 通过 / 0 失败」，**无「结果：」前缀**，用 `Select-String '结果：'` 会漏掉这 60 条。
`ru_morph_defects.mjs`（缺陷台账，**留红即待办**；v0.9.0 后 **55 通过 / 1 失败** exit 1，唯一余红 = `термостат`）、`ru_morph_goals.mjs`（迭代目标，0/2 exit 2）、`ru_morph_semantic.mjs`（语义判别集，v0.9.0 后 **44 通过 / 1 失败，回归项 0**）**均不接入** `pnpm test`，手动跑。
⚠ `lexicon.mjs:122-141` 的 4 条统计断言是**冻结快照**，随倒排表重建而变，须在每次落库迭代后同步（口径注释已写在断言上方）。

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
6. **测试文件的词库路径必须与 cwd 无关**，且必须支持 `ZIDIANKAIFA_DB` 覆盖：
   ```js
   // 正确（与 ru_morph.mjs:39 一致）—— __dirname 经 fileURLToPath 得到
   const dbPath = process.env.ZIDIANKAIFA_DB ?? path.resolve(__dirname, '..', '..', '..', 'data', 'db', 'dict.db');
   ```
   ⚠ **`pnpm --filter <pkg> test` 的 cwd 是包目录，不是仓库根**（实测：
   `pnpm --filter @zidiankaifa/core exec node -e "console.log(process.cwd())"` → `...\packages\core`）。
   写成 `new DatabaseSync('data/db/dict.db')` 会在 `pnpm test` 下崩 `Error: unable to open database file`
   （`errcode: 14`），而**从仓库根直接 `node` 跑却完全正常** ⇒ 假绿。
   **凡新增/改动测试文件，必须两种 cwd 各跑一次**：
   ```powershell
   cd D:\lzk17\Documents\zidiankaifa;               node packages/core/test/<f>.mjs
   cd D:\lzk17\Documents\zidiankaifa\packages\core; node test/<f>.mjs
   ```
   两者都必须 exit 0。
7. **测试断言口径必须写明**（本项目已因口径混淆产生多轮互指错误）：
   - 尺子有三把，分母不同**不可互比**：**R**（`related.mjs:144`，`rowid % 97 = 0` → 791 词）、A（全库俄语 101,512）、B（有词源俄语 31,193 取样 800）；
   - 「空洞」有两口径：**总数**（未覆盖字符总数 ≥3 = **134**，**L4 权威口径**）vs **最大单段**（≥3 = 129）；
   - D1 规模引用**全库口径 342**（75 保留 + 267 消除）。
   引用任何指标**必须带口径**，否则视为无效数字。

---

## 3. 环境事实（勿重复试探）

**Shell / 工具**
- pwsh 引号极脆：`node -e` 内嵌 SQL/正则易报 `Expected unicode escape`。**多行代码一律写临时 `.mjs` 再 `node 文件`**。
- PowerShell 里 SQL 的 `COUNT(*)` 会被展开报错，用 `COUNT(1)`。
- 中文路径/`@` 开头目录用 `-LiteralPath` 或先 `cd`。
- `node:sqlite` 的 `DatabaseSync.prepare().all()` 返回**行对象**，不是数组。
- ⚠ **`Measure-Object -Line` 不数空行**（本项目已第二次踩同类计数陷阱，第一次是漏数无「结果：」前缀的断言块）：
  `.board/EVIDENCE.md` 被它数成 **1072** 行，真值 **1429** 行。**行数一律用换行符计数**：
  ```powershell
  $raw = [System.IO.File]::ReadAllText('<file>')
  ($raw.ToCharArray() | Where-Object { $_ -eq [char]10 }).Count
  ```
  （`Get-Content -Raw` + `-split "\`n"` 里的反引号会中断 pwsh 解析，**勿用**。）

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

**⚠ `pnpm --filter @zidiankaifa/web build` 与 `desktop build` 在受限沙箱下会被阻塞 —— 但策略放宽后可用（v0.9.0 实测修正）**
- **受限沙箱（workspace-write）下确实无法完成**：沙箱禁止带**管道 stdio** 的 spawn（`spawn EPERM`），
  而 **esbuild 必须用管道与后端进程 IPC**（`esbuild/lib/main.js:1978` 的 `stdio: ["pipe","pipe","inherit"]`）。
  `vite build` **三个环节**都要 esbuild：① 配置文件打包（`bundleConfigFile`）；② `commonjs--resolver` 的 realpath 探测（会 `exec("net use")`）；③ `vite:build-html` 转译 `index.html`。
  判别实验确证：`stdio:'inherit'|'ignore'` 的 spawn **可以**成功，**只有管道 stdio 被禁**；esbuild 包内无 wasm 变体，
  且 vite 用**命名导入**取 `exec`（ESM 活绑定只读）⇒ **沙箱内无法 monkey-patch**。
- **★ 修正（v0.9.0）**：文件策略放宽到 **`danger-full-access`** 后，**两条命令均一次通过**：
  `web build` exit 0（vite 6.4.3，1.18 s）· `desktop build` exit 0（electron-builder 26.15.3 产出 NSIS 安装包 + portable + blockmap + `latest.yml`）。
  ⇒ 该阻塞**是文件策略所致，不是命令本身的缺陷**。遇到时先确认当前 DSH 文件策略（`workspace-write` = 受阻塞；`danger-full-access` = 可跑），
  **不要**据旧结论直接让用户代跑。
- 打包（`desktop build`）必须给三件套环境变量（见上「打包」节）。
（`scripts/build_web_nospawn.mjs` 是沙箱阻塞期写的内联配置绕行脚本，能过配置阶段但会卡在 `vite:build-html`，保留作诊断用。）

**⚠ goal（长期目标）工具的边界（已实测，勿重复试探）**
- `update_goal` 的 `edit` / `pause` / `resume` **只允许在人类回合（direct human turn）执行**；
  在目标轮（goal_round）内调用报 `Error: this goal operation requires a direct human turn on a top-level agent`。
- **经 `ask_user_question` 获得的用户选项答复不算人类回合**——试过，同样被拒。
- ⇒ 需要改 goal 口径时，**让用户亲自发一条普通消息**，不要重试工具调用。
- `complete` / `blocked` 在自动续跑轮内是允许的；`blocked` 另要求同一阻塞条件持续 ≥3 轮。

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
- 词素库现状（v0.9.0 后）：`morphemes` **918** 条（英语 468 / 俄语 **450**）；倒排表 `roots` **492**（en 321 / ru 171）、`affixes` **416**（en 138 / ru 278）。
  ⚠ 倒排表由 `packages/data-pipeline/build_roots_tables.mjs` 生成，**只收「有真实关联词」的词素** ⇒ 条数天然少于 `morphemes`（当前缺 ru prefix 1 条 `о-`、en root 9 条，后者含 `ment`/`un-`/`auto-` 等）。**这是设计使然，非缺陷**；`lexicon.mjs:122-141` 的 4 条统计快照与之对应，重建倒排表后必须同步。
- 已知数据上限：俄语词源覆盖 30.8%（en/zh/ru 三转储已挖到头，需第四源）；`words_i18n` 屈折形污染已清 58,195 条。

---

## 6. 发布流程

1. 四个 `package.json` + 3 处文本（`apps/web/src/App.tsx`、`apps/web/src/components/SettingsPanel.tsx`、`apps/sync-server/src/index.ts`）统一 bump 版本。
2. **三个 build 都要跑**：core（`dist`）+ web（`apps/web/dist`，桌面端打包会内嵌它）+ **sync-server**。
   ```powershell
   pnpm --filter @zidiankaifa/core build
   pnpm --filter @zidiankaifa/web build
   pnpm --filter @zidiankaifa/sync-server build   # ← v0.7.1 漏跑过，导致 /health 仍返回旧版本号
   ```
3. 跑测试（core 5 个文件 + desktop）。
4. 打包（见第 3 节三件套）→ `dist-release/` 产出 exe + portable + `latest.yml` + `.blockmap`。
5. `git add <明确文件>`（**禁用 `git add -A`**）→ commit → push → `git tag vX.Y.Z` → push tag。
6. `gh release create vX.Y.Z <4 个附件> --notes-file docs/release-vX.Y.Z.md`。
7. 更新 `docs/需求总结.md`（新增章节）与 `README.md`（功能行 + Roadmap）。

---

## 7. 已知未闭环事项

- ~~【P0】桌面端升级不换库~~ → **已修复（v0.7.1）**：`ensureUserDb()` 做指纹比对换库 + 生词本迁移，见第 2 节铁律 5。端到端复现方法：用 `--user-data-dir=<临时目录>` 启动 exe，观察是否生成 `dict.db.stamp` 与 `dict.db.bak-*`。
- 桌面端升级换库时，旧库中**时间戳早于内置库同名墓碑**的墓碑记录不会被 `syncMerge` 带入（last-write-wins），对活跃生词无影响。
- 俄语 `suggest` 已接 `lang`；中文反查建议仍可能混合（auto 模式按设计交错）。
- 词源覆盖率与屈折形反查的残余缺口见 `docs/需求总结.md` 遗留章节。
