# iOS 原生能力移植计划（2026-09-26）

背景：知乎、Linux.do 两个源在 iOS 上点开即报
`"ProxiedHttp" plugin is not implemented on ios` / `"LinuxDoSession" plugin is not implemented on ios`。
根因不是网络，而是 iOS 层只移植了 2 个原生插件，其余 Android 专属能力没有对应实现，
且部分 JS 调用点用 `Capacitor.isNativePlatform()`（iOS 为真）当作"Android 原生能力可用"的判据。

## 0. 进展（滚动更新）

| 文件 | 状态 | 注册 | 测试 |
|---|---|---|---|
| `ProxiedHttpPlugin.swift` | 已落盘 430 行（含代理 407 认证修正） | pbxproj A140 + MainViewController | 方法表 / SOCKS5 / Set-Cookie / 代理凭据 |
| `SecureStorePlugin.swift` | 已落盘 165 行（Keychain） | pbxproj A150 + MainViewController | Keychain 策略 / null 契约 / reject 文案 |
| `ZhihuSessionPlugin.swift` | 已落盘 834 行（WKWebView 登录） | pbxproj A160 + MainViewController | 方法表（2 个） |
| `LinuxDoUserApiAuth.swift` | 已落盘 917 行（ASWebAuthenticationSession + RSA/Keychain） | pbxproj A170 | 兜底登记检查 |
| `LinuxDoBrowserSessionSupport.swift` | 已落盘 857 行（WKWebView 会话恢复 + Cookie 提交） | pbxproj A180 | 兜底登记检查 |
| `LinuxDoSessionPlugin.swift` | 进行中：10/14 方法（读路径）；上传 4 方法待补 | pbxproj A190 + MainViewController | 方法表待补全 |
| `Info.plist` | `newsnook` + `discourse` 两个 scheme 已注册 | — | scheme ↔ `MOBILE_AUTH_CALLBACK_URL` / `callbackURLScheme` parity |

测试入口（均在 CI 既有列表里，本地绿）：`npm run test:ios-native-plugin`、`npm run test:ios-platform`。
`test:ios-native-plugin` 现在还会兜底断言 **`ios/App/App` 下每个 `.swift` 都登记进 Xcode Sources** —— 漏登记的文件「存在、测试也过」，但根本不参与编译。

## 0b. 剩余工作

1. `LinuxDoSessionPlugin.swift` 补 4 个上传方法（`beginUpload` / `appendUploadChunk` / `finishUpload` / `cancelUpload` + `linuxDoUploadProgress` 事件），并把 `LinuxDoSession` 加进一致性测试表（14 个方法）。**进行中**。
2. 编译验证：推分支走 `.github/workflows/ios-build.yml`（需用户授权推送）——这是唯一能证明 Swift 可编译的手段。
3. Tier 3（`ReadAloud` / `VolumePageTurn` / `SyncNotification` / `MediaSniffer` / `DlnaCast`）按用户选择处理；`DlnaCast` 在 iOS 需要 Apple 特批 multicast entitlement，自签 IPA 不可用。

## 0c. 本轮已跑通的验证（本地，2026-09-26）

| 套件 | 结果 |
|---|---|
| `npm run lint` | 0 errors（18 条既有 warning，都在 `scripts/`） |
| `npx tsc -b tsconfig.app.json` | exit 0 |
| `test:ios-platform` / `test:ios-native-plugin` | ok |
| `test:native-platform` / `test:device-media-controls` / `test:apple-translation` / `test:free-translation` / `test:translation` / `test:ui-font` | 全部 ok（iOS 层 CI 列表） |
| `test:account-auth`（新增 2 个 iOS 用例）/ `test:secure-secret-hydration` / `test:cloud-sync-runtime` / `test:account-sync-ui` | 全部 ok |
| `test:linuxdo` / `test:zhihu-session` / `test:zhihu` | 全部 ok |

注：`tsx` / `rolldown` 在本机沙箱里需要 `danger-full-access`（esbuild/rolldown 要 spawn 子进程，默认被拒为 EPERM）；`test:ios-project` 依赖 macOS 的 `plutil`，Windows 上跑不了。

## 0c-2. 提交与分支状态（2026-09-26）

- 全部改动已提交到**本地分支** `ios-native-plugins`（commit `60b40bb`，23 个文件，+8280/−15）。`main` 未动，未推送。
- 提交信息见 `D:\GitHub_Clone\_port-analysis\commit-msg-newsnook-ios-native-plugins.txt`。
- 编译验证已用 `ios-build.yml` 的 `workflow_dispatch` + `checkout_ref`（`publish_release=false`）完成，随后折叠进 `ios-layer` 与 `main`（见 §0c-4）。
- 已知待修：`performUpload` 在主线程同步序列化整个 multipart 请求体（256 MB 上限时可能冻 UI 数秒）——应把序列化挪到后台队列，完成后再回主线程起 `uploadTask`。**排在编译通过之后做**，避免第一次 CI 失败混入自造错误。
- 已知取舍：iOS 上选了 SOCKS5 代理时，`transport.ts` 仍返回 `native-tunnel`，由 `ProxiedHttpPlugin` 在请求时明确 reject 并给出中文原因。**不要改成 `unsupported`**——`src/lib/http.ts` 对 `unsupported` 的处理是「不带 tunnel 直接请求」，那会变成静默直连（最坏结果）；设置页提前提示属于 UI 改进，可另做。

## 0c-3. 编译验证通过（2026-09-26）

`ios-build.yml` 在 `macos-26` 上 **全部 13 个步骤成功**（Build (unsigned) / Package IPA / Upload artifact 均 success）：

- 分支 `ios-native-plugins`，run [`36213707066`](https://github.com/IamNewHands/newsnook-ios/actions/runs/36213707066)
- 产物 artifact：`NewsNook-1.8.9-unsigned-ipa`（2.73 MB，未过期）
- 触发方式：`gh workflow run ios-build.yml --ref ios-native-plugins -f checkout_ref=ios-native-plugins -f publish_release=false`

迭代过程（4 次 CI，共修 14 个 Swift 编译错误，全部是真实错误，不是环境问题）：

| run | 错误数 | 内容 |
|---|---|---|
| 36212952577 | 8 | 4 处对强引用 `self` 用 `guard let self`；`browserTransportWaiters` 类型写成 `(WebView?)`；`jsonLiteral` 缺字典重载 |
| 36213170591 | 2 | `WKWebView.customUserAgent` 是 `String?`，未解包 |
| 36213336389 | 7 | 缺 `import AuthenticationServices`；`LinuxDoIdentityRedirectBlocker` 类型根本没写；`@MainActor` 类型在非隔离 `load()` 里构造；`URLSessionUploadTask` 没有 `completionHandler` 属性 |
| 36213707066 | 4 | `ProxiedHttpPlugin` 的可选 headers 未解包；`makeOnce()` 返回闭包却被当对象调 `.claim()` |

**结论：6 个 Swift 文件全部通过编译器**（ProxiedHttp / SecureStore / ZhihuSession / LinuxDoSession / LinuxDoUserApiAuth / LinuxDoBrowserSessionSupport）。仍未验证的是**运行时行为**：代理出口 IP、Set-Cookie 逐条回传、`loadHTMLString` 的 document.origin、上传进度回调等，只能真机点检（各 port spec 列了清单）。

## 0c-4. 折叠回 `ios-layer`（已完成，2026-09-26）

产物已折叠进 iOS 层，三个不变量本地与远端都验证通过：

| 不变量 | 结果 |
|---|---|
| `ios-layer^` 的树 == 上游 `v1.8.9` tag 的树 | ✅ `e4cf937…` |
| `ios-layer` 与 `main` 的树一致（`ios-sync.yml` 的 drift guard 就是这条） | ✅ `git diff --quiet origin/ios-layer origin/main` 退出 0 |
| 旧 `main` 是新 `main` 的祖先（main 只快进，从不 force-push） | ✅ |

做法（`ios-layer` 是补丁源，force-push 是它的正常更新方式，`ios-sync.yml` 自己也这么推）：

```bash
L=$(git commit-tree <新树> -p 4ea4d1a -m 'feat(ios): v1.8.9 + 完整 iOS 层…')   # 层提交
M=$(git commit-tree <新树> -p <旧 main> -F <消息文件>)                          # main 提交
git push origin "$M:main"                        # 快进
git push --force origin "$L:refs/heads/ios-layer"
```

最终 SHA：`main = fc56e3f`，`ios-layer = 2ad5505`（树同为 `6e245be…`）。
零删除：`git diff --diff-filter=D --name-only <旧 main> <新 main>` 为空。

## 0d. 账号 iOS 平台适配（已完成）

`authClient.ts` 的 `native` 判据从 `platform === 'android'` 改成 `platform !== 'web'`，
`createPlatformAccountAdapter()` 现在把 iOS 映射成 `'ios'` 并走 `Browser.open`。
这一处同时修好四件事：session 落 SecureStore（Keychain）、请求带 `Authorization: Bearer`、
社交登录开在系统浏览器而不是 App 自己的 WebView、OAuth 回调走
`${baseUrl}/api/v1/auth/mobile/complete` → `newsnook://auth/callback` 深链（scheme 已在 `Info.plist` 注册）。
`scripts/account-auth.test.ts` 新增两个 iOS 用例把这条路径钉住（含「杀进程重开仍算已登录」）。

## 1. 插件级审计（Android 11 个 vs iOS 2 个）

| Android 插件 (Java) | 行数 | JS 入口 | iOS 守卫 | iOS 现状 |
|---|---|---|---|---|
| ProxiedHttpPlugin | 155 | `src/features/proxy/nativeHttp.ts:34` | **无** | ❌ 原始报错。知乎认证/图片上传、代理隧道全部命中 |
| LinuxDoSessionPlugin | 1661 | `src/features/linuxdo/session/native.ts:41` | **无**（只判 isNativePlatform） | ❌ 原始报错。Linux.do 工作区整体不可用 |
| ZhihuSessionPlugin | 469 | `src/features/zhihu/session/native.ts:26` | `isPluginAvailable` ✓ | ⚠️ 降级为"仅 Android 提供登录"，但只读路径仍会撞 ProxiedHttp |
| SecureStorePlugin | 140 | `src/features/account/native.ts:13` | **无**（`secureStore.ts:83` 直接按 isNativePlatform 选原生实现） | ❌ 原始报错。账号登录 / Secret 回填 / 知乎凭据落盘 |
| ReadAloudPlugin | 284 | `src/features/readAloud/native.ts:66` | `getPlatform()==='android'` ✓ | ⚠️ 降级到 Web Speech / AI TTS，可用但无后台播放 |
| DlnaCastPlugin | 1263 | `src/lib/dlnaCast.ts:63` | `getPlatform()==='android'` ✓ | ⚠️ 隐藏，投屏提示"仅支持 Android 真机" |
| MediaSnifferPlugin | 1555 | `src/features/mediaSniffer/native.ts:160` | `getPlatform()!=='android'` 提前返回 ✓ | ⚠️ 降级：自定义源视频只剩直连播放 |
| VolumePageTurnPlugin | 48 | `src/lib/volumePageTurn.ts:14` | `isPluginAvailable` ✓ | ⚠️ 隐藏：音量键翻页不可用 |
| SyncNotificationPlugin | 104 | `src/features/sync/nativeNotification.ts:24` | `getPlatform()==='android'` ✓ | ⚠️ 静默跳过同步通知 |
| AppUpdatePlugin | 370 | `src/features/appUpdate/native.ts:39` | `getPlatform()==='android'` ✓ | ✅ 正确隐藏（iOS 无 APK 自更新） |
| DeviceMediaControlsPlugin | 240 | `src/lib/deviceMediaControls.ts:20` | — | ✅ 已移植（Swift） |

未适配（原始报错）的插件共 4 个：**ProxiedHttp、LinuxDoSession、SecureStore、ZhihuSession（仅剩 transport 侧未接）**。

## 2. 非插件类审计（同一类"没有转成 iOS"的问题）

| 位置 | 问题 | 影响 |
|---|---|---|
| `ios/App/App/Info.plist` | 没有 `CFBundleURLSchemes` | `newsnook://auth/callback` 回流不可用；账号 OAuth 在 iOS 无法回到 App |
| `ios/App/App/Info.plist` | 没有 `UIBackgroundModes`（audio / fetch） | 朗读、AI TTS、同步在后台会停 |
| `src/features/account/authClient.ts:342-348` | iOS 被归为 `platform: 'web'` | 账号走 Cookie 适配器；配合 SecureStore 缺失会在登录时抛错 |
| `src/lib/batteryStatus.ts:44` | 只实现了 Android sticky intent + Web Battery API | iOS WKWebView 没有 Battery API，电量探测不可用 |
| `docs/ios-build.md:149` | 声称"自动降级" | 与 4 个插件的实际行为不符，需改写 |
| `src/lib/http.ts`（native-tunnel 分支） | 代理隧道走 ProxiedHttp | iOS 一旦配置 App 内代理，**所有源**都会报同一个错 |

已确认**没有**同类问题：官方 Capacitor 插件（Http / Cookies / SystemBars / Filesystem / Share / Preferences / Network / Browser / App / CommunityMedia）在 iOS 工程与 SPM 清单里齐备；
`@capacitor/ios` 自带 `CapacitorHttp.swift`，所以"非隧道"HTTP 路径在 iOS 是通的。

## 2b. 账号的 iOS 平台适配（已完成，2026-09-26）

`createPlatformAccountAdapter()`（`src/features/account/authClient.ts:345-358`）只分 android / 其余：

```ts
const android = Capacitor.getPlatform() === 'android'
platform: android ? 'android' : 'web'
```

iOS 落到 `'web'` 分支，而 `platform === 'android'` 是整套 bearer 逻辑的开关
（`authClient.ts:82` `const native = platform === 'android'`）。后果：

1. iOS 不写也不读 SecureStore 里的 session → 即使 SecureStore 已移植，登录仍不跨重启；
2. `fetchCloud` 不带 `Authorization: Bearer`，改依赖云域名的 Cookie —— 上游注释已说明
   这条在 WebView 里不可靠，iOS WKWebView 的第三方 Cookie 策略同样会拦；
3. `openExternal` 走 `window.location.assign(url)`，把 OAuth 页面开在 App 自己的
   WKWebView 里，而不是系统浏览器 / ASWebAuthenticationSession；
4. 回调路径 `newsnook://auth/callback` 在 iOS 上**不可用**：`Info.plist` 没有
   `CFBundleURLTypes`（已核对全文），系统不会把该 scheme 交回 App。

要改的点：`AccountPlatform` 增加 `'ios'`（`features/account/types.ts:14`）；`native` 判据改成
按 `isPluginAvailable('SecureStore')` 而不是平台字符串；`openExternal` 在 iOS 走
`Browser.open`；`Info.plist` 注册 `newsnook` scheme；核对 `useAccount.ts` 的 `appUrlOpen`
回调与 `features/sync/deviceIdentity.ts`、`AccountSyncScreen.tsx` 的平台分支。

## 3. 移植分层

### Tier 1 — 打通用户报障路径
1. `ProxiedHttpPlugin.swift`（URLSession + 代理 + base64 二进制 + Set-Cookie 数组 + 重定向控制）
2. `LinuxDoSessionPlugin.swift`（含 `LinuxDoUserApiAuth` / `LinuxDoBrowserSessionRecovery` / `LinuxDoCookieCommit` 三个辅助类）
3. `ZhihuSessionPlugin.swift`（WKWebView 登录 + WKHTTPCookieStore 取 Cookie）

### Tier 2 — 同类原始报错
4. `SecureStorePlugin.swift`（Keychain 替代 AndroidKeyStore + AES-GCM）

### Tier 3 — 功能缺口（已正确降级，但 iOS 缺能力；需产品决策）
5. `VolumePageTurnPlugin.swift`（48 行，AVAudioSession 音量 KVO）
6. `SyncNotificationPlugin.swift`（104 行，UNUserNotificationCenter）
7. `ReadAloudPlugin.swift`（284 行，AVSpeechSynthesizer + 后台音频，需 Info.plist `UIBackgroundModes: audio`）
8. `MediaSnifferPlugin.swift`（1555 行，WKWebView 拦截；架构与 Android 不同）
9. `DlnaCastPlugin.swift`（1263 行；iOS 惯例是 AirPlay 而不是 DLNA，属于**改写**而非移植）

## 4. 每个插件都必须完成的收尾项

- [ ] Swift 文件落到 `ios/App/App/`
- [ ] `project.pbxproj` 三处登记（PBXBuildFile / PBXFileReference / Sources + group），ID 用未占用的 `A14x`/`A15x` 段
- [ ] `MainViewController.swift` 的 `capacitorDidLoad()` 注册
- [ ] `scripts/ios-native-plugin.test.mjs`（或新脚本）断言 jsName、方法表、@objc 实现一一对应
- [ ] JS 侧守卫改按插件能力判断（`isPluginAvailable` / `getPlatform()==='android'`），缺能力时给中文可读提示
- [ ] `docs/ios-build.md` 的能力边界表同步更新

## 5. 验证路径（本机无法编译 Swift）

Windows 上没有 Xcode，**任何 Swift 都不能在本地编译或运行**。可行验证：
1. `npm run lint`、`npm run test:ios-native-plugin`、`npm run test:ios-project`（静态断言）
2. `npm run test:proxy`、`test:linuxdo*`、`test:zhihu-*`、`test:account-auth`（JS 契约回归）
3. 推送分支后由 `.github/workflows/ios-build.yml` 在 `macos-26` 上编译未签名 IPA —— 这是唯一能证明 Swift 能编译的手段，需要用户授权推送
4. 真机点检：知乎列表/正文、知乎登录、Linux.do 列表/正文/登录/阅读记录上传、代理隧道

## 6. 层归属（重要）

`main` 的树 = 上游 tag 树 + `ios-layer` 树，直接改 `main` 会在下次上游同步时被抹掉。
本次改动最终必须折叠回 `ios-layer` 分支后再让 `main` 指向同一棵树。本地当前工作树在 `main` 上、未提交。
