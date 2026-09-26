# NewsNook iOS 编译说明

## 环境

- macOS（CI 用 GitHub Actions 的 `macos-26` runner，arm64）
- Node.js 22 或更高版本
- Xcode 26 或更高版本（Capacitor 8 当前官方要求）
- Apple ID；真机安装需要在 Xcode 中选择自己的开发团队

Windows / Linux 上可以跑 lint、`npm run build` 和大部分测试，但**编译 IPA 必须用 macOS**。详见下面的「本地验证」与「版本跟随与自动化」。

## 安装与同步

在项目根目录执行：

```bash
npm ci --registry=https://registry.npmjs.org
npm run ios:sync
```

`ios:sync` 会重新生成 iOS 图标和启动画面、构建 React 页面，并将 Web 产物与 Capacitor 插件同步到 iOS 工程。

仓库根目录的 `capacitor.config.ts` 保留 Android 已发布包使用的 `com.aizeek.newsnook`；现有 iOS target 的 Bundle Identifier 单独固定为 `com.aizeek.newsnook.ios`。不要删除 `ios/` 后直接重新执行 `cap add ios`，否则需要重新设置 iOS Bundle Identifier 和本文列出的原生配置。

## 版本跟随与自动化

本仓库的 `main` = **上游稳定版代码 + iOS 层**。「iOS 层」是让 NewsNook 能在 iOS 上编译运行的那部分改动：

| 类别 | 路径 |
|---|---|
| iOS 工程 | `ios/**`（Xcode 工程、SPM 清单、`DeviceMediaControlsPlugin.swift`、`MainViewController.swift`、图标与启动画面） |
| 构建脚本 | `scripts/generate-ios-assets.mjs`、`scripts/ios-set-marketing-version.mjs` |
| iOS 测试 | `scripts/ios-*.test.mjs`、`scripts/native-platform.test.ts`、`scripts/device-media-controls.test.ts` |
| Web 层补丁 | `src/lib/nativePlatform.ts`、`src/BootstrapRoot.tsx`、`src/lib/deviceMediaControls.ts`、`capacitor.config.ts`、`package.json` |
| 文档 | `docs/ios-build.md`、`docs/superpowers/**/2026-08-04-ios-*` |
| CI | `.github/workflows/ios-build.yml`、`.github/workflows/ios-sync.yml` |

### 两个 workflow

- **iOS Build**（`ios-build.yml`）：手动触发。在 `macos-26` 上用 Xcode 26 编译出**未签名 IPA**，作为 Actions artifact 上传；`publish_release` 默认开，同时发布到滚动 Release。
  - `checkout_ref` 要填 **ref**：分支名、tag 名，或**完整 40 位** commit SHA。填短 SHA 会在 Checkout 步直接失败（`A branch or tag with the name '6ea45a0' could not be found`）——`actions/checkout` 的 `ref` 不接受缩写。日常就用 `main`。
- **iOS Sync from Upstream**（`ios-sync.yml`）：每天 02:00 UTC（北京时间 10:00）检查上游 `t59688/newsnook` 的最新**稳定版** tag（`vX.Y.Z`，不含 `-beta.`）。发现新版本就自动重贴 iOS 层、构建 IPA、发布滚动 Release，最后把 `main` 快进到新版本。

### 滚动 Release：仓库里永远只有一条

tag 固定 `ios-latest`，资产名固定 `NewsNook-unsigned.ipa`，**每次构建就地覆盖同一条 release、同一个资产**。上游升版也不会多出新的 release——发布入口只有这一个。

- 稳定下载地址（写进书签/脚本都不会失效）：
  `https://github.com/IamNewHands/newsnook-ios/releases/latest/download/NewsNook-unsigned.ipa`
- Release 说明由 workflow 生成：上游版本、**构建戳 `<run>-<短SHA>`**、完整提交 SHA、自签提示，以及上面那条稳定地址。`release_notes` 输入（`ios-sync.yml` 会传）追加在最前面。
- 发布前会先把 `ios-latest` tag 强推到本次构建的提交；tag 推不上去就整体失败，不会留下「资产换了、tag 还指着老提交」的半成品。
- `ios-latest` tag 会移动，所以**不要**用它当版本基线；上游基线看 `vX.Y.Z`，iOS 层基线看 `ios-layer` 分支。

两个 workflow 都不需要任何证书或描述文件 Secret：产物是未签名 IPA，签名由设备端（SideStore / LiveContainer / SideInstaller）用你自己的 Apple ID 完成。

### 重贴补丁是怎么工作的

`ios-layer` 分支的 tip 永远是一个**单提交**，内容 = 「某个上游 tag + 完整 iOS 层」。同步时：

1. 把 `main` 的树整体换成新 tag 的树，但让提交的 parent 仍是 `main`。因此 `main` 是纯追加历史，**只快进、从不 force-push**。
2. `git cherry-pick ios-layer` 做三方合并：能自动合就自动合。
3. 冲突就**明确失败并开 issue**——`main` 不动，也不发布任何 Release，绝不静默产出坏包。

冲突几乎只会出现在 iOS 层依赖的这几个文件上：`src/BootstrapRoot.tsx`、`src/lib/deviceMediaControls.ts`、`capacitor.config.ts`、`package.json`。

> **`main` 是派生产物。** 它的树 = 上游 tag 的树 + `ios-layer` 的树。任何直接改在 `main` 上、却没有折叠进 `ios-layer` 的改动，都会在下一次同步时被抹掉。同步 workflow 会先校验 `main` 与 `ios-layer` 的树是否一致，不一致就直接失败，不会静默丢改动。**要改 iOS 层，就改 `ios-layer`，再让 `main` 指向同一个树。**

> GitHub 对 60 天无活动的仓库会停用 `schedule`。正常跟版时每次同步都会产生提交，不会触发停用；若上游长期停更，需要手动 Run 一次 workflow 保活。

### 同步失败怎么修

1. 打开 issue，看 workflow 日志里 cherry-pick 报的冲突文件。
2. 本地复现：

   ```bash
   git fetch origin ios-layer
   git checkout -B tmp <新的上游 tag>
   git cherry-pick origin/ios-layer     # 这里会显示冲突
   ```

3. 手工解决后，把结果整理成**一个**提交（parent 是新 tag），推回 `ios-layer`：

   ```bash
   git push --force origin HEAD:refs/heads/ios-layer
   ```

4. 重跑 `iOS Sync from Upstream`（可以指定 `upstream_tag` 输入）。

`ios-layer` 是内部补丁源，会被 force-push；`main` 不会。

### 回滚

发布是**滚动**的：只有一条 `ios-latest` Release，每次构建就地覆盖，所以**旧 IPA 不会留在仓库里**
（要留就自己存一份）。回滚分两种：

- **回滚源码**：`main` 只快进、不 force-push，所以用 `git revert <坏提交>` 追加一个反向提交即可；
  想一次撤掉一串，用 `git revert --no-commit <good>..<bad>`。
- **只要某个旧提交的包**：在 Actions 里手动触发 `iOS Build`，`checkout_ref` 填那个已知可用提交的
  **完整 40 位 SHA**（短 SHA 不行，见上文 `checkout_ref` 的说明），构建完就地覆盖 `ios-latest`。

已经装在设备上的包不会因为仓库分支或 Release 变化而失效。

## 本地验证

Windows / Linux 上能跑的部分：

```bash
npm ci --registry=https://registry.npmjs.org
npm run lint
npm run build                              # build:contracts + 字体子集 + tsc -b + vite build
npm run test:native-platform
npm run test:device-media-controls
npm run test:ios-platform
npm run test:ios-native-plugin
```

`npm run test:ios-project` 依赖 macOS 自带的 `plutil` 与 `sips`（校验 `Info.plist`、`PrivacyInfo.xcprivacy` 与图标尺寸），**只能在 macOS 上跑**，CI 里会跑。它同时校验 `project.pbxproj` 的 `MARKETING_VERSION` 与 `package.json` 的 `version` 一致。

注意：npm 11 起默认拦截依赖的 install / postinstall 脚本（`allow-scripts`）。`sharp`（图标生成）与 `esbuild` 依赖这些脚本；CI 固定 Node 22（npm 10）不受影响，本地若 `sharp` 不可用需要 `npm approve-scripts sharp`。

## 打开 Xcode

执行：

```bash
npm run ios:open
```

也可以直接打开 `ios/App/App.xcodeproj`。本项目使用 Swift Package Manager，不需要执行 `pod install`。

## 模拟器运行

1. 在 Xcode 顶部 Scheme 中选择 `App`。
2. 选择任一 iOS 15 或更高版本的 iPhone Simulator。
3. 按 `Command + R`。

命令行无签名编译：

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## 真机签名

1. 在 Xcode 左侧选择 `App` 工程，再选择 `App` target。
2. 打开 `Signing & Capabilities`。
3. 勾选 `Automatically manage signing`。
4. 在 `Team` 中选择自己的 Apple Developer Team。
5. 保持 Bundle Identifier 为 `com.aizeek.newsnook.ios`；如果该标识在你的团队中不可用，改成你自己的唯一标识。
6. 连接 iPhone，选择设备后按 `Command + R`。

## 怎么确认设备上装的是哪一版

`CFBundleShortVersionString` 刻意跟随上游（现在是 `1.8.9`，设备端自签工具靠它判断有没有
新版本），所以**同一个上游版本下的多次重新构建，版本号完全一样**。这带来一个真实陷阱：

- 用 SideStore / LiveContainer 之类工具「覆盖安装」同版本包时，可能被判定成「已装同版本」
  而**跳过替换**，于是设备上跑的还是旧包 —— 表现就是「我明明装了新包，插件却报
  `"X" plugin is not implemented on ios`」（旧包里根本没有那个插件）。
- **同一个上游版本内要换包时，先删掉 App 再装**，不要直接覆盖。

**确认方法**：App 里「我的 → 关于」，那行小字是 `版本 <上游版本> · 构建 <构建戳>`。

- 构建戳来自 `vite.config.ts` 的 `buildStamp()`：CI 上是 `<run number>-<短 SHA>`（例
  `32-52802bd`），可以直接和 GitHub Actions 的 run 与 commit 对照；本地开发是
  `YYYY.MM.DD-HHmm`。
- **只到「年月」（如 `2026.09`）说明装的是 2026-09-26 之前的旧包** —— 那些包的构建戳只有
  月份粒度，且没有 Tier 3 的原生插件。
- `npm run test:ios-native-plugin` 会拦住构建戳退回「年月」粒度。

## iOS 功能边界

- 翻译：支持 Google、Azure、DeepL、DeepLX 云翻译与 AI 翻译；Google / Microsoft 的 API Key 留空时走免密钥通道（`translate.googleapis.com` / Edge `translatetext`）；iOS 18 及以上额外提供**系统内置离线翻译**（`Translation` 框架，语言包由系统下载和管理）。**不包含** Android 的 ML Kit 与 Bergamot 语言模型下载。
- 正文顶栏的翻译按钮右侧有下拉箭头，可直接切换翻译通道；正在看译文时切换会立刻用新通道重跑，不必回到设置页。
- 超长段落（>3000 字符）会按句末标点切开分批翻译，单次请求始终有体积上界；正常段落仍然整段一起翻译。
- 界面字体：`设置 → 界面字体` 可切换字体、字号与字重，全部使用 iOS 内置字体，不依赖网络。
- 阅读正文页的**悬浮上下翻页按钮**：半透明的竖排 ▲ / ▼ 两个按钮，点一下滚动一屏（0.9 屏，与阅读滚动指示器一致）。整组按钮可直接拖动到屏幕任意位置（拖动与点击按 6px 位移阈值区分，拖完不会误翻页），位置按设备保存在本地（`newsnook:reader-float-nav`）。默认开启；可在阅读器的「更多操作」菜单里关闭/打开（`floatReaderNav` 偏好，本地生效、不同步到云端）。墨水屏分页模式下不显示。
- 应用内更新（`src/features/appUpdate`）与「下载 APK」横幅在 iOS 上自动关闭——上游已按平台判定（`Capacitor.getPlatform() === 'android' && isPluginAvailable('AppUpdate')`，以及 `shouldShowWebAppDownloadBanner`），iOS 上不会提示你下载 APK。
- 原生能力移植状态（2026-09-26，**已过 macOS 编译；运行时行为仍需真机确认**）：
  - 已移植：`ProxiedHttp`（代理隧道 + 知乎认证通道）、`SecureStore`（Keychain 取代 Android Keystore）、`ZhihuSession`（知乎登录）、`LinuxDoSession`（Linux.do 会话与请求）。
  - 已移植（第二轮）：`SyncNotification`（同步通知）、`ReadAloud`（系统朗读 + 后台播放 + 锁屏控制）、`DlnaCast`（DLNA 投屏）、`MediaSniffer`（媒体嗅探 + 本机中转）。
  - iOS 上 `ProxiedHttp` **只支持 HTTP/HTTPS 代理**；SOCKS5 会明确报错——系统没有公开的 SOCKS 开关，继续执行只会静默直连。
  - 仍未移植：App Update（iOS 走 App Store，本来就不该有）、音量键翻页（用户明确暂不做）。
  - **DLNA 发现**在 iOS 上不是组播：组播发包需要 Apple 特批的 `com.apple.developer.networking.multicast`，自签 IPA 拿不到。改成「单播 M-SEARCH 扫本机网段」+「手动填电视 IP」，两条路都不需要那个 entitlement（单播只触发一次「本地网络」隐私权限弹窗）。**兼容中转（proxy 模式）未实现**：电视无法直连视频源时会明确报错，而不是经手机中转。
  - **媒体嗅探**在 iOS 上不是网络层拦截：WKWebView 跑在独立网络进程，iOS 15–17 没有公开的 HTTPS 子请求拦截 API。改成「注入脚本观察 fetch/XHR/MSE/performance/DOM + 播放器配置」+「本机 127.0.0.1 中转补 Referer/UA」。覆盖不到跨进程的媒体子请求与 Service Worker 内部的请求。
  - **AirPlay** 是 iOS 独有的第二条投屏路径，不需要原生代码：WKWebView 的 `HTMLMediaElement` 自带 `webkitShowPlaybackTargetPicker()`，投屏浮层里的 AirPlay 入口直接调它（前提是 video 声明了 `x-webkit-airplay="allow"`，`InkVideoPlayer` 已用 `setAttribute` 打上）。
  - 音量键翻页未做：iOS 只能 KVO 观察 `AVAudioSession.outputVolume`，按一下音量会真的变，属可用但有副作用的方案。
- `Info.plist` 的 `CFBundleURLTypes` 注册了 `newsnook` 与 `discourse` 两个 scheme：前者承载分享深链与账号 OAuth 回流（`newsnook://auth/callback`），后者承载 Linux.do 的 User-Api-Key 授权回流（`discourse://auth_redirect`，`ASWebAuthenticationSession`）。漏注册时 `npm run test:ios-platform` 会拦住。
- iOS 原生插件登记有三处，缺一处就等于没编译进去：Swift 文件本身、`ios/App/App.xcodeproj/project.pbxproj`（PBXBuildFile + PBXFileReference + Sources）、`MainViewController.capacitorDidLoad()` 的 `registerPluginInstance`。`npm run test:ios-native-plugin` 会兜底检查前两处。
- `DeviceMediaControlsPlugin.swift` 只实现亮度与媒体音量五个方法（`getBrightness` / `setBrightness` / `clearBrightness` / `getVolume` / `setVolume`）。因此 iOS 上全屏视频的**方向锁定会失败**并回落到播放器的 CSS 旋转兜底，`getNativeBattery()` 返回 `null`。
- iOS 上 `nativeAvailable()` 为真，所以亮度手势走原生分支；`src/lib/deviceMediaControls.ts` 里「原生设置成功时清掉蒙层、失败时压暗蒙层」的补丁是 iOS 亮度手势能用的前提，**不要当成冗余代码删掉**。
- 新闻源、偏好、历史、稍后读和缓存仍保存在本机。
- Apple Developer 证书、发布描述文件和 App Store Connect 记录不保存在仓库。

## App Store 隐私配置

工程已包含 `PrivacyInfo.xcprivacy`，声明 Filesystem 文件时间戳与 Preferences UserDefaults 所需的 Required Reason API。准备提交 App Store Connect 时，仍需按实际发布版本在后台核对并填写 App Privacy 数据收集问卷；若后续新增原生插件，也要重新检查插件要求的隐私清单条目。

## iOS 层的实现取舍

这几处不是「照抄上游」，改动理由留档在这里：

- **右滑返回被拖动的那一层**：`SettingsShell`、知乎工作区、Linux.do 工作区、阅读器四处都用
  `useEdgeSwipeBack`，但被 `translate3d` 拖动的必须是**那一层不透明的壳**（含上下安全区），
  不能是壳里那块 `flex-1` 的内容面。只拖内容面时安全区留白原地不动、左右直接露出下层列表，
  而且内容面处在带 `fill-mode` 终态的动画层内部，合成器要重画那一层才能补上让出的区域。
  同理，入场动画（`reader-in` / `settings-in`）必须挂在内层：CSS 动画（含终态）优先级高于
  内联 `style`，挂在外层会把右滑写的内联 `transform` 顶掉。
- **右滑期间的合成开销**：`.reader-swipe-surface` 常驻 `will-change: transform`，让合成层在
  挂载时就建好，而不是等右滑第一帧；`[data-swipe-back-active='true']` 期间关掉整棵子树的
  `backdrop-filter` 并给 `[data-surface='reader-chrome']` 换不透明底色 —— `backdrop-filter`
  每帧都要重新采样背景并重算模糊，在移动中的合成层里代价最高（eink 模式对全页也是同一套处理）。
- **多实例认领**：每个 `useEdgeSwipeBack` 实例都往 `window` 挂 `touchmove`，而 `touchstart`
  会冒泡到每个祖先实例。阅读器是 `<main>` 之外的浮层、工作区在 `<main>` 之内，两者可以并存，
  因此 hook 里用模块级单实例认领，最内层先到先赢；`resetAfterBack` 的复位也延后两帧，避免把
  旧页面画回原位一帧。

真机验收清单与逐轮实测记录不入库，只保存在本地 `docs/local/ios-device-verification.md`
（`docs/local/` 已在 `.gitignore` 里）。

## iOS 媒体音量说明

iOS 没有公开的直接设置系统媒体音量 API。本项目通过公开的 `MPVolumeView` 控件尝试调整系统媒体音量；如果当前系统版本或音频路由没有提供可调滑块，应用会自动退回为调整当前视频元素音量，不会导致播放器退出。系统媒体音量效果需在实际支持版本的 iPhone 上确认，不能仅以模拟器结果作为结论。
