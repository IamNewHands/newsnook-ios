# LinuxDo 浏览器会话恢复 + Cookie 提交 iOS 移植规格（2026-09-26）

把 Android 的两个辅助类移植为 iOS Swift：

- 源 1：`android/app/src/main/java/com/aizeek/newsnook/LinuxDoBrowserSessionRecovery.java`（228 行）
- 源 2：`android/app/src/main/java/com/aizeek/newsnook/LinuxDoCookieCommit.java`（35 行）
- 目标：`ios/App/App/LinuxDoBrowserSessionSupport.swift`（一个文件装两个类型，只需一次 Xcode 注册）
- 约束：iOS 15.0（`ios/App/CapApp-SPM/Package.swift` → `platforms: [.iOS(.v15)]`）、swift-tools 5.9、无第三方依赖、**不是** Capacitor 插件（无 `CAPPlugin` / `jsName`）
- **本文档对应的 Swift 文件未经编译、未经真机验证**（Windows 主机无 Xcode）。所有"已实现"均应读作"按源码写的"。

契约来源：`src/features/linuxdo/session/native.ts`（`LinuxDoBrowserPreparation` / `browserSnapshot` 结果形状）
与 `src/features/linuxdo/api/client.ts`（`phase`/`status`/`transport: 'browser-firstparty'` 消费方式）。

---

## 1. Java 公开成员 → Swift 对应 → 调用方预期

### 1.1 `LinuxDoBrowserSessionRecovery`

| Java 成员 | 行 | Swift 对应 | 调用方（插件包装层）预期 |
|---|---|---|---|
| `prepare(Activity, Consumer<JSObject>)` | 55 | `prepare(presenter: UIViewController?, completed: @escaping PreparationCallback)` | 从 `getActivity()` 等价物（`bridge?.viewController`）进入；回调在主线程。`presenter == nil` → 同步回调 `{ready:false, reason:"activity"}` |
| `canRequest(String): boolean` | 121 | `canRequest(_ url: String) -> Bool` | 插件在决定走第一方文档前先问；未 ready 时恒为 `false` |
| `request(String, String, JSONObject, String, Consumer<JSObject>)` | 133 | `request(url:method:headers:body:completed:)` | `headers` 收敛为 `[String: String]`（见 §4-D1）；回调在主线程 |
| `cancel()` | 178 | `cancel()` | 插件在 `clearBrowserSession` / 账号切换 / `onDestroy` 时调用 |
| `private PendingRequest` | 48 | `private final class PendingRequest` | 内部实现，不暴露 |
| `private finishRequest / finishPreparation / touch / decode / asset` | 180–224 | 同名 `private` 方法 + `static decode(_:)` | 内部实现 |
| `private static requestError / unavailable` | 226–227 | `static requestError(_:)` / `static unavailable(reason:)` | 内部实现（`static` 便于测试直接断言文案） |

### 1.2 `LinuxDoCookieCommit`

| Java 成员 | 行 | Swift 对应 | 调用方预期 |
|---|---|---|---|
| `interface Writer { void write(String, Consumer<Boolean>) }` | 10 | `protocol Writer { func write(cookie: String, completed: @escaping (Bool) -> Void) throws }` | 包装层实现它，或用 `ClosureWriter` / `LinuxDoHTTPCookieStoreWriter` |
| `static commit(List<String>, Writer, Runnable, Runnable)` | 14 | `static func commit(cookies:writer:success:failure:)` + 闭包重载 `commit(cookies:write:success:failure:)` | 与 Java 相同：空列表立即 `success()`；全成功 `success()` 一次；任一失败 `failure()` 一次 |
| `private LinuxDoCookieCommit()` | 12 | `private init(count:success:failure:)` | 不可直接实例化 |

---

## 2. 最终 Swift API 表面（插件包装层照此调用，无需再读 Java）

```swift
// ---- 类型 1：会话恢复 ----
@MainActor
final class LinuxDoBrowserSessionRecovery: NSObject, @unchecked Sendable {

    typealias PreparationResult = [String: Any]   // {ready, username?, userId?, csrf?, reason?, phase?, status?}
    typealias ResponseResult = [String: Any]      // {status, data, headers?, responseUrl?} 或 {error}
    typealias PreparationCallback = (PreparationResult) -> Void
    typealias ResponseCallback = (ResponseResult) -> Void
    typealias WebViewFactory = () -> WKWebView

    // 常量（与 Java 一致）
    static let origin: String                 // "https://linux.do"
    static let prepareTimeout: TimeInterval   // 15
    static let cooldown: TimeInterval         // 30
    static let idleTimeout: TimeInterval      // 120
    static let requestTimeout: TimeInterval   // 35
    static let preparePollInterval: TimeInterval  // 0.25
    static let requestPollInterval: TimeInterval  // 0.1

    convenience override init()
    init(webViewFactory: @escaping WebViewFactory)

    /// Cookie 变化通知（主线程）。可选，仅用于日志/调试。
    var onCookiesChanged: (() -> Void)?

    /// 与 WKWebsiteDataStore.default() 同源的 Cookie 存储。
    var cookieStore: WKHTTPCookieStore { get }

    static func defaultWebView() -> WKWebView

    func prepare(presenter: UIViewController?, completed: @escaping PreparationCallback)
    func canRequest(_ url: String) -> Bool
    func request(url: String,
                 method: String,
                 headers: [String: String],
                 body: String,
                 completed: @escaping ResponseCallback)
    func cancel()

    static func requestError(_ message: String) -> ResponseResult
    static func unavailable(reason: String) -> PreparationResult

    /// 把 WebView 挂进 presenter 视图层级（1×1、透明、不可交互）。
    @discardableResult
    static func attach(_ browser: WKWebView, to presenter: UIViewController) -> WKWebView
}

// ---- 类型 2：Cookie 提交 ----
final class LinuxDoCookieCommit {

    protocol Writer {
        func write(cookie: String, completed: @escaping (Bool) -> Void) throws
    }

    struct ClosureWriter: Writer {
        init(_ body: @escaping (String, @escaping (Bool) -> Void) throws -> Void)
    }

    static func commit(cookies: [String],
                       writer: Writer,
                       success: @escaping () -> Void,
                       failure: @escaping () -> Void)

    static func commit(cookies: [String],
                       write: @escaping (String, @escaping (Bool) -> Void) throws -> Void,
                       success: @escaping () -> Void,
                       failure: @escaping () -> Void)
}

// ---- 可选辅助（本文件附带，非必需） ----
struct LinuxDoHTTPCookieStoreWriter: LinuxDoCookieCommit.Writer {
    init(store: WKHTTPCookieStore = WKWebsiteDataStore.default().httpCookieStore)
    static func properties(from setCookie: String) -> [HTTPCookiePropertyKey: Any]
    static func normalizedSetCookie(_ setCookie: String, responseURL: URL?) -> String
}
```

### 2.1 结果形状（必须与 JS 契约逐字一致）

| 场景 | Swift 返回值 | 对应 JS 消费点 |
|---|---|---|
| 探针成功 | `{ready:true, username:String, userId:Int, csrf:String}` | `client.ts:150` `prepared.ready && prepared.csrf` |
| 会话退出（探针 `/session/current.json` 401/404，或返回非 2xx） | `{ready:false, reason:"needs-verification", phase:"session", status:<HTTP 状态>}` | `client.ts:145` `phase === 'session' && (status === 401 \|\| 404)` → 抛"浏览器会话已退出" |
| CSRF 拉取失败（探针 `/session/csrf.json` 非 2xx，或 `csrf` 为空） | `{ready:false, reason:"needs-verification", phase:"csrf", status:<HTTP 状态或 200>}` | 不命中 401/404 分支 → 落到"浏览器账号与当前账号不同"或直接重试 |
| 15s 超时 | `{ready:false, reason:"needs-verification"}`（**无** `phase`/`status`） | `'phase' in prepared` 为 false → 不误判为会话退出 |
| presenter 不可用 | `{ready:false, reason:"activity"}` | 同 JS `native.ts:79` 的 `unsupported` 形态 |
| 冷却期内 | `{ready:false, reason:"cooldown"}` | 不重复开页面 |
| 空闲/显式取消 | `{ready:false, reason:"cancelled"}` | — |
| 请求未就绪 | `{error:"Browser session not ready"}` | `client.ts` 走 native 失败路径 |
| 请求超时 | `{error:"Linux.do 浏览器请求超时"}` | 同上 |
| JS 侧请求失败 | `{error:"Linux.do 浏览器请求失败"}` | 同上 |
| 请求启动失败 | `{error:"Linux.do 浏览器请求无法启动"}` | 同上 |
| 会话结束（请求被取消） | `{error:"Linux.do 浏览器会话已结束"}` | 同上 |

**`phase`/`status` 的语义区分必须保住**：`phase:"session"` 表示身份探测就失败（401/404 = 真的没登录）；`phase:"csrf"` 表示身份没问题、只是 CSRF 没取到。`client.ts:145` 只对前者抛 `auth-required`，后者要继续走"账号比对 / 重试"。移植时任何把两者合并的写法都会让"CSRF 抖动"被误报成"会话退出"。

---

## 3. Android → iOS 机制映射

| Android 机制 | iOS 替换 | 差异与处理 |
|---|---|---|
| `android.webkit.WebView` + `WebSettings`（JS/DOM storage 开、file/content access 关、单窗口、mixed content 禁止） | `WKWebView` + `WKWebViewConfiguration`：`websiteDataStore = .default()`、`processPool = WKProcessPool()`、`defaultWebpagePreferences.allowsContentJavaScript = true`、`preferences.javaScriptCanOpenWindowsAutomatically = false` | WKWebView 默认就不允许 file:// 访问与混合内容，无需逐项关闭；**必须 `addSubview` 进视图层级**，否则 JS 不执行（与 Android 不同，Android 未 attach 也能跑 `loadUrl` 的 JS） |
| `shouldOverrideUrlLoading` 只放行主框架 `https://linux.do` | `WKNavigationDelegate.webView(_:decidePolicyFor:decisionHandler:)`，主框架非 https/非 linux.do → `.cancel` | 子框架一律 `.allow`（对齐 `isForMainFrame()` 判断） |
| `CookieManager.getInstance()`（进程级共享） | `WKWebsiteDataStore.default().httpCookieStore`（App 内共享） | 探针页里的 `fetch(credentials:'include')` 写入的 Cookie 会自动进这个 store；`WKProcessPool()` 让本 WebView 与宿主同池 |
| `CookieManager.flush()` | **无对应物**。`WKWebsiteDataStore` 自行持久化；本实现改为 `WKHTTPCookieStoreObserver.cookiesDidChange(in:)` 观察 + `getAllCookies` 回读一次 | 语义差异见 §4-D2 |
| `runOnUiThread` / `Handler(Looper.getMainLooper())` / `postDelayed` | 全部入口 `@MainActor`；延时用 `DispatchQueue.main.asyncAfter(deadline:execute:)` + `DispatchWorkItem`（可 `cancel()`） | `DispatchWorkItem.cancel()` 对已入队未执行的任务有效，语义等价 `handler.removeCallbacks` |
| `Activity`（`Context` / `isFinishing()`） | 注入的 `UIViewController` presenter；`isFinishing` → `isBeingDismissed \|\| isMovingFromParent` | 近似而非等价（见 §5-U5） |
| `Context.getAssets().open("linuxdo-session-*.js")` | 两个脚本内联为 `static let sessionProbeScript` / `sessionRequestScript`（Swift 原始字符串 `#"""..."""#`，逐字复制） | iOS 无 assets 目录；脚本内容与 Android 完全一致 |
| `evaluateJavascript(script, callback)` 回调收到"JSON 字符串再包一层引号" | `evaluateJavaScript(_:completionHandler:)`（iOS 15 有回调版；异步版 `evaluateJavaScript(_:)` 是 iOS 15+ 但本实现用回调版更贴近原逻辑） | `decode(_:)` 先解析外层、再解析内层；`undefined` → `nil` → 继续轮询（等价 Java `catch (Exception ignored)`） |
| `JSONObject.quote(id)` | `static quoted(_:)`（`JSONSerialization` 单元素数组去方括号） | 产出的都是合法 JSON 字符串字面量 |
| `input.toString()` 直接拼 JS | `jsonObjectLiteral(_:)` → `JSON.parse("<json>")` | 避免手拼转义；JS 侧 `request` 对象形状不变 |
| `SystemClock.elapsedRealtime()` | `Date().timeIntervalSince1970 * 1000` | 仅用于冷却判定，单调性差异不影响语义 |
| `UUID.randomUUID()` | `UUID().uuidString` | 同上 |
| `AtomicBoolean.compareAndSet`（Cookie 提交） | `NSLock` + 私有终态标志（`completeSuccessIfLast` / `completeFailure`） | 见 §4-D3 |

---

## 4. 降级项与 JS 可见后果

### D1. `headers` 类型收敛为 `[String: String]`（低风险）

Java 用 `JSONObject`（值可为数字/布尔）。Swift 签名收成 `[String: String]`，因为插件包装层从 `CAPPluginCall` 拿到的请求头本来就是字符串字典（`client.ts:218` 构造的也是全字符串）。
**后果**：若包装层需要传非字符串头值，必须自行 `String(describing:)`；否则编译期就会被拦下（不会静默丢失）。

### D2. 没有 `CookieManager.flush()`（中风险）

Android 在探针 ready 后显式 `CookieManager.flush()`，把内存 Cookie 立刻落盘。iOS 没有该 API：

- 本实现：ready 时调用 `persistCookies()` → `httpCookieStore.getAllCookies`，让 `WKWebsiteDataStore` 立刻处理新 Cookie 并触发 `cookiesDidChange`；
- 同时注册 `WKHTTPCookieStoreObserver`，Cookie 变化时回调 `onCookiesChanged`（主线程）。

**JS 可见后果**：如果 `WKWebsiteDataStore` 落盘比 Android 慢，且 App 在 ready 后立刻被杀死，可能丢最新 Cookie → 下次冷启动需要重新走一次 `prepareBrowserSession`（表现为"偶尔要重新验证"），**不会**产生错误数据。
`clearBrowserSession` 侧不受影响：`client.ts` 的清理走插件自己的 `WKWebsiteDataStore` 清理路径（另一个 agent 负责）。

### D3. Cookie 提交的并发模型换成 `NSLock`（低风险）

Java 用 `AtomicBoolean`/`AtomicInteger`；Swift 用 `NSLock` 保护 `remaining` + `finished`。已对齐 Java 测试的全部四条语义：

1. 空列表 → 立即 `success()`，不调用 writer；
2. 全部 `true` → `success()` 恰好一次；
3. 任一 `false` → `failure()` 恰好一次，之后不再 `success()`；
4. 同一回调重复触发 / writer 抛异常 → 不再产生第二次结果。

`DeliveredFlag` 对应 Java 的 `AtomicBoolean delivered`。

### D4. `HTTPCookie(properties:)` 不会用 URL 补全 Domain/Path（**高风险**）

Android 的 `CookieManager.setCookie(url, cookie, callback)` 会拿 URL 补全缺失的 `Domain`/`Path`。
iOS 的 `WKHTTPCookieStore.setCookie(_:completionHandler:)` **不会**：`HTTPCookie(properties:)` 在缺 `Domain`、或属性非法时返回 `nil`。

本实现的处理：

- `LinuxDoHTTPCookieStoreWriter.write` 解析失败 → `completed(false)` → `LinuxDoCookieCommit` 走 `failure()`；
- 额外提供 `normalizedSetCookie(_:responseURL:)`：缺 `Path` 补 `/`、缺 `Domain` 用响应 URL 的 host 补、https 下缺 `Secure` 补上。

**JS 可见后果**：若包装层忘记调用 `normalizedSetCookie`，host-only cookie（Discourse 的 `Set-Cookie` 通常带 `Domain`，但不保证）会写入失败 → `failure()` → 调用方走"CSRF 未确认"路径，用户看到"Linux.do 未确认阅读记录"，**不会**静默成功（这点比 Android 更保守，是刻意选择）。

### D5. `SameSite` 属性透传（中风险）

iOS 15 没有公开的 `HTTPCookiePropertyKey.sameSite`。本实现用非标准键 `HTTPCookiePropertyKey("SameSite")` 透传。`HTTPCookie(properties:)` 是否识别该键未验证。

**后果**：若被忽略，写回的 Cookie 没有 SameSite 标记 → 浏览器默认按 `Lax` 处理。对 linux.do 的同站请求无影响；跨站场景（本项目没有）可能被拒。

### D6. `Set-Cookie` 属性重解析会丢未知属性（中风险）

`properties(from:)` 只识别 `Domain`/`Path`/`Secure`/`Expires`/`Max-Age`/`SameSite`，其余属性（如 `HttpOnly`、`Priority`、`Partitioned`）被丢弃。

**后果**：`HttpOnly` 丢失只影响 JS 可见性（本项目的 Cookie 读取走原生），不影响服务端校验。若未来依赖 `Partitioned`，需扩展该解析器。

### D7. 探针脚本的 15s 预算（低风险）

Android 与 iOS 都用 `TIMEOUT_MS = 15_000`。iOS 首屏 `WKWebView` 冷启动比 Android `WebView` 慢（无共享进程缓存），15s 内 Discourse 首屏 + 两次 fetch 可能偏紧。

**后果**：超时 → `{ready:false, reason:"needs-verification"}`（**无** phase/status），JS 走普通重试，用户看到"需要浏览器安全验证"而不是误报会话退出。

### D8. 没有 `setAcceptThirdPartyCookies`（无影响）

Android 显式关掉第三方 Cookie；WKWebView 默认就不接受跨站第三方 Cookie，无需对应代码。

### D9. 回调线程处理：不用 `MainActor.assumeIsolated`（已规避风险）

`evaluateJavaScript` / `getAllCookies` / `setCookie` / `cookiesDidChange` 的回调本来就在主线程。最初写法用 `MainActor.assumeIsolated { }` 进入 `@MainActor` 隔离域，但该 API 在 SDK 里带 `@available(iOS 17.0, *)` 标注（虽然 Swift 5.9 运行时 back-deploy 到 iOS 15，部署目标 iOS 15 下**存在编译报错风险**）。

最终实现改为 `DispatchQueue.main.async { }` 再入队一次主队列：

- 无可用性标注，iOS 15 编译无风险；
- 闭包是普通 `@escaping` 闭包，不要求 `Sendable`，因此 `encoded: Any?` 与 `weak self` 都不会产生严格并发警告；
- 代价是每次轮询回调多一次主队列跳转（亚毫秒级，可忽略）。

若将来把类改成完全无 `@MainActor`（纯主线程约定），这三处 `DispatchQueue.main.async` 也可去掉，但保留它更稳。

### D10. 空闲计时器与 `cancel()` 的语义（已修正，记录以防回归）

Java `cancel()` 调 `finishPreparation(unavailable("cancelled"), false)`，而 `finishPreparation` 的 else 分支在 `prepared != nil` 时**不会**拆文档（先 `if (keepReadyDocument) touch()`，否则 `prepared = null` 并销毁）。

Swift 版把 `cancel()` 写成 `finishPreparation(result: unavailable("cancelled"), keepReadyDocument: prepared != nil)`：

- `prepared != nil` → 保留文档并 `touch()` 续期 idle（对齐 Java 空闲计时器触发的 `cancel()` 只清状态、不拆会话）；
- `prepared == nil` → 拆文档、取消所有挂起请求、通知 waiters。

若写成无条件 `false`，空闲计时器会误拆正在服务的会话（表现为"120 秒后阅读记录补传突然失败"）。

---

## 5. 不确定项（按风险排序）

| # | 风险 | 不确定内容 | 最坏后果 |
|---|---|---|---|
| U1 | **高** | `HTTPCookie(properties:)` 对 Discourse `Set-Cookie` 的接受度：缺 `Domain` 的 host-only cookie 是否必然返回 `nil`；`Expires` 字符串格式（`Wed, 09 Jun 2027 10:18:14 GMT`）是否被直接接受（我按 `HTTPCookiePropertyKey.expires` 传原始字符串，未转 `Date`） | Cookie 写入失败 → 阅读记录补传一直"未确认"；需真机抓 `Set-Cookie` 实测 |
| U2 | **高** | `WKWebsiteDataStore.default().httpCookieStore` 与 Capacitor 宿主 WebView 是否真的同源（宿主用的是 `WKWebViewConfiguration` 默认 store，应为 `.default()`，但未验证） | 探针写入的 Cookie 与后续 `clearBrowserSession`/宿主请求看到的不是同一份 → 会话"看起来已登录但请求 401" |
| U3 | 中 | 回调线程：`evaluateJavaScript` / `getAllCookies` / `setCookie` / `cookiesDidChange` 是否都在主线程投递（本实现按主线程假设，用 `DispatchQueue.main.async` 兜底；`DispatchQueue.main.async` 本身在任何线程调用都安全） | 无崩溃风险；最坏是多一次队列跳转 |
| U4 | 中 | `SameSite` 非标准键是否被 `HTTPCookie` 接受（见 D5） | 写回 Cookie 无 SameSite → 跨站场景被拒（本项目无跨站） |
| U5 | 中 | `isBeingDismissed \|\| isMovingFromParent` 与 Android `isFinishing()` 不等价：正在被 pop 但尚未 dismiss 的控制器可能被误判为"不可用" | 极端时序下 `prepare` 返回 `reason:"activity"`，用户看到"需要重新验证" |
| U6 | 中 | `WKHTTPCookieStoreObserver.cookiesDidChange` 是否保证主线程（本实现用 `DispatchQueue.main.async` 转发，任何线程都安全，因此该风险已消除，仅保留记录） | 无 |
| U7 | 中 | `WKWebView` 必须 attach 才能执行 JS：包装层是否会在 `prepare` 前把 WebView 加进视图层级 | 探针永不返回 → 15s 超时 → 每次都"需要重新验证" |
| U8 | 低 | `properties(from:)` 丢弃 `HttpOnly` 等属性（见 D6） | Cookie 对 JS 可见（本项目不读 JS Cookie，无实际影响） |
| U9 | 低 | `normalizedSetCookie` 的字符串拼接是否会与已有属性重复（例如已有 `Domain` 但大小写不同，判定用的是 `lowercased()`，应无问题） | 生成非法 Set-Cookie → `HTTPCookie` 返回 `nil` → 走 failure（保守） |
| U10 | 低 | `Date().timeIntervalSince1970 * 1000` 的冷却判定在系统时间跳变时的行为（Android 用单调时钟） | 极端情况下多开/少开一次页面 |
| U11 | 低 | 内联 JS 用 Swift 原始字符串 `#"""..."""#`：脚本内不含 `#"""` 序列（已检查），但若将来编辑脚本引入 `\#(` 会被解释 | 脚本语法错误 → 探针永不 ready |
| U12 | 低 | 类标注 `@MainActor` 后，从非隔离闭包访问其状态在 Swift 6 严格并发下会告警（Swift 5 模式无告警）；本实现已用 `DispatchQueue.main.async` 包住访问点 | 编译告警（不致命） |

---

## 6. 验证清单（必须在 macOS / 真机上做）

**编译与注册**

1. macOS 上把 `LinuxDoBrowserSessionSupport.swift` 加入 App target 的 Sources（`project.pbxproj` 由中央注册流程处理，本文件不改）。
2. 确认编译通过（`swift-tools-version: 5.9`、`platforms: [.iOS(.v15)]`）。重点看有无 iOS 15 可用性报错（本实现只用 iOS 15 之前的公开 API：`WKWebView` / `WKHTTPCookieStore` / `WKHTTPCookieStoreObserver` / `HTTPCookie(properties:)` / `DispatchQueue`）。
3. 确认 `LinuxDoBrowserSessionRecovery` 与 `LinuxDoCookieCommit` 都在同一 module 内可见（本文件不 import Capacitor，避免误注册为插件）。

**会话恢复（U1/U2/U7 的判定实验）**

4. 已登录 linux.do 的账号：触发一次会命中 Cloudflare 挑战的请求，确认 JS 侧走到 `prepareBrowserSession`，且返回 `{ready:true, username, userId, csrf}`。
5. 抓包/日志确认 `phase`：退出登录后重试，必须返回 `phase:"session", status:401`（不是 `phase:"csrf"`）。
6. 模拟 CSRF 端点 500：必须返回 `phase:"csrf", status:500`，且 JS 侧**不**抛"浏览器会话已退出"。
7. 冷启动后立刻杀 App：重启确认 Cookie 仍在（D2 的落盘时延判定）。
8. 确认 WebView 已 attach（U7）：断点或日志确认 `prepare` 后 15s 内探针有回调，而不是每次都超时。

**Cookie 提交（U1/U4 的判定实验）**

9. 构造一个返回两条 `Set-Cookie` 的测试响应（一条带 `Domain=.linux.do; Path=/; Secure; HttpOnly`，一条 host-only 无 `Domain`），确认 `commit` 最终 `success()` 且 `httpCookieStore.getAllCookies` 能读到两条。
10. 构造一条非法 Cookie（如 `Domain=` 空）：确认 `failure()` 恰好一次，且不再触发 `success()`。
11. 回调重复触发（同一 writer 调两次 `completed(true)`）：确认 `success()` 仍只一次。

**取消 / 空闲（D10 的判定实验）**

12. ready 后等 120 秒：确认 `cancel()` 只清 waiters、**不**拆掉已 ready 的会话（下一次 `request` 仍成功）。
13. 未 ready 时 `cancel()`：确认所有 waiters 收到 `{ready:false, reason:"cancelled"}`，且挂起请求收到 `{error:"Linux.do 浏览器会话已结束"}`。

**相关测试脚本（本次未改任何 TS，以下用于回归既有契约）**

- `npm run test:linuxdo-readsync` — 含 `scripts/linuxdo-browser-session-probe.test.ts`（探针结果形状）与 `scripts/linuxdo-firstparty-request.test.ts`（第一方请求白名单）；这两个脚本断言的就是本文件搬运的 JS 与 `canRequest` 规则。
- `npm run test:linuxdo` — 上游 `scripts/linuxdo.test.ts` + 上述读同步套件。
- 若存在 `scripts/ios-native-plugin.test.mjs` 同形脚本，可新增断言：本文件**不含** `CAPPlugin` / `jsName`（防止被误当成插件）。

---

## 7. 未改动文件（明确声明）

本次只新增两个文件：

- `ios/App/App/LinuxDoBrowserSessionSupport.swift`（新增）
- `docs/superpowers/specs/2026-09-26-linuxdo-browser-session-ios-port.md`（本文）

未触碰：`project.pbxproj`、`MainViewController.swift`、`ios/App/CapApp-SPM/Package.swift`、
任何 TypeScript、任何 Java（含 `LinuxDoSessionPlugin.java` 与 `LinuxDoUserApiAuth.java`，由其他 agent 负责）、任何测试脚本。
