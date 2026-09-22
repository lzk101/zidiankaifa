# 📖 我的电子辞典（zidiankaifa）

自研电子辞典：**React + TypeScript + SQLite 一套代码**，Electron 驱动 Windows 桌面，PWA/Capacitor 覆盖手机端；内置 ECDICT 开源词库（约 77 万词条），按**语言发展流程**整理单词——词源分类、词形演变、词根词缀拆解；配套轻量 Node 云同步服务实现跨端生词本互通。

## 功能

- 🔍 **查词**：音标、英英/英汉释义、词性、柯林斯/牛津星级、考试标签（中考/高考/四六级/考研/托福/GRE/雅思）、语料词频
- 🔊 **发音**：系统 TTS（浏览器/桌面通用），后续可接真人发音音频
- 🧬 **词源分类**：三层数据——Etymological Wordnet 词源图算出的词级演变链（135k 词）+ **Wiktionary（wiktextract）词源详解**（词源原文中文/英文 + 结构化派生链，数十万词）+ 语源语言判定；词源卡内置「构词成分」行，把词素级拆解与词级演变链串成一条**发展路径**；**俄语词源卡已上线**（**31,256 条**俄语词源，其中**中文 14,224 条**，含 **27,852 条派生链**与**同源词标注**，如 `вода ← 古东斯拉夫语 ← 原始斯拉夫语 *voda ← 原始印欧语 *wódr̥`，并标出与英语 water 的同源关系）
- 🔄 **词形演变**：由 ECDICT exchange 字段生成，过去式/过去分词/现在分词/复数/比较级等，点词形即查
- 🧩 **词根词缀拆解**：内置 **918 条词素库**（英语 468 + **俄语 450**：前缀 / 后缀 / 词根，其中约 290 条由 Wiktionary 构词模板与词表复合切分**数据驱动**扩充），**全局最优分段（DP）**（位置无抢占、一词多词素全命中、例词点击即查）；俄语拆解额外支持**单字符前缀紧跟验证**（в-/с-/у-/о-）、**屈折词尾吸收**（`-ость` → `-ости/-остью`）与 **ё/е 等价**（`весёлый` 命中 `весел-`），`телефон → теле- + фон-`、`водопровод → водо- + -провод`、`тоска → тоск-`
- 🌱 **词根表 / 词缀表**（v0.6.0）：**476 条词根 + 403 条词缀**独立成表，英语与俄语**分表**浏览/搜索；每条含中文含义、词源语言（原始斯拉夫语 *tъska、古希腊语 λόγος…）、典型例词与**关联词**（由真实构词拆解统计，非子串匹配，共 114,443 条）；查词页的词素与构词成分**可点击直达**对应词根详情
- 🔗 **词源关联网络**（v0.7.0）：词源详解里的相关词**自动变成可点链接**——「继承自原始斯拉夫语 *tъska，可能与 <u>тощий</u> 或 <u>тискать</u> 相关」直接点开词族；俄语按西里尔词天然提取（58% 词条命中），英语只取 `un- + believe + -able` 这类**构词表达**，过滤 distance/apparatus 等叙述用词
- 🕸 **同根词 · 词族**（v0.7.0）：查词页按共享词素分组展示词族（`тоска` → тоск- 组 5 词；`telephone` → tele 组 27 词 + phon 组 30 词）；剔除裸词素碎片、英语按 bnc/frq 词频排序（`tele` 组以 television/telegraph/telecom 打头），点词素进词根表、点词回查
- 📚 **生词本**：新学/学习中/已掌握/已暂停 四态管理，支持自定义标签；**「按词根分组」视图** + 桌面端**知识图谱**（词根词缀 × 生词网络，点节点回查）
- ⬆️ **自动更新**（桌面端）：启动静默检查新版本 → 顶部条幅提示（可选自动下载，**blockmap 差分**省流量）→ 下载完成重启即安装；设置面板显示下载进度/速率、可开关自动检查、一键打开发布页；便携版引导手动下载
- 📋 **剪贴板取词**（桌面端）：复制单词自动弹出释义浮窗
- ☁️ **云同步**：自建轻量 Node 服务，桌面与手机生词本 last-write-wins 合并（含删除墓碑）
- 🗂 **多语言**：内置**俄语**支持（**101,500+ 主词条**：中文释义 + IPA 音标 + **变格变位结构化表格**（格×数 / 人称×时态）+ 词形反查（`книгу` → `книга` 宾格单数）+ 真人音频链接）；**语言切换器**（自动/英语/俄语）与中文反查英俄分区展示，**联想与查词均按语言隔离**（俄语模式不再混出英语项），生词本按语言标注（🇷🇺）；查词对大小写与屈折形做过校正（`Франция`→「法国」而非「франций 的属格单数」，`дома`→「在家」，而 `столом` 仍反查到 `стол` + 第六格标注）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite（手写 CSS，浅色/深色主题，响应式） |
| 桌面 | Electron 37（contextIsolation + preload 桥），`node:sqlite`（无原生编译依赖） |
| **手机** | **Capacitor 8.5.2 真 App**（`apps/mobile/`，`webDir` = `../web/dist`）+ 同一套 React 前端；Android 工程 `apps/mobile/android/`，包名 `com.lzk101.zidiankaifa`，**已产出签名 release APK**。⚠ iOS 工程可生成，但**编译须 macOS + Xcode**，Windows 上物理无法产出 |
| 数据 | SQLite（better 无依赖：Node 内置 `node:sqlite`） |
| 同步 | Node 内置 http 服务 + SQLite，可选 Bearer Token |
| 词库 | [ECDICT](https://github.com/skywind3000/ECDICT)（开源，77 万词条）+ [Etymological Wordnet](https://archive.org/details/etymwn-20130208)（CC BY 3.0）+ [Wiktionary/wiktextract](https://kaikki.org)（CC BY-SA 4.0 / GFDL，词源详解）+ 自编词根库 |

## 目录结构

> 逐目录性质、写权限、脚本分类与产物处置见 **`PROJECT_STRUCTURE.md`**（结构主文档）。

```
zidiankaifa/
├── packages/
│   ├── core/              # 共享数据层：类型契约 + node:sqlite 查询库（桌面/服务端共用）
│   └── data-pipeline/     # 数据管线：download.py / build_db.py / roots.json / roots_ru.json
├── apps/
│   ├── web/               # React 前端（Electron 加载 + PWA 双用）
│   ├── desktop/           # Electron 壳（main.mjs / preload.mjs / dbmigrate.mjs / updater.mjs）
│   └── sync-server/       # Node 同步服务（查词代理 + 生词本同步）
├── scripts/               # 只读探针 / 实验台（133 个，历史留痕，非产品代码）
├── .board/                # 多 agent 台账（BASELINE / TASKS / BOARD / REQ / DECISIONS / EVIDENCE）
├── docs/                  # 人读文档：交接文档 / 需求总结 / release-v*.md
├── data/                  # 数据产物（git 忽略）：raw/ 源数据，db/dict.db 词典库
└── dist-release/          # 安装包产物（git 忽略）
```

项目根还有三份人读文档：`AGENTS.md`（AI 开发规范与环境事实，必读）· `PROJECT_CHARTER.md`（项目主管章程）· `PROJECT_STRUCTURE.md`（结构主文档）。

## 快速开始

```bash
# 1. 安装依赖（首次约几分钟；Electron 二进制若未自动下载，见下方说明）
pnpm install

# 2. 构建词库（下载源数据 + 构建 SQLite，约 66MB + 27MB 下载、5-10 分钟构建）
pnpm run data:all          # 或分步：pnpm run data:download && pnpm run data:build

# 3. 构建核心库与前端
pnpm --filter @zidiankaifa/core build
pnpm --filter @zidiankaifa/web build

# 4. 启动桌面应用
pnpm --filter @zidiankaifa/desktop dev

# 5.（可选）启动同步服务（手机端/浏览器端查词与同步依赖它）
pnpm --filter @zidiankaifa/sync-server start

# 6.（可选）打包 Windows 安装包（产物在 dist-release/，先完成第 3 步构建）
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:electron_config_cache='<workspace>\.electron-cache'      # electron 二进制缓存
$env:ELECTRON_BUILDER_CACHE='<workspace>\.eb-cache'           # NSIS/winCodeSign 工具缓存
pnpm --filter @zidiankaifa/desktop build
```

> 若 Electron 二进制未下载：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; $env:electron_config_cache='<workspace>\.electron-cache'; node apps/desktop/node_modules/electron/install.js`
>
> 打包工具链预下载脚本：`python packages/data-pipeline/fetch_builder_bins.py`（将 NSIS/winCodeSign/7zip 缓存到 `.eb-cache/`）。

### 浏览器/PWA 模式（手机端）

1. 启动同步服务：`pnpm --filter @zidiankaifa/sync-server start`
2. `pnpm --filter @zidiankaifa/web dev` 或构建后静态部署 `apps/web/dist`
3. 浏览器打开（手机访问局域网 IP），在「设置」填入同步服务器地址（如 `http://192.168.1.5:4570`）

## 同步服务

```bash
# 环境变量（均可选）
ZIDIANKAIFA_SYNC_PORT=4570        # 端口（亦接受 PORT）
ZIDIANKAIFA_SYNC_TOKEN=your-token # 遗留单 token 鉴权（作用域 = 本机 'local'；保留以兼容桌面端 sync:now）
ZIDIANKAIFA_DB=.../dict.db        # 词典库路径
ZIDIANKAIFA_SYNC_DB=.../sync.db   # 同步库路径
# 账号与限流（AC-27，v0.11.0）
ZIDIANKAFA_AUTH_REGISTER=closed   # 关闭公开注册（缺省开放，便于起首账号）
ZIDIANKAIFA_RATE_MAX=300          # 作用域维度：每 60s 上限
ZIDIANKAIFA_AUTH_RATE_MAX=15      # 鉴权路由：按 IP
ZIDIANKAIFA_AUTH_USER_RATE_MAX=8  # 鉴权路由：按账号
ZIDIANKAIFA_RATE_WINDOW_MS=60000  # 限流窗口

# 接口
GET  /health                      # 健康检查 + 词条数
GET  /api/v1/lookup?word=&lang=   # 查词（lang=auto|en|ru）
GET  /api/v1/suggest?q=&limit=&lang=  # 联想（按语言隔离）
GET  /api/v1/breakdown?word=&lang=    # 词根拆解
GET  /api/v1/lexicon?kind=&lang=&q= # 词根表/词缀表列表（kind=root|prefix|suffix）
GET  /api/v1/lexicon/entry?morpheme=&lang=  # 词素详情（含全部关联词）
GET  /api/v1/lexicon/stats           # 词根/词缀统计
GET  /api/v1/words?lang=&q=          # 单词表（按语言分离）
GET  /api/v1/book                 # 生词本全量
GET  /api/v1/book-groups          # 生词本 × 词素分组（知识图谱数据）
GET  /api/v1/related?word=&lang=  # 查词页同根词（按共享词素分组的词族）
POST /api/v1/sync  {items:[...]}  # 合并同步（last-write-wins，含删除墓碑）
# 账号（AC-27，v0.11.0；用户名即 email）
POST /api/v1/auth/register  {email,password}  # 注册并签发 token
POST /api/v1/auth/login     {email,password}  # 登录签发新 token（不区分「无此账号/口令错」，防枚举）
POST /api/v1/auth/revoke    {all?}            # 撤销当前 token（all:true 撤销该账号全部）
GET  /api/v1/auth/whoami                      # 当前作用域
```

> **密码存储**：`scrypt` ＋ 每用户随机盐 ＋ `timingSafeEqual`，格式 `scrypt$N$salt$hash`；**令牌只存 sha256 哈希**（不存明文），用户级可撤销。
> ⚠ **当前限制（未完成，勿误读为已支持多用户）**：`/api/v1/book`、`/api/v1/book-groups`、`/api/v1/sync` **尚未接入用户维度** ⇒ 服务端目前仍是「**单人多设备**」语义，**多人共用会互相看到并修改对方生词本**；不要把本服务暴露到公网（`DEC-031`，发布阻断项）。

## 测试

```bash
# 核心数据层回归（626 项断言：拆解/语言路由/词形反查/劫持回归/词源/suggest 隔离/
#                  词根词缀表/词源关联链接/同根词族/覆盖率下限/词素语义/生词本语言隔离/
#                  用户维度隔离（AC-27））
pnpm --filter @zidiankaifa/core test     # 需先 build，且本地存在 data/db/dict.db
                                         # （book_lang.mjs 例外：全程临时合成库，不读 dict.db）

# 桌面端词库升级（22 项断言：首次运行 / 升级+生词本迁移 / 连续升级 / 内置库缺失 / 旧库损坏）
pnpm --filter @zidiankaifa/desktop test
```

> 合计 **648 项**（core 626 + desktop 22），全部 0 失败。
> core 626 = `regress` 99 + `lexicon` 67 + `related` 38 + `ru_morph` 60 + `ru_morph_d1fix` 194 + `ru_morph_d1guard` 26 + `book_lang` **142**（全部已接入 `pnpm test`）。
> ⚠ `book_lang` 由 137 增至 142 系 v0.11.0 的 AC-27 把 `book` 主键由 `(word, lang)` 升为 **`(user_id, word, lang)`** ⇒ 旧口径 `621 = …+137`、合计 `643` **已作废**（口径变更须带时点，见 `AGENTS.md` §1）。
> 另有 4 个**手动**留红台账（**不接入** `pnpm test`）：`ru_morph_defects.mjs`（55 通过 / 1 失败，唯一余红 = `термостат`）·
> `ru_morph_goals.mjs`（0/2，v0.11.0 目标）· `ru_morph_semantic.mjs`（44/1）· `ru_morph_v090_guard.mjs`（107/0）。
> 逐文件断言数与口径见 `AGENTS.md` §1 与 `.board/BASELINE.md`。

## 数据来源与许可

- [ECDICT](https://github.com/skywind3000/ECDICT)：76 万词条（音标/释义/词频/考试标签/词形变化）。开源词库，用于个人学习研究。
- [Etymological Wordnet](https://archive.org/details/etymwn-20130208)（Gerard de Melo）：603 万条词源关系，CC BY 3.0。
- [Wiktionary](https://www.wiktionary.org/) / [kaikki.org wiktextract 转储](https://kaikki.org)：词源详解原文（中文/英文）与结构化派生链，CC BY-SA 4.0 / GFDL。
- 词根词缀库：本项目自编（英语 `packages/data-pipeline/roots.json`、**俄语 `roots_ru.json`**，共 918 条词素（英语 468 / 俄语 450），例词经词表校验；俄语部分早期由 `analyze_ru_morphemes.py` 从 Wiktionary 构词模板与词表复合切分**数据驱动**挖掘候选，人工审定含义与词源后入库（**该自动挖掘入口已被否决，v0.9.0 起改为「人工提候选 + 可复核联网来源 + 边际增益实测」的审定门**），覆盖率用 `measure_ru_breakdown.mjs` 评测）。
- 词库构建脚本与产物仅用于本项目，请勿将词库数据打包商用。

## Roadmap

- [x] 数据管线（ECDICT/词源/词根 → SQLite）
- [x] 核心查询库（查词/词族/词源/拆解/生词本/合并同步）
- [x] React Web UI + Electron 桌面壳
- [x] Node 同步服务
- [x] Windows EXE 打包（v0.2.0：安装包 + 便携版，含完整词库）
- [x] 俄语变格变位数据补全（v0.2.1：forms 48.8% → 62.8%）、中文词源 text_zh 构建（9,378 行）
- [x] **俄语词源 + 词根词缀**（v0.3：**30,767 条俄语词源**（中文 13,852 + 英文 30,322）+ 派生链 + **145 条俄语词素库**（前缀 50/后缀 42/词根 53）+ 语言感知拆解）
- [x] **自动更新系统**（v0.4：应用内检查 → 下载（blockmap 差分）→ 重启安装；设置面板 + 顶部条幅；便携版引导手动下载）
- [x] **查词正确性与词素补漏**（v0.4.1：专名大小写漏失修复、词形反查劫持修复、suggest 语言隔离、词素 582→601、**71 项 core 回归测试**固化）
- [x] **俄语词素库数据驱动扩充**（v0.4.3：词素 601→**888**，俄语 145→**432**；覆盖 `тоска`/`водопровод`/`страшный` 等常用词；修掉单字符前缀误拆与 ё/е 未归一；回归 **91 项**）
- [x] **屈折形词条污染清理**（v0.4.4：清出 **58,195 条**（36.6%）变格/变位形被建成的独立词条——此前估计仅 9,710 条；删除 57,615 条可反查项后俄语词条 159,127→**101,512**，查 `книгу` 现直接返回主词条 `книга` + 「宾格/单数」标注；不可反查的 580 条保留；含库内备份表与回归 8 项，共 **99 项**）
- [x] **手机端（Capacitor）· 手机↔电脑互通 · 用户机制**（**v0.11.0**）：手机端由 PWA 升级为 **Capacitor 8.5.2 真 App**（`apps/mobile/`，`webDir=../web/dist`，包名 `com.lzk101.zidiankaifa`，minSdk 24 / targetSdk 36），**release APK 已签名并实测安装运行**（`versionCode 1100` / `versionName 0.11.0`，标题/搜索框/五面板齐全，无白屏）；端到端隔离实测**双向同步成立**——手机写 `t81phone` ⇒ PC 库回读 4 行（含中文备注与标签数组），PC 写 `t81desktop` ⇒ 手机 `pulled=5` 且**看到电脑端新词 = true**、字段逐项一致；修复 3 个缺陷（`V11-SYNC-DTO` 跨 HTTP 边界字段名 snake_case/camelCase 不匹配导致 500 与**静默漏推** · `V11-NOTE-NULL` `note: null` 被存成字符串 `"undefined"` · `V11-OPENDB-LEAK` `openDatabase()` 抛错路径漏 `close()` 泄漏句柄）。**用户机制（AC-27）**：`book` 主键 `(word, lang)` → **`(user_id, word, lang)`**，`user_id` **NOT NULL 且不给 DEFAULT**（给默认值会让「漏写」与「漏过滤」双向静默失效），旧数据落 `'local'`，**首个注册账号会认领本机匿名生词本**（实测 `claimed = 3`），`sync-server` 新增 `/api/v1/auth/{register,login,revoke,whoami}`（`scrypt` + 每用户随机盐 + `timingSafeEqual`，口令格式 `scrypt$N$salt$hash`，**token 只存哈希**、用户级可撤销，**零新依赖**）；Web/手机端「设置」内已有账号卡片。门禁 **621 → 648**（core **626** ＋ desktop 22）。⚠ **未交付**：云端托管同步（需 Turso 凭证）· **离线最小可用集**（包内无词库 ⇒ 断网不可用）· 互通仍需**自建同步服务** · 桌面端账号 UI · iOS 无法编译 ⇒ 清单见 `docs/v0.11.0-status.md`
- [ ] 真人发音音频（ECDICT audio 字段 + 有道/离线音频）
- [ ] 背单词/记忆曲线复习
- [x] **Capacitor 打包 Android APK**（v0.11.0：见下方 v0.11.0 条目；已产出**签名 release APK** 并在 Android 15 模拟器实测安装运行）
- [ ] 中文分词搜索（FTS5 trigram）
- [ ] 划词取词（全局快捷键）
- [x] **数据质量总收**（v0.5.0：词源来源标注修正 19,865 条——原先 64% 俄语词条把「资料出处」当成语源语言显示「源自 英语」；第三数据源 kaikki 俄语 dump 勘察（44.3 万词条仅可新增 128 条 → **源数据到头**）；补建 115 条词形反查；VACUUM 515.09→**491.59MB**；覆盖率口径修正为 **30.8%**；回归 **99 项**）
- [x] **词根表 / 词缀表**（v0.6.0：拆解算法由「贪心最长匹配」重写为**全局最优分段 DP**（消除同位置词素抢占——стетоскоп 不再被误拆出 тоск-），使词根关联词从 21 条含噪降为 **6 条全对**；新增 корни(476) / аффиксы(403) 独立表 + words_en/words_ru 视图；Web 新增**词根词缀面板**与**构词路径点击联动**；测试新增 lexicon.mjs **67 项**）
- [x] **词源关联网络 · 同根词族**（v0.7.0：词源详解里的相关词变**可点链接**（俄语 58% 词条命中，英语限构词表达以避免叙述用词噪声）；查词页新增**同根词 · 词族**（按共享词素分组、剔碎片、英语按 bnc/frq 排序）；修复 `сегодня` 词首间隙假命中（同时保住 `acknowledge → ac-+know+-ledge`）；词素库 888→**909**（俄语 +стол-/сад-/брат-/сказ-/каз- 等 9 条，英语 +拉丁语同化前缀 ac-/ap-/as-/cor-/ef- 等 12 条）；新增 related.mjs **38 项**，全量 **204 项**）
- [ ] ~~俄语词源覆盖率提升~~ → 已确认**受限于源数据**（真实覆盖率 **30.8%** = 31,256 / 101,512 主词条；此前记的 19.6% 是分母含 5.7 万屈折形词条所致）
- [x] **修复：升级安装后仍读旧词库**（v0.7.1：`resolveDbPath()` 原先**只在 userData 副本不存在时**才复制内置库，导致装过任意旧版本后**永久读那一份旧库**——实测 v0.7.0 用户仍在读 v0.2.x 的 509MB 旧库（俄语词源 0 / 俄语词素 0 / 无 roots 表），界面显示"暂无词源数据 / 暂未拆解"；新增 `apps/desktop/src/dbmigrate.mjs`，以 `size:mtime` 指纹比对自动换库、**换库时迁移生词本（含删除墓碑）**、旧库改名备份、旧库损坏也照常换库；新增 `test/dbmigrate.test.mjs` **22 项断言**；同时新增 `AGENTS.md` 固化环境事实与**防循环熔断规则**）
- [x] **修复：词首单字符间隙的假词根误拆**（v0.8.0：查 `плескание`（溅水）→ 词族卡显示 **`лес-`（森林）40 词**、`ателье`（画室）→ **`тел-`（身体）40 词**。根因是 `breakdownWord()` 两道守卫**恰好都放过 `gap === 1`**——守卫一要求片段数为 1（实际 3 段）、守卫二要求 `start >= 2`（实际 1）；**覆盖率阈值对此完全无效**（`зверство` cov=1.00），属阈值型防护的固有盲区。一行修复：守卫二阈值 `>= 2` → **`>= 1`**，让 gap=1 与 gap≥2 适用同一「必须能被前缀精确解释」判据。**全库假前缀组 267 词全部消除（342 = 75 保留 + 267 消除）**，真前缀 75 词 0 误杀，无新增拆解；尺子 R 30.85% → **30.09%**（−6 词全是被消除的假拆解，预期代价）。新增 `test/ru_morph.mjs`(52) 与 `test/ru_morph_d1fix.mjs` 双语素级防回归门，断言总数 **226 → 442**）
- [x] **词素语义核证 · 防假拆解**（v0.9.0：修复「词首假词根误拆」——查 `сучить`（捻、搓）→ 词族卡此前显示 `уч-`（教、学）的家族。根因**不是**「只做字母级判定不做词素级判定」，而是**这些词素本身在库里被标成了 `root` 却出现在词中位置**（`уч-` = `*učiti` 学/教、`дн-` = `*dьnь` 日/昼、`да-` = `*dati` 给/授予，单字符**前缀**只有 `в-` `о-` `с-` `у-` 四个）⇒ 不存在「词素级前缀判定」可修。**packages/core/src 一行未改**，只在 `roots_ru.json` 补齐 **9 条词素**（441→450）：真词素 `суч-` `суд-` `домин-` `-ной` `пад-` `тряс-`（各附可复核 ru.wiktionary `{{морфо-ru}}` 来源）+ 3 条**整词抑制兜底** `столп-` `казус-` `однако-`（`origin` 已标注「非语义切分」，Release Notes 已披露）。**全库可拆 33,174→33,495**，词首假词根 `уч-@1`/`дн-@1` 均归零，尺子 R **238→241（30.09%→30.47%）**，R 内空洞≥3 **134→132**，`loses=2`（`поднаковальня`/`поднакопить`，旧态含假词根 `дн-`，转为不拆属净改善）。**两项判据豁免已如实披露**：口径A/B 空洞绝对值上升（率反而下降，因分母同时长大）、`-ной` 属「结构上不可满足」的判据缺陷。新增 `test/ru_morph_semantic.mjs` 语义判别集；门禁 **442→506**）

- [x] **生词本语言分离 · 词根分类独立面板**（v0.10.0：生词本原先把英俄词混在一个列表里、`book` 表主键只有 `word` —— 同拼写跨语言会**互相覆盖/互相删除**。本迭代把 `book` 表迁到 **(word, lang) 复合主键**（`migrateBookCompositeKey`，含**迁移前自动快照** `VACUUM INTO <db>.bak-<ISO>`、事务回滚、行数守卫、索引重建，老库首次打开自动迁移，**逐字段保真含墓碑**），`bookGet/bookList/bookListAll/bookAdd/bookRemove/bookUpdate/syncMerge/bookGroups` **全部带 `lang`**（同步合并键也改为 `(word, lang)`，协议未变），消除了「删俄语词把英语同名词墓碑掉」与「`bookRemove` 缺省把墓碑写成 `'en'`」两处缺陷；**SQLite 与浏览器 `localStorage` 两条存储路径同时隔离**。UI：生词本**一个入口 + 🇬🇧/🇷🇺 子页签**（各自独立计数、删除互不影响、添加时自动判语言**并可手动覆盖**）；新增**独立的第 5 面板「🌱 词根分类」**（只归类**生词本内**的词，空生词本显示空态而**不回退**成全库词根表，与「词根词缀」面板职责区分）。门禁 **506 → 643**（新增 `book_lang.mjs` **137 项**：迁移/隔离/同步合并/语言判定/备份快照））
- [ ] **v0.12.0 计划（正确性梯队，v0.11.0 改向后**顺延**）**：① `а-` 否定前缀缺失（唯一能同时消 gap 且降空洞的前缀，实测 4 词 `астатизм`/`астатический`/`астатичность`/`гигростат` 的正解被守卫拒掉）② `lookupWord` 的 `inBook` 仍硬编码 `lang = 'en'`（`packages/core/src/db/index.ts:823`，当前不可达故属潜在不一致）③ 词中空洞通用上限（D2：`землетрясение` 跳 `ряс`、`водопад` 类）④ 假词根全库普查（`каз-`/`дом-`/`дн-` 等**库内词根自身含语义错误**，属词素库维护问题而非算法问题）⑤ `термостат` 取舍（补 `стат-` 会吃掉真前缀 `термо-`，已实测否决）⑥ `да-` 假族 26 词（与真族 10 词**引擎输出同形**，补词素会误伤真族，实测否决；判别核心对：`вдаться`=`в-|да|+ть|-ся`（真）vs `вдавить`=`в-|дав|-и|+ть`（巧合））；工程债见 `docs/交接文档.md` §6.C
