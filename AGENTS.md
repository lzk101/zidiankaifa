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
| **手机端**（v0.11.0 新增） | `apps/mobile/` | **Capacitor 8.5.2** 真 App；`capacitor.config.json`（`webDir` = `../web/dist`）＋ `android/` 原生工程；包名 `com.lzk101.zidiankaifa` |
| 词库 | `data/db/dict.db` | ~494MB（**518,242,304 B**），**不入 git**（.gitignore）· 冻结库，`BASELINE.md` 有指纹 |

📁 **逐目录性质 / 写权限 / `scripts/` 的文件分类 / 产物与缓存处置 / 命名与结构约定 ⇒ 见根目录 `PROJECT_STRUCTURE.md`（结构主文档）。** 本文件只管环境事实与规范，结构指针以那份为准。
⚠ **引用任何计数必须带时点**（commit SHA 或「本迭代」）。本文档曾把 `scripts/` 写成 **133** —— 实际已随 T62 清理降至 **99**，v0.11.0 期间因新探针回升至 **111**。这正是本项目反复发生的**计数陷阱**：**不改总数就写成「N 个文件」**。**现测（v0.11.0 迭代内，`e20f512` 之后）：已跟踪合计 288 / 300 · `scripts/` 111 / 165 · `docs/` 13。**

🧹 **结构治理（每迭代必做）**：本项目有**第 4 个常驻 agent = 项目结构管理 agent**（委任书 `.board/roles/structure-agent.md`），**每次版本发布 + push 之后**做一次结构体检与清理。
- **额度**（冻结于 `.board/BASELINE.md` §7）：已跟踪文件 ≤ **300** · `scripts/` ≤ **165** · `scripts/` 顶层 ≤ **35** · `dist-release/` ≤ **1.5 GB** · `data/` ≤ **4.5 GB**（只报不删）· 缓存合计 ≤ **1.2 GB** · 临时残留 **0** · 单文件 ≤ **20 MB**
- **台账**：`.board/STRUCTURE.md`（结构台账）· **`.board/agents.md`（agent 登记册：受保护名单恒 4 个 · 临时 agent 回收判定）**（均只有该 agent 写）
- **权限一句话**：**能删产物，不能删代码；能出方案，不能改架构；能登记 agent，不能唤醒 agent。** 保护清单 —— `data/**` 整棵树 + 全部已跟踪文件，**只报不删**；`data/raw/` 2.93 GB 是词库重建原料，**不要因体积大就当成垃圾**
- ⚠ **agent 层无「删除」API**：只有 `list_agents`（只读）/ `interrupt_agent`（停当前一轮）/ `send_message`（**= 唤醒**，反清理）。⇒「清理临时 agent」= 台账化 + 标记可回收 + 报主管止损。**`ready` ≠ 已死，随手重派会产出与既有结论冲突的第二版。**

**测试**：`pnpm --filter @zidiankaifa/core test` → 跑 `test/regress.mjs`(99) + `test/lexicon.mjs`(67) + `test/related.mjs`(38) + `test/ru_morph.mjs`(60) + `test/ru_morph_d1fix.mjs`(194) + `test/ru_morph_d1guard.mjs`(26) + `test/book_lang.mjs`(**142**)（需本地 `data/db/dict.db`）→ **core 626 / 0**；`apps/desktop/test/dbmigrate.test.mjs`(22) ⇒ **门禁 648 通过 / 0 失败**（v0.11.0 AC-27 后）。
⚠ **构成式变更（2026-09-20 实测）**：`book_lang.mjs` **137 → 142**（AC-27 把 `book` 主键由 `(word,lang)` 升为 `(user_id,word,lang)`，测试 agent 更新了 12 条旧主键断言并净增 5 条）⇒ 旧式 **`621 = 99+67+38+60+194+26+137` 已作废**，新式 **`626 = 99+67+38+60+194+26+142`**，门禁合计 **648 = 626 + 22**。
⚠ **`book_lang.mjs` 不读 `data/db/dict.db`**（全程临时合成库），测的是 `packages/core/dist/` 构建产物 ⇒ **改 `packages/core/src/db/**` 后必须先 `pnpm --filter @zidiankaifa/core build`**，否则测的是旧实现（铁律 3）。
⚠ **旧口径 506 = core 484 + desktop 22**，而 core 484 = 99+67+38+**60**+194+26 —— 旧账本一度**漏了 `ru_morph.mjs` 的 60**，系本项目第 5 次同类计数陷阱。
⚠ **断言计数陷阱**：`ru_morph.mjs` 打印「回归护栏（…）：60 通过 / 0 失败」，**无「结果：」前缀**，用 `Select-String '结果：'` 会漏掉这 60 条。
`ru_morph_defects.mjs`（缺陷台账，**留红即待办**；v0.9.0 后 **55 通过 / 1 失败** exit 1，唯一余红 = `термостат`）、`ru_morph_goals.mjs`（迭代目标，0/2 exit 2）、`ru_morph_semantic.mjs`（语义判别集，v0.9.0 后 **44 通过 / 1 失败，回归项 0**）**均不接入** `pnpm test`，手动跑。
⚠ `lexicon.mjs:122-141` 的 4 条统计断言是**冻结快照**，随倒排表重建而变，须在每次落库迭代后同步（口径注释已写在断言上方）。

⚠️🔴 **打开 `data/db/dict.db` 只读必须用 `new DatabaseSync(path, { readOnly: true })`，严禁 `openDatabase(path)`**（v0.11.0 实测事故，2026-09-20）：
- **`openDatabase()` 会跑 `book` 迁移**（`migrateBookLang` → `migrateBookUserId` → `migrateBookCompositeKey` → 后置校验），而迁移**开始前先落一份 `VACUUM INTO` 整库快照**。
- ⇒ 测试文件若用它打开冻结词库，**每跑一次门禁就写一次冻结词库，并多出一个 ~493 MB 的 `dict.db.bak-<ISO>`** —— 实测 `data/db/` 因此膨胀到 **1.700 GiB**（**无界增长**），且**直接违反 `data/**` 属保护清单「只报不删」的冻结语义**。
- 已修三处：`packages/core/test/lexicon.mjs:11` · `packages/core/test/related.mjs:25` · `packages/core/test/ru_morph.mjs:43`（三文件实测 `bookAdd`/`bookRemove`/`bookUpdate`/`db.exec`/`.run(` **各 0 次**，纯读取断言 ⇒ 只读完全够用）。修后 `dict.db.bak-*` 份数 **0 → 0 不新增**、`dict.db-wal` **0 B**、`dict.db` size/mtime 与基线**逐位一致**，而门禁仍 **648/0 exit 0**。
- 既有正确范例：`packages/core/test/regress.mjs:13` · `ru_morph_d1fix.mjs:42` · `ru_morph_d1guard.mjs:403` **一直**用 `readOnly: true`。
- ⚠ **未修（不在 `pnpm test` 链内 ⇒ 不阻塞门禁，但手动跑仍会写库）**：`packages/core/test/ru_morph_defects.mjs:43` · `ru_morph_goals.mjs:32` · `ru_morph_v090_guard.mjs:36`；`scripts/probe_ru_coverage.mjs:24` · `scripts/exp_v9_admission.mjs:26` · `scripts/exp_ru_ceiling.mjs:30` · `scripts/probe_t32_noi_claims.mjs:14`；`packages/data-pipeline/build_roots_tables.mjs:21` 更是**设计上就要写库**（词库重建工具）⇒ **必须在副本上跑**。

⚠️ **冻结库的「已迁移形态」不可作为基线**（v0.11.0 实测）：
- v0.10.0 与 v0.11.0 **两次 `book` 迁移都只存在于 WAL 里**，主文件一直是**最初**的词库 —— 删掉 `-wal` 后实测 `book` 主键 = **`["word"]`（单列）**、`lang` 在末位。
- **判断冻结库是否被污染须三项并查，缺一不可**：① `size` + `mtime` ② **`-wal` / `-shm` 是否存在及其大小** ③ **主文件字节里是否有迁移痕迹**（如 `idx_book_user_updated` / `book_new` / `PRIMARY KEY (user_id`）。
  ⛔ 只看 size/mtime **会漏判**：主文件未被写、改动全在 WAL 时，size/mtime 与基线完全一致。
- **恢复手法（已验证）**：**删除 `-wal` / `-shm` 即回到逐字节原状** —— 主文件本身就是最后一个 checkpoint。恢复后须复核 `PRAGMA integrity_check = ok` 与基准表行数（`words` 770611 · `words_i18n`(ru) 101512 · `morphemes` 918 · `roots` 492 · `affixes` 416）。

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

**Android / Capacitor 手机端构建（v0.11.0 实测；工具链已装，勿重新勘察）**
- **工具链落点 = 仓库根 `.android-toolchain/`（已入 `.gitignore`，绝不入 git）**，**不在系统 PATH** ⇒ 每次构建都必须显式设四个环境变量：
  ```powershell
  $base = 'D:\lzk17\Documents\zidiankaifa\.android-toolchain'
  $env:JAVA_HOME        = "$base\jdk\jdk-21.0.12.1+1"   # ★ 必须 JDK 21
  $env:ANDROID_HOME     = "$base\sdk"
  $env:ANDROID_SDK_ROOT = "$base\sdk"
  $env:GRADLE_USER_HOME = "$base\gradle"                # 隔离，避免污染用户 ~/.gradle
  ```
- **★ 三条硬版本事实（都踩过）**：
  1. **Capacitor 8 要求 JDK 21，不是 17**。用 17 会在 `:capacitor-android:compileDebugJavaWithJavac` 报 **`无效的源发行版：21`** —— 根因是 `@capacitor/android/capacitor/build.gradle` **写死** `JavaVersion.VERSION_21`。备选方案（未采用）= 降到 Capacitor 7.6.9 配 JDK 17。
  2. **Gradle 不读系统代理**。`:7897`（Clash）必须写进 `.android-toolchain/gradle/gradle.properties` 的 `systemProp.http(s).proxyHost` / `Port`，否则 `google()` / `mavenCentral()` 全超时。
  3. **`uiautomator dump` 拿不到 WebView 内容**（实测 dump 仅 2,524 B、6 个原生节点，WebView 是不透明节点）⇒ 手机端 UI 验证**必须走截图或 CDP**，不能靠无障碍树。
- **构建三步**（顺序不可换）：
  ```powershell
  pnpm --filter @zidiankaifa/web build            # ① 产出 apps/web/dist
  pnpm --filter @zidiankaifa/mobile sync          # ② cap sync：拷 web 资源 → android/app/src/main/assets/public
  cd apps\mobile\android; .\gradlew.bat assembleDebug   # ③ 需上面四个环境变量
  ```
  **APK 产物 = `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`**（实测约 4.27 MB）。
- ⚠ **`cap add` / `cap sync` 会把 `apps/web/dist` 拷进 `android/app/src/main/assets/public`**，而 `apps/mobile/android/.gitignore:96` **有意排除**该目录（Capacitor 官方注释 "Copied web assets"）⇒ **web 资源不入 git，由 `cap sync` 在构建时注入**。⇒ 干净 clone 后**必须先跑 ①②**，否则 Gradle 打出的 APK 是空壳。
- **`pnpm install` 在本仓有两个坑**：无 TTY 时须 `CI=true`（否则 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）；改依赖后须 `--no-frozen-lockfile`（否则 `ERR_PNPM_OUTDATED_LOCKFILE`）。
- **模拟器**：AVD 名 **`zdk35`**（Pixel 6 / Android 15 / `google_apis;x86_64`）；`ANDROID_AVD_HOME` 指向 `.android-toolchain/avd`。冷启动约 1 分钟到 `sys.boot_completed=1`。模拟器访问宿主机用固定别名 **`10.0.2.2`**。
- **★ 手机端页面级验证通道 = Chrome DevTools Protocol**（`capacitor.config.json` 开了 `webContentsDebuggingEnabled: true`）：
  ```powershell
  adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>   # ⚠ socket 名去掉前导 @
  ```
  ⚠ **`localabstract:` 后不能带 `@`** —— 拼成 `@webview_devtools_remote_<pid>` 时 **`adb forward` 会回显成功（假绿）但连不上**，表现为 `curl exit 52` / `UND_ERR_SOCKET`。然后走 CDP `Runtime.evaluate`（`awaitPromise: true` + `returnByValue: true`）**在真实页面内执行 JS**。应用每次重启 `webview_devtools_remote_<pid>` 的 pid 都会变 ⇒ **每次都要重取 socket 重做 forward**，且 forward 建立后 HTTP 端点**非立即可用**，须轮询重试。
- **Android 9+ 默认禁明文 HTTP**，而 WebView 页源是 `https://localhost` ⇒ 向 `http://` 请求叠加 mixed content 拦截。解法已落地：`android/app/src/main/res/xml/network_security_config.xml`（基线 `cleartextTrafficPermitted="false"`，仅对私网段 + `10.0.2.2` + `localhost` 开例外）＋ `AndroidManifest.xml` 引用它。
- **iOS 在 Windows 上物理无法编译**（必须 macOS + Xcode）⇒ 只能出工程，如实标注，勿承诺。

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
- ⚠ **有 active goal 时 `create_goal` 会失败**：报 `Error: goal "goal-xxxx" already exists with phase "active"`。
  **同一会话只有一个 goal** ⇒ 进入下一迭代时**改 objective，不要新建**（实测 v0.9.0 → v0.10.0 切换）。
- ⚠ **`edit` 之后 goal 会变成 `activation: disarmed`**（不再自动续跑），须**紧接一次 `update_goal action=resume`** 才会回到 `armed`。
  ⚠ **`resume` 必须传 `edit` 返回的新 revision**（不是编辑前那个），否则版本不符会被拒。
  实测序列：`get_goal`(rev 3) → `edit`(rev 3→4, disarmed) → `resume`(rev 4→5, **armed** ✔)。
- 改 objective 的**正确触发点是人类回合**：用户直接发一条普通消息（如「把 goal 改成 …」）即构成 human turn，
  **同一轮内** `get_goal` → `edit` → `resume` 全部可用。`ask_user_question` 的选项答复仍不算。

**Playwright / 浏览器**
- 搜索框是 React 受控组件：`browser_fill` **必须先填空串再填值**，否则值被回滚。
- 页面有两个 `.search-input`（header + main），用 `css=.search-input >> nth=1`。

**🔴⚠ 本 harness 下「用环境变量给子进程做隔离」**完全不可用**（v0.11.0 T94 实测，四种通道全部失败）**
> 场景：要起一个**打临时库**的 `apps/sync-server` 实例做端到端实测（绝不能碰 `data/**`）。
> 实测结论：**没有任何一种方式能把 `ZIDIANKAIFA_DB` / `ZIDIANKAIFA_SYNC_DB` / `PORT` 传给 node 子进程** ⇒
> 服务一律落到**生产默认路径**（`data/db/dict.db` + `data/sync-data/sync.db`）。

| 通道 | 实测结果 |
| --- | --- |
| pwsh 工具里 `$env:X=...; node ...` | ❌ node 收到的仍是默认值 |
| node `spawn(...)`：`stdio=['ignore',fd,fd]` / `'pipe'` / `'ignore'` 三种 | ❌ 子进程**静默不监听**（无输出、无退出），三种全败 |
| `Start-Process -FilePath node` + 同会话 `$env:` | ❌ 服务自报 `dict db : ...\data\db\dict.db` —— **env 没传进去** |
| `Start-Process pwsh -File <包装脚本>`（脚本内设 `$env:` 再跑 node） | ❌ 同样落默认路径 |
| Node 里设 `process.env` + `spawnSync('pwsh', ['-Command', 'Start-Process ...'])` | ❌ 落默认路径；且 `spawnSync` 会**挂死**（必须靠外层超时打断） |

- ⛔ **绝对纪律**：由于无法隔离，**任何「起 sync-server 做实测」的脚本都会打到生产库**。
  - 它对 `data/db/dict.db` 是**只读式**使用，但 `openDatabase()` 会跑迁移 ⇒ **冻结库立刻多出 `-wal`/`-shm` 与一个 ~493 MB `dict.db.bak-<ISO>`**；对 `data/sync-data/sync.db` 则会**真的写入**（账号/生词）。
  - **因此：起服务实测前必须先记生产库指纹，测完必须清理 + 三次并查复核**（见下）。
- ✅ **实测可行的通道（唯一）**：`Start-Process -FilePath 'node' -ArgumentList 'apps/sync-server/dist/index.js' -PassThru -WindowStyle Hidden -RedirectStandardOutput <f> -RedirectStandardError <f>` —— 服务**能起来**（会监听），但**必然打生产库**。
- ✅ **冻结库回滚手法**：删 `-wal`/`-shm` 即回逐字节原状（主文件是最后一个 checkpoint）。**实测两次均成功**。
- ✅ **sync 库「账号表」回滚**：`users` / `auth_tokens` 是纯测试数据 ⇒ 直接 `DELETE` 后 `PRAGMA wal_checkpoint(TRUNCATE)` 即净；**绝不碰 `book` 表**。
- ⚠ `node -e` 内嵌 SQL/正则**仍会** `Expected unicode escape`（pwsh 引号陷阱）⇒ 一律写 `.mjs` 文件。

**⚠ 文本文件存在字节损坏风险（2026-09-16 实测，已修复一处）**
- `README.md:144` 曾被写入 **U+000D CR + U+0007 BEL** 两个控制字符（原文应为西里尔词 `корни` / `аффиксы`，被按错误码位落盘），肉眼在编辑器里看不出来，只有逐码点才能发现。
- **普查判据**（不要用「文件里有 CR 就算坏」——本项目多数文件是 CRLF，那是正常的）：
  ① 出现 BEL `U+0007` / VT / FF / ESC 等非空白控制字符；
  ② **行中** CR（CR 后面不是 LF）；
  ③ CR 与 BEL 出现在同一行（已实测到的损坏形态）。
- 现成工具：`node scripts/audit_text_health.mjs`（只读，全仓普查 + 旧口径数字残留抽查）。
- **修复方式**：用**稳定拉丁锚点**（`indexOf('oots(476)')` 之类）定位并按**码点索引**整体替换，**不要**用含控制字符的字面量做 `replace`（会匹配失败）。范例：`scripts/fix_readme_l144_corruption.mjs`。


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

### 4.5 ⚠️ `send_message` 派单会**静默丢失** —— 必须以「落盘证据」验收，不得以「已派单」结案
> **实测（v0.11.0 第 12 轮，2026-09-14 22:36）**：主管一次性向 4 个常驻 agent 派单（T83 开发 / T84 测试 / T87 结构 / T70 需求），随后 **90 分钟内磁盘零写入** —— `packages/core/src/**` 与 `apps/sync-server/src/**` 零改动、`scripts/check_user_scope.mjs` 不存在、`git ls-files --others` 为空、`.board/**` 的 mtime 全部停在派单前。而 `list_agents` 显示 **15 条全部 `ready`、无一个 `running`** —— **看起来像「派了但没做」，实际是「没收到」**。

- **判别实验（本项目已验证可复现）**：发一条**极小任务**给目标 agent，**立刻**调 `list_agents` —— 投递成功则**秒级翻 `running`**（实测 `bb9e0148` 与 `6c6cedb8`、`7ff57407` 均在 `send_message` 返回后立即变 `running`）。⇒ **通道本身是通的**，但不保证每一次投递都到达。
- ⛔ **绝对禁止的推论**：把 `ready` 读成「已完成」或「已执行」。
  - `ready` = **可被 `send_message` 续跑**，**唯一状态值**，**不区分**「已完成并落盘 / 失败被放弃 / 从未开始」。
  - ⚠ **`ready` 与「已交付」之间没有任何蕴含关系**：`ready` 也可能意味着**它根本没收到你的派单**。
- ✅ **验收纪律（硬性）**：任何 agent 任务的完成度**只能由落盘证据判定**：
  1. `git status --short` 有无产物；`git ls-files --others --exclude-standard` 有无新文件
  2. **受影响路径的 mtime** 是否晚于派单时刻（`Get-Item <f> | % LastWriteTime`）
  3. 有断言/路由的任务**要真跑一遍**（例：T83 的判据 = `Invoke-WebRequest http://127.0.0.1:4570/api/v1/auth/register` ⇒ 实测 **404** ⇒ 未实施；旧路由 `/api/v1/book` 返回 **200** 作对照组）
  - **无证据即未交付**，须**重派**并在派单里写明「此前未执行、这是重派」，附上你实测到的反证（agent 会据此核对，避免与既有产出冲突）。
- ⚠ **重派时把大单切成可独立验收的小步**（R1 / R2 …），每步自带走查证据 —— 大单一旦丢失，损失的是整单时间。

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
