# Android 签名密钥（v0.11.0 建立）

> ⚠ **本文件只记录指纹与位置，绝不记录口令。** 口令在仓库外的凭证文件里（见下）。
> ⚠ **密钥本身不入 git**（根 `.gitignore:103` 的 `.toolchain/` 规则）。

## 1. 这是什么，为什么重要

Android 要求每个 APK 用**同一个密钥**签名才能被已安装它的用户**覆盖升级**。
这把密钥因此是**应用的永久身份**：

- 用同一密钥签名 ⇒ 用户点「安装」即可升级，生词本保留
- 换密钥 ⇒ 系统判定为「不同应用」⇒ 老用户**必须卸载才能装新版，生词本会丢**

⇒ **密钥与口令必须离线备份**（U 盘 / 密码管理器）。丢失 = 该 App 永久无法再发更新。

## 2. 位置

| 项目 | 值 |
|---|---|
| 密钥本体 | `apps/mobile/android/.toolchain/zidiankaifa-upload.jks` |
| 台账副本 | `.android-toolchain/upload-keystore/zidiankaifa-upload.jks`（同一文件，哈希一致） |
| 口令凭证 | `apps/mobile/android/.toolchain/keystore.properties`（Gradle 读） |
| 人工台账 | `.android-toolchain/upload-keystore/KEYSTORE-CREDENTIALS.txt`（含口令，**仓库外**） |

**为什么放两处**：`.android-toolchain/` 是我的工具链落点、**整体不入 git**；但 Gradle 工程需要一份**随包自包含**的凭证，所以复制进 `apps/mobile/android/.toolchain/`（同样不入 git，规则见根 `.gitignore`）。
两处 `zidiankaifa-upload.jks` 的 SHA256 **实测一致**。

## 3. 密钥参数（可机械核对）

| 项目 | 值 |
|---|---|
| 类型 | PKCS12 |
| 别名 | `zidiankaifa` |
| 算法 | RSA 4096 · SHA256withRSA |
| 有效期 | 10000 天 |
| DN | `CN=LZK101 Zidiankaifa, OU=Personal, O=LZK101, L=Local, ST=Local, C=CN` |
| **SHA1 指纹** | `81:17:50:1A:2A:4E:BF:25:66:13:87:97:5B:12:B9:1A:8F:A7:BE:2C` |
| **SHA256 指纹** | `D3:7C:04:A8:13:03:7C:B6:2B:45:A7:E0:F8:AC:4C:76:89:B8:6E:3E:E0:A1:9E:BA:0E:35:6A:0A:3A:30:85:1E` |

> ⚠ **指纹有三种打印格式，直接字符串比较必然误判**（本项目实测踩过）：
> `keytool` 打**大写带冒号**（`D3:7C:04:…`）· `apksigner` 打**小写无冒号**（`d37c04a8…`）· 文档里可能两种混用。
> **比较前必须规范化**：取第一个冒号之后的子串 → 去掉所有非十六进制字符 → 转小写 → **断言长度必须是 64**。
> ⛔ 不要用「取最后一个冒号之后」—— 带冒号的指纹**每个字节后面都有冒号**，那样只会取到最后 1 个字节（实测得到 `1e`）。
> ⛔ 也不要把整行去做 `[^0-9A-Fa-f]` 过滤 —— 行标签里的 `a`/`e`/`A` 本身是合法十六进制字符，会被并入结果（实测得到 68/78 位）。

### 复现指纹（用于核对发布包是否为本密钥所签）

```powershell
$base = 'D:\lzk17\Documents\zidiankaifa\.android-toolchain'
$kt = "$base\jdk\jdk-21.0.12.1+1\bin\keytool.exe"
& $kt -list -v -keystore 'apps\mobile\android\.toolchain\zidiankaifa-upload.jks' -storepass '<口令>'
```

用 `apksigner` 核对**已产出的 APK** 用哪把密钥签的：

```powershell
& "$base\sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs `
    apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

⚠ **SHA256 指纹是「发布包签名一致性」的唯一机械判据**。任何一次发布前都应核对
`apksigner verify --print-certs` 的输出与上表一致 —— 不一致就说明签名配置没生效
（最可能的形态：产出的是 `app-release-unsigned.apk`，或 `keystore.properties` 没被读到）。

## 4. 凭证来源优先级（`app/build.gradle` 实现）

1. `apps/mobile/android/.toolchain/keystore.properties` ← **本机现用**
2. 环境变量 `ZIDIANKAIFA_KEYSTORE` / `ZIDIANKAIFA_KEYSTORE_PASSWORD` / `ZIDIANKAIFA_KEY_ALIAS` / `ZIDIANKAIFA_KEY_PASSWORD`（备用，供 CI）

`keystore.properties` 格式（`storeFile` 相对**仓库根**解析）：

```properties
storeFile=.toolchain/zidiankaifa-upload.jks
storePassword=<30 字符随机口令>
keyAlias=zidiankaifa
keyPassword=<同 storePassword>
```

## 5. 缺凭证时的行为（刻意设计）

`assembleRelease` 若拿不到凭证，**直接抛 `GradleException` 失败**，而不是产出一个
`app-release-unsigned.apk`。理由：unsigned 包**装不上真机**，但文件名看起来完全正常
⇒ 会造成「构建成功却发不出去」的**假绿**。本项目已有十余次口径/假绿类事故，故在此结构性堵死。

**debug 构建刻意不绑定** `signingConfig`：走 AGP 默认 debug keystore，模拟器安装足够。

## 6. 待办（发布前必须做）

- [ ] 把 `.android-toolchain/upload-keystore/KEYSTORE-CREDENTIALS.txt` **离线备份**（含口令）
- [ ] 首次发布 release APK 后，用 `apksigner verify --print-certs` 核对 SHA256 指纹与上表一致
- [ ] 在 GitHub Release 里**同时提供 APK 的 SHA256**，便于用户校验下载完整性
