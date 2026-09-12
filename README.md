# 📖 我的电子辞典（zidiankaifa）

自研电子辞典：**React + TypeScript + SQLite 一套代码**，Electron 驱动 Windows 桌面，PWA/Capacitor 覆盖手机端；内置 ECDICT 开源词库（约 77 万词条），按**语言发展流程**整理单词——词源分类、词形演变、词根词缀拆解；配套轻量 Node 云同步服务实现跨端生词本互通。

## 功能

- 🔍 **查词**：音标、英英/英汉释义、词性、柯林斯/牛津星级、考试标签（中考/高考/四六级/考研/托福/GRE/雅思）、语料词频
- 🔊 **发音**：系统 TTS（浏览器/桌面通用），后续可接真人发音音频
- 🧬 **词源分类**：三层数据——Etymological Wordnet 词源图算出的词级演变链（135k 词）+ **Wiktionary（wiktextract）词源详解**（词源原文中文/英文 + 结构化派生链，数十万词）+ 语源语言判定；词源卡内置「构词成分」行，把词素级拆解与词级演变链串成一条**发展路径**；**俄语词源卡已上线**（**31,256 条**俄语词源，其中**中文 14,224 条**，含 **27,852 条派生链**与**同源词标注**，如 `вода ← 古东斯拉夫语 ← 原始斯拉夫语 *voda ← 原始印欧语 *wódr̥`，并标出与英语 water 的同源关系）
- 🔄 **词形演变**：由 ECDICT exchange 字段生成，过去式/过去分词/现在分词/复数/比较级等，点词形即查
- 🧩 **词根词缀拆解**：内置 **601 条词素库**（英语 456 + **俄语 145**：前缀 50 / 后缀 42 / 词根 53），**贪心最长匹配**（一词多词素全命中、长词素优先、例词点击即查）；俄语拆解额外支持**单字符前缀前瞻验证**（в-/с-/у-/о-）与**屈折词尾吸收**（`-ость` → `-ости/-остью`），`телефон → теле- + фон-`、`писатель → пис- + -тель`
- 📚 **生词本**：新学/学习中/已掌握/已暂停 四态管理，支持自定义标签；**「按词根分组」视图** + 桌面端**知识图谱**（词根词缀 × 生词网络，点节点回查）
- ⬆️ **自动更新**（桌面端）：启动静默检查新版本 → 顶部条幅提示（可选自动下载，**blockmap 差分**省流量）→ 下载完成重启即安装；设置面板显示下载进度/速率、可开关自动检查、一键打开发布页；便携版引导手动下载
- 📋 **剪贴板取词**（桌面端）：复制单词自动弹出释义浮窗
- ☁️ **云同步**：自建轻量 Node 服务，桌面与手机生词本 last-write-wins 合并（含删除墓碑）
- 🗂 **多语言**：内置**俄语**支持（159,000+ 词条：中文释义 + IPA 音标 + **变格变位结构化表格**（格×数 / 人称×时态）+ 词形反查 + 真人音频链接）；**语言切换器**（自动/英语/俄语）与中文反查英俄分区展示，**联想与查词均按语言隔离**（俄语模式不再混出英语项），生词本按语言标注（🇷🇺）；查词对大小写与屈折形做过校正（`Франция`→「法国」而非「франций 的属格单数」，`дома`→「在家」，而 `столом` 仍反查到 `стол` + 第六格标注）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite（手写 CSS，浅色/深色主题，响应式） |
| 桌面 | Electron 37（contextIsolation + preload 桥），`node:sqlite`（无原生编译依赖） |
| 手机 | 同一套前端以 PWA 运行；预留 Capacitor 配置 |
| 数据 | SQLite（better 无依赖：Node 内置 `node:sqlite`） |
| 同步 | Node 内置 http 服务 + SQLite，可选 Bearer Token |
| 词库 | [ECDICT](https://github.com/skywind3000/ECDICT)（开源，77 万词条）+ [Etymological Wordnet](https://archive.org/details/etymwn-20130208)（CC BY 3.0）+ [Wiktionary/wiktextract](https://kaikki.org)（CC BY-SA 4.0 / GFDL，词源详解）+ 自编词根库 |

## 目录结构

```
zidiankaifa/
├── packages/
│   ├── core/              # 共享数据层：类型契约 + node:sqlite 查询库（桌面/服务端共用）
│   └── data-pipeline/     # 数据管线：download.py / build_db.py / roots.json
├── apps/
│   ├── web/               # React 前端（Electron 加载 + PWA 双用）
│   ├── desktop/           # Electron 壳（main.mjs / preload.mjs）
│   └── sync-server/       # Node 同步服务（查词代理 + 生词本同步）
└── data/                  # 数据产物（git 忽略）：raw/ 源数据，db/dict.db 词典库
```

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
ZIDIANKAFA_SYNC_PORT=4570        # 端口
ZIDIANKAFA_SYNC_TOKEN=your-token # 开启鉴权（推荐）
ZIDIANKAFA_DB=.../dict.db        # 词典库路径
ZIDIANKAFA_SYNC_DB=.../sync.db   # 同步库路径

# 接口
GET  /health                      # 健康检查 + 词条数
GET  /api/v1/lookup?word=&lang=   # 查词（lang=auto|en|ru）
GET  /api/v1/suggest?q=&limit=&lang=  # 联想（按语言隔离）
GET  /api/v1/breakdown?word=&lang=    # 词根拆解
GET  /api/v1/book                 # 生词本全量
GET  /api/v1/book-groups          # 生词本 × 词素分组（知识图谱数据）
POST /api/v1/sync  {items:[...]}  # 合并同步
```

## 测试

```bash
# 核心数据层回归（71 项断言：拆解/语言路由/词形反查/劫持回归/词源/suggest 隔离）
pnpm --filter @zidiankaifa/core test     # 需先 build，且本地存在 data/db/dict.db
```

## 数据来源与许可

- [ECDICT](https://github.com/skywind3000/ECDICT)：76 万词条（音标/释义/词频/考试标签/词形变化）。开源词库，用于个人学习研究。
- [Etymological Wordnet](https://archive.org/details/etymwn-20130208)（Gerard de Melo）：603 万条词源关系，CC BY 3.0。
- [Wiktionary](https://www.wiktionary.org/) / [kaikki.org wiktextract 转储](https://kaikki.org)：词源详解原文（中文/英文）与结构化派生链，CC BY-SA 4.0 / GFDL。
- 词根词缀库：本项目自编（英语 `packages/data-pipeline/roots.json`、**俄语 `roots_ru.json`**，共 601 条词素，例词经词表校验）。
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
- [ ] 真人发音音频（ECDICT audio 字段 + 有道/离线音频）
- [ ] 背单词/记忆曲线复习
- [ ] Capacitor 打包 Android APK
- [ ] 中文分词搜索（FTS5 trigram）
- [ ] 划词取词（全局快捷键）
- [ ] 俄语词源覆盖率提升（当前 19.6%，双语料已到上限，需第三数据源 ru.wiktionary XML）
