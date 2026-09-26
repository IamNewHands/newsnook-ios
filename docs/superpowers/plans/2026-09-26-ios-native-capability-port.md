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
| `LinuxDoSessionPlugin.swift` | 已落盘 2782 行（14 方法，含 4 个上传方法 + 进度事件） | pbxproj A190 + MainViewController | 方法表（14 个） |
| `SyncNotificationPlugin.swift` | 已落盘 143 行（UNUserNotificationCenter + 深链回跳） | pbxproj A1A + MainViewController | 方法表 / 优先级 / 降级 / 深链 scheme |
| `ReadAloudPlugin.swift` | 已落盘 896 行（AVSpeechSynthesizer + 后台音频 + 锁屏控制） | pbxproj A1B + MainViewController | 方法表（8 个）/ 后台音频 / 远端命令 / UTF-16 偏移 |
| `DlnaCastUpnp.swift` + `DlnaCastPlugin.swift` | 已落盘 727 + 480 行（单播 SSDP + 手动 IP + SOAP 直连） | pbxproj A1C/A1D + MainViewController | 方法表（6+3）/ 禁组播 / UPnP 动作面 |
| `MediaSnifferProbeScript.swift` + `MediaSnifferWebProbe.swift` + `MediaSnifferStreamProxy.swift` + `MediaSnifferPlugin.swift` | 已落盘 412 + 314 + 430 + 292 行（注入探针 + 本机媒体中转） | pbxproj A1E–A21 + MainViewController | 方法表（7 个）/ 探针来源 / 回环监听 / 请求头白名单 |
| `Info.plist` | `newsnook` + `discourse` scheme、`UIBackgroundModes: audio`、`NSLocalNetworkUsageDescription`、`NSAllowsLocalNetworking` | — | scheme ↔ `MOBILE_AUTH_CALLBACK_URL` / ATS 放行本机中转 |

测试入口（均在 CI 既有列表里，本地绿）：`npm run test:ios-native-plugin`、`npm run test:ios-platform`。
`test:ios-native-plugin` 现在还会兜底断言 **`ios/App/App` 下每个 `.swift` 都登记进 Xcode Sources** —— 漏登记的文件「存在、测试也过」，但根本不参与编译。

## 0b. 剩余工作

1. **真机验收**：Tier 3 四套能力都只在 CI 上编译过。首轮真机结果（构建 `34-2688ad9`）：
   **后台朗读 ✅**、**媒体嗅探 ✅**、**AirPlay ✅ 到「弹出系统本地网络权限框」这一步**（无 Apple TV，
   投屏本身未验）；DLNA 单播扫段同样卡在「没有电视」。其余项见
   [`docs/ios-build.md`](../../ios-build.md) 的「2026-09-26 原生插件移植的真机验收项」。
2. **DlnaCast 兼容中转（proxy 模式）未实现**：Android 在电视无法直连视频源时会把视频经
   本机前台服务中转（`CastMediaProxy` + `DlnaCastForegroundService`，614 行）。iOS 侧只做直连，
   直连确认失败时明确 reject，`session.mode` 恒为 `direct`。补它需要一个本机 HTTP 服务器
   —— `MediaSnifferStreamProxy` 已经是同构实现，可以复用。
3. **MediaSniffer 的覆盖缺口**：注入脚本拿不到跨进程的媒体子请求与 Service Worker 内部的请求
   （平台限制）。若要更接近 Android，需要 iOS 18+ 的 `WKWebView.proxyConfigurations`
   做真拦截，但那会把最低版本抬到 18。
4. `VolumePageTurnPlugin.swift`（音量键翻页）：用户明确「暂时不做」。iOS 只能 KVO 观察
   `AVAudioSession.outputVolume`，按一下音量会真的变，属可用但有副作用的方案。
5. `performUpload` 在主线程同步序列化整个 multipart 请求体（256 MB 上限时可能冻 UI 数秒）——
   应把序列化挪到后台队列。**仍待办**。

## 0e. 第三轮：返回手势（2026-09-26）

真机反馈：右滑返回能用但「跳一下、像返回了两层」；设置页进二级页后不能右滑返回。

| 症状 | 归因 | 改动 |
|---|---|---|
| 工作区右滑返回跳一下 | `resetAfterBack` 与 `onBack` 挤在同一 tick 复位合成层，旧页面被画回原位一帧（`commit()` 上方注释早就写了这个坑，`resetAfterBack` 又踩了一次） | `useEdgeSwipeBack.ts`：复位延后两帧 + `isConnected` 守卫 |
| 其他源右滑返回跳一下 | `closeReader()` 同一 tick 调 `recoverAppScrollAfterNavigation()`，清掉正在退场的阅读器壳 `transform`。上游代码，一直存在；新包更重，React 提交被推到绘制之后才显形 | `App.tsx`：`closeReader` 的复位延后两帧 |
| 一次滑动退两层 | 每个 hook 实例都往 `window` 挂 `touchmove`，`touchstart` 冒泡到每个祖先实例；阅读器（`<main>` 之外的浮层）与工作区（`<main>` 之内）可同时挂载，两边各调一次 `onBack`。**未能真机复现，属代码可证的洞** | `useEdgeSwipeBack.ts`：模块级单实例认领（最内层先到先赢） |
| 设置二级页不能右滑 | 从未接线 | `SettingsShell.tsx`：接 `useEdgeSwipeBack(edgeOnly)`，一处覆盖全部设置页；入场动画挪到内层（CSS 动画优先级高于内联 `transform`，否则整页拖不动）；`edgeSwipeBack.ts` 加右滑返回时间窗标记，让返回不重复播入场动画 |

验证：`test:edge-swipe` 扩了标记契约；`lint` / `tsc -b` / 全量 `test:*` 见 §0c。真机验收项见
[`docs/ios-build.md`](../../ios-build.md) 的「2026-09-26 第三轮：返回手势的真机验收项」。

真机结果（构建 `34-2688ad9`）：

- ✅ **设置二级页左缘右滑返回**——本轮新增能力，用户确认可用。
- ✅ 右滑返回不再「跳一下」，也不再像退两层。
- ❌ 阅读器右滑返回**短暂闪一下空白**再返回：比修前好，但「还是不够丝滑」→ 见 §0e-2。

## 0e-2. 第四轮：阅读器右滑返回闪空白（2026-09-26）

真机反馈的关键是**对比**：设置页右滑丝滑，阅读器右滑闪空白。把四个调用方摆一起看，形状差异只有一个：

| 调用方 | 被拖动的那一层 | 真机结果 |
|---|---|---|
| `SettingsShell` | 不透明根层（`absolute inset-0 … bg-ink`），入场动画在内层 | 丝滑 |
| 知乎工作区 | 不透明根层（`section … bg-ink`），根层无动画 | 丝滑 |
| Linux.do 工作区 | 不透明根层（`div … bg-ink`），根层无动画 | 丝滑 |
| 阅读器 | 根层里那块 `flex-1` 的**正文面**；根层透明、且根层带 `reader-in` 动画 | 闪空白 |

只拖正文面有两个后果：（a）根层上下两条安全区留白（`--sat` / `--sab`）原地不动，左右又直接露出下层
列表，滑动过程中画面是「撕裂」的；（b）正文面处在一个带 `fill-mode` 终态的动画层内部，合成器必须
重画那一层才能补上让出的区域，那几帧就是「空白」。

修法：把阅读器对齐到另外三处**已在真机确认丝滑**的形状。

| 改动 | 文件 |
|---|---|
| 根层（`absolute inset-0 z-30`）挂 `reader-swipe-surface` + `bg-ink`，`shellRef` 上移一层，根层成为被拖动的那一层 | `src/screens/ReaderScreen.tsx` |
| `reader-in` 入场动画下移到内层 `flex min-h-0 flex-1 flex-col`（挂外层会被 `fill-mode` 终态顶掉内联 `transform`，与 `SettingsShell` 同一个坑） | 同上 |

副作用检查：`touch-action` 的祖先链上仍然只有一个 `pan-y pinch-zoom`（原来在正文面、现在在根层），
交集不变，正文里宽表格（`data-reader-horizontal-scroll`）的横向拖动不受影响；右缘左滑开评论的监听
目标也一并从正文面挪到根层（根层是超集，手势路径不变）。

验证：`test:edge-swipe` / `test:ios-native-plugin` / `test:reader-images` / `test:reader-font-pinch`
全 ok；`lint` 0 errors（18 条既有 warning，数量与上一轮相同）；`npx tsc -b tsconfig.app.json` exit 0。
真机验收项见 [`docs/ios-build.md`](../../ios-build.md) 的「2026-09-26 第四轮：阅读器右滑返回闪空白」。

真机结果（构建 `35-4ea4844`）：✅ 闪空白消失、「效果好很多了」；❌ 但「动画有点生硬、帧率不太足、
有点拖影」→ 见 §0e-3。

## 0e-3. 第五轮：右滑返回的帧率优化（2026-09-26）

第四轮解决的是「有没有东西可看」，第五轮解决的是「每帧要算多少」。改的两处都只动 CSS：

| 现象 | 归因 | 改动 |
|---|---|---|
| 起步一顿、之后一路拖影 | 合成层是右滑第一帧才升的（`useEdgeSwipeBack` 在 `begin()` 里写 `will-change`），升层与首次栅格化都挤在手指刚动的那几帧里 | `.reader-swipe-surface` 常驻 `will-change: transform` + `backface-visibility: hidden` |
| 持续掉帧 | 顶栏 `bg-ink/90 backdrop-blur-md`：`backdrop-filter` 每帧重新采样背景并重算模糊 | `[data-swipe-back-active='true']` 期间关掉整棵子树的 `backdrop-filter`，`[data-surface='reader-chrome']` 换不透明底色（与 eink 模式同一套处理） |

没有改手势判据、时长或缓动。下一批候选（若真机仍生硬）：`box-shadow` 换左缘渐变条、滑动期间
顶栏改 `position: static`、提交动画改 `element.animate()`。

## 0h. 关于页补上本版仓库（2026-09-26）

`关于 → 项目与文档` 原本只有上游 `t59688/newsnook` 一个仓库入口。现在多一行
`IamNewHands/newsnook-ios`（标签「本版」）——本版 iOS 层与未签名 IPA 都在这个仓库里，
用户要核对版本时能直接找到发布源。两行共用抽出来的 `RepoRow`（整行开外链 + 右侧单独复制链接），
避免出现两份只差 URL 的标记；`ABOUT_CONFIG.iosRepoUrl` 是唯一事实源。

## 0f. 滚动 Release（2026-09-26）

用户要求：发包都进 Release，**仓库里只能有一条 release**，有更新就地覆盖。

改动全在 `.github/workflows/ios-build.yml`：

| 项 | 改前 | 改后 |
|---|---|---|
| Release tag | `ios-v<package.json version>`（上游升版就多一条 release） | 固定 `ios-latest` |
| 资产名 | `NewsNook-<version>-unsigned.ipa`（升版即换名，下载地址失效） | 固定 `NewsNook-unsigned.ipa` |
| 更新方式 | 同 tag 存在时只 `upload --clobber`，说明不更新 | `gh release edit` 更新标题/说明 + `upload --clobber`；`--latest` |
| tag 指向 | 停在首次创建时的提交 | 每次发布先 `git push -f` 把 `ios-latest` 挪到本次构建的提交（放最前，失败即整体失败） |
| 构建戳 | App 用 `GITHUB_SHA`（传 `checkout_ref` 时是触发分支的头，未必是真正构建的提交） | 新增 `Resolve build identity` 取 `git rev-parse HEAD`，并把 `GITHUB_SHA` 覆盖成它，App 构建戳 / release 说明 / 真机核对三处一致 |
| 手动触发默认 | `publish_release` 默认 false | 默认 true |

稳定地址：`https://github.com/IamNewHands/newsnook-ios/releases/latest/download/NewsNook-unsigned.ipa`

本地验证：PyYAML 解析通过；四个 `run` 块 `bash -n` 通过；release 说明生成块干跑排版正确。
已用一次真实发布验证：run 34 发布 `ios-latest`（资产 `NewsNook-unsigned.ipa`，3 036 594 字节），
`ios-latest` tag 指向该次构建的提交，资产内 App 构建戳与说明里的 `34-2688ad9` 一致。

旧的三条 release（`ios-v1.8.7` / `1.8.8` / `1.8.9`）已按用户点名授权删除，tag 一并删掉。
影响：`ios-v1.8.8` 原本指向 `853e16d`、`ios-v1.8.7` 的 `c63b754` 原本由 `ios-sync/v1.8.7` 分支
兜着，删 tag 与删该分支后两者都不再被任何 ref 引用（`ios-v1.8.9` 的 `6bc0eb7` 本就在 `main`
历史里，没影响）。两者都已在下面的 bundle 备份里。

## 0g. 分支清理（2026-09-26）

用户要求「分支里只留下有用的」。清点后**只保留 `main` 与 `ios-layer`**，删掉 10 条本地 + 2 条
远程分支（都是 2026-09-22 初次移植留下的工作分支，内容已被 `main` 取代）：

- 本地：`ios-layer-squash`、`ios-native-plugins`、`ios-port`、`layer-new`、`layer-new2`、
  `main-new`、`main-new2`、`newsnook-backup-pre-188`、`sync-1.8.8`、`tmp-ui-font`
- 远程：`ios-native-plugins`（Tier-1/2 移植的 6 个逐步提交）、`ios-sync/v1.8.7`（v1.8.7 时代的
  13 个提交，含 `c63b754`）

删除前把 11 条分支的独有提交打包成 bundle，**可回滚**（下面的命令已 `--dry-run` 实测通过）：

```bash
# 恢复：在任意含 main 的克隆里执行，11 条 ref 会落到 refs/restored/ 下（不覆盖现有分支）
git fetch D:\GitHub_Clone\_port-analysis\newsnook-ios-branches-2026-09-26.bundle 'refs/*:refs/restored/*'
```

bundle：`D:\GitHub_Clone\_port-analysis\newsnook-ios-branches-2026-09-26.bundle`（731 658 字节，
`git bundle verify` 通过；两条前置提交 `c90bd76` / `6bc0eb7` 都在 `main` 里，所以对 main 的克隆
是自足的）。清理后 `git fsck` 只剩几个 dangling 对象（被删分支的 tip），属预期。

清理后的 ref 拓扑就三条：分支 `main`、分支 `ios-layer`、tag `ios-latest`（滚动，会移动）。

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

最终 refs 以 `git rev-parse origin/main origin/ios-layer` 为准（两者树必须一致）；不要在这里写死 SHA——每次折叠都会变，写死必然过期。
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

### Tier 3 — 功能缺口（2026-09-26 第二轮，用户选择「1/2 做、3 两种都支持、4 不做」）
5. `VolumePageTurnPlugin.swift`（48 行，AVAudioSession 音量 KVO）—— **本轮不做**
6. `SyncNotificationPlugin.swift`（UNUserNotificationCenter）—— **已移植**，143 行
7. `ReadAloudPlugin.swift`（AVSpeechSynthesizer + 后台音频 + MPNowPlayingInfoCenter）—— **已移植**，896 行
8. `MediaSnifferPlugin.swift`（WKWebView 注入探针 + 本机媒体中转）—— **已移植**，1448 行（4 文件）
9. `DlnaCastPlugin.swift`（单播 SSDP + 手动 IP + SOAP 直连）—— **已移植**，1207 行（2 文件）；
   兼容中转（proxy 模式）未实现

### Tier 3 的三处架构改写（不是「照抄 Java」，改的理由要留档）

| 能力 | Android 做法 | iOS 做法 | 为什么不能照抄 |
|---|---|---|---|
| DlnaCast 发现 | UDP 组播 M-SEARCH 到 `239.255.255.250:1900` | 单播 M-SEARCH 扫本机网段 + 手动填 IP | 向组播地址发包需要 Apple 特批的 `com.apple.developer.networking.multicast`，自签/侧载拿不到，`sendto` 直接 EACCES |
| MediaSniffer 观察 | `WebViewClient.shouldInterceptRequest` 拦网络层 | 注入脚本钩 fetch/XHR/MSE/performance/DOM | WKWebView 跑在独立网络进程，iOS 15–17 没有公开的 HTTPS 子请求拦截 API（`URLProtocol` 无效，只有 iOS 18+ 的 `proxyConfigurations`） |
| MediaSniffer 补请求头 | OkHttp 拦截时注入 Referer/UA | 本机 127.0.0.1 HTTP 中转，JS 把 `<video src>` 换过去 | 同上：没有拦截点，只能改成显式换地址 |

AirPlay 属于**新增**而非移植：iOS 上不需要原生代码，WKWebView 的 `HTMLMediaElement`
自带 `webkitShowPlaybackTargetPicker()`，路由的是该 video 元素本身（比原生
`AVRoutePickerView` 更准，后者只影响 App 的音频会话）。前提是 video 声明
`x-webkit-airplay="allow"`。

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
