# 知乎会话插件 iOS 移植（WKWebView + WKHTTPCookieStore 版）

日期：2026-09-26
状态：**已落盘、未编译、未真机验证**（Windows 主机无 Xcode，本机无法编译任何 Swift；本文件一次都没有过编译器）
交付物：

- `ios/App/App/ZhihuSessionPlugin.swift`（834 行）
- 本文档

源真值：`android/app/src/main/java/com/aizeek/newsnook/ZhihuSessionPlugin.java`（512 行，2 个 `@PluginMethod`）
JS 契约：`src/features/zhihu/session/native.ts`（`registerPlugin<ZhihuSessionNativePlugin>('ZhihuSession')`）
JS 消费方：`session/account.ts`、`session/store.ts`、`session/types.ts`、`transport/android.ts`、`ui/ZhihuAccountScreen.tsx`
参照风格：`ios/App/App/DeviceMediaControlsPlugin.swift`、`ios/App/App/AppleTranslationPlugin.swift`
部署目标：iOS 15.0（`project.pbxproj` 四处 `IPHONEOS_DEPLOYMENT_TARGET = 15.0`）；只用 iOS 15 之前就存在的公开 API；无第三方依赖。

---

## 0. 结论摘要

- 两个方法、9 个 resolve 字段、5 个 reject 错误码与 Java 端逐字对齐；**唯一必须原样保留的反直觉点是 reject 的实参位置**（见 §1.3），改了就破坏 JS 的取消判定。
- 登录 UI 从 Android 的 `Dialog + WebView` 换成 `UINavigationController(rootViewController: ZhihuAuthViewController)` 全屏 modal，容器内是自绘 nav chrome（标题「登录知乎」+ 关闭 ×）+ `WKWebView`；Cookie 从 `CookieManager` 换成 `WKWebsiteDataStore.default().httpCookieStore`。
- 身份校验从 OkHttp 换成 `URLSessionConfiguration.ephemeral` + 一个只做「不跟随重定向」的 `URLSessionTaskDelegate`。
- **本文件目前不参与编译**：`project.pbxproj` 与 `MainViewController.swift` 的登记由调用方集中处理（本次禁止改），撰写本文时 `ZhihuSessionPlugin` 尚未登记。
- **JS 侧不需要任何改动**：`native.ts:29` 的能力探测、`account.ts:28,100` 与 `ZhihuAccountScreen.tsx:260` 的「仅 Android 提供」文案都挂在 `Capacitor.isPluginAvailable('ZhihuSession')` 上，登记完成后自动变为可用/自动隐藏。

---

## 1. 方法表：Java → Swift → JS 契约

### 1.1 方法

| Java `@PluginMethod` | Java 行为要点 | Swift 对应 | JS 调用 |
|---|---|---|---|
| `authenticate(PluginCall)` | 并发守卫 → URL 白名单 → 存 `pendingCall` → `runOnUiThread` 开 Dialog | `@objc func authenticate(_ call: CAPPluginCall)`；`CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)` | `NativeZhihuSession.authenticate({ url?, wwwCookie?, apiCookie? })` |
| `clearBrowserSession(PluginCall)` | 清 www/api 两个 origin 的知乎 Cookie → `resolve()` | `@objc func clearBrowserSession(_ call: CAPPluginCall)`；`CAPPluginMethod(name: "clearBrowserSession", returnType: CAPPluginReturnPromise)` | `NativeZhihuSession.clearBrowserSession(): Promise<void>` |

`jsName = "ZhihuSession"`、`identifier = "ZhihuSessionPlugin"`、类名 `ZhihuSessionPlugin`（`@objc(ZhihuSessionPlugin)`），与 `native.ts` 的 `registerPlugin('ZhihuSession')` 对齐。`CAPPluginMethod` 的 selector 由 `name + ":"` 拼出（`CAPPluginMethod.m:29`），所以 Swift 方法名必须正好是 `authenticate` / `clearBrowserSession`。

### 1.2 resolve 载荷（成功路径）

Java 用 `JSObject.put` 写 9 个字段；Swift 用 `call.resolve([String: Any])` 写同名 9 个键。JS 侧 `native.ts:47-60` 逐字段映射到 `ZhihuStoredAccount`：

| resolve 字段 | Java 来源 | Swift 来源 | JS 落点（`ZhihuStoredAccount`） |
|---|---|---|---|
| `accountId` | `profile.id` → 空则 `url_token` | `ZhihuIdentity.accountId`（同规则） | `account.id`（**必填**，空则 JS 抛「没有返回有效账号会话」） |
| `name` | `profile.optString("name","")` | `string(profile["name"])` | `account.name` |
| `urlToken` | `profile.optString("url_token","")` | `string(profile["url_token"])` | `account.urlToken` |
| `avatarUrl` | `profile.optString("avatar_url","")` | `string(profile["avatar_url"])` | `account.avatarUrl` |
| `headline` | `profile.optString("headline","")` | `string(profile["headline"])` | `account.headline` |
| `wwwCookie` | 探测前读到的 `CookieManager.getCookie("https://www.zhihu.com")` | 探测前 `readCookieHeader(host: "www.zhihu.com")` | `wwwCookie`（与 `apiCookie` 至少一个非空） |
| `apiCookie` | 同上，`https://api.zhihu.com` | 探测前 `readCookieHeader(host: "api.zhihu.com")` | `apiCookie` |
| `userAgent` | `authWebView.getSettings().getUserAgentString()` | `capturedUserAgent`（`navigator.userAgent`，见 §3.5） | `userAgent`（空则 `undefined`，transport 退回内置 UA） |
| `profileJson` | `profile.toString()`（重新序列化） | 原始响应正文 | `profileJson`（当前 JS 只存取、不解析，见 §3.8） |

Cookie 字符串格式两端一致：`name=value; name2=value2`，`; ` 分隔，同名以 www 域当前值为准（`mergeCookieHeaders([apiCookie, wwwCookie])`，后者覆盖前者但保留首次出现顺序，对应 Java 的 `LinkedHashMap`）。

### 1.3 reject 载荷（错误路径，**位置不能改**）

Capacitor 的 `reject` 在两个平台上都是「message 在前、code 在后」：

- Android `PluginCall.reject(String msg, String code)`（`PluginCall.java:114`）
- iOS `CAPPluginCall.reject(_ message: String, _ code: String? = nil, …)`（`CAPPluginCall.swift:45`）

而 Java 端本插件一直写成 `call.reject("ZH_AUTH_BUSY", "已有知乎认证窗口正在进行")`，也就是**把 ASCII 错误码放在 message 位、中文说明放在 code 位**。iOS bridge 的 JS 侧把原生 `error` 对象的键原样拷到 `CapacitorException`（`native-bridge.js:951-957`，`message` / `code` 直接赋值），所以：

- `error.message === "ZH_AUTH_CANCELLED"`（ASCII 码）
- `error.code === "未检测到已登录的知乎账号"`（中文）

`account.ts:113` 与 `ZhihuAccountScreen.tsx:49` 都用 `message.includes('ZH_AUTH_CANCELLED')` 判定「用户主动取消」，因此 Swift 侧必须写成同样的位置（本实现通过 `rejectCall(_:code:message:)` 显式注释这个错位）：

| 场景 | Java | Swift（实参顺序相同） | JS 可见 |
|---|---|---|---|
| 已有认证窗口 | `reject("ZH_AUTH_BUSY", "已有知乎认证窗口正在进行")` | `rejectCall(call, code: "ZH_AUTH_BUSY", message: "已有知乎认证窗口正在进行")` | `message='ZH_AUTH_BUSY'` |
| 非知乎 HTTPS 域名 | `reject("ZH_AUTH_URL_BLOCKED", "认证地址不属于知乎第一方 HTTPS 域名")` | 同左 | `message='ZH_AUTH_URL_BLOCKED'` |
| 无法打开认证页 | `reject("ZH_AUTH_UNAVAILABLE", "当前 Activity 无法打开知乎认证页")` | 同左（文案里的「Activity」改成「当前视图控制器」） | `message='ZH_AUTH_UNAVAILABLE'` |
| 取消 / 未检测到账号 | `reject("ZH_AUTH_CANCELLED", "未检测到已登录的知乎账号")` | 同左 | `message='ZH_AUTH_CANCELLED'`，UI 静默 |
| 系统销毁 | `reject("ZH_AUTH_DESTROYED", "知乎认证页已被系统关闭")` | 同左 | `message='ZH_AUTH_DESTROYED'`（iOS 只在进程终止时触发，基本看不到） |

成功路径的 `resolve` 不受此影响。

### 1.4 取消 / 关闭路径（JS promise 的落点）

| 触发 | Java | Swift（本实现） | JS 结果 |
|---|---|---|---|
| 点 ×（自绘关闭按钮） | `requestAuthenticationClose()` → `closeRequested=true` → 探测 → 成功则 resolve，失败则 `ZH_AUTH_CANCELLED` | 同左（nav bar 左键 `xmark`） | resolve 或 reject `ZH_AUTH_CANCELLED` |
| 系统返回键 | 有历史则 `webView.goBack()`，否则 `requestAuthenticationClose()` | 无系统返回键；改用 `allowsBackForwardNavigationGestures = true` 的边缘返回手势（只在有历史时生效），关闭仍只能点 × | 手势不改 promise 状态 |
| Dialog 被外部收起 | `setOnDismissListener` → `cancelAuthenticationNow()` | `ZhihuAuthViewController.viewDidDisappear` 且 `isBeingDismissed \|\| presentingViewController == nil` → 同一个收口函数 | reject `ZH_AUTH_CANCELLED` |
| 系统销毁 | `handleOnDestroy()` → `ZH_AUTH_DESTROYED` | `UIApplication.willTerminateNotification` → `ZH_AUTH_DESTROYED`（进程将亡，JS 通常收不到） | 同上 |
| 探测请求失败 | `finishFailedProbe()` 比对最新 Cookie：变了就再探一次，没变才取消 | 同左 | 同上 |

---

## 2. 机制映射：Android → iOS

| 维度 | Android（现状） | iOS（本次移植） |
|---|---|---|
| 承载容器 | `android.app.Dialog`（`Theme_Material_Light_NoActionBar`，MATCH_PARENT） | `UINavigationController(rootViewController: ZhihuAuthViewController)`，`modalPresentationStyle = .fullScreen`，从 `bridge?.viewController` present |
| 原生 chrome | 自绘 56dp 标题栏：「登录知乎」+ 圆形 × + 1px 分隔线 | 系统 nav bar：`title = "登录知乎"`、`leftBarButtonItem = xmark` |
| 安全区 | `WindowInsetsCompat` 手动 padding（status bar + cutout） | nav bar / `safeAreaLayoutGuide` 由 UIKit 处理，无手写 insets |
| 页面容器 | `WebView` + `WebSettings`（JS on、DOM storage on、多窗口 off、mixed content never） | `WKWebView` + `WKWebViewConfiguration`（`allowsContentJavaScript = true`、`javaScriptCanOpenWindowsAutomatically = false`、`websiteDataStore = .default()`） |
| 多窗口 | `setSupportMultipleWindows(false)`：`target=_blank` 在当前 WebView 打开 | `WKUIDelegate.createWebViewWith` 里对白名单 URL 调 `webView.load`，返回 nil |
| 域名白名单 | `shouldOverrideUrlLoading` + `isAllowedAuthUrl`（https 且 host 是 `zhihu.com` 或 `*.zhihu.com`） | `WKNavigationDelegate.decidePolicyFor` + 同一个静态判定（`URLComponents` 解析） |
| 越界提示 | `Toast`「已阻止跳出知乎第一方认证域名」 | 顶部半透明 `UILabel` 提示条，2s 后淡出 |
| Cookie 容器 | `CookieManager.getInstance()`（app 进程全局，落盘） | `WKWebsiteDataStore.default().httpCookieStore`（app 全局，落盘；Capacitor 主 WebView 也用同一个 store，见 `CAPBridgeViewController.swift:121`） |
| 读某个 origin 的 Cookie | `getCookie(origin)` | `getAllCookies` + 自写域匹配 / 路径匹配 / 过期过滤（等价 RFC 6265 语义，见 `cookieApplies`） |
| 恢复 Cookie | `setCookie(origin, "name=value; Path=/; Secure")`（host-only） | `HTTPCookie(properties: [.name, .value, .domain: host, .path: "/", .secure: "TRUE"])` + `setCookie`（host-only，无 expires ⇒ session cookie，与 Java 同） |
| 删除 Cookie | 按 name 逐个 `setCookie(name=; Max-Age=0; Path=/; Secure[; Domain=.zhihu.com])` | `getAllCookies` → 过滤 `*.zhihu.com` → `delete(cookie)`（只能按条删，没有 per-origin API） |
| 禁用整库清理 | 明确不用 `removeAllCookies()` | 同理只用按域删除，绝不碰其它站点 |
| 登录完成判定 | `onPageFinished` → 原生 OkHttp `GET /api/v4/me` | `didFinish` → `URLSession` `GET /api/v4/me`；**额外**加了 `WKHTTPCookieStoreObserver.cookiesDidChange` 触发（去抖 0.6s + 最小间隔 3s） |
| HTTP 客户端 | OkHttp（connect 10s / read 15s，`followRedirects(false)`、`followSslRedirects(false)`） | `URLSessionConfiguration.ephemeral`（`httpShouldSetCookies=false`、`httpCookieStorage=nil`、`request=15s`/`resource=30s`）+ `ZhihuIdentityRedirectBlocker`（`willPerformHTTPRedirection` 回调 `nil` ⇒ 不跟随） |
| 请求头 | `Accept: application/json`、`Referer: https://www.zhihu.com/`、`Cookie: <merged>`、`User-Agent: <webview UA>` | 完全一致 |
| UA 获取 | `authWebView.getSettings().getUserAgentString()`（同步） | `webView.evaluateJavaScript("navigator.userAgent")`（**异步**，`viewDidAppear` 与每次 `didFinish` 补抓） |
| 并发守卫 | `pendingCall != null \|\| authDialog != null` → `ZH_AUTH_BUSY`（在调用线程上判空，`volatile`） | 同一个判据，但**整个状态机固定在主线程**：Capacitor iOS 在串行后台队列 `bridge` 上调插件方法（`CapacitorBridge.swift:131,507`），方法入口先取参，再 `DispatchQueue.main.async` 进状态机 ⇒ 两次几乎同时的 `authenticate` 会被主线程串行化 |
| 销毁钩子 | `Plugin.handleOnDestroy()`（Activity 销毁 / 旋转 / finish） | Capacitor iOS **没有**等价钩子（`CAPPlugin.h` 无此方法）⇒ 用 `willTerminateNotification` + `viewDidDisappear` 两条路径替代 |
| 收尾 | `destroyAuthWebView()`（stopLoading、清 client、load about:blank、destroy） | `ZhihuAuthViewController.detach()`（stopLoading、清 delegate、load about:blank、移除视图、清回调） |

---

## 3. 行为差异与不可移植项（逐条给出 JS 可见后果）

1. **reject 的 message/code 错位必须保留**。若按「语义正确」改成 `reject("已有知乎认证窗口正在进行", "ZH_AUTH_BUSY")`，JS 的 `message.includes('ZH_AUTH_CANCELLED')` 会失效 ⇒ 用户点 × 会看到一条报错横幅而不是静默返回。JS 可见后果：取消路径 UI 行为变化。本实现保留错位。
2. **清 Cookie 的范围更大**。Android 只清 `www.zhihu.com` / `api.zhihu.com` 两个 origin（外加 `.zhihu.com` 共享域）；iOS 的 `WKHTTPCookieStore` 没有按 origin 删除的 API，本实现删掉所有 `zhihu.com` / `*.zhihu.com` Cookie（含 `zhuanlan.zhihu.com` 等子域）。JS 可见后果：无（范围只在知乎域内变大，账号切换更干净）；副作用是若将来有别的知乎子域登录态，也会被一起清掉。
3. **Cookie store 是 app 全局，与 Capacitor 主 WebView 共用**。Android 的 `CookieManager` 同样全局，行为一致；但 iOS 上没有「每个 WebView 独立 jar」这个概念，所以本插件写的 Cookie 立刻对主 WebView 也可见。JS 可见后果：无（transport 不依赖 WebView Cookie，自己带 Cookie 头）。
4. **第三方 Cookie 开关不存在**。Android 显式 `setAcceptThirdPartyCookies(webView, true)`；iOS 没有这个开关——同一 data store 的 Cookie 天然共享，`www.zhihu.com` 与 `api.zhihu.com` 属同一 registrable domain，ITP 不拦。JS 可见后果：无；**风险**是若知乎登录页里嵌了真正跨站的风控/验证码 iframe，ITP 可能拦住它的第三方 Cookie（见 §6）。
5. **UA 是异步抓的**。Android 在探测时同步取 `getSettings().getUserAgentString()`，永远非空；iOS 用 `evaluateJavaScript` 取 `navigator.userAgent`，首次 `didFinish` 前可能还没回来。本实现在 `viewDidAppear` 与每次 `didFinish` 各抓一次、失败可重试；仍拿不到就不带 `User-Agent` 头（与 Java 的 `if (!userAgent.isEmpty())` 分支同构）。JS 可见后果：`result.userAgent` 可能为 `undefined`，此时 `transport/android.ts:144` 退回内置 Android Chrome UA（知乎对 UA 有客户端判定，见该文件注释）。
6. **多了一条探测触发源**。Android 只在 `onPageFinished` 探测；iOS 额外监听 `cookiesDidChange`（去抖 0.6s、两次探测至少隔 3s、且只在认证页打开时生效）。原因是 `WKHTTPCookieStore` 与网络进程的同步存在延迟，`didFinish` 时可能读不到刚下发的 Cookie。JS 可见后果：登录成功后**可能更早**自动 resolve（无需等下一次页面跳转）；代价是 `/api/v4/me` 请求数比 Android 略多（登录流程内通常个位数）。
7. **系统返回键没有对应物**。Android 返回键 = 有历史就回退、没历史就取消；iOS 全屏 modal 没有系统返回键，本实现用 `allowsBackForwardNavigationGestures`（WebView 自带边缘返回手势）覆盖「回退历史」，「没历史时取消」这一半只能靠 × 按钮。JS 可见后果：无（都不改 promise 状态）。
8. **`profileJson` 是原始响应正文**。Java 用 `profile.toString()`（重新序列化，键序/空白由 org.json 决定），Swift 直接给响应原文。当前 JS（`types.ts:22`、`store.ts:76`、`native.ts:58`）只存不解析。JS 可见后果：无；若将来有人拿它做字符串比较会不同。
9. **Cookie 值首尾空白会被 trim**。Android 恢复时把 `"name = value"` 整段原样交给 CookieManager（由它去 trim），iOS 侧本实现显式 trim name/value。JS 可见后果：无（本插件自己产出的 Cookie 串本来就没有多余空白）。
10. **URL 校验更严格**。Android `Uri.parse` 很宽松；`URLComponents(string:)` 遇到非法字符（例如裸空格）会返回 nil ⇒ 直接 `ZH_AUTH_URL_BLOCKED`。JS 可见后果：只有传入畸形 URL 时才会出现，而 JS 侧默认值与 UI 传值都是干净的 https URL。
11. **页面加载失败的表现不同**。Android 由系统 WebView 显示错误页；iOS 的 `WKWebView` 是白屏，本实现额外在 `didFail` / `didFailProvisionalNavigation` 弹一条「知乎页面加载失败，请检查网络后重试」提示条。JS 可见后果：无（promise 仍在等用户操作）。
12. **modal 层级冲突会显式拒绝**。Android 的 Dialog 是独立 window，压在 Activity 上；iOS 的 modal 从 `bridge?.viewController` present，若宿主已经在展示别的 modal，UIKit 会静默失败。本实现先判 `host.presentedViewController == nil`，再加一个 2s 的 `presentationWatchdog` 自检，失败就 `ZH_AUTH_UNAVAILABLE`。JS 可见后果：原本会永久挂起的 promise 现在会明确 reject（这条是 Android 没有的新增保护）。
13. **`handleOnDestroy` 无等价钩子**。Android 在 Activity 销毁（含旋转、被系统回收）时收口并 cancel 网络请求；iOS 只有进程终止通知 + `viewDidDisappear`。JS 可见后果：极端情况下（App 被系统在后台杀死）promise 不会 settle——但此时 JS 上下文也一起没了。
14. **`WKWebView` 的 Web 内容进程崩溃**（iOS 特有）没有处理：不会自动 reload，用户看到白屏，只能点 × 重试。Android 侧对应的是 renderer 挂掉。JS 可见后果：需要用户手动重试。
15. **`clearBrowserSession` 与进行中的认证没有互斥**。Java 也没有；iOS 上两者都在主线程串行执行，不会数据竞争，但语义上仍是「随时可清」。JS 可见后果：与 Android 相同。
16. **多了两道兜底定时器**（Android 没有）：`cookieSetupWatchdog`（清/恢复 Cookie 的 completion 2s 不回就照样开页，幂等）与 `presentationWatchdog`（present 后 2s 仍没挂上窗口就 `ZH_AUTH_UNAVAILABLE`）。目的是不让 JS 的 promise 永久挂起。JS 可见后果：正常情况下两者都不会触发；只有 UIKit/WebKit 异常时才会提前 reject 或提前开页。

---

## 4. 凭证去向与持久化边界

- **插件本身不持久化任何凭据**：不写 Keychain、不写 `UserDefaults`、不写文件，也不打印 Cookie。Cookie 只存在于两处运行时容器里：
  1. `WKWebsiteDataStore.default().httpCookieStore`（登录 WebView 与后续请求用）；
  2. `call.resolve([...])` 的返回值，交给 JS。
- **账号持久化由 JS 层负责**：`account.ts` 拿到 resolve 结果后调 `ZhihuCredentialStore.saveAccount()`（`store.ts:84`，键 `site.zhihu.<accountId>.session`），最终落到 `SecureStore` 插件——iOS 侧是 `SecureStorePlugin.swift` 的 Keychain `kSecClassGenericPassword`（`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`）。因此杀进程后能不能保持登录，取决于 SecureStore 插件，而不是本插件。
- **浏览器会话确实会落盘**：`WKWebsiteDataStore.default()` 会把 Cookie 写到 App 沙箱的 WebKit 目录（Android 的 `CookieManager` 同样落盘）。这是「浏览器会话」而不是账号凭据，且 `removeCurrentAccount()`（`account.ts:150`）会调 `clearBrowserSession()` 把它清掉。本移植没有改变这条边界。
- 本插件不会把 Cookie 写进 `NSUserDefaults` / 日志 / 任何跨账号共享的位置。

---

## 5. 验证

### 5.1 本机（Windows）已做

| 项 | 手段 | 结果 |
|---|---|---|
| 括号 / 字符串字面量配平 | 自写状态机扫全文（跳过注释与字符串） | 通过（无未闭合括号，834 行） |
| 方法表一致性 | 人工比对 `@objc func` 与 `CAPPluginMethod(name:)` | 2/2 对齐 |
| reject 文案与 Java 逐字一致 | 人工比对 §1.3 表格 | 一致（仅 `ZH_AUTH_UNAVAILABLE` 的说明文案把「Activity」改成「当前视图控制器」） |
| 无明文泄漏 | grep `print(` / `UserDefaults` / `localStorage` | 无命中（仅在注释里出现「UserDefaults」） |
| JS 契约回归 | `npm run test:zhihu-session` | **无法运行**：`npx tsx` 拉起 esbuild service 时报 `Error: spawn EPERM`（`node_modules/esbuild/lib/main.js:2272`），是本会话沙箱禁止 `child_process` 管道 stdio 的已知限制。另外该脚本只断言 **Android** 源文件与 JS 层（`scripts/zhihu-session.test.ts:210-229`），**不覆盖本次新增的 Swift 文件**，需要在能跑 `tsx` 的环境补跑以确认 JS 契约未变 |
| 既有 iOS 插件断言 | `node scripts/ios-native-plugin.test.mjs` | **通过**（`ios-native-plugin: ok`；该脚本不读本文件，只证明没有连带破坏既有 iOS 插件约束） |

### 5.2 必须在 macOS / 真机上做

1. **编译**：macOS 上 `xcodebuild`（或 CI `.github/workflows/ios-build.yml` 的未签名 IPA 构建）。这是唯一能证明 Swift 能编译的手段。
2. **工程登记**（**本次未做，明确留给调用方**）：`project.pbxproj` 的 PBXBuildFile / PBXFileReference / group / Sources 四处，以及 `MainViewController.swift` 里 `bridge?.registerPluginInstance(ZhihuSessionPlugin())`。撰写本文时 `ZhihuSessionPlugin` 尚未出现在这两处；未登记时文件不参与编译，`Capacitor.isPluginAvailable('ZhihuSession')` 为 false，`ZhihuAccountScreen.tsx:144` 的登录按钮会保持 disabled。
3. **JS 契约回归**（在能跑 `tsx` 的环境）：`npm run test:zhihu-session`。
4. **真机人工点检**（iPhone，非越狱；按顺序做，每条都能独立判成败）：
   1. 设置 → 知乎账号 → 「登录 / 注册知乎」：应弹出全屏页，标题「登录知乎」，左上角 ×。
   2. 在弹出页里点「密码登录」并用手机号+验证码登录：登录成功后**不用点任何按钮**，页面应自动收起，账号卡片显示昵称/头像。
   3. 再点「重新验证知乎账号」：应在恢复已有 Cookie 后**很快**自动收起（命中观察者触发的探测），而不是停在登录页。
   4. 点 × 立刻关闭：账号状态不变、**不应出现任何报错横幅**（验证 §1.3 的错位 reject 生效）。
   5. 断网后点登录，等页面加载失败：应看到「知乎页面加载失败」提示条，点 × 后回到账号页且无报错横幅。
   6. 连点两次登录（第二次在第一层还开着时）：第二次应立即收到 `ZH_AUTH_BUSY`（UI 上表现为按钮忙碌态 / 一条错误提示），不出现两个弹窗。
   7. 登录页里点「用户协议 / 隐私政策」这类新窗口链接：应在同一个 WebView 里打开（不被拦截、不白屏）。
   8. 登录页里点一条站外链接（如知乎以外的备案/合作链接）：应被拦下并显示「已阻止跳出知乎第一方认证域名」提示条。
   9. 登录页里做一次「返回」手势（从左边缘右滑）：应回到上一个页面而不是关掉弹窗。
   10. 登录成功后杀进程重开：账号仍在（这一步验证的是 SecureStore/Keychain，不是本插件，但缺了它整个链路不算通）。
   11. 「从本机移除当前账号」后再点登录：登录页应是未登录状态（验证 `clearBrowserSession` 真的清掉了浏览器会话）。
   12. 登录成功后立刻用知乎业务页（信息流/我的主页）请求一次：验证 `result.userAgent` 与 Cookie 能让 `/api/v4/me` 通过（`transport/android.ts` 的 UA 分支）。

---

## 6. 不确定项（按风险从高到低）

1. **未编译**：834 行 Swift 一次都没过编译器。最可能出问题的点：
   - `@objc public func cookiesDidChange(in cookieStore: WKHTTPCookieStore)` —— 这是 `@objc optional` 协议要求，我显式加了 `@objc`；若编译器仍报「does not conform」，退路是把 conformance 写成 `extension ZhihuSessionPlugin: WKHTTPCookieStoreObserver`。
   - `nonBlank(_ value: Any?)` 里 `value as? NSNumber` / `value as? String` 的写法（`Any?` 上的条件转换）与 `guard let raw else` 简写；逻辑等价于 Java 的 `optString`，但没有编译器背书。
   - `HTTPCookie(properties: [.name: …, .secure: "TRUE"])` 的字典字面量桥接与 `HTTPCookiePropertyKey` 推断；若 `HTTPCookie(properties:)` 对缺 `.version` 返回 nil，恢复 Cookie 会静默跳过（表现为「重新验证时登录页不是已登录态」）。
   - `call.resolve([9 个 String 键])` 对 `[String: Any]` 的重载选择（与 `resolve(with:)` 泛型重载共存）。
   - `let present: () -> Void = { … }` 这个局部闭包被多个 `@escaping` completion 捕获后调用；语法上合法，但没有编译器验证。
2. **`WKHTTPCookieStore` 与网络进程的同步时序**：我依赖「`setCookie` 的 completion 回调之后 webview 就能带上这些 Cookie」，以及「`didFinish` 之后 `getAllCookies` 能读到知乎刚下发的 Cookie」。这两条都是社区经验而非 Apple 承诺。若真机上表现为「恢复的账号在登录页里没登录」或「登录成功后探测一直失败」，修法是：恢复后先 `load(about:blank)` 再 load 目标 URL，或给 `getAllCookies` 加一次短延迟重试。
3. **观察者触发的额外探测**：可能被知乎风控视为异常频率。已用去抖 + 3s 最小间隔压制（登录流程内个位数请求），但没有真机数据。若真机上出现验证码频率上升，第一步就是把 `WKWebsiteDataStore.default().httpCookieStore.add(self)` 那两行去掉，退回「只有 didFinish 触发」。
4. **ITP 与第三方 Cookie**：`www.zhihu.com` / `api.zhihu.com` 同属 `zhihu.com`，不受影响；但如果知乎登录页嵌了真正跨站的风控 iframe，`WKWebView` 的 ITP 可能拦它的 Cookie，而 Android 侧显式开了 `setAcceptThirdPartyCookies(true)`。这条只能在真机上撞。
5. **`evaluateJavaScript("navigator.userAgent")` 的时机**：`viewDidAppear` 时页面可能还在 `about:blank`，我判断此时 `navigator.userAgent` 仍返回 WKWebView 的真实 UA（同一 Web 进程），但没有验证。若返回空串，代码会重试到 `didFinish`，最终仍可能拿到空 ⇒ JS 退回内置 Android UA。
6. **两道兜底定时器都是新增行为**。`presentationWatchdog`（2s）：若设备/系统在 2s 内还没完成 present（理论上不可能），会把一个正在展示的窗口判成失败并 reject，同时 `teardownAuthUI` 会把 `authController` 置空、留下一个不再受管的 modal（用户仍可点 × 关掉，但插件已不再跟踪它）。`cookieSetupWatchdog`（2s）：若 `WKHTTPCookieStore` 的 completion 迟于 2s 才回，页面会在 Cookie 恢复完成前就开始加载，表现为「重新验证时登录页不是已登录态」——这是「宁可少带 Cookie 也不挂死 promise」的取舍。
7. **`viewDidDisappear` 作为「窗口已关闭」的判据**：我用 `isBeingDismissed || presentingViewController == nil || navigationController?.isBeingDismissed`。若将来有人在认证页之上再 present 一个 modal，`viewDidDisappear` 不会触发（被盖住不算收起），所以判据成立；但这条依赖「没人往上叠 modal」。
8. **`URLSessionConfiguration.ephemeral` + `httpCookieStorage = nil`**：我预期这样 URLSession 不会自己塞任何 Cookie、原样发送我手写的 `Cookie` 头。若真机上出现请求里多出/少了 Cookie，症状是探测恒失败（表现为「登录成功却总被判成取消」）。
9. **`profileJson` 的形态差异**（原始正文 vs 重新序列化）：当前 JS 只存不解析，若将来加解析逻辑需注意非法 JSON 时 Java 会抛异常走失败分支，而 Swift 的 `parseIdentity` 已先用 `JSONSerialization` 解析过一遍，失败即判定未登录——两者对「200 但非 JSON」的结果一致（都是失败探测）。
10. **超时数值的语义差异**：OkHttp 的 connect/read 是两个独立超时，`URLSession` 只有「请求空闲超时 15s / 资源总超时 30s」。极端慢网下两者的失败时机不同，但都收敛到「探测失败 → 重比 Cookie → 取消」。
11. **`ZhihuAuthViewController` 是 internal（模块内可见）而不是 fileprivate**：同文件里插件类需要引用它。这不影响 JS，但意味着它是 App target 内的可见类型。
12. **没有新增静态断言脚本**：姊妹移植（SecureStore / ProxiedHttp）各自加了 `scripts/*-ios.test.mjs`，本次任务的边界明确写了「只交两个文件、不要动其它文件」，所以没有加。若要给这份 Swift 加静态断言，需要调用方另行授权。

---

## 7. 与任务边界的对照

- 只新增 `ios/App/App/ZhihuSessionPlugin.swift` 与本文档。
- **未**改 `project.pbxproj`、`MainViewController.swift`、`Package.swift`、任何 TypeScript 文件（登记与 JS 判据由调用方集中处理）。
- 无第三方依赖：只 `import Capacitor / Foundation / UIKit / WebKit`。
- 只使用 iOS 15 之前就存在的公开 API：`WKWebView` / `WKHTTPCookieStore`（iOS 11+）、`WKHTTPCookieStoreObserver`（iOS 11+）、`URLSession`、`UINavigationController`、`UIBarButtonItem`、`UIImage(systemName:)`（iOS 13+）、`defaultWebpagePreferences`（iOS 14+）。没有 `@available` 分支需要。
