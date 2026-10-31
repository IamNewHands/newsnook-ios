# NewsNook iOS 云翻译版移植设计

## 目标

在保留现有 React/Vite 前端和 Android 工程的前提下，为 NewsNook 增加可由 Xcode 编译的 Capacitor iOS 工程。iOS 首版使用 `com.aizeek.newsnook.ios`，最低支持 iOS 15，只保留 Google、Azure、DeepL、DeepLX 等云端翻译，不集成 ML Kit 离线翻译。

## 现状

NewsNook 的主要产品能力已经位于 Web 层：信息源配置、RSS/Atom 与公开接口解析、正文提取、阅读缓存、稍后读、历史记录、主题排版和云翻译。Android 工程是 Capacitor 容器，并额外实现了以下平台能力：

- `DeviceMediaControls`：全屏视频的窗口亮度和媒体音量控制。
- `MlKitTranslation`：仅 Android local flavor 使用的离线翻译插件。
- 原生启动画面与 WebView 首帧衔接。
- 针对网易遗留 HTTP 地址的受限明文网络放行。

Web 层已使用 Capacitor 的 Preferences、Filesystem、Share、Browser、StatusBar、Media 和原生 HTTP，因此标准 Capacitor iOS 平台能够复用绝大多数功能。

## 方案选择

采用标准 Capacitor iOS 平台，共用现有 React/Vite 产物，并用 Swift 实现必要的 `DeviceMediaControls` 插件。

未采用以下方案：

- 不采用无 Swift 插件的纯标准容器，因为全屏视频的亮度和音量体验会弱于 Android。
- 不采用手写独立 `WKWebView` 容器，因为这会重复实现已有的 Capacitor 存储、文件、分享、浏览器和 HTTP 桥接，并使双端长期分叉。

## 工程结构

现有仓库继续作为唯一源码仓库，保留 `src/`、`android/` 和 Web 构建流程。新增 Capacitor 生成的 Swift Package Manager iOS 工程，入口为 `ios/App/App.xcodeproj`。采用 Capacitor 8 默认的 Swift Package Manager 模板，避免新增 CocoaPods 环境依赖。

工程使用以下标识与平台基线：

- App 名称：`News Nook`
- Bundle Identifier：`com.aizeek.newsnook.ios`
- 最低系统：iOS 15
- Web 资源目录：`dist`
- 原生容器：Capacitor iOS / `WKWebView`

`package.json` 增加与 Android 对称的 iOS 命令，用于构建 Web、同步原生工程、打开 Xcode 和运行模拟器。`@capacitor/ios` 与仓库当前锁定的 Capacitor 8.4.2 保持同版本，避免跨主版本混装。

## 启动与界面衔接

iOS 使用系统 Launch Screen 展示应用品牌底色和图标。系统启动页退出后，Web 层继续显示现有 React 启动画面，直到本地偏好恢复、主题确定和应用根节点准备完成。

Web 层的启动画面启用条件从 Android/开发环境扩展到所有原生平台。iOS 原生窗口和 WebView 背景使用与现有深色启动页一致的 `#0E0F12`，避免系统启动页与 Web 首帧之间出现白屏。

状态栏继续由 `@capacitor/status-bar` 和现有 `applyNativeChrome` 控制。页面布局沿用 CSS safe-area inset，适配刘海屏和底部 Home Indicator。

## 数据流与存储

运行时数据流保持不变：

1. App 从应用包内加载 `dist`，不访问远程业务页面。
2. 启动阶段从 Capacitor Preferences 恢复源、类别、场景和显示偏好。
3. 信息流、正文、图片和云翻译请求在原生环境中通过 `CapacitorHttp` 直连上游。
4. 阅读记录、稍后读、正文缓存和云翻译配置保存在本机。
5. 原文链接通过 Capacitor Browser 打开；图片通过 Filesystem 临时落盘，再交给系统分享或照片库。

iOS 版本不增加账号、业务后端、云同步或中转代理。

## 翻译边界

iOS 不注册 `MlKitTranslation` 插件，也不链接 Google ML Kit。现有 `isLocalTranslationAvailable()` 会返回 `false`，设置界面据此隐藏或禁用本地翻译能力。

保留以下云端翻译提供方及现有请求格式：

- Google Translate
- Azure Translator
- DeepL
- DeepLX 或用户自建兼容端点

API Key 和端点继续保存在本机，应用通过 Capacitor 原生 HTTP 直接请求用户配置的服务。首版不增加 Keychain 迁移，以免改变现有跨平台偏好数据模型。

## iOS 原生媒体控制

新增 Swift `DeviceMediaControls` Capacitor 插件，并保持 Web 层现有接口不变：

- `getBrightness`
- `setBrightness`
- `clearBrightness`
- `getVolume`
- `setVolume`

亮度使用 `UIScreen.main.brightness`。插件在首次修改前记录原始亮度，`clearBrightness` 和退出全屏时恢复记录值。

媒体音量通过公开的 `MPVolumeView` 控件尝试读取和调整，返回实际生效的 0 到 1 值；不调用私有 API。iOS 没有公开的直接系统音量 setter，因此该路径按真机 best-effort 处理。插件不可用、控件层级不可调或调用失败时，Web 层沿用现有降级逻辑：亮度使用视频蒙层模拟，音量修改当前 `HTMLVideoElement`。

## 文件、照片与分享

图片下载继续走 CapacitorHttp，临时文件继续由 Filesystem 管理。保存到相册使用现有 Media 插件的 iOS 实现，并在 `Info.plist` 提供明确的照片添加用途说明。

用户拒绝照片权限时，保存操作返回可读错误，不影响文章页面、图片查看和系统分享。系统分享继续使用 `@capacitor/share`，不新增自定义分享扩展。

## 网络与 ATS

绝大多数请求使用 HTTPS。对于代码中明确处理的网易遗留 HTTP 链接，在 `Info.plist` 的 App Transport Security 配置中仅为相关网易域名添加受限例外，不启用全局 `NSAllowsArbitraryLoads`。

应用继续优先尝试将 HTTP 地址升级为 HTTPS，只有升级失败且域名位于例外范围内时才使用 HTTP。云翻译端点仍强制要求 HTTPS，不受网易例外影响。

## 生命周期、导航与旋转

iOS 使用 Capacitor 默认 App 生命周期。现有页面内返回逻辑和边缘滑动返回继续由 React 层处理，不引入额外原生导航栈。

视频全屏允许系统根据播放器状态旋转；普通页面维持现有纵向移动端布局。Web 层在全屏退出时调用 `clearBrightness`，Swift 插件同时监听 `UIApplication.didEnterBackgroundNotification` 并恢复原始亮度，避免亮度状态遗留。

## 异常处理

- 新闻源、正文或云翻译请求失败：保留现有错误提示和重试行为，不新增服务端代理。
- ATS 阻止未授权 HTTP 域名：显示网络失败，不扩大明文白名单。
- 图片保存权限被拒绝：给出可读提示，分享功能仍可使用。
- 原生媒体插件缺失或调用失败：自动降级到 Web 控制，不导致播放器崩溃。
- Capacitor 同步或 Xcode 编译失败：保留完整命令输出，按实际版本约束修复或记录，不通过无关依赖升级掩盖错误。

## 构建兼容性

仓库锁定 Capacitor 8.4.2；官方开发基线是 Node.js 22+ 与 Xcode 26+。交付不为兼容旧工具链而降级 Capacitor 依赖族。

当前机器的 Xcode 16.4 / iOS Simulator SDK 18.5 也已完成一次无签名 Debug 编译，可用于本地验证当前源码；后续依赖升级、归档和 App Store 提交仍以 Capacitor 官方的 Xcode 26+ 基线为准。

## 验证

实施完成后执行以下验证：

1. 安装锁定依赖并运行现有前端 lint、TypeScript/Vite 构建和脚本测试。
2. 执行 Capacitor iOS 同步，确认所有官方插件均被识别。
3. 使用 `xcodebuild` 对 iOS Simulator 做无需签名的 Debug 编译。
4. 启动模拟器进行冒烟检查：启动衔接、首页加载、文章阅读、云翻译设置、原文打开、分享入口、深浅色和安全区。
5. 对只能在真机验证的照片权限、系统亮度和媒体音量给出单独检查清单，不把模拟器结果冒充真机验证。

## 交付物

- 可打开的 `ios/App/App.xcodeproj`
- Bundle ID 为 `com.aizeek.newsnook.ios` 的 iOS target
- Swift `DeviceMediaControls` 插件
- iOS 图标、Launch Screen、权限说明和受限 ATS 配置
- `ios:sync`、`ios:open`、`ios:run` 命令
- 中文 iOS 编译、签名与真机检查说明

Apple Developer Team、开发/发布证书和 App Store Connect 记录由用户在自己的账号下配置，不写入仓库。
