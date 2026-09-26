# LinuxDoSession 插件 iOS 移植规格（会话 / 请求 10 方法，2026-09-26）

把 Android Capacitor 插件移植为 iOS Swift：

- 源：`android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java`（1823 行）
- 目标：`ios/App/App/LinuxDoSessionPlugin.swift`
- 契约来源：`src/features/linuxdo/session/native.ts`（`LinuxDoSessionPlugin` 接口、`LinuxDoNativeResponse`、`LinuxDoBrowserPreparation`）
  与 `src/features/linuxdo/api/client.ts`（消费 `status` / `data` / `headers` / `responseUrl` / `transport` 与 `phase`/`status`）
- 约束：iOS 15.0（`IPHONEOS_DEPLOYMENT_TARGET = 15.0`，`SWIFT_VERSION = 5.0`）、无第三方依赖、
  Capacitor 8 约定（`@objc(ClassName)` / `identifier` / `jsName` / `pluginMethods` / `call.resolve|reject`）
- **本文件未经编译、未经真机验证**（Windows 主机无 Xcode）。所有"已实现"均应读作"按源码写的"。

---

## 0. 本次范围（明确声明）

本文件**只实现 10 个会话 / 请求方法**：

`authenticateUserApiKey`、`cancelUserApiKeyAuth`、`clearUserApiKey`、`authenticate`、`snapshot`、
`browserSnapshot`、`request`、`prepareBrowserSession`、`fetchConnectTrustPage`、`clearBrowserSession`。

**不包含**这 4 个上传方法与进度事件：

- `beginUpload`（Java 983）
- `appendUploadChunk`（Java 999）
- `finishUpload`（Java 1040）
- `cancelUpload`（Java 1147）
- 事件 `linuxDoUploadProgress`（Java 277 `notifyUploadProgress`）

它们由**后续一遍**追加（对应 Java 1095–1157 与上传相关状态：`uploadSessions`、`UploadSession`、
`UploadProgressRequestBody`、`cleanupUpload`、`performUpload`）。因此：

- `pluginMethods` 数组当前**恰好**声明 10 项，没有上传方法；
- 本文件**没有**实现 `notifyListeners("linuxDoUploadProgress", ...)`；
- JS 侧 `native.ts` 的 `uploadLinuxDoFile` 在本文件落地前会得到 "not implemented" 类的失败，
  这是**预期**状态，不是回归。

---

## 1. 方法表（Java `@PluginMethod` → Swift 对应 → JS 契约）

`pluginMethods` 与 Java 的 `@PluginMethod` 一一对应，顺序与 `native.ts` 接口声明一致。

| # | Java | Java 行 | Swift | 选项（in） | 成功字段（out） | 失败（error code / message） |
|---|---|---|---|---|---|---|
| 1 | `authenticateUserApiKey` | 314 | `authenticateUserApiKey(_:)` | 无 | 由 `redeemUserApiSession` → `resolveSnapshot` 产出快照（见 #5） | 忙：`LINUXDO_USER_API_BUSY`；依赖类错误码 `LINUXDO_USER_API_BROWSER` / `_CRYPTO` / `_CANCELLED` / `_DENIED` / `_PROTOCOL`；OTP 不可用 `LINUXDO_USER_API_OTP` |
| 2 | `cancelUserApiKeyAuth` | 341 | `cancelUserApiKeyAuth(_:)` | 无 | `void`（无参数 `resolve()`） | 挂起的登录被拒：`LINUXDO_USER_API_CANCELLED` |
| 3 | `clearUserApiKey` | 358 | `clearUserApiKey(_:)` | 无 | `void` | 无（本地登出永远成功；远端吊销失败也 `resolve`） |
| 4 | `authenticate` | 401 | `authenticate(_:)` | `url?: string`（缺省 `https://linux.do/login`） | 快照（见 #5） | 忙：`LINUXDO_SESSION_BUSY`；URL 不允许：`LINUXDO_SESSION_URL`；无法开窗：`LINUXDO_SESSION_UNAVAILABLE`；用户取消：`LINUXDO_SESSION_CANCELLED`；进程收尾：`LINUXDO_SESSION_DESTROYED` |
| 5 | `snapshot` | 419 | `snapshot(_:)` | 无 | `{authenticated: Bool, authMode: "browser-session"\|"none", userAgent: String, currentUser?: {id, username, name, avatarTemplate, trustLevel, unreadNotifications, allUnreadNotificationsCount, canUseTemplates?}}` | 有可用 OTP 时先兑换；兑换失败 `LINUXDO_USER_API_OTP` |
| 6 | `browserSnapshot` | 431 | `browserSnapshot(_:)` | 无 | 同 #5 | 无 |
| 7 | `request` | 436 | `request(_:)` | `url: string`、`method: "GET"\|"POST"\|"PUT"\|"DELETE"`、`headers?: {[k]: string}`、`body?: string`、`browserOnly?: boolean` | `{status: Int, data: String, headers: {[k]: string}, transport: "native"\|"browser"\|"browser-firstparty", responseUrl?: String}` | URL 不允许：`LINUXDO_REQUEST_URL`；方法不支持：`LINUXDO_REQUEST_METHOD`；网络失败：`LINUXDO_REQUEST_NETWORK`；响应读取失败：`LINUXDO_RESPONSE_READ`（见 D8）；Cookie 同步失败：`LINUXDO_COOKIE_SYNC`；浏览器路径失败：`LINUXDO_BROWSER_REQUEST` |
| 8 | `prepareBrowserSession` | 491 | `prepareBrowserSession(_:)` | 无 | `{ready: Bool, username?, userId?, csrf?, reason?, phase?: "session"\|"csrf", status?}`（由 `LinuxDoBrowserSessionRecovery` 产出） | 无 reject（失败也 `resolve` 成 `{ready:false, reason}`） |
| 9 | `fetchConnectTrustPage` | 499 | `fetchConnectTrustPage(_:)` | 无 | `{status: Int, data: String, finalUrl: String, headers: {[k]: string}}` | `LINUXDO_CONNECT_URL` / `LINUXDO_CONNECT_REDIRECT` / `LINUXDO_CONNECT_REDIRECT_URL` / `LINUXDO_CONNECT_NETWORK` |
| 10 | `clearBrowserSession` | 1159 | `clearBrowserSession(_:)` | 无 | `void` | 清理异常：`LINUXDO_SESSION_CLEAR` |

### 1.1 `reject` 参数顺序（**JS 可见契约，不可"顺手纠正"**）

Java 全程写作 `call.reject(<中文文案>, <ASCII 错误码>)`，而 Capacitor 的 `reject` 签名在
Android 与 iOS 上都是 `reject(message, code)`。也就是 Java 端把**错误码放在 message 位、
中文放在 code 位**。JS 侧用 `error.message.includes('LINUXDO_...')` 判定的地方依赖这个错位。

Swift 端照抄同一顺序（`call.reject(message, code)`），与 `ZhihuSessionPlugin.swift` 的
`rejectCall(_:code:message:)` 同款处理。**不要**改成 `reject(code, message)`。

### 1.2 `transport` 标记语义

| 值 | 何时产生 | Swift 位置 |
|---|---|---|
| `native` | `performNativeRequest` 直接用 `URLSession` 成功 | `resolveRequest` |
| `browser-firstparty` | 恢复文档 ready 且 `canRequest(url)` 放行的三个第一方端点（`/topics/timings`、`/session/csrf`、`/session/csrf.json`） | `performBrowserRequest` → `LinuxDoBrowserSessionRecovery.request` |
| `browser` | 隐藏同源传输 WebView 的 `fetch()` 结果（含 Cloudflare 挑战后的回落） | `resolveBrowserRequest`（`BrowserFetchResponse` 默认值） |

`client.ts:55` 只认这四个值（含 Web 端的 `web`），其它一律归为 `unknown`。

### 1.3 Cloudflare 挑战判定（逐字搬运）

`isCloudflareChallenge(status:body:headers:)` 与 Java 689–713 完全一致：

- 状态必须是 403 / 429 / 503；
- `cf-mitigated` 含 `challenge` → 挑战；
- 否则正文前 128 KiB 必须命中 `cf_chl_opt` / `/cdn-cgi/challenge-platform` / `cf-chl-` /
  `challenge-form` / `cf-turnstile` / `<title>just a moment` / `enable javascript and cookies to continue` /
  `performing security verification` 之一；
- 且 `server` 含 `cloudflare`、或 `cf-ray` 非空、或正文含 `cloudflare` / `cdn-cgi`。

原生请求命中挑战时回落浏览器路径；浏览器路径成功且**不再**是挑战时把
`preferBrowserTransport` 置为 `true`（会话级记忆，与 Java 一致）；浏览器路径失败时回落原生，
并把 `preferBrowserTransport` 置回 `false`。

---

## 2. Android → iOS 机制映射

| 子系统 | Android | iOS | 说明 |
|---|---|---|---|
| 主线程 | `Handler(Looper.getMainLooper())` / `runOnUiThread` | `DispatchQueue.main.async` + `DispatchQueue.main.asyncAfter(deadline:execute:)` + `DispatchWorkItem` | `DispatchWorkItem.cancel()` 等价 `handler.removeCallbacks` |
| HTTP | OkHttp `identityClient`（连接 15s / 读 30s / 写 120s、`followRedirects(false)`、`followSslRedirects(false)`） | `URLSession`（`.ephemeral`、`httpShouldSetCookies = false`、`httpCookieAcceptPolicy = .never`、`httpCookieStorage = nil`、`reloadIgnoringLocalCacheData`、`timeoutIntervalForRequest = 15`、`timeoutIntervalForResource = 30`）+ `LinuxDoIdentityRedirectBlocker`（`willPerformHTTPRedirection` 回调 `nil`） | 不跟随重定向是语义的一部分：`fetchConnectTrustPage` 手工逐跳校验；`collectSnapshot` 靠 3xx/401 判定未登录 |
| 登录窗口 | `Dialog` + 自绘 chrome（标题 / `×` / 「完成」/ 提示条）+ `WebView` + `WebViewClient` | 全屏 `UINavigationController` + `LinuxDoSessionViewController`（原生导航栏 + `WKWebView`） | 文案逐字保留：`LinuxDo · 登录与安全验证` / `LinuxDo · 正在建立安全会话` / `已阻止跳出 Linux.do 第一方域名` |
| 隐藏传输通道 | 不可见 `WebView` + `addJavascriptInterface(BrowserFetchBridge, "NewsNookLinuxDoBridge")` + `loadDataWithBaseURL(ORIGIN + "/", …)` | 1×1 透明 `WKWebView` + `WKScriptMessageHandler(name: "NewsNookLinuxDoBridge")` + `loadHTMLString(…, baseURL: URL(string: "https://linux.do/"))` | 同源 bootstrap 语义等价；`WKWebView` **必须** `addSubview` 才执行 JS |
| 桥消息 | `@JavascriptInterface onStart / onChunk / onComplete / onError` | `postMessage({id, kind:'start'\|'chunk'\|'done'\|'error', …})` → `userContentController(_:didReceive:)` → `handleBrowserFetchMessage` | 消息形状改变（iOS 没有 `@JavascriptInterface`），但 `PendingBrowserFetch` 的状态机与 Android `BrowserFetchPending` 一致：32 KiB 分块、16 MiB 上限、35s 超时、`set-cookie` 过滤 |
| 传输就绪 | `WebViewClient.onPageFinished` → `browserTransportReady = true` | `WKNavigationDelegate.webView(_:didFinish:)`（只认传输 WebView） | 15s 未就绪 → `failBrowserTransportInitialization("建立 Linux.do 浏览器网络通道超时")` |
| Cookie 读取 | `CookieManager.getInstance().getCookie(ORIGIN)`（同步） | `WKWebsiteDataStore.default().httpCookieStore.getAllCookies`（异步）+ 自实现 `cookieApplies` 域/路径/过期判定 | 插件内部流程全部改成异步回调；`clearUserApiKey` 的吊销请求需要同步 Cookie，改用 `HTTPCookieStorage.shared`（见 D4） |
| Cookie 写入 | `CookieManager.setCookie(url, cookie, cb)` + `flush()` | `LinuxDoCookieCommit` + `LinuxDoHTTPCookieStoreWriter` + `normalizedSetCookie(_:responseURL:)`；`flush()` 无对应物，改为回读 `getAllCookies` | 依赖文件已处理 Domain/Path 补全（见 `2026-09-26-linuxdo-browser-session-ios-port.md` D4） |
| Cookie 清理 | 按名 `setCookie(ORIGIN, "name=; Max-Age=0; …")` 两条（host-only + `.linux.do`） | 按域过滤 `httpCookieStore.delete(cookie)` 逐条删 | 范围更大但同样只碰 `*.linux.do`；`delete` 无失败回调 |
| 会话缓存 | `SharedPreferences("linuxdo_session_cache")` → `PREF_LAST_USER = "last_user"` | **`UserDefaults`**，键 `linuxdo_session_cache.last_user` | 明确声明：不发明别的存储。键名加前缀是因为 iOS 的 `UserDefaults` 是单一域，Android 的 `SharedPreferences` 是独立文件（见 D5） |
| `getActivity()` | `Activity` / `isFinishing()` | `bridge?.viewController` / `isBeingDismissed \|\| isMovingFromParent` | 近似而非等价（见 U5） |
| `getActivity().getIntent().getData()`（冷启动回流） | `load()` + `handleOnNewIntent` 把深链交给 `userApiAuth.handleRedirect` | **无对应物**：iOS 的 `ASWebAuthenticationSession` 由依赖类自己持有 `completionHandler` 并直接调 `handleRedirect` | 依赖类已实现；本插件不注册 `UIApplicationDelegate` 深链回调 |
| `handleOnDestroy()` | `userApiAuth.destroy()` + 拒绝挂起 call + 拆 WebView | `UIApplication.willTerminateNotification` 观察者 → `handleAppWillTerminate()` | Capacitor iOS 无插件销毁钩子（与 `ZhihuSessionPlugin` 同款兜底） |
| `KEYCODE_BACK` 回退 | `dialog.setOnKeyListener` → `webView.canGoBack()` | WebView 自带边缘返回手势（`allowsBackForwardNavigationGestures = true`） | 行为等价 |
| `setSupportMultipleWindows(false)` | `WebViewClient` + `WebSettings` | `WKUIDelegate.createWebViewWith` 返回 `nil`，允许的链接就地打开 | 文案 `已阻止跳出 Linux.do 第一方域名` |
| `Toast` | `Toast.makeText` | 自绘 `noticeLabel`（深色半透明，2s 后淡出） | 视觉不同，文案相同 |
| 屏幕方向 / 状态栏 | `WindowCompat` / `WindowInsetsControllerCompat` | 交给 iOS 系统与导航栏 `.black` 外观 | 无 JS 影响 |

### 2.1 线程模型（明确选择）

Capacitor 8 的 iOS bridge 在**串行后台队列**上调用插件方法（`CapacitorBridge.swift` 的
`dispatchQueue.async`），**不是主线程**。本插件的选择：

1. **全部可变状态只在主线程读写。** 每个 `@objc func` 方法入口先同步取出 `call` 参数，
   然后 `DispatchQueue.main.async` 进入状态机；`URLSession` / WebKit / UIKit 回调一律
   先切回主线程再碰状态。
2. **跨线程查询由 `NSLock`（`stateLock`）保护。** 只覆盖 `pendingCall` / `pendingUserApiCall` /
   `finishing` / `preferBrowserTransport` 四个字段；读写都发生在主队列上，锁只是让
   「非主线程读一次」也安全（例如调试或在 `deinit` 路径查询）。没有其它线程在改状态，
   所以不存在持锁等主线程的互等。
3. **依赖的 `LinuxDoBrowserSessionRecovery` 是 `@MainActor`**，用
   `Task { @MainActor in ... }` 进入。**不使用 `MainActor.assumeIsolated`**（iOS 17 标注）。
   本插件自身**不**标注 `@MainActor`，与 `ProxiedHttpPlugin.swift` 一致，避免 `@objc` 方法
   在 iOS 15 部署目标下的可用性风险。
4. `CAPPluginCall.resolve` / `reject` 本身线程安全，因此从任意队列结算都不会崩；
   但本实现仍统一在主队列结算，保证与状态变更的顺序一致（避免"先结算后改状态"的竞态）。

---

## 3. 不可移植 / 降级项与 JS 可见后果

### D1. 登录 WebView 的 OTP 兑换读 CSRF 的方式（**中风险，行为有意偏离**）

Android 在 `handleOtpPageFinished` 里用
`document.body.innerText` 取 `JSON.parse(...).csrf`。Android 的 `WebView` 把
`application/json` 响应渲染成可读文本，`innerText` 能拿到正文。

iOS 的 `WKWebView` 对 `application/json` 响应走「原生 JSON 预览」渲染路径，
`document.body.innerText` **不保证**包含正文（未验证）。

本实现改为在**同一文档内** `fetch('/session/csrf.json', {credentials:'include', …})`
取 CSRF（`otpCsrfProbeScript`）：

- 语义相同：同一 Cookie 会话、同一 Cloudflare 挑战通道、同源；
- 读取路径不依赖渲染细节，也不依赖 `innerText` 的换行/截断行为；
- 挑战页（非 JSON）→ `r.ok` 为 false 或 `cf-mitigated: challenge` → 返回空串 →
  保持窗口可见让用户完成挑战，与 Android 的 `if (csrf.isEmpty()) return;` 等价。

**JS 可见后果**：`authenticateUserApiKey` 的成功路径与 Android 相同；差异只在
「JSON 预览渲染」这一 iOS 特有细节上，属于**更保守**的取法。若真机发现
`fetch` 在该文档里被 CSP 拦（`connect-src`），会退回 `if (csrf.isEmpty()) return` 的
等待行为，最终由 2 分钟看门狗报 `LINUXDO_USER_API_OTP_TIMEOUT`（见 U2）。

### D2. 没有 `CookieManager.flush()`（低风险）

Android 在 Cookie 写入后显式 `flush()` 落盘。iOS 由 `WKWebsiteDataStore` 自行持久化；
本实现在三处调用 `flushCookies()`（`getAllCookies` 回读一次）表达同样的落盘意图：
OTP 快照前、浏览器 fetch 完成时、`clearBrowserSession` 结束时。

**JS 可见后果**：若 App 在落盘前被杀，可能丢最新 Cookie → 下次冷启动需要重新走一次
`prepareBrowserSession`（表现为"偶尔要重新验证"），**不会**产生错误数据。

### D3. 隐藏传输通道用 `postMessage` 而不是 `@JavascriptInterface`（低风险，机制替换）

iOS 没有 `addJavascriptInterface`。等价物是 `WKScriptMessageHandler`，但 JS 侧调用形状
必须从 `bridge.onStart(...) / onChunk(...) / onComplete(...) / onError(...)` 改成
`bridge.postMessage({id, kind, …})`。**这是本插件内联脚本的改动，不进 JS 仓库**，
所以对 `native.ts` / `client.ts` 完全不可见。

同时保留 Android 的两个关键行为：

- `redirect: 'manual'`（等价 OkHttp 的 `followRedirects(false)`）：3xx 时只把
  `status` / `headers` / `url` 交给原生，**不把跳转页正文**当响应（`data` 置空）；
- 32 KiB 分块 + 16 MiB 上限 → 超限时报 `Linux.do 浏览器响应过大`（与 Java 一致）。

**JS 可见后果**：无（消息形状只存在于插件内部）。

### D4. `clearUserApiKey` 的 Cookie 头走 `HTTPCookieStorage.shared`（中风险）

`clearUserApiKey` 要在发出 `POST /user-api-key/revoke` 之前同步拼出 Cookie 头。
`WKHTTPCookieStore` 只有异步 `getAllCookies`，而在主线程上同步等待它会死锁。
本实现改用 `HTTPCookieStorage.shared.cookies`（同步、App 级），域/路径/过期判定
仍走同一个 `cookieApplies`。

**JS 可见后果**：若 `HTTPCookieStorage.shared` 与 `WKWebsiteDataStore.default().httpCookieStore`
不同源，吊销请求可能少带会话 Cookie → 远端吊销失败。但 `clearUserApiKey` 的
本地登出**永远成功**（与 Java 相同：`onFailure` 也 `resolve`），所以 JS 侧只表现为
"服务端那份 key 可能没被吊销"（一次性密码作用域本来就访问不了普通 API，影响很小）。

### D5. 会话缓存从 `SharedPreferences` 改为 `UserDefaults`（低风险）

- Android：`getSharedPreferences("linuxdo_session_cache", 0)` + 键 `last_user`；
- iOS：`UserDefaults.standard` + 键 `linuxdo_session_cache.last_user`。

**明确声明**：这是 `SharedPreferences → UserDefaults` 的机制替换，不是发明新存储。
键名加前缀是因为 iOS 的 `UserDefaults` 是单一域，裸键 `last_user` 有撞名风险。
缓存内容（`id` / `username` / `name` / `avatar_template` / `trust_level` /
`unread_notifications` / `all_unread_notifications_count` / `can_use_templates?`）
与 Java `cacheSessionUser` 逐字一致。

**JS 可见后果**：无（缓存只是离线兜底，服务端始终是权威）。

### D6. `getObject` 的 `JSObject` 不能直接当 `[String: Any]`（已修，记录防回归）

Capacitor 8 的 `CAPPluginCall.getObject(_:)` 返回 `JSObject?`，而
`JSObject = [String: JSValue]`（`JSValue` 是空协议），既不能当 `[String: Any]?` 传，
也不能桥接成 `NSDictionary`。本实现的 `stringDictionary(_ object: JSObject?)` 按
动态类型逐项取值（`String` / `NSNumber`），与 `ProxiedHttpPlugin.swift` 同款。

**JS 可见后果**：若写成直接强转，**编译失败**（不是运行时降级）。

### D7. `clearUserApiKey` 的响应体不读取（无影响）

Java 用 `try (ResponseBody body = response.body())` 显式关闭；Swift 的 `dataTask`
在 completion 里已经把 `Data` 交出来，无需显式关闭。行为一致（都不看正文）。

### D8. `LINUXDO_RESPONSE_READ` 在 iOS 上几乎不可达（低风险）

Java 在 `responseBody.string()` 抛 `IOException` 时报 `LINUXDO_RESPONSE_READ`。
Swift 的 `dataTask` 把「读体失败」合并进 `error`，落到 `LINUXDO_REQUEST_NETWORK`。

**JS 可见后果**：极端情况下错误码从 `LINUXDO_RESPONSE_READ` 变成
`LINUXDO_REQUEST_NETWORK`。两者都不在 `client.ts` 的分类逻辑里（都归到
`network` 类），**不影响业务判定**。

### D9. `prepareBrowserSession` 的 presenter 校验（中风险）

Java 传 `getActivity()`，依赖类判 `null` / `isFinishing`。iOS 传 `bridge?.viewController`，
依赖类判 `isBeingDismissed || isMovingFromParent`。

**JS 可见后果**：与 Android 依赖类规格的 U5 相同——极端时序下返回
`{ready:false, reason:"activity"}`，用户看到"需要重新验证"，不会误判为会话退出。

### D10. 隐藏传输 WebView 需要宿主视图（中风险）

`WKWebView` 必须真的进视图层级才会执行 JS（Android 未 attach 也能跑 `loadUrl` 的 JS）。
本实现把它 `addSubview` 到 `bridge?.viewController.view`（1×1、透明、不可交互）。

**JS 可见后果**：若宿主控制器不可用（启动中 / 已被 dismiss），
`ensureBrowserTransport` 直接回 `当前 Activity 无法建立浏览器网络通道` →
`request` 回落原生路径 → 用户看到 `Linux.do 网络请求失败` 而不是静默挂起。

---

## 4. 验证计划

> 前置：本文件**未编译**。以下每一步都必须在 macOS + Xcode（或 CI）上执行；
> 第 1 步不通过就不要继续。

### 4.1 编译与注册

1. macOS 上把 `LinuxDoSessionPlugin.swift` 加入 App target 的 Sources
   （`project.pbxproj` 与 `MainViewController.swift` 的注册由中央流程处理，本文件不改）。
2. 确认编译通过，重点看：
   - 无 iOS 15 可用性报错（本文件只用 `WKWebView` / `WKScriptMessageHandler` /
     `WKWebsiteDataStore` / `URLSession` / `HTTPCookieStorage` / `DispatchQueue` / `NSLock`）；
   - `LinuxDoUserApiAuth` / `LinuxDoBrowserSessionRecovery` / `LinuxDoCookieCommit` /
     `LinuxDoHTTPCookieStoreWriter` 在同一 module 内可见；
   - `LinuxDoSessionViewController` 与 `LinuxDoSessionPlugin.isAllowedUrl` 的
     `fileprivate` 可见性成立（同文件）。
3. 确认 `pluginMethods` 恰好 10 项，且没有上传方法。

### 4.2 真机点击走查（按顺序）

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开 Linux.do 工作区 → 点登录 | 系统浏览器拉起 `/user-api-key/new`；回到 App 后快照 `authenticated: true`、`authMode: "browser-session"` |
| 2 | 登录中杀进程再回到 App | `snapshot()` 仍能恢复会话（凭据在 Keychain，pending nonce 在 UserDefaults） |
| 3 | 登录中调用 `cancelUserApiKeyAuth` | 挂起的 call 被拒 `LINUXDO_USER_API_CANCELLED`（注意 `reject` 顺序：message 位是中文，code 位是码） |
| 4 | 调用 `clearUserApiKey` | `resolve()` 成功；再 `snapshot()` 得 `authenticated: false` |
| 5 | 点"浏览器验证"（触发 `authenticate`） | 出现「Linux.do · 登录与安全验证」全屏窗口；点「完成」后窗口关闭并 resolve 快照 |
| 6 | 在登录窗口里点 `×` | `LINUXDO_SESSION_CANCELLED`，窗口关闭 |
| 7 | 触发一次会命中 Cloudflare 挑战的写入（如补传阅读记录） | JS 侧先 `prepareBrowserSession` → `{ready:true, username, userId, csrf}`；重试的写入 `transport: "browser-firstparty"` |
| 8 | 退出 linux.do 登录后重试第 7 步 | `prepareBrowserSession` 返回 `phase:"session", status:401`（**不是** `phase:"csrf"`），JS 抛"浏览器会话已退出" |
| 9 | 只让 CSRF 端点失败（模拟 500） | `phase:"csrf", status:500`，JS **不**抛"浏览器会话已退出" |
| 10 | `fetchConnectTrustPage` | 返回 `{status, data, finalUrl, headers}`；`finalUrl` 已去掉 query/fragment |
| 11 | `clearBrowserSession` | 窗口/传输 WebView 全部拆掉；`snapshot()` 与 `browserSnapshot()` 都变未登录 |
| 12 | 冷启动后立刻杀 App | 重启确认 Cookie 仍在（D2 落盘时延判定） |

### 4.3 测试脚本

```bash
npm run test:linuxdo           # 上游 linuxdo 套件 + 读同步套件
npm run test:linuxdo-readsync  # scripts/linuxdo-browser-session-probe.test.ts + linuxdo-firstparty-request.test.ts
node scripts/ios-native-plugin.test.mjs   # 断言每个 .swift 都在 Sources 里、插件注册形状
```

注意：这些脚本断言的是 **TS 契约与 iOS 工程注册**，不能证明 Swift 编译通过或行为正确。
本文件未改任何 TS / 测试脚本。

---

## 5. 不确定项（按风险排序）

| # | 风险 | 不确定内容 | 最坏后果 |
|---|---|---|---|
| U1 | **高** | `loadHTMLString(_:baseURL:)` 是否让隐藏传输 WebView 的 `document.origin` 变成 `https://linux.do`，从而使同源 `fetch(credentials:'include')` 带上 Cookie 且不被 CORS 拦 | 传输通道所有请求失败 → `request` 每次都回落原生 → 挑战场景下用户看到"网络请求失败" |
| U2 | **高** | OTP 兑换改为 `fetch('/session/csrf.json')` 后，在 `WKWebView` 的 JSON 文档里是否被 CSP / 渲染差异影响（D1） | CSRF 取不到 → 一直等到 2 分钟看门狗 → `LINUXDO_USER_API_OTP_TIMEOUT` |
| U3 | **高** | `HTTPCookieStorage.shared` 与 `WKWebsiteDataStore.default().httpCookieStore` 是否同源（D4） | 吊销请求少带 Cookie → 远端 key 未吊销（本地登出仍成功） |
| U4 | 中 | `Task { @MainActor in ... }` 在 `SWIFT_VERSION = 5.0` 下捕获非 `Sendable` 的 `self` / `CAPPluginCall` 是否只告警不报错（本机无法编译验证） | 若报错，需把插件类改为 `@MainActor` 并调整入口 |
| U5 | 中 | `isBeingDismissed \|\| isMovingFromParent` 与 Android `isFinishing()` 不等价 | 极端时序下 `prepareBrowserSession` 返回 `reason:"activity"` |
| U6 | 中 | `WKScriptMessageHandler` 强引用：`userContentController.add(self, name:)` 会让 WebView 持有插件；插件也持有 WebView → 引用环。本实现只在 `destroyBrowserTransport` / `failBrowserTransportInitialization` 里 `removeScriptMessageHandler` | 若拆解路径未走到，插件与 WebView 一起泄漏（会话级，不致命） |
| U7 | 中 | `redirect: 'manual'` 在 WKWebView 的 `fetch` 里对同源 302 是否真的把 `response.type` 置为 `opaqueredirect`（此时 `response.url` 可能为空） | `responseUrl` 为空 → 诊断里 `responsePath` 缺失，不影响状态判定 |
| U8 | 中 | `URLSession` 的 `value(forHTTPHeaderField: "Set-Cookie")` 在多条 Set-Cookie 时的形态，以及 `splitCombinedSetCookie` 的启发式是否正确 | Cookie 同步失败 → `LINUXDO_COOKIE_SYNC`（保守失败，不会静默成功） |
| U9 | 中 | `WKWebView` 对 `application/json` 的 `document.body.innerText` 行为（D1 的反面：快照路径仍在用 `innerText`） | `collectWebViewSnapshot` 解析不到 user → 快照回落缓存用户（与 Android 兜底一致） |
| U10 | 低 | `evaluateJavaScript` 返回 Promise 时 completion 的触发时机（OTP 探针是 async） | 可能拿到 `undefined` → 走"等待挑战完成"分支 → 最终超时 |
| U11 | 低 | `presenterAnchor()` 在多场景 / 无 key window 时返回 `nil` | `authenticateUserApiKey` 报 `LINUXDO_USER_API_BROWSER` |
| U12 | 低 | `LinuxDoSessionViewController` 的 `viewDidDisappear` 判定在 iPad 分屏 / 被覆盖时是否误报 | 误报"窗口已关闭" → `LINUXDO_SESSION_CANCELLED` |
| U13 | 低 | `UIApplication.willTerminateNotification` 在 iOS 上很少触发（多数是 `didEnterBackground`） | 进程被杀时不走 `handleAppWillTerminate`；挂起的 call 随进程消失（与 Android 的 `onDestroy` 覆盖度不同） |
| U14 | 低 | 上传方法缺失（§0） | `uploadLinuxDoFile` 失败，直到后续一遍补上 |

---

## 6. 未改动文件（明确声明）

本次只新增两个文件：

- `ios/App/App/LinuxDoSessionPlugin.swift`（新增）
- `docs/superpowers/specs/2026-09-26-linuxdo-session-ios-port.md`（本文）

未触碰：`project.pbxproj`、`MainViewController.swift`、`ios/App/CapApp-SPM/Package.swift`、
任何 TypeScript、任何 Java（含 `LinuxDoSessionPlugin.java` 与三个辅助类）、任何测试脚本。

---

## 7. 追加一遍：4 个上传方法 + `linuxDoUploadProgress` 事件（2026-09-26，第二遍）

> **本节的定位**：§0 与 U14 描述的是**第一遍**的状态，已被本节取代（原文保留不改，便于对照）。
> 本节只记录**新增**内容；§1–§6 关于 10 个会话 / 请求方法的结论全部仍然有效。
>
> **本节同样未经编译、未经真机验证**（Windows 主机无 Xcode）。所有"已实现"均应读作"按源码写的"。

### 7.1 变更摘要

| 项 | 第一遍 | 第二遍（本节） |
|---|---|---|
| `pluginMethods` 项数 | 10 | **14**（新增的 4 项排在数组末尾，顺序 `beginUpload` → `appendUploadChunk` → `finishUpload` → `cancelUpload`） |
| `@objc func` 数量 | 10 | **14** |
| 进度事件 | 无 | `notifyListeners("linuxDoUploadProgress", data: ...)` |
| 新增可变状态 | — | `uploadSessions: [String: UploadSession]`、`uploadSession: URLSession?`（都只在主线程读写） |
| 文件行数 | 2223 | 见 §7.8 |

新增状态**不进** `stateLock`：它们是纯主线程状态（与 Java 用 `ConcurrentHashMap` 的理由不同——
iOS 侧所有入口都先 `DispatchQueue.main.async`，不存在 Java 那种 OkHttp 工作线程直接触碰
`uploadSessions` 的路径）。`stateLock` 仍然只保护 §2.1 记录的那四个跨线程查询字段。

### 7.2 方法表（options 进 / 字段出 / 错误情形）

错误码与错误文案**逐字**取自 Java（`call.reject(message, code)` → Swift
`call.reject(message, code)`，参数顺序与 §1.1 的约定一致）。

#### 7.2.1 `beginUpload`

| 项 | 内容 |
|---|---|
| options 进 | `fileName: string`（缺省 `"upload.bin"`，等价 Java `getString("fileName", "upload.bin")`）、`mimeType: string`（缺省 `"application/octet-stream"`） |
| 字段出 | `{ uploadId: string }`（`UUID().uuidString`，等价 Java `UUID.randomUUID().toString()`） |
| 副作用 | 在 `FileManager.default.temporaryDirectory` 建一个空文件（Java 是 `getCacheDir()`），并在 `uploadSessions` 登记一条会话 |
| 错误 | `无法创建上传临时文件` / `LINUXDO_UPLOAD_PREPARE`（建文件失败；插件已释放也走这条） |
| 与 Java 的差异 | `fileName` 用 `sanitizedUploadFileName` 取最后一段（同时把 `\` 归一成 `/`），对齐 `new File(name).getName()`；空结果回落 `"upload.bin"` |

#### 7.2.2 `appendUploadChunk`

| 项 | 内容 |
|---|---|
| options 进 | `uploadId: string`、`base64: string`（JS 侧每块 256 KiB 原文的 base64） |
| 字段出 | `{ bytesWritten: number }`——**累计**已写入字节（不是本块字节），等价 Java `session.bytesWritten` |
| 副作用 | 追加写暂存文件；`bytesWritten` 只在主队列累加 |
| 错误 | ① 会话不存在 → `上传会话已失效` / `LINUXDO_UPLOAD_SESSION`（**不删文件**，因为文件归属未知）；② `base64` 为空串 → `上传分块为空` / `LINUXDO_UPLOAD_CHUNK`（**不删文件**）；③ base64 非法 → `文件分块编码无效` / `LINUXDO_UPLOAD_BASE64`（**删文件 + 摘会话**）；④ 累计超过 256 MB → `单个附件超过 256 MB` / `LINUXDO_UPLOAD_TOO_LARGE`（**删文件 + 摘会话**）；⑤ 追加写失败 → `写入上传临时文件失败` / `LINUXDO_UPLOAD_WRITE`（**删文件 + 摘会话**） |
| 与 Java 的差异 | 追加写用 `OutputStream(url:append:true)` + 循环 `write` 代替 `FileOutputStream(file, true)`；没有 `FileOutputStream` 那种"构造即抛"的语义，所以写失败统一收敛到 `LINUXDO_UPLOAD_WRITE` |

#### 7.2.3 `finishUpload`

| 项 | 内容 |
|---|---|
| options 进 | `uploadId: string` |
| 字段出 | 服务端 `POST /uploads.json` 返回的**解析后 JSON 对象**（`[String: Any]` 直接 `call.resolve`），等价 Java `JSObject.fromJSONObject(new JSONObject(text))` |
| 前置校验 | 先 `uploadSessions.removeValue(forKey: uploadId)`；会话不存在、`bytesWritten <= 0`、或暂存文件已不在 → `上传会话已失效` / `LINUXDO_UPLOAD_SESSION`（若会话对象拿得到，仍然删文件，对齐 Java `if (session != null) session.file.delete()`） |
| 分支 A（已登录） | `userApiAuth?.hasValidCredential() == true` → 直接 `performUpload(csrf: "")` |
| 分支 B（未登录） | 先 `GET https://linux.do/session/csrf.json`（**不带** `newsnook_otp_csrf` 参数，与 §1 的 OTP 路径不同），取 `csrf` 字段后 `performUpload(csrf: <token>)` |
| 错误（分支 B） | 网络失败 → `无法建立上传会话` / `LINUXDO_UPLOAD_CSRF`；响应非 2xx、body 为空、或 `csrf` 为空 → `无法获取 CSRF Token` / `LINUXDO_UPLOAD_CSRF` |
| 错误（上传本身） | 网络失败 → `上传失败` / `LINUXDO_UPLOAD_NETWORK`；非 2xx → `text.isEmpty ? "上传失败" : text` / `LINUXDO_UPLOAD_HTTP`（**把服务端原文透传给 JS**）；2xx 但 body 不是 JSON 对象 → `无法解析上传结果` / `LINUXDO_UPLOAD_PARSE` |
| Cookie 同步 | 上传响应里的 `Set-Cookie` 走既有的 `commitResponseCookies`（5s 超时）；失败 → `无法解析上传结果` / `LINUXDO_UPLOAD_PARSE`（对齐 Java：`syncResponseCookies` 抛错被同一个 `catch (Exception)` 接住，落到 PARSE 分支） |
| 请求形状 | `POST /uploads.json`，`Content-Type: multipart/form-data; boundary=...`，`Accept: application/json`，`X-Requested-With: XMLHttpRequest`，可选 `X-CSRF-Token`，Cookie / `User-Agent` 由 `applyBrowserSessionHeaders` 语义显式给，另加 `userApiAuth.applyHeaders()` 的 `User-Api-Key` / `User-Api-Client-Id` |
| multipart 字段 | `upload_type=composer` + `file`（`filename=<fileName>`、`Content-Type=<mimeType>`），字段顺序与 Java `MultipartBody.Builder` 的 `addFormDataPart` 顺序一致 |

#### 7.2.4 `cancelUpload`

| 项 | 内容 |
|---|---|
| options 进 | `uploadId: string` |
| 字段出 | 无（`call.resolve()`） |
| 副作用 | 摘会话 → 取消在途 `URLSessionUploadTask`（若有）→ 删除暂存文件；**总是成功**，即使 `uploadId` 不存在（对齐 Java `cleanupUpload` 对未知 id 静默返回） |
| 错误 | 无（Java 也没有 reject 分支） |

#### 7.2.5 事件 `linuxDoUploadProgress`

| 字段 | 类型 | 语义 |
|---|---|---|
| `uploadId` | `string` | 发起该次上传时 `beginUpload` 返回的 id |
| `sentBytes` | `Int`（`Int64` 转换后） | **整个 multipart 请求体**已发送的字节数（不是文件字节数，也不是"已写入暂存文件"的字节数） |
| `totalBytes` | `Int` | 整个 multipart 请求体的总字节数（≈ `Content-Length`） |
| `progress` | `Double` | `min(1.0, sentBytes / totalBytes)`，`totalBytes <= 0` 时为 `0.0` |

`uploadId` / `sentBytes` / `totalBytes` / `progress` 四个键与 Java `notifyUploadProgress`
逐字一致。**`progress` 是网络进度**（0…1），JS 侧自己算 `0.15 + networkProgress * 0.8`，
所以这里**绝不能**上报本地暂存百分比。

### 7.3 暂存与进度机制（Android → iOS 机制替换）

**选择：文件型上传任务 + `URLSessionTaskDelegate` 的 `didSendBodyData`。**

| 环节 | Android | iOS（本节实现） |
|---|---|---|
| 暂存位置 | `File.createTempFile("linuxdo-upload-", ".tmp", getContext().getCacheDir())` | `FileManager.default.temporaryDirectory`（= `NSTemporaryDirectory()`）+ `linuxdo-upload-<UUID>.tmp` |
| 追加写 | `FileOutputStream(session.file, true)` | `OutputStream(url: file, append: true)`，循环 `write` 到写完 |
| 请求体 | `MultipartBody.FORM` + 自定义 `UploadProgressRequestBody`（OkHttp 在 `writeTo(BufferedSink)` 里边写边数字节） | 先把完整 multipart 请求体序列化到**第二个**临时文件（`linuxdo-upload-body-<UUID>.tmp`），再用 `uploadTask(with:fromFile:)` 上传 |
| 进度来源 | `UploadProgressRequestBody.writeTo` 里累加 `sent += read`，对 `session.file.length()` 取比 | `urlSession(_:task:didSendBodyData:totalBytesSent:totalBytesExpectedToSend:)` |
| 进度节流 | 整数百分比变化，或距上次 ≥ 160ms（`percent == 100` 必报） | 整数百分比变化（`percent == 100` 必报）；**省略 160ms 那条**（`didSendBodyData` 本身按系统块回调，频率已经不高） |
| 事件线程 | `notifyListeners` 在 OkHttp 工作线程（Android 允许） | 委托回调在 `URLSession` 的 delegate queue（后台）→ **先 `DispatchQueue.main.async` 再 `notifyListeners`** |

**为什么不用 `Data` 型上传体**：`uploadTask(with:fromData:)` 把整个 body 放在内存里，
`didSendBodyData` 在多数网络路径上不会按块回报，拿不到真实网络进度；而且 256 MB 上限下
内存不可接受。

**单位说明**：`totalBytesSent` / `totalBytesExpectedToSend` 都是**请求体**（含 boundary 与
表单头）的字节数，所以 `sentBytes`/`totalBytes` 与 Java 的 `sent`/`totalBytes`（= `session.file.length()`）
**不是同一个基数**——分母多了约几百字节的 boundary/header。比值差异在 0.1% 量级，
对进度条无可见影响，但严格说这是"语义等价、数值不同"。

**会话隔离**：`didSendBodyData` 的委托挂在**上传专用**的 `uploadURLSession()`
（`URLSessionConfiguration.ephemeral` + `delegate: self`），不动
`sharedIdentitySession()`（它的 delegate 是 `LinuxDoIdentityRedirectBlocker`，改它会波及 §1 的
10 个方法）。上传会话同样 `httpShouldSetCookies = false` + `httpCookieStorage = nil`，
Cookie 一律显式给，与 `identityClient` 对齐。

**兜底**：完成回调里若 `error == nil`，再补发一次 `progress = 1.0`（用 `bytesWritten` 当分子分母）。
理由是 `didSendBodyData` 是"文档保证但实测依赖网络路径"的回调，万一它在本机/本网络路径上不回报，
JS 的进度会停在 0.15；补发一次至少让 `0.15 + 0.8 * 1.0 = 0.95` 收敛（剩下的 0.05 由 JS 在
`finishUpload` resolve 后补）。**副作用**：正常路径下 JS 会在 `progress = 1.0` 上被通知两次
（幂等，`onProgress` 只是赋值）。

### 7.4 清理与失败语义

暂存文件有两类，都在 `FileManager.default.temporaryDirectory`：

1. **数据文件** `linuxdo-upload-<UUID>.tmp`：`appendUploadChunk` 逐块追加写。
2. **请求体文件** `linuxdo-upload-body-<UUID>.tmp`：`finishUpload` 序列化 multipart 时生成，
   只在一次上传的生命周期内存在。

| 路径 | 数据文件 | 请求体文件 | JS Promise |
|---|---|---|---|
| `cancelUpload`（含未知 id） | 删（若会话存在） | 由任务完成回调删（`cancel()` 会触发） | `resolve()` |
| `appendUploadChunk` 的 base64 非法 / 超 256 MB / 写失败 | 删 + 摘会话 | 尚未生成 | `reject` 对应错误码 |
| `appendUploadChunk` 的会话失效 / 空分块 | **不删**（对齐 Java） | 尚未生成 | `reject` |
| `finishUpload` 的前置校验失败 | 删（会话对象拿得到时） | 尚未生成 | `reject LINUXDO_UPLOAD_SESSION` |
| CSRF 阶段失败 | 删 | 尚未生成 | `reject LINUXDO_UPLOAD_CSRF` |
| 上传网络失败 / 非 2xx / 解析失败 | 删（完成回调里删） | 删（完成回调里删） | `reject` 对应错误码 |
| 上传成功 | 删（完成回调里删） | 删（完成回调里删） | `resolve(服务端 JSON)` |
| 应用终止 / 插件 `deinit` | `cleanupAllUploads()` 全部删 + 取消在途任务 | 由任务完成回调删 | 若 call 还在，`reject LINUXDO_UPLOAD_NETWORK` |

**进程级路径的说明**：Java 的 `handleOnDestroy()` 没有显式清理上传会话，靠 Android
`cacheDir` 由系统回收。iOS 的 `tmp/` **不会**自动回收，所以本实现在
`handleAppWillTerminate()`（以及 `deinit`）里调用 `cleanupAllUploads()`：
取消全部在途任务、删除全部暂存文件、`invalidateAndCancel()` 上传会话。
`cleanupAllUploads()` 先把 `session.settled = true` 再取消，所以取消触发的完成回调会静默退出，
不会对已经因进程终止而无意义的 call 再 `reject` 一次。

**Promise 收敛保证**：上传任务的完成回调**一定会**走到 `call.resolve` 或 `call.reject`
（插件已释放时也 `reject`，不静默 `return`）；Cookie 提交阶段另有 5s 超时兜底
（`commitResponseCookies`）。`session.settled` 保证 `cancelUpload` 与完成回调之间不会双重结算。

**已知泄漏**：`performUpload` 里 `session.task = task` 而任务的 `completionHandler` 弱持有
`session`（`[weak session]`），所以正常情况下不构成引用环；但任务被取消且完成回调因
`settled` 提前返回时，`session.task` 不会被置空——该 `UploadSession` 会一直活到插件释放。
这是会话级（不是进程级）的小泄漏，已记录为 U-新4。

### 7.5 不确定项（按风险排序，仅本遍新增）

| # | 风险 | 不确定内容 | 最坏后果 |
|---|---|---|---|
| N1 | **高** | `URLSessionTaskDelegate` 的 `didSendBodyData` 对 `uploadTask(with:fromFile:)` 是否在**本机 iOS 27 / 目标 iOS 15 上真的按块回调**（Apple 文档保证，但社区有"文件型上传不回调"的相反报告） | 进度事件只发兜底那一次 → 进度条从 15% 直接跳到 95%，没有中间过程（功能不坏，体验退化） |
| N2 | **高** | 256 MB 上限下"先序列化到第二个临时文件"会把峰值磁盘占用翻倍（数据文件 + 请求体文件），且序列化是同步主线程 I/O | 大文件时主线程卡顿数秒；磁盘紧张时序列化失败 → `LINUXDO_UPLOAD_NETWORK`（错误码不精确） |
| N3 | 中 | `Data(base64Encoded:options:.ignoreUnknownCharacters)` 与 Android `Base64.DEFAULT` 的**非法字符容忍度不同**：Android 对某些非法输入抛 `IllegalArgumentException`，iOS 会静默丢弃 | 本该报 `LINUXDO_UPLOAD_BASE64` 的输入被当成"部分有效"继续写 → 上传的文件静默损坏 |
| N4 | 中 | `OutputStream(url:append:true)` 的 `streamStatus` 判定（`.open` / `.writing`）是否在所有 iOS 15 路径上都成立；`append: true` 对不存在的文件的行为 | 合法分块被误判为 `LINUXDO_UPLOAD_WRITE` |
| N5 | 中 | `uploadURLSession()` 复用同一个 session 跑 CSRF 的 `dataTask` 与文件 `uploadTask`，`timeoutIntervalForRequest = 120s` 对慢网络下的大文件是否够（Java 的 `writeTimeout` 也是 120s，但 OkHttp 的语义是"单次写"不是"总时长"） | 慢网络下大文件上传被 `NSURLErrorTimedOut` 打断 → `LINUXDO_UPLOAD_NETWORK` |
| N6 | 低 | `notifyListeners(_:data:)` 收 `NSDictionary<NSString *, id>`；本实现只放 `String` / `Int` / `Double` 以求稳定过桥 | 若桥接对 `Int` 处理异常，JS 侧 `event.progress` 变成 `undefined` → JS 自己 clamp 成 0（进度条不动） |
| N7 | 低 | 未登录分支的 CSRF `dataTask` 与上传任务共用 delegate 队列，`didSendBodyData` 里 `task as? URLSessionUploadTask` 的过滤是否足够 | CSRF 响应被误当成上传进度（已用类型过滤排除，理论不会） |

### 7.6 验证要求（重要）

**`npm run test:linuxdo*` 不覆盖 Swift。** 现有相关脚本只断言 TS 契约与 iOS 工程注册形状
（见 §4.3：`node scripts/ios-native-plugin.test.mjs` 只检查每个 `.swift` 是否在 Sources 里、
插件注册形状），它们**不能**证明本节的 Swift 编译通过，更不能证明上传行为正确。

因此本节的任何结论都必须靠**真机验证**：

1. 在 macOS 上编译（本机 Windows 无 Xcode，连语法都没过过编译器）；
2. 真机跑一遍 `uploadLinuxDoFile`：小文件（< 1 MB）、中等文件（~10 MB）、接近上限的文件；
3. 观测点：进度事件是否**连续**（验证 N1）、暂存文件与请求体文件是否在成功 / 失败 / 取消
   三条路径后都从 `tmp/` 消失（验证 §7.4）、`cancelUpload` 后 JS 是否立刻拿到 resolve 且没有
   迟到的 `linuxDoUploadProgress`；
4. 断网 / 403 / 服务端返回非 JSON 三种失败路径各自的错误码是否符合 §7.2。

### 7.7 本节明确未改动的文件

- `ios/App/App/LinuxDoSessionPlugin.swift`（追加，未改 §1–§6 覆盖的 10 个方法）
- `docs/superpowers/specs/2026-09-26-linuxdo-session-ios-port.md`（追加本节）

未触碰：`project.pbxproj`、`MainViewController.swift`、`ios/App/CapApp-SPM/Package.swift`、
任何 TypeScript、任何 Java、任何测试脚本。

### 7.8 第二遍之后的目标文件规模

`ios/App/App/LinuxDoSessionPlugin.swift`：2223 行 → **2754 行**（+531）。
`pluginMethods` 数组：10 项 → **14 项**。`@objc func`：10 → **14**。
（行数含本遍新增的注释；该数字取自追加完成时对文件的直接计数。）

## 8. 追加一遍：`fetchMedia` 媒体字节（2026-09-27，第三遍）

### 8.1 问题

真机现象：Linux.do 帖子的**正文图片全部显示「图片加载失败 · 点按重试」**，但**头像正常**
（头像走 `cdn.ldstatic.com`），同一帖子在 iPhone Safari 里图片正常。

实测（2026-09-27，Windows 侧）：

| 请求 | 结果 |
|---|---|
| `https://linux.do/uploads/...`（真实 3X/1X 上传路径） | **403 `Just a moment...`**，响应头 `cf-mitigated: challenge`；换 iPhone WKWebView UA / Chrome UA 一致 |
| `https://linux.do/latest.json` | 403（同上，故 API 也必须走浏览器传输） |
| `https://cdn.ldstatic.com/letter_avatar/...` | 200（公开，无挑战） |
| `https://cdn.ldstatic.com/uploads/...` | 404（CDN 不服务 `/uploads/`，所以**不能**用改写域名来绕） |

即：**主站图片落在 Cloudflare 托管挑战后面**。宿主 WebView 的跨站 `<img>` 拿不到放行
（跨站 Cookie 策略），而通用兜底 `resolvePlayableImageSrc()` → `CapacitorHttp` 走的是
URLSession 且不带 linux.do 任何 Cookie（插件把 Cookie 写在 `WKWebsiteDataStore`），
两条路都 403。API 之所以没事，是因为 §1.2 的浏览器传输通道本来就是为这个挑战准备的。

### 8.2 方法表

| JS 契约 | 行为 |
|---|---|
| `fetchMedia({ url, referer? })` | 只接受 `https://linux.do`（复用 `isApiAllowedUrl`，不含子域）；成功 resolve `{ status, base64, contentType?, transport }`；失败 reject `LINUXDO_MEDIA_URL` / `LINUXDO_MEDIA_NETWORK` / `LINUXDO_MEDIA_HTTP` / `LINUXDO_MEDIA_EMPTY` / `LINUXDO_MEDIA_BROWSER` |

实现顺序（`performNativeMediaRequest` → `performBrowserMediaRequest`）：

1. **原生**：带 `readCookieHeader(origin:)` 的 Cookie 头 + `Referer` + 浏览器 UA + `Accept: image/*`
   走 `sharedIdentitySession()`（不跟随重定向、不碰 Cookie 存储），2xx 且
   `Content-Type` 是 `image/` `video/`（或缺省）时把字节 `base64EncodedString()` 回传；
2. **浏览器传输**：命中挑战 / 非 2xx / 非媒体正文时，复用 §2 的隐藏同源传输 WebView，
   `binary: true` 让内联脚本把响应读成 **data URL**（`response.blob()` → `FileReader.readAsDataURL`）
   分片回传，原生侧剥掉 `data:<type>;base64,` 前缀还原 base64。媒体路径用 `redirect:'follow'`
   （图片常被 301 到 CDN），API 路径仍是 `redirect:'manual'` 不变。

### 8.3 JS 侧

- `src/features/linuxdo/media/imageSource.ts`：`resolveLinuxDoImageSrc(url)` —— 非原生 / 非
  `linux.do` 主站 / 失败一律原样返回（网页端与 CDN 图片不受影响）；成功时 `atob` → `Blob` →
  `blob:` URL，按 URL 缓存（上限 96 条，FIFO 回收并 `revokeObjectURL`），登出与
  「清除验证数据」调用 `releaseLinuxDoImageCache()`。
- `src/features/linuxdo/ui/LinuxDoCookedBody.tsx`（新）：所有 cooked HTML 的唯一渲染入口
  （帖子正文、资料页简介、动态摘要、搜索结果摘要），内部就是 `useProgressiveImages` +
  `resolveImage: resolveLinuxDoImageSrc` + 投票条/分类点内联样式。`ThreadViews` 原来的
  私有 `LinuxDoPostBody` 改为它的薄包装，不再各写一份。
- `src/features/linuxdo/ui/useLinuxDoImageSrc.ts`（新）：React 直接渲染的图片（资料页勋章）
  用这个 hook 解析，非主站/非原生/失败原样返回。
- `src/hooks/useProgressiveImages.ts`：新增可选 `resolveImage`，接管失败兜底；先问自定义
  resolver，它原样返回（管不了这个地址）才走通用原生兜底；自定义 resolver 返回的 blob
  由它自己持有，hook 卸载时**不**撤销。给了 `resolveImage` 即视为存在兜底通道，不再要求
  调用方同时打开 `forceNativeFallback`。

### 8.4 验证要求

同 §7.6：`npm run test:linuxdo-media`（新增，已并入 `test:linuxdo`）只断言 TS 契约、
base64 解码、非原生回退，以及对 Swift 源文件的**形状**断言（`fetchMedia` 已注册、
`binary` 分支存在、挑战后回落存在）；**不能**证明 Swift 编译通过或真机取到字节。
必须在 macOS 上编译 + 真机走查：带图帖子的正文图片（先占位后渐显、点击可放大、同一图片
第二次进入不再走网络、无图帖子不报错）、带简介与勋章的资料页、搜索结果里带图摘要。

### 8.5 本节未改动的文件

`project.pbxproj`、`MainViewController.swift`、`CapApp-SPM/Package.swift`、任何 Java、
任何 Android 代码。`fetchMedia` 只加在 iOS 插件上（Android 的 WebView 与 CookieManager
共享会话，图片本来就能直接加载），因此 Android 与 Web 行为完全不变。

### 8.6 第三遍之后的目标文件规模

`ios/App/App/LinuxDoSessionPlugin.swift`：2754 行 → **2917 行**。
`pluginMethods` 数组：14 项 → **15 项**。`@objc func`：14 → **15**。

