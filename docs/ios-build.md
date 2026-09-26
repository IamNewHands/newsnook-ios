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

- **iOS Build**（`ios-build.yml`）：手动触发。在 `macos-26` 上用 Xcode 26 编译出**未签名 IPA**，作为 Actions artifact 上传；勾选 `publish_release` 时同时发布 GitHub Release。
  - `checkout_ref` 要填 **ref**：分支名、tag 名，或**完整 40 位** commit SHA。填短 SHA 会在 Checkout 步直接失败（`A branch or tag with the name '6ea45a0' could not be found`）——`actions/checkout` 的 `ref` 不接受缩写。日常就用 `main`。
- **iOS Sync from Upstream**（`ios-sync.yml`）：每天 02:00 UTC（北京时间 10:00）检查上游 `t59688/newsnook` 的最新**稳定版** tag（`vX.Y.Z`，不含 `-beta.`）。发现新版本就自动重贴 iOS 层、构建 IPA、发布 `ios-v<版本>` Release，最后把 `main` 快进到新版本。

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

Release 是按 `ios-v<版本>` 打 tag 的，回滚到上一个可用版本：

```bash
git fetch origin --tags
git checkout -B main ios-v<上一个版本>
git push origin main          # 若 main 已前进，需要 --force-with-lease
```

或者在 GitHub 上把上一个版本的 IPA 重新下载安装即可——设备端不会因为仓库分支变化而失效。

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

## 真机检查清单

- 冷启动时系统启动页和 React 启动画面之间无白屏。
- 首页能刷新信源，文章正文、图片和视频能够打开。
- 云翻译配置能保存，HTTPS 翻译请求能够完成。
- 正文顶栏翻译按钮右侧的下拉箭头能打开通道列表；切换通道后正在显示的译文会重跑。
- 一篇长繁体文章用 Microsoft Translator 翻译不再长时间卡住（正文会分批发，单次请求有体积上界）。
- iOS 18+ 首次用系统内置翻译时，系统会弹出语言包下载提示；已装好的语对会在设置页显示「已下载：…」。
- 图片保存首次请求相册权限；拒绝权限不会导致页面退出。
- 图片分享能够调起系统分享面板。
- 全屏视频左侧竖滑调整亮度，退出全屏或切到后台后恢复原亮度。
- 全屏视频右侧竖滑调整系统媒体音量。
- 深浅色状态栏、安全区和横竖屏布局正常。

### 2026-09-26 原生插件移植的真机验收项

这 6 个 Swift 文件已通过 macOS 编译（`ios-build.yml` 全绿），但**运行时行为只能在真机确认**。
逐项清单在各 port spec 里；下面是最关键的 5 条（任何一条失败都说明对应假设不成立）：

1. **代理出口**：设置里填 HTTP 代理后拉一个国际源，确认真的走了代理（`connectionProxyDictionary` 的键名与代理凭据 407 回调都是纸面推断）。
2. **知乎 Cookie 回传**：知乎登录后翻两页，确认会话不因 `Set-Cookie` 被合并成逗号串而失效（`ProxiedHttp` 逐条回传 `setCookies`）。
3. **Linux.do 隐藏传输**：打开 Linux.do 正文/阅读记录同步，确认 `loadHTMLString` 的 `document.origin` 是 `https://linux.do`，同源 `fetch` 能带上 Cookie。
4. **上传进度**：Linux.do 发一张图，确认进度条是平滑推进而不是 15% 直接跳 95%（`didSendBodyData` 是否按块回调）。
5. **知乎登录整链**：`登录知乎` → 系统登录页 → 回到 App 后账号页显示已登录；杀进程重开仍登录（Cookie 落 Keychain）。

规格与已知取舍：`docs/superpowers/specs/2026-09-26-*.md`（6 篇）；总体计划与审计见
`docs/superpowers/plans/2026-09-26-ios-native-capability-port.md`。

### 2026-09-26 第二轮（Tier 3）的真机验收项

`SyncNotification` / `ReadAloud` / `DlnaCast` / `MediaSniffer` 四套能力同样只过了 macOS 编译。
下面每条对应一处**纸面推断**，失败即说明该推断不成立：

1. **同步通知**：在后台触发一次「首次同步完成」，确认通知中心出现一条**无声**通知；点开落到「账户与同步」。首次调用会弹一次通知权限框（不授权则静默跳过，同步照常）。
2. **后台朗读**：开始朗读后按 Home 键切后台，确认**继续朗读**；锁屏/控制中心出现上一段/播放暂停/下一段；插拔耳机时朗读暂停（`noisy`）。
3. **朗读进度与暂停**：暂停后再继续，确认从**当前词**接上而不是整段重念；进度条位置随朗读推进（UTF-16 码元偏移是否与 JS `substring` 对齐）。
4. **AI TTS 音频**：用 AI 朗读通道念一段，确认能出声且结束后自动停止（`AVAudioPlayer` + base64 落盘路径）。
5. **DLNA 单播扫段**：手机与电视同网段，首次搜索时系统弹出「本地网络」权限框；授权后能搜到电视。搜不到时用「手动添加电视 IP」填电视地址，确认能加上并开始投屏。
6. **DLNA 直连**：投屏后确认电视真的开始播放（`confirmDirectPlayback` 要求连续 1.8 秒 playing）；进度条拖动、暂停/继续、音量条（电视支持 RenderingControl 时）都能用。
7. **AirPlay**：投屏浮层里点 AirPlay，确认弹出系统路由选择器并能投到 Apple TV（`webkitShowPlaybackTargetPicker` 在 WKWebView 里是否可用是最大不确定项）。
8. **媒体嗅探**：打开一个自定义源视频页，确认能嗅到 HLS/DASH 清单（探针脚本的 fetch/XHR 钩子在 WKWebView 里是否生效）。
9. **本机中转**：遇到防盗链源时确认视频能播（`<video src>` 被换成 `http://127.0.0.1:<port>/stream?…`，`NSAllowsLocalNetworking` 是否足够放行）；拖动进度条确认 Range 透传正常、App 不会闪退（`SO_NOSIGPIPE`）。

### 2026-09-26 第三轮：返回手势的真机验收项

真机反馈两条：（a）右滑返回能用，但「返回时会跳一下，感觉像返回了两层」；（b）设置页进到
二级页后不能右滑返回。三处改动，对应三处纸面推断：

1. `useEdgeSwipeBack` 的 `resetAfterBack` 原本和 `onBack` 挤在**同一个 tick** 里复位合成层：
   React 这次路由更新要等本轮任务之后的调度才提交，此时清 `transform` 会把旧页面画回屏幕
   原位一帧。改成等两帧（新路由已画好）再复位。
2. `useEdgeSwipeBack` 增加「同一次滑动只允许一个实例认领」：每个实例都往 `window` 挂
   `touchmove`，而 `touchstart` 会冒泡到每个祖先实例。阅读器是 `<main>` 之外的浮层、工作区
   在 `<main>` 里，两者可以并存，那时两边都会认领同一次右滑、各调一次 `onBack` ——
   一次滑动退两层。
3. `SettingsShell` 接上左缘右滑返回（`edgeOnly`），并把入场动画挪到**内层**：CSS 动画（含
   `fill-mode` 的终态）优先级高于内联 `style`，动画挂在外层会把右滑写的内联 `transform`
   顶掉，整页拖不动。

验收：

1. **设置二级页右滑**：`我的 → 设置 → 外观`，从左缘往右滑，页面跟手滑出并回到「我的」；
   `外观 → 自定义配色` 右滑回到「外观」。**这一条是新增能力，之前完全没有。**
2. **设置页返回不跳**：右滑到底松手后，页面应当一直滑到屏幕外、再出现上一级；**不应**看到
   旧页面弹回屏幕原位一帧。
3. **返回不重复入场**：右滑返回进入的上一级页**不应**再从右侧滑入一次（`settings-in` 只该在
   点左上角返回箭头或从「我的」进入时出现）。
4. **不抢分类管理的横向拖拽**：`设置 → 分类与预设`，在行左缘 48px 内按住并横向拖动，确认拖拽
   仍然生效。若被抢，给该页传 `disabled`（`useEdgeSwipeBack` 已有该开关）。
5. **阅读器右滑返回不跳**：任一源打开正文，左缘右滑返回，确认列表**不闪回正文一帧**
   （`closeReader` 里的合成层复位已延后两帧）。
6. **工作区右滑返回不跳**：知乎 / Linux.do 点进帖子后右滑返回，确认工作区**不闪回帖子一帧**。
7. **「两层」若仍能复现**：请记下当时是从哪里进入的——特别是「在知乎 / Linux.do 工作区里打开
   过文章，再回到工作区之后右滑」这条路径（那是阅读器与工作区唯一可能同时挂载的场景）。

## iOS 媒体音量说明

iOS 没有公开的直接设置系统媒体音量 API。本项目通过公开的 `MPVolumeView` 控件尝试调整系统媒体音量；如果当前系统版本或音频路由没有提供可调滑块，应用会自动退回为调整当前视频元素音量，不会导致播放器退出。系统媒体音量效果需在实际支持版本的 iPhone 上确认，不能仅以模拟器结果作为结论。
