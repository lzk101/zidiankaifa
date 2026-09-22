# v0.11.0 — 手机端 ＋ 端云互通

> 发布日期：**2026-09-22**（GA1–G6 全绿，见文末）
> 上一个版本：v0.10.0（2026-09-14）
> 主题：把电子辞典从**只有桌面端**扩展为**手机端（Capacitor 真 App）＋ 桌面/手机双向同步 ＋ 多用户账号隔离**。

> ⚠ **本文档状态：随发布同步维护**。撰写时点 HEAD `09c74bb`；**发布前更新至 `2026-09-22`（R3 落地、版本 bump 0.11.0、APK 重打）**。
> **未完成项一律照实标注为「未交付」，不得在正式发布时移除这些标注** ——
> 本项目已有十余次「把 intended 写成 done」的口径事故，发布说明是最容易出事的地方。

---

## 一、这个版本新增了什么

### 1. 手机端：Capacitor 真 Android App（可安装）

此前项目只有桌面端（Electron）。本版新增 `apps/mobile/`：

- **Capacitor 8.5.2** 壳，`webDir` 指向 `apps/web/dist` —— **复用 Web 端全部 UI 与逻辑**，不重写界面
- 包名 `com.lzk101.zidiankaifa` · 应用名「电子辞典」· `minSdk 24`（Android 7.0+）/ `targetSdk 36`
- 原生工程入 git（Gradle 配置、Manifest、图标、签名配置均可追溯），构建产物不入 git

**实测证据**（模拟器 `emulator-5554` / AVD `zdk35`）：

| 项 | 结果 |
|---|---|
| `gradlew assembleRelease` | `BUILD SUCCESSFUL` · exit 0（**重打包 30 s**，124 tasks） |
| 产物 | `app-release.apk` = **3,277,846 B** · SHA256 `C040CE801A6F3C6242FE670F825CDD0A8CD96433FFB52DBDABF6E3FED28648AA` |
| 签名 | **已签名** —— `apksigner verify`：`Verifies` · v2 scheme `true` · 1 signer |
| 证书 SHA-256 | `d37c04a813037cb62b45a7e0f8ac4c7689b86e3ee0a19eba0e356a0a3a30851e` |
| 安装 | `adb install -r` ⇒ `Success`（5.4 s）|
| 启动 | `topResumedActivity=com.lzk101.zidiankaifa/.MainActivity` |
| 界面 | 标题「我的电子辞典」· 搜索框 · 自动/英语/俄语 · **五面板**（查词/生词本/词根词缀/词根分类/设置）—— 无白屏、无 WebView 报错 |

**⚠ 下载到的 APK 如何校验**：见 §四。

### 2. 手机 ↔ 电脑 双向同步（已实测成立）

同一个生词本在手机与电脑之间**双向流动**，冲突按 **last-write-wins** 合并，删除用**墓碑**传播。

**实测证据**（真 sync-server ＋ 真 SQLite，非模拟）：

| 方向 | 操作 | 结果 |
|---|---|---|
| 手机 → 电脑 | 手机端写入一条带中文笔记与标签的生词 | PC 库回读 **4 行**含该词；`note="T81 手机端写入"`（中文）与 `tags:["手机端"]`（数组）**完整往返** |
| 电脑 → 手机 | PC 端写入新词 | 手机端 `pulled=5` 且**看得见该词**；`status`/`note`/`tags`/`reviewCount` **逐项一致** |
| 时间戳推进 | 同一条目 `updatedAt +5000` 再推 | `pushed=1` ⇒ **跨端更新真的发生**；同时间戳再推 ⇒ `pushed=0`（LWW 生效） |

### 3. 三个真实缺陷的修复

手机端联调过程中实测发现并修复（**都是「能跑但会静默出错」的类型**）：

| 编号 | 缺陷 | 用户可见后果 | 修法 |
|---|---|---|---|
| `V11-SYNC-DTO` | 服务端把**数据库原始行（snake_case）**直接当 `BookItem`（camelCase）用 | ① 同步接口 **500** ② 更隐蔽的是 `updatedAt > cur.updated_at` **恒假** ⇒ **跨端更新被静默漏推**（不报错、不生效） | 服务端改用 `bookListAll()`（内含 `rowToBook` 映射）；新增入站 DTO 规范化，容忍 snake_case |
| `V11-NOTE-NULL` | `firstDefined` 只滤 `undefined` 不滤 `null` | 笔记字段被写成字符串 `"undefined"` | 同时滤掉 `null` |
| `V11-OPENDB-LEAK` | `openDatabase()` 任一抛错路径**既不返回也不关闭**连接 | 长驻进程内反复打开失败库会累积句柄；测试侧收尾无法删除临时库（`EPERM`） | `try/catch` 补 `db.close()`，**原错误原样抛出**（桌面端要展示中文错误消息） |

> ⚠ **为什么这些缺陷能穿过 643 条门禁**：`packages/core/test/book_lang.mjs` 与 `apps/sync-server/scripts/smoke.mjs`
> **都直接调用函数**（手工构造 camelCase 对象），**没人测 HTTP 边界** ⇒ 两层各自自洽、交界处无人测。
> 本版补了 `scripts/check_sync_dto_contract.mjs`（22 断言）专门守这条边界。

---

## 二、本版**没有**做的事（照实披露，勿在宣传中省略）

| 项 | 状态 | 说明 |
|---|---|---|
| **账号与多用户隔离** | ✅ **已交付** | 服务端新增 `POST /api/v1/auth/{register,login,revoke}` 与 `GET /api/v1/auth/whoami`；生词本主键升级为 **`(user_id, word, lang)`** ⇒ **不同用户的生词本互不可见**（实测：两用户写同词同语言各存一行）。口令以 `scrypt$N$salt$hash` 落库、令牌**只存哈希**且可撤销。**首个注册账号会「认领」本机已有的匿名生词本**（实测 `claimed = 3`） |
| **离线查词** | ❌ **未交付** | 安装包内 `assets/` **仅 226.6 KB**（只有 web 壳），**不含任何词库文件**。⇒ **断网状态下无法查词** |
| **iOS 版本** | ❌ **无法交付** | iOS 编译**必须 macOS + Xcode**，Windows 上物理做不到 ⇒ **本版仅 Android** |
| **开箱即用的云同步** | ❌ **未交付** | 同步需要**自行部署** `apps/sync-server`；手机端还需与服务器同局域网并手填地址。⇒ 电脑关机/换网/进程退出 ⇒ 手机端同步即不可用 |
| **桌面端账号 UI** | ⚠ **未交付** | 桌面端的账号登录入口本版未做；**Web / 手机端**可在「设置」里注册或登录。桌面端仍走旧的匿名通道（等价于「本机用户」） |

---

## 三、升级须知

### 桌面端（从 v0.10.0 升级）

- 生词本**不会丢**。v0.11.0 的 `book` 表在云端/服务端侧引入了用户维度，**本机桌面端数据不受影响**（匿名使用等价于「本机用户」）
- 词库仍随安装包内置，**无需任何服务器即可查词**（与 v0.10.0 相同）

### 手机端（新安装）

- **仅 Android 7.0（API 24）及以上**
- 首次安装后如需同步：在「设置」里填入同步服务地址
- ⚠ **debug 包与 release 包签名不同，不能互相覆盖安装**；若你此前装过开发版，需先卸载

---

## 四、下载与校验

| 文件 | 用途 |
|---|---|
| `zidiankaifa-0.11.0-x64.exe` | Windows 安装版（**175,048,814 B**） |
| `zidiankaifa-portable-0.11.0-x64.exe` | Windows 免安装版（**174,818,998 B**） |
| `app-release.apk` | Android 安装包（**3,277,846 B**） |
| `latest.yml` / `*.blockmap` | 桌面端自动更新元数据 |

**APK 校验值**（确认下载完整且未被替换）：

```
文件 SHA-256 : C040CE801A6F3C6242FE670F825CDD0A8CD96433FFB52DBDABF6E3FED28648AA
签名证书 SHA-256 : D3:7C:04:A8:13:03:7C:B6:2B:45:A7:E0:F8:AC:4C:76:89:B8:6E:3E:E0:A1:9E:BA:0E:35:6A:0A:3A:30:85:1E
```

```powershell
# 自行核验（需 Android SDK 的 apksigner）
apksigner verify --print-certs zidiankaifa-0.11.0.apk
```

> ⚠ 指纹有三种打印格式（`keytool` 大写带冒号 / `apksigner` 小写无冒号），
> **直接肉眼比对容易看错**：请去掉冒号、忽略大小写后比较这 64 个字符。

---

## 五、发布门禁（**G1–G6 全绿**）

| # | 门禁 | 状态 |
|---|---|---|
| G1 | AC-27 用户隔离与凭证（`DEC-031` 发布阻断项） | ✅ **已落地** —— `scripts/probe_t97_r3_isolation.mjs` **33 通过 / 0 失败 exit 0** |
| G2 | 门禁 core **626**/0 ＋ desktop **22**/0 ＝ **648/0** | ✅ 已复测（旧口径 643 作废：`book_lang.mjs` 137 → **142**） |
| G3 | APK 签名指纹 = keystore 指纹 | ✅ `Verifies` · v2 `true` · 1 signer |
| G4 | 包内 web 资源为**最新**构建 | ✅ 双方均为 `index-CwJqPsi9.js` / 200,263 B（含 `v0.11.0`） |
| G5 | 四包版本号与 3 处文本统一为 `0.11.0` | ✅ 全部 `0.11.0`，`/health` 实测返回 `"version":"0.11.0"` |
| G6 | `versionCode` 单调递增 | ✅ `1100` / `versionName "0.11.0"` |

逐条核验命令见 `docs/v0.11.0-status.md`。

---

## 六、已知限制（不阻断发布，但用户应当知道）

1. **同步服务需自建**：本版**没有**托管的云服务。要多设备同步，须自行运行 `apps/sync-server`
2. **仍是「自建服务器」形态**：服务端现已支持账号与用户隔离（见 §一），但**没有托管云**。⇒ 只给自己用可以；若要给他人用，**务必先在设置里注册账号** —— 一旦服务端存在账号，**未登录的匿名同步通道即被关闭**（无凭证返回 401），这是有意设计（否则任何人可读写全库）
3. **离线不可用**：见 §二第 2 行
4. **iOS 缺失**：见 §二第 3 行
5. **俄语侧的「高频」标准不存在**：词库 `words_i18n` 的俄语侧**没有任何词频列**，英文侧也仅 45,443 词有 BNC 排名 ⇒ 将来的离线词表**不会**以「高频」命名，具体判据见 `.board/REQ.md`
