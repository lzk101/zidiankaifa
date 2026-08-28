# 📖 我的电子辞典（zidiankaifa）

自研电子辞典：**React + TypeScript + SQLite 一套代码**，Electron 驱动 Windows 桌面，PWA/Capacitor 覆盖手机端；内置 ECDICT 开源词库（约 77 万词条），按**语言发展流程**整理单词——词源分类、词形演变、词根词缀拆解；配套轻量 Node 云同步服务实现跨端生词本互通。

## 功能

- 🔍 **查词**：音标、英英/英汉释义、词性、柯林斯/牛津星级、考试标签（中考/高考/四六级/考研/托福/GRE/雅思）、语料词频
- 🔊 **发音**：系统 TTS（浏览器/桌面通用），后续可接真人发音音频
- 🧬 **词源分类**：三层数据——Etymological Wordnet 词源图算出的词级演变链（135k 词）+ **Wiktionary（wiktextract）词源详解**（词源原文中文/英文 + 结构化派生链，数十万词）+ 语源语言判定
- 🔄 **词形演变**：由 ECDICT exchange 字段生成，过去式/过去分词/现在分词/复数/比较级等，点词形即查
- 🧩 **词根词缀拆解**：内置 260+ 词根/前缀/后缀库，启发式切分并标注含义与来源
- 📚 **生词本**：新学/学习中/已掌握/已暂停 四态管理，支持自定义标签
- 📋 **剪贴板取词**（桌面端）：复制单词自动弹出释义浮窗
- ☁️ **云同步**：自建轻量 Node 服务，桌面与手机生词本 last-write-wins 合并（含删除墓碑）
- 🗂 **多语言**：词库结构预留语言字段；中文可反查英文

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
```

> 若 Electron 二进制未下载：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; $env:electron_config_cache='<workspace>\.electron-cache'; node apps/desktop/node_modules/electron/install.js`

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
GET  /api/v1/lookup?word=         # 查词
GET  /api/v1/suggest?q=&limit=    # 联想
GET  /api/v1/breakdown?word=      # 词根拆解
GET  /api/v1/book                 # 生词本全量
POST /api/v1/sync  {items:[...]}  # 合并同步
```

## 数据来源与许可

- [ECDICT](https://github.com/skywind3000/ECDICT)：76 万词条（音标/释义/词频/考试标签/词形变化）。开源词库，用于个人学习研究。
- [Etymological Wordnet](https://archive.org/details/etymwn-20130208)（Gerard de Melo）：603 万条词源关系，CC BY 3.0。
- [Wiktionary](https://www.wiktionary.org/) / [kaikki.org wiktextract 转储](https://kaikki.org)：词源详解原文（中文/英文）与结构化派生链，CC BY-SA 4.0 / GFDL。
- 词根词缀库：本项目自编（`packages/data-pipeline/roots.json`）。
- 词库构建脚本与产物仅用于本项目，请勿将词库数据打包商用。

## Roadmap

- [x] 数据管线（ECDICT/词源/词根 → SQLite）
- [x] 核心查询库（查词/词族/词源/拆解/生词本/合并同步）
- [x] React Web UI + Electron 桌面壳
- [x] Node 同步服务
- [ ] 真人发音音频（ECDICT audio 字段 + 有道/离线音频）
- [ ] 背单词/记忆曲线复习
- [ ] Capacitor 打包 Android APK
- [ ] 中文分词搜索（FTS5 trigram）
- [ ] 划词取词（全局快捷键）
