# v0.10.0 — 生词本语言分离 ＋ 词根分类独立面板

> 发布日期：2026-09-14
> 上一个版本：v0.9.0（2026-09-13）
> 主题：把「英语生词」与「俄语生词」在**存储层、API 层、UI 层**三处彻底分开；并把「按词根归类我的生词」从生词本里独立成顶层面板。

---

## 一、这个版本修好了什么

### 1. 生词本的语言分离（此前是设计缺陷，不是「正在丢数据」）

改动前 `book` 表的主键**只有 `word`**，`lang` 只是一列普通字段。后果有四条，全部实测确认：

| # | 缺陷 | 用户可见表现 |
| --- | --- | --- |
| 1 | 同拼写的英/俄词**无法共存** | 先加 `test`（英），再加 `test`（俄）⇒ 第二条**写不进去**且无任何提示 |
| 2 | 浏览器 `localStorage` 路径同样按 `word` 去重 | 手动把英文词归到俄语本、再加同拼写英文词 ⇒ **静默丢弃** |
| 3 | `bookRemove` 未传语言 | 删一个语言会**连带删掉另一语言**（`localStorage` 路径实测） |
| 4 | `bookRemove` 写墓碑时 `?? 'en'` 回退 | 删俄语词后，墓碑的 `lang` 被写成 `'en'` |

**说明（如实披露）**：`data/db/dict.db` 实测**英俄同形词 = 0 条**，因此上述缺陷在本机现有数据上**未造成实际数据丢失**。它是**设计正确性问题**，一旦用户手动收藏同拼写词即会触发。修复方向由用户拍板为「**彻底迁移：(word, lang) 复合主键**」。

**修法**：

- `book` 表主键改为 `PRIMARY KEY (word, lang)`；新库直建新结构，老库**自动迁移**（建新表 → `INSERT SELECT` → 换名，全程 `BEGIN IMMEDIATE` 事务 + 行数守卫 `if (after < before) throw`）。
- `apps/desktop/src/main.mjs` 的 3 个 IPC（`book:add` / `book:remove` / `book:groups`）与 `apps/web/src/api.ts` 的两条存储路径**全部显式传 `lang`**。
- `bookRemove` / `bookUpdate` 不再隐式回退 `'en'`，改由新增的 `existingLangForWord(db, word)` 决定墓碑语言。
- `localStorage` 旧数据（无 `lang` 的裸数组）在**首次读取时**按 `isCyrillic(word)` 归语言并写回一次，**旧数据不丢弃**。

### 2. 生词本 UI 拆成英/俄两个子页签

- **仍只有一个「📚 生词本」入口**（没有加第 6 个面板，遵守不做清单第 1 条）。
- 面板内 🇬🇧 / 🇷🇺 子页签，**各自独立的「共 N 词」与状态筛选计数**。
- 添加框语言判定：西里尔字母**自动**归俄语，并新增**手动覆盖**下拉（自动 / 🇬🇧 英语 / 🇷🇺 俄语）。

### 3. 词根分类独立成顶层第 5 面板

- 新增 `apps/web/src/components/RootClassPanel.tsx`，顶层导航新增 **🌱 词根分类**（共 5 个面板：查词 / 生词本 / 词根词缀 / **词根分类** / 设置）。
- 面板内同样分英/俄子页签。
- **职责区分**（这是两块面板容易混淆的地方，已写进 UI 提示与代码注释）：
  - **🌱 词根词缀** = **全库**词根/词缀表（浏览词典本身收录了哪些词素）。
  - **🌱 词根分类** = **只归类「我的生词本」里的词**。生词本为空时显示**空态**，**不回退成全库词根表**。

### 4. 数据安全：迁移备份与失败呈现（测试 agent 发现，本迭代最重要的一条）

**测试 agent 的受控实验**证明：改动前那版「先复制 `dict.db` 再迁移」的备份，在 **WAL 模式**下**不是有效回退点**。

- 机制：`packages/core/src/db/schema.ts:29` 是 `PRAGMA journal_mode = WAL`，所有 `openDatabase()` 打开的库都是 WAL 库；`fs.copyFileSync(主库)` **只复制主库文件，不含 `-wal`**，而**已提交但未 checkpoint 的事务全在 `-wal` 里**。
- 决定性实验（`scripts/probe_t36_realcopy.mjs` §3b）：真实库副本写入 1 条俄语生词（`book` 3⇒4 行，`-wal` 53,592 B 未 checkpoint），随即按同构方式只复制主库 ⇒ 副本里**书 3 行、新写入的那行 0 命中**。**用户刚加的生词不在备份里。**

**修法（三轮收敛）**：

| 阶段 | 方案 | 结果 |
| --- | --- | --- |
| 原实现 | `copyFileSync(主库)` | 漏 `-wal` 已提交事务 ⇒ 不是有效回退点 |
| 中间版 | 先 `wal_checkpoint(TRUNCATE)` 再复制 | 修好原缺陷，但**自身引入降级路径**（checkpoint 返回 `busy !== 0` 就放弃迁移） |
| **本版** | **`VACUUM INTO '<db>.bak-<ISO>'`** | **单读事务、无 busy 分支**，从根上消除降级路径；备份是**一致性快照** |

配套三条：

1. **后置校验**：迁移后断言 `PRAGMA table_info(book)` 里 `word` 与 `lang` **两列 `pk > 0`**，否则**抛错**而不是静默降级。校验被放在 `openDatabase()` 出口（不是被调函数内部），因为后者会被两条 try 内的早期 `return` 绕过。
2. **有界重试**：残留的 `book_new` 表会被清除并**重试一次**；重试分支**只告警不递归**。
3. **备份复用**：同一次迁移调用内已创建并验证过的快照会被复用（打印 `复用本次迁移已创建的快照：<文件名>`），避免一次自愈落下两份 ~494 MB 的备份（≈1 GB）。

**用户可见的失败**：`apps/desktop/src/main.mjs` 在 `app.whenReady()` 里捕获 `openDatabase` 异常并弹 `dialog.showErrorBox('无法打开词库', …)` + `app.exit(1)`。此前抛错发生在 `createWindow()` 之前 ⇒ 打包版（无控制台）表现为「**双击图标没反应**」。

**为什么必须响亮失败**：若迁移被跳过，`book` 表仍是旧主键 `[word]`，此时 `bookAdd` / `bookRemove` / `bookUpdate` **4/4 全部抛** `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`，而 `bookList` / `bookListAll` **正常可用** ⇒ 那是「**能打开、列表正常、但一条也加不进去**」的静默故障。

---

## 二、量化结果

### 测试门禁

| 文件 | 断言数 | 两种 cwd |
| --- | --- | --- |
| `packages/core/test/regress.mjs` | 99 | exit 0 |
| `packages/core/test/lexicon.mjs` | 67 | exit 0 |
| `packages/core/test/related.mjs` | 38 | exit 0 |
| `packages/core/test/ru_morph.mjs` | 60 | exit 0 |
| `packages/core/test/ru_morph_d1fix.mjs` | 194 | exit 0 |
| `packages/core/test/ru_morph_d1guard.mjs` | 26 | exit 0 |
| **`packages/core/test/book_lang.mjs`（本迭代新增）** | **137** | exit 0 |
| **core 小计** | **621** | — |
| `apps/desktop/test/dbmigrate.test.mjs` | 22 | exit 0 |
| **门禁总计** | **643 通过 / 0 失败** | — |

- v0.9.0 门禁为 **506**（core 484 + desktop 22）；本迭代 **+137**，全部来自新增的 `book_lang.mjs`，**既有 506 项零回归**。
- `book_lang.mjs` 逐块：**[A] 迁移 42 · [B] 跨语言隔离 26 · [C] 同步合并键 18 · [D] 语言判定 25 · [E] 备份一致性 26**。
- 退出码语义：`0` 五块全绿 / `1` 任一块有失败。
- ⚠ `book_lang.mjs` 全程使用**临时合成库**，**不打开** `data/db/dict.db`；语言判定块因 `localStorage` 在 node 下无法执行，退化为**文本级契约断言**（已在文件内如实声明，不假装测过运行时行为）。

### UI 契约脚本

`scripts/check_v10_ui_contract.mjs`（新增，文本级契约）：**53 通过 / 0 失败 exit 0**。
⚠ 该脚本是**文本级**的，**不替代渲染验证** —— 它只能证明契约字符串在位，不能证明界面渲染正确。

### UI 冒烟（主管在浏览器实跑，非自动化）

用 `node _serve_static.mjs 5180` 静态托管 `apps/web/dist` + sync-server 提供 REST 后端，逐项人工核对：

| 检查项 | 实测 |
| --- | --- |
| 顶层面板数 | ✅ 5 个：`🔍 查词` / `📚 生词本` / `🌱 词根词缀` / **`🌱 词根分类`** / `⚙️ 设置` |
| 页脚版本 | ✅ `我的电子辞典 v0.10.0` |
| 英/俄子页签 + 独立计数 | ✅ 加 `test` ⇒ 英语**共 1 词**；加 `тест` ⇒ 俄语**共 1 词**；切回英语**仍共 1 词**（只有 `test`） |
| 删除的跨语言隔离 | ✅ 删俄语 `тест` ⇒ 俄语归 0，英语 `test` **仍共 1 词** |
| 语言判定 + 手动覆盖 | ✅ 西里尔自动判 ru；手动选 🇷🇺 加英文 `hello` ⇒ 落入**俄语**列表，覆盖生效 |
| 🌱 词根分类面板 | ✅ 英/俄子页签；英语侧 `生词 1 词 · 归入 1 个词素`，`test` → 词根「见证；证明」+ 例词 `testify/testimony/protest/contest/attest/detest`；含职责区分提示 |
| 空态 | ✅ 俄语侧 `生词 0 词 · 归入 0 个词素` → 显示引导文案，**未回退成全库词根表** |

### 构建与发布件

| 项 | 值 |
| --- | --- |
| 版本 | 0.9.0 → **0.10.0**（4 个 `package.json` + 3 处文本） |
| `pnpm --filter @zidiankaifa/core build` | exit 0 |
| `pnpm --filter @zidiankaifa/web build` | exit 0（vite 6.4.3，`dist/assets/index-DyGj5chj.js` 199.55 kB） |
| `pnpm --filter @zidiankaifa/sync-server build` | exit 0（dist 内嵌 `version: '0.10.0'`） |
| `pnpm --filter @zidiankaifa/desktop build` | exit 0（electron-builder 26.15.3 / electron 37.10.3） |
| web dist 内嵌版本 | ✅ `我的电子辞典 v0.10.0` ⇒ **v0.9.0 遗留项 B-1 闭环** |
| sync-server `/health` | ✅ `{"ok":true,"words":770611,"sync":"zidiankaifa-sync-server","version":"0.10.0"}` |

---

## 三、安装包

| 文件 | 大小 |
| --- | --- |
| `zidiankaifa-0.10.0-x64.exe`（NSIS 安装版） | 175,041,867 B |
| `zidiankaifa-portable-0.10.0-x64.exe`（免安装） | 174,812,071 B |
| `zidiankaifa-0.10.0-x64.exe.blockmap` | 182,886 B |
| `latest.yml` | `version: 0.10.0`，`sha512: bgB2C42h81qsnJTJUHcaqaJ2cVOn4fRI5NML3KGwI9H9Agwhki5YCg/A2ElbzIXyB29R6E5UeHQOjaac5cfjkQ==` |

> 词库 `data/db/dict.db`（约 494 MB）**不随仓库分发**。桌面端首次启动会由 `ensureUserDb()` 按 `size:mtime` 指纹从内置库铺到 userData，指纹不一致即换库并迁移 `book` 表。

---

## 四、已知代价与豁免（如实披露）

### 1. 迁移备份的**残留边界**：反复失败会累积整库大小的 `.bak`

- 修复了「同一**次**迁移调用内落两份」⇒ 实测**恰 1 份**。
- **仍存在（T52 实测澄清）**：`openDatabase()` 每次调用都传入**新的** `{ bak: null }` 状态 ⇒ 复用**只在同一次调用内**生效，**跨启动不复用**。因此若迁移**每次启动都失败**，每次仍会新建一份 ~494 MB 的快照 —— 实测连续 3 次 `openDatabase` ⇒ 备份数 **`[1,2,3]`**，且**没有清理机制**。
- 这是**有意取舍** —— 备份是数据安全的最后一道防线，宁可占磁盘也不删。建议失败时人工排查后手动删除 `.bak-*`。
- **另有两条登记项**（非本版引入，测试 agent 的观察项，判定权在主管）：
  1. ~~「备份失败」路径会绕过 T45 后置校验。~~ **【订正 2026-09-14 · 已实测证伪】** 该表述是 **T48 之前**的事实：T48 已把后置校验上移到 `openDatabase()` 出口（`packages/core/src/db/index.ts:144` 调用 `assertBookCompositeOrThrow`），**覆盖所有返回路径**（含 `:244` / `:279` 两条早期 `return`）。**实测**（`scripts/probe_sup_t48_assert_coverage.mjs`，冻结时钟 + 在确切备份名上占位目录以确定性触发「备份失败」）：**7 通过 / 0 失败** —— 该路径**抛错** `book 表未能迁移到 (word, lang) 复合主键（当前主键列 = ["word"]）…`，且判别力守卫（无干扰时同一夹具不抛错且迁移成功、主键为复合）通过。**故本条不再是缺陷。**
  2. 备份文件会在库目录旁生成 SQLite 的 `-wal` / `-shm` sidecar，**计数类断言须精确匹配文件名全形**（用 `startsWith` 会把 sidecar 算成备份）。

### 2. `book` 表中 `lang='ru'` 却含拉丁字母的 8 条记录 —— **登记，不处理**

`b-кварк` / `c-moll'ный` / `c-кварк` / `d-кварк` / `s-кварк` / `t-кварк` / `u-кварк` / `имя прилaгaтeльнoe`。

- 前 7 条是含拉丁前缀的物理术语写法，**属词库既有数据**；第 8 条是**字符集损坏行**（「имя прилагательное」混入了拉丁 `a`/`e`）。
- 这 8 条在 **`words_i18n`**（词库）而非 `book`（生词本）中，本次迁移**只读写 `book` 表**，实测 `words_i18n(ru)` 159,127 行与含拉丁 62 行**一字节未动**。
- 按不做清单第 2 条**仅登记，不再修**。

### 3. 缺省 `lang` 的删除语义仍是「任意性」的（向后兼容保留）

`bookRemove(db, word)` **不传语言**时，由 `existingLangForWord()` 按 `ORDER BY deleted ASC, updated_at DESC LIMIT 1` 挑一条 —— **不按语言**。因此同词双语言并存时，删掉的是「较新的那条」，**哪条不可预期**。

- 本版**所有 UI / IPC 调用点都已显式传 `lang`**，正常使用不会走到这条路径。
- 保留缺省行为是为了**向后兼容**（旧桌面端 / 旧同步端调用不带 `lang`）。
- 调用点覆盖由 `scripts/check_v10_ui_contract.mjs` 机械把关（例外须脚本内书面登记 + 主管裁定，不得口头豁免）。

### 4. ✅ 桌面端 SQLite 路径已做端到端冒烟（本版完成）

**两条独立路径都已实测**：

| 路径 | 方式 | 结果 |
| --- | --- | --- |
| 浏览器 + sync-server（REST） | `_serve_static.mjs 5180` + `apps/sync-server/dist/index.js` | ✅ 见「二、UI 冒烟」7 项 |
| **桌面端（Electron 主进程 + `book:*` IPC + 真实 SQLite 库）** | `electron.exe apps/desktop --user-data-dir=<临时目录>`，用**库副本**（不碰生产 profile 与冻结库） | ✅ 见下 |

桌面端两次冒烟：

1. **常规启动**（复合主键库副本）：`dict.db opened, 770611 words` · `app version 0.10.0` · 导出文本含 **5 个顶层面板**（查词 / 生词本 / 词根词缀 / **词根分类** / 设置）· 页脚 `我的电子辞典 v0.10.0` · 🌱 词根分类面板的**空态**正确显示引导文案而非全库表 · `exit 0`。
2. **真实老结构库迁移**（`data/db/dict.db.bak-v02pipe`，272,752,640 B，`book` 主键只有 `["word"]`）：

   | 核验项 | 实测 |
   | --- | --- |
   | 迁移前 → 后主键 | `["word"]` → **`["word","lang"]`**（两列 `pk>0`）✅ |
   | 数据保真 | 3 行**逐行逐字段相等**（`word/lang/deleted/updated_at`）、墓碑 3 → **3** ✅ |
   | 词库侧零改动 | `words_i18n(ru)` **159,127 → 159,127** ✅ |
   | 迁移前快照 | 生成 **1 份** `old.db.bak-2026-09-13T17-50-21-071Z`（`VACUUM INTO`，259,026,944 B）✅ |
   | 进程退出码 | **0** ✅ |

   ⚠ 该次运行另报 `Error: no such table: roots`（`relatedByMorpheme` 调用 `dict:related` 时）。**这不是迁移缺陷** —— 实测表集合对比确认：该老库**本来就没有** `roots` / `affixes` 表（它们由 `build_roots_tables.mjs` 生成，是更晚的产物），生产冻结库则有。属**老库特性**，已在 `.board/EVIDENCE.md` 记档。

### 5. `roots_ru.json` 四条 `origin` 的联网复核结果**尚未落库**

v0.9.0 落库的 9 条词素中，有 4 条的来源字段被独立联网复核发现需要订正（`домин-` 抄录不符 + 语源主张未在引用页核到 · `пад-` 的 `*pasti` 应为 `*padati` · `-ной` 应引 `боль|-н|+ой` · `однако-` 需区分共时/历时）。**均不撤词素**，属来源字段（`origin`）的元数据订正，**本版未动**，已在需求台账挂账。

### 6. `lookupWord` 第二处 `inBook` 内联查询仍硬编码 `lang = 'en'`（潜在缺陷，v0.10.0 未修）

`packages/core/src/db/index.ts` 有两处 `inBook` 内联 SQL：

- **`:764`**（`lookupI18n` 路径）：`WHERE word = ? AND lang = ? AND deleted = 0` —— **正确**，随入参语言判定。
- **`:823`**（`lookupWord` 的英语主路径）：`WHERE word = ? AND lang = 'en' AND deleted = 0` —— **仍硬编码**。

**可达性判定（已读码确认）**：`lookupWord` 在 `:780`（`lang === 'ru'` 强制俄语）与 `:788-791`（西里尔输入 auto）**两条俄语入口都会提前 `return lookupI18n(...)`** ⇒ 俄语词**不会**走到 `:823`。因此这是**潜在不一致**（若未来有词条同时存在于英语 `words` 表与俄语 `words_i18n`，或新增俄语入口），**不是当前活跃缺陷**。

已登记为 **v0.11.0 正确性候选**（与 v0.10.0 修掉的跨语言「★ 已收藏」误报同族）。

### 7. AC-2 仍为 🟡

v0.9.0 的 `термостат` 留红项（H-d 四件证据）**未出** ⇒ **不得宣称「30 条全清」**。

---

## 五、这个版本**没有**做什么（范围纪律）

按需求侧「不做清单 10 条」执行，逐条确认：

1. ❌ 不加第 6 个顶层面板，不把词根分类并进 `/lexicon`。
2. ❌ 不处理 `lang='ru'` 含拉丁的 8 条（仅登记，见上）。
3. ❌ **不改 `sync-server` 协议**（路由、payload 字段序列、`BookItem` 字段集均未变；同步合并键改为 `(word, lang)` 属服务端已有行为，无需协议变更）。
4. ❌ 不从 `words_i18n` 反推入参语言（`book` 段无 `words_i18n` 查询）。
5. ❌ 不改 `breakdownWord` / 阈值 / 位置规则（拆解算法**一行未动**）。
6. ❌ 不改 `groupBookByMorphemeData` 的归类算法。
7. ❌ 不动既有 6 个 core 测试文件的断言期望值。
8. ❌ 不做同形词去重 / 警告 UI（实测同形词 = 0）。
9. ❌ 不加新索引，不把新列索引写进 `SCHEMA_SQL`（`.gitattributes` 之外无 schema 变更）。
10. ❌ 不做 B2 背单词 / B3 APK。

---

## 六、下一迭代方向（v0.11.0 候选，按优先级）

### A 正确性

1. **`а-`（alpha privative）前缀缺失** —— 唯一能同时消 gap 并降低空洞数的前缀，会牵动 `стат-` 相关切分。
2. **`lookupWord` 的 `inBook` 硬编码 `lang = 'en'`**（`packages/core/src/db/index.ts:823`）—— 见四.6，潜在不一致。
3. **D2 通用空洞上限** —— 「词中空洞无上限」的通用机制（`землетрясение` 跳过 `ряс` 型）。
4. **假词根全库普查** —— 库内词根自身含语义错误（`каз-` / `дом-` / `дн-` 被当假词根不是算法问题，是**词素库的语义维护问题**）。
5. **`термостат` 取舍** —— 与 `-ной` 的交互（加了会吃掉真前缀 `термо-`）。
6. **`да-` 假族 26 词** —— 逐词核证有硬证据，但消除会误伤真族 10 词，需新机制。

### B 工程债

1. **`roots_ru.json` 四条 `origin` 订正**（见四.5）。
3. **`book_lang.mjs` 清理分支 `EPERM`** —— 全绿后才走到的临时目录清理会报错，且有遗留 `run-*` 目录。
4. **跨启动备份累积 `[1,2,3]`** —— 见四.1（有意取舍，但需要失败时的人工介入指引）。
5. 倒排表与 `morphemes` 的系统差额（设计使然，但需在文档中保持口径一致）。
6. 全库扫描耗时（单次 ~12–19 s，门禁总时长受其影响）。
7. `scripts/_tmp/` 清理。

### C 覆盖率

**不设目标值**（v0.9.0 已取消 45% 目标，见 `.board/DECISIONS.md` 的 `DEC-017`）。当前尺子 R = **241/791 = 30.47%**，为诚实值。

---

## 七、数据来源与可复核性

- **需求**：`.board/REQ.md` §8（`REQ-V10-001`，AC-12…AC-19 + DoD D13–D22）
- **决策**：`.board/DECISIONS.md`（`DEC-021` 架构拍板 · `DEC-022` 临时脚本不得作证据源 · `DEC-023` 行号纪律 · `DEC-024` 缺省语言语义＋并行迭代纪律 · `DEC-025` 备份语义改为「一致性快照」 · `DEC-026` 改 `VACUUM INTO` ＋ 后置校验与有界重试）
- **证据**：`.board/EVIDENCE.md`（测试 agent 独占，§44 / §45 / §46–§50 逐轮证据链）
- **执行记录**：`.board/TASKS.md`（T35–T52 逐单 + 裁决十九/二十/二十一）
- **独立验证**：`packages/core/test/book_lang.mjs`（测试 agent 编写，非开发 agent 自证）
- **复现入口**：
  ```powershell
  pnpm --filter @zidiankaifa/core test        # core 621/0
  pnpm --filter @zidiankaifa/desktop test     # desktop 22/0
  node packages/core/test/book_lang.mjs       # 单跑新增隔离测试（两种 cwd 均应 exit 0）
  node scripts/check_v10_ui_contract.mjs      # UI 文本级契约 53/0
  ```

> ⚠ **独立验证的边界**：`book_lang.mjs` 的块 B–D 验证的是**存储层与 API 层**；**UI 渲染层**只有一次人工冒烟（见二）与文本级契约脚本，**没有自动化端到端 UI 测试**。这一点不应被后续文档转述为「UI 已被自动化覆盖」。
