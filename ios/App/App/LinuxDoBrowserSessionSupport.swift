import Foundation
import UIKit
import WebKit

// MARK: - LinuxDoBrowserSessionRecovery
//
// 本文件是以下两个 Android 辅助类的 Swift 移植（同一文件放两个类型，只需一次 Xcode 注册）：
//   - android/app/src/main/java/com/aizeek/newsnook/LinuxDoBrowserSessionRecovery.java（228 行）
//   - android/app/src/main/java/com/aizeek/newsnook/LinuxDoCookieCommit.java（35 行）
//
// 移植原则：只搬机制，不改契约。JS 可见的结果形状（ready / username / userId / csrf /
// reason / phase / status / error）与中文 reason 文案逐字保持一致。
//
// Android → iOS 机制替换：
//   android.webkit.WebView            → WKWebView
//   android.webkit.CookieManager      → WKWebsiteDataStore.default().httpCookieStore
//   CookieManager.flush()             → WKHTTPCookieStoreObserver + getAllCookies 回读（无显式 flush）
//   runOnUiThread / Handler(Looper)   → DispatchQueue.main / DispatchWorkItem
//   Activity（Context）                → 注入的 UIViewController presenter + WKWebView 工厂闭包
//   android.content.res.AssetManager  → 两个 JS 探针脚本内联为本文件常量（iOS 无 assets 目录）
//   阻塞式请求辅助                     → evaluateJavaScript 回调 + DispatchWorkItem 轮询（保持回调风格）
//
// 说明：本文件不 import Capacitor，两个类型都不是 CAPPlugin（无 jsName / 无 @CapacitorPlugin），
// 由插件包装层持有并调用；Xcode 注册只需把本文件加进 target 的 Sources。

/// Linux.do 浏览器会话恢复器：在一次已确认的 API 挑战之后，做一次普通的
/// 第一方页面访问，让站点自己初始化浏览器状态，再从这个真实文档里取回
/// identity + CSRF，并用它承载后续的 `/topics/timings`、`/session/csrf(.json)` 请求。
///
/// 与 Android 版一样，这里**不**自动破解验证码、不伪造 clearance、不向远端 HTML
/// 暴露任何 JavaScriptInterface。恢复出来的 CSRF 只留在本文档内使用，不回流到
/// 当初失败的合成传输通道。
///
/// 线程约定：整个类都 `@MainActor`。WKWebView 与 WKHTTPCookieStore 本来就只能在主线程碰，
/// 调用方（插件包装层）用 `Task { @MainActor in ... }` 进入即可；回调也都在主线程触发。
@MainActor
final class LinuxDoBrowserSessionRecovery: NSObject {

    // MARK: 常量（与 Java 版一一对应）

    /// 第一方页面 origin；`canRequest` 也只放行这个 host。
    static let origin = "https://linux.do"
    /// 准备阶段总超时（Java: TIMEOUT_MS = 15_000L）。
    static let prepareTimeout: TimeInterval = 15
    /// 失败后的冷却，避免反复开页面（Java: COOLDOWN_MS = 30_000L）。
    static let cooldown: TimeInterval = 30
    /// 会话空闲多久自动结束（Java: IDLE_MS = 120_000L）。
    static let idleTimeout: TimeInterval = 120
    /// 单次第一方请求超时（Java 字面量 35_000L）。
    static let requestTimeout: TimeInterval = 35
    /// 准备阶段的轮询间隔（Java: 250L）。
    static let preparePollInterval: TimeInterval = 0.25
    /// 第一方请求结果的轮询间隔（Java: 100L）。
    static let requestPollInterval: TimeInterval = 0.1

    // MARK: 对外类型

    /// 准备结果。字段与 `src/features/linuxdo/session/native.ts` 的
    /// `LinuxDoBrowserPreparation` 完全对应：ready 时给 username/userId/csrf；
    /// 未 ready 时给 reason（中文，面向用户）+ phase/status。
    typealias PreparationResult = [String: Any]

    /// 第一方请求结果。ready 时给 status/data/headers/responseUrl；
    /// 失败时只给 error（中文文案）。
    typealias ResponseResult = [String: Any]

    typealias PreparationCallback = (PreparationResult) -> Void
    typealias ResponseCallback = (ResponseResult) -> Void
    typealias WebViewFactory = () -> WKWebView

    /// 挂起中的第一方请求（对应 Java 私有类 PendingRequest）。
    private final class PendingRequest {
        let completed: ResponseCallback
        var poll: DispatchWorkItem?
        var timeout: DispatchWorkItem?
        init(completed: @escaping ResponseCallback) { self.completed = completed }
    }

    // MARK: 状态（对应 Java 字段）

    private let webViewFactory: WebViewFactory
    private var view: WKWebView?
    private var prepared: PreparationResult?
    private var poll: DispatchWorkItem?
    private var timeout: DispatchWorkItem?
    private var idle: DispatchWorkItem?
    private var lastAttempt: TimeInterval = -LinuxDoBrowserSessionRecovery.cooldown
    private var waiters: [PreparationCallback] = []
    private var requests: [String: PendingRequest] = [:]
    private var observedCookieStore: WKHTTPCookieStore?

    /// 会话期间 Cookie 发生变化的通知（主线程）。可选，仅用于日志/调试。
    var onCookiesChanged: (() -> Void)?

    /// 使用默认 WebView 工厂（进程池与 Capacitor 宿主 WebView 共享 Cookie）。
    /// 注意：默认工厂造出的 WebView 尚未挂进视图层级，包装层必须自己
    /// `addSubview`（或用 `attach(_:to:)`），否则 JS 不执行。
    convenience override init() {
        self.init(webViewFactory: { LinuxDoBrowserSessionRecovery.defaultWebView() })
    }

    /// 允许注入 WebView 工厂：插件包装层要挂到具体 presenter 上，或测试要替换实现时使用。
    init(webViewFactory: @escaping WebViewFactory) {
        self.webViewFactory = webViewFactory
        super.init()
    }

    // 说明：没有 deinit 清理。观察者摘除统一走 finishPreparation / cancel（都在主线程），
    // 避免在 deinit（不保证主线程、且被隔离检查拦）里碰 WKHTTPCookieStore。

    /// 当前使用的共享 Cookie 存储（与 `WKWebsiteDataStore.default()` 同源）。
    /// 插件包装层需要回读/清理会话 Cookie 时用这个。
    var cookieStore: WKHTTPCookieStore {
        WKWebsiteDataStore.default().httpCookieStore
    }

    // MARK: 默认 WebView

    /// 默认 WKWebView：JavaScript 开启、禁用文件与跨窗口、共享默认数据存储与进程池。
    /// 调用方需要把它 `addSubview` 进视图层级（否则 JS 不执行），并在会话结束后自行移除。
    static func defaultWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.processPool = WKProcessPool()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = false
        let browser = WKWebView(frame: .zero, configuration: configuration)
        browser.allowsBackForwardNavigationGestures = false
        browser.customUserAgent = nil
        return browser
    }

    // MARK: prepare

    /// 准备浏览器会话。对应 Java `prepare(Activity, Consumer<JSObject>)`。
    ///
    /// 行为与 Java 版一致：
    /// 1. presenter 为空 → `{ready:false, reason:"activity"}`（同步回调）。
    /// 2. 已有 ready 文档 → 直接回同一个结果（并续期 idle 计时）。
    /// 3. 正在准备 → 挂进 waiters，准备结束时一起回调。
    /// 4. 冷却期内 → `{ready:false, reason:"cooldown"}`（同步回调）。
    /// 5. 否则新建 WKWebView，加载 `https://linux.do/`，每 250ms 轮询探针，
    ///    15s 超时 → `{ready:false, reason:"needs-verification"}`。
    ///
    /// - Parameters:
    ///   - presenter: 只用于校验（等价 Android 的 null Activity / isFinishing 判断）。
    ///     本方法**不会**把它自己的 WebView 挂到 presenter 上；包装层必须先用
    ///     `defaultWebView()` + `attach(_:to:)` 造好并挂好视图，或改用
    ///     `init(webViewFactory:)` 注入一个已挂载的 WebView——否则 WKWebView 不执行 JS，
    ///     探针永不返回，15s 后超时。
    ///   - completed: 结果回调（主线程）。
    func prepare(presenter: UIViewController?, completed: @escaping PreparationCallback) {
        if let presenter, presenter.isBeingDismissed || presenter.isMovingFromParent {
            completed(Self.unavailable(reason: "activity"))
            return
        }
        if view != nil, let prepared {
            touch()
            completed(prepared)
            return
        }
        if view != nil {
            waiters.append(completed)
            return
        }
        let now = Date().timeIntervalSince1970 * 1000
        if now - lastAttempt < Self.cooldown * 1000 {
            completed(Self.unavailable(reason: "cooldown"))
            return
        }
        lastAttempt = now
        waiters.append(completed)

        let browser = webViewFactory()
        view = browser
        browser.navigationDelegate = self
        // 观察 Cookie 变化：Android 靠 CookieManager.flush()，iOS 没有 flush，
        // 改为观察 httpCookieStore（WKWebsiteDataStore 自身负责持久化）。
        let store = cookieStore
        store.add(self)
        observedCookieStore = store

        let script = Self.sessionProbeScript
        let timeoutItem = DispatchWorkItem { [weak self] in
            self?.finishPreparation(result: Self.unavailable(reason: "needs-verification"), keepReadyDocument: false)
        }
        timeout = timeoutItem
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.prepareTimeout, execute: timeoutItem)

        browser.load(URLRequest(url: URL(string: Self.origin + "/")!))
        schedulePreparePoll(script: script)
    }

    /// 准备阶段轮询：每 250ms 读一次 `window.__newsnookSessionProbe`，
    /// 未落地就再排一次。等价于 Java `poll` Runnable + `handler.postDelayed(this, 250L)`。
    private func schedulePreparePoll(script: String) {
        guard prepared == nil, let browser = view else { return }
        let item = DispatchWorkItem { [weak self, weak browser] in
            guard let self, let browser else { return }
            guard self.view === browser, self.prepared == nil else { return }
            browser.evaluateJavaScript(script + "\nJSON.stringify(window.__newsnookSessionProbe || null);") { [weak self, weak browser] encoded, _ in
                guard let self, let browser else { return }
                // 先在回调线程（主线程）解出纯 Swift 字典，再入主队列；
                // 这样闭包里不捕获 evaluateJavaScript 的返回值对象。
                let probe = Self.decode(encoded)
                DispatchQueue.main.async {
                    guard self.view === browser, self.prepared == nil else { return }
                    // probe 为 nil 表示文档正在导航、脚本还没跑完或返回 undefined：
                    // 与 Java 的 catch (Exception ignored) 一样，继续轮询。
                    if let data = probe, !(data["pending"] as? Bool ?? false) {
                        let ready = (data["ready"] as? Bool ?? false)
                            && (Self.intValue(data["userId"]) ?? 0) > 0
                            && !(Self.stringValue(data["username"]) ?? "").isEmpty
                            && !(Self.stringValue(data["csrf"]) ?? "").isEmpty
                        var result: PreparationResult = ["ready": ready]
                        if ready {
                            result["username"] = Self.stringValue(data["username"]) ?? ""
                            result["userId"] = Self.intValue(data["userId"]) ?? 0
                            result["csrf"] = Self.stringValue(data["csrf"]) ?? ""
                            self.prepared = result
                            // iOS 没有 CookieManager.flush()；回读一次 httpCookieStore，让
                            // WKWebsiteDataStore 立刻处理探针写入的 Cookie 并刷新观察者。
                            self.persistCookies()
                        } else {
                            result["reason"] = "needs-verification"
                            result["phase"] = Self.stringValue(data["phase"]) ?? "session"
                            result["status"] = Self.intValue(data["status"]) ?? 0
                        }
                        self.finishPreparation(result: result, keepReadyDocument: ready)
                        return
                    }
                    self.schedulePreparePoll(script: script)
                }
            }
        }
        poll = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.preparePollInterval, execute: item)
    }

    // MARK: canRequest

    /// 只有 `https://linux.do` 上无 query/fragment、无 userinfo、端口为 443 的
    /// `/topics/timings`、`/session/csrf`、`/session/csrf.json` 才允许走第一方文档。
    /// 对应 Java `canRequest(String)`。
    func canRequest(_ url: String) -> Bool {
        guard view != nil, prepared != nil else { return false }
        guard let target = URL(string: url), let scheme = target.scheme, let host = target.host else { return false }
        guard scheme.lowercased() == "https", host.lowercased() == "linux.do" else { return false }
        guard target.user == nil, target.password == nil else { return false }
        if let port = target.port, port != 443 { return false }
        guard target.query == nil, target.fragment == nil else { return false }
        return ["/topics/timings", "/session/csrf", "/session/csrf.json"].contains(target.path)
    }

    // MARK: request

    /// 在恢复出来的第一方文档里发起请求。对应 Java `request(String, String, JSONObject, String, Consumer)`。
    ///
    /// 失败（会话未就绪 / URL 不合法）时同步回调 `{error:"Browser session not ready"}`；
    /// 超时回调 `{error:"Linux.do 浏览器请求超时"}`；JS 侧失败回调
    /// `{error:"Linux.do 浏览器请求失败"}`；启动异常回调 `{error:"Linux.do 浏览器请求无法启动"}`。
    /// 成功回调 `{status:Int, data:String, headers:[String:String], responseUrl:String}`。
    func request(
        url: String,
        method: String,
        headers: [String: String],
        body: String,
        completed: @escaping ResponseCallback
    ) {
        guard let browser = view, canRequest(url) else {
            completed(Self.requestError("Browser session not ready"))
            return
        }
        touch()
        let id = UUID().uuidString
        let pending = PendingRequest(completed: completed)
        requests[id] = pending

        var input: [String: Any] = [:]
        input["id"] = id
        input["url"] = url
        input["method"] = method
        input["headers"] = headers
        input["body"] = body
        let argument = Self.jsonObjectLiteral(input)
        guard let argument else {
            finishRequest(id: id, result: Self.requestError("Linux.do 浏览器请求无法启动"))
            return
        }
        let script = Self.sessionRequestScript
            + "\nwindow.__newsnookFirstPartyRequest(\(argument));"
        let key = Self.quoted(id)
        browser.evaluateJavaScript(script, completionHandler: nil)

        let timeoutItem = DispatchWorkItem { [weak self] in
            self?.finishRequest(id: id, result: Self.requestError("Linux.do 浏览器请求超时"))
        }
        pending.timeout = timeoutItem
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.requestTimeout, execute: timeoutItem)
        scheduleRequestPoll(id: id, pending: pending, browser: browser, key: key)
    }

    /// 请求结果轮询：每 100ms 读一次 `window.__newsnookFirstPartyResults[id]`。
    /// 等价于 Java `PendingRequest.poll` + `handler.postDelayed(this, 100L)`。
    private func scheduleRequestPoll(id: String, pending: PendingRequest, browser: WKWebView, key: String) {
        guard requests[id] === pending, view === browser else { return }
        let item = DispatchWorkItem { [weak self, weak browser] in
            guard let self, let browser else { return }
            guard self.requests[id] === pending, self.view === browser else { return }
            browser.evaluateJavaScript("JSON.stringify(window.__newsnookFirstPartyResults && window.__newsnookFirstPartyResults[\(key)] || null)") { [weak self, weak browser] encoded, _ in
                guard let self, let browser else { return }
                // 同探针：先解码再入主队列，闭包不捕获 WebKit 的返回值对象。
                let decoded = Self.decode(encoded)
                DispatchQueue.main.async {
                    guard self.requests[id] === pending, self.view === browser else { return }
                    // decoded 为 nil = 正在导航的文档还没有结果，与 Java 的
                    // catch (Exception ignored) 一样继续轮询。
                    if let result = decoded, !(result["pending"] as? Bool ?? false) {
                        browser.evaluateJavaScript("delete window.__newsnookFirstPartyResults[\(key)];", completionHandler: nil)
                        var response: ResponseResult = [:]
                        if result["error"] != nil {
                            response["error"] = "Linux.do 浏览器请求失败"
                        } else {
                            response["status"] = Self.intValue(result["status"]) ?? 0
                            response["data"] = Self.stringValue(result["data"]) ?? ""
                            if let headers = result["headers"] as? [String: Any] {
                                response["headers"] = headers.reduce(into: [String: String]()) { partial, entry in
                                    partial[entry.key] = Self.stringValue(entry.value) ?? ""
                                }
                            }
                            response["responseUrl"] = Self.stringValue(result["responseUrl"]) ?? ""
                        }
                        self.finishRequest(id: id, result: response)
                        return
                    }
                    self.scheduleRequestPoll(id: id, pending: pending, browser: browser, key: key)
                }
            }
        }
        pending.poll = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.requestPollInterval, execute: item)
    }

    // MARK: cancel

    /// 取消准备：所有 waiters 收到 `{ready:false, reason:"cancelled"}`。
    ///
    /// 对应 Java `cancel()` → `finishPreparation(unavailable("cancelled"), false)`。
    /// 注意 Java 语义：`keepReadyDocument = false` 表示「这次结果本身不算 ready 文档」，
    /// 但**已经 ready 的文档会被保留**（Java 里 `finishPreparation` 的 else 分支只在
    /// `prepared == null` 时才真正拆文档）。所以这里必须保留 ready 文档并续期 idle，
    /// 否则 `cancel()` 会误拆掉正在服务的会话。
    func cancel() {
        finishPreparation(result: Self.unavailable(reason: "cancelled"), keepReadyDocument: prepared != nil)
    }

    // MARK: 内部

    private func finishRequest(id: String, result: ResponseResult) {
        guard let pending = requests.removeValue(forKey: id) else { return }
        pending.poll?.cancel()
        pending.timeout?.cancel()
        if prepared != nil { touch() }
        pending.completed(result)
    }

    private func finishPreparation(result: PreparationResult, keepReadyDocument: Bool) {
        poll?.cancel()
        timeout?.cancel()
        poll = nil
        timeout = nil
        if keepReadyDocument {
            touch()
        } else {
            idle?.cancel()
            idle = nil
            prepared = nil
            let previous = view
            view = nil
            // 先摘观察者，再销毁文档。
            if let store = observedCookieStore {
                store.remove(self)
                observedCookieStore = nil
            }
            for id in Array(requests.keys) {
                finishRequest(id: id, result: Self.requestError("Linux.do 浏览器会话已结束"))
            }
            if let previous {
                previous.stopLoading()
                previous.navigationDelegate = nil
                previous.removeFromSuperview()
            }
        }
        let callbacks = waiters
        waiters.removeAll()
        for callback in callbacks { callback(result) }
    }

    private func touch() {
        idle?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.cancel()
        }
        idle = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.idleTimeout, execute: item)
    }

    /// 回读一次 httpCookieStore。iOS 没有 CookieManager.flush()，这个调用既让
    /// WKWebsiteDataStore 立刻处理新 Cookie，也顺带触发 cookiesDidChange 观察回调。
    private func persistCookies() {
        cookieStore.getAllCookies { [weak self] _ in
            DispatchQueue.main.async {
                self?.onCookiesChanged?()
            }
        }
    }

    // MARK: 结果构造（文案与 Java 版逐字一致）

    static func requestError(_ message: String) -> ResponseResult {
        ["error": message]
    }

    static func unavailable(reason: String) -> PreparationResult {
        ["ready": false, "reason": reason]
    }

    // MARK: 解码 / 编码辅助

    /// 等价于 Java `decode(String)`：Android 的 evaluateJavascript 返回的是
    /// 「JSON 字符串再包一层引号」，所以先解析外层，再解析内层。
    static func decode(_ encoded: Any?) -> [String: Any]? {
        guard let encoded else { return nil }
        var outer: Any = encoded
        if let text = encoded as? String {
            guard text != "null" else { return nil }
            guard let data = text.data(using: .utf8) else { return nil }
            guard let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return nil }
            outer = parsed
        }
        if let text = outer as? String {
            guard text != "null", let data = text.data(using: .utf8) else { return nil }
            guard let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return nil }
            return parsed as? [String: Any]
        }
        return outer as? [String: Any]
    }

    static func stringValue(_ value: Any?) -> String? {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String { return Int(text) }
        return nil
    }

    /// 把 Swift 字典编成 JS 对象字面量（`JSON.parse` 兜底），避免手拼转义出错。
    static func jsonObjectLiteral(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: []),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return "JSON.parse(\(quoted(text)))"
    }

    /// 等价于 `JSONObject.quote`：产出带引号、已转义的 JSON 字符串字面量。
    static func quoted(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
              let text = String(data: data, encoding: .utf8),
              text.count >= 2 else {
            return "\"\""
        }
        // 去掉数组的方括号，留下单个字符串字面量。
        return String(text.dropFirst().dropLast())
    }

    // MARK: 内联 JS（对应 android/app/src/main/assets/*.js）

    /// 探针脚本，逐字来自 `android/app/src/main/assets/linuxdo-session-probe.js`。
    static let sessionProbeScript = #"""
    (function () {
      'use strict';
      if (location.origin !== 'https://linux.do' || window.__newsnookSessionProbe) return;
      // A synthetic blank document or an interstitial is not a loaded forum page.
      var generator = document.querySelector('meta[name="generator"]');
      var forum = generator && /Discourse/i.test(generator.content || '');
      if (!forum && !document.querySelector('#data-discourse-setup, #data-preloaded')) return;
      window.__newsnookSessionProbe = { pending: true };
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 10000);
      var phase = 'session';
      var options = {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      };
      (async function () {
        try {
          var current = await fetch('/session/current.json', options);
          if (!current.ok || current.headers.get('cf-mitigated') === 'challenge') {
            window.__newsnookSessionProbe = { ready: false, phase: phase, status: current.status };
            return;
          }
          var identity = await current.json();
          var user = identity.current_user || identity.user;
          if (!user || !user.username || !(user.id > 0)) {
            window.__newsnookSessionProbe = { ready: false, phase: phase, status: 401 };
            return;
          }
          phase = 'csrf';
          var response = await fetch('/session/csrf.json', options);
          if (!response.ok || response.headers.get('cf-mitigated') === 'challenge') {
            window.__newsnookSessionProbe = { ready: false, phase: phase, status: response.status };
            return;
          }
          var payload = await response.json();
          if (typeof payload.csrf !== 'string' || !payload.csrf.trim()) {
            window.__newsnookSessionProbe = { ready: false, phase: phase, status: 200 };
            return;
          }
          // This value is read only by the owning app's evaluateJavaScript callback.
          // Never log it or expose a JavaScriptInterface to this remote page.
          window.__newsnookSessionProbe = { ready: true, username: user.username, userId: user.id, csrf: payload.csrf };
        } catch {
          window.__newsnookSessionProbe = { ready: false, phase: phase, status: 0 };
        } finally {
          clearTimeout(timer);
        }
      })();
    })();
    """#

    /// 第一方请求脚本，逐字来自 `android/app/src/main/assets/linuxdo-session-request.js`。
    static let sessionRequestScript = #"""
    (function () {
      'use strict';
      if (window.__newsnookFirstPartyRequest) return;
      window.__newsnookFirstPartyResults = Object.create(null);
      window.__newsnookFirstPartyRequest = function (request) {
        var results = window.__newsnookFirstPartyResults;
        var id = request.id;
        if (results[id]) return;
        results[id] = { pending: true };
        var target;
        try { target = new URL(request.url); } catch {}
        var csrf = target && /^\/session\/csrf(?:\.json)?$/.test(target.pathname);
        var timings = target && target.pathname === '/topics/timings';
        if (location.origin !== 'https://linux.do' || !target || target.origin !== 'https://linux.do'
            || target.username || target.password || target.search || target.hash
            || !(csrf && request.method === 'GET' || timings && request.method === 'POST')) {
          results[id] = { error: 'Invalid first-party read-sync request' };
          return;
        }
        var aborter = new AbortController();
        var timeout = setTimeout(function () { aborter.abort(); }, 30000);
        fetch(target.href, {
          method: request.method, credentials: 'include', redirect: 'error', cache: 'no-store',
          headers: request.headers, body: request.method === 'GET' ? undefined : request.body,
          signal: aborter.signal
        }).then(async function (response) {
          var data = await response.text();
          if (data.length > 131072) throw new Error('Response too large');
          var headers = {};
          response.headers.forEach(function (value, name) {
            if (!/^(set-cookie2?|authorization|proxy-authorization)$/i.test(name)) headers[name] = value;
          });
          results[id] = { status: response.status, data: data, headers: headers, responseUrl: response.url };
        }).catch(function () {
          results[id] = { error: 'First-party browser request failed or timed out' };
        }).finally(function () { clearTimeout(timeout); });
      };
    })();
    """#
}

// MARK: - WKNavigationDelegate

extension LinuxDoBrowserSessionRecovery: WKNavigationDelegate {
    /// 等价于 Android `shouldOverrideUrlLoading`：只允许主框架留在
    /// https://linux.do 内，其余一律取消导航。
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.targetFrame?.isMainFrame ?? false else {
            decisionHandler(.allow)
            return
        }
        guard let target = navigationAction.request.url,
              target.scheme?.lowercased() == "https",
              target.host?.lowercased() == "linux.do" else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

// MARK: - WKHTTPCookieStoreObserver

extension LinuxDoBrowserSessionRecovery: WKHTTPCookieStoreObserver {
    /// Android 用 `CookieManager.flush()` 显式落盘；iOS 由 WKWebsiteDataStore 持久化，
    /// 这里只在 Cookie 变化时把事件透出去（不做同步写回，避免递归）。
    nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        // 观察回调由 WebKit 在主线程投递；这里再入队一次主队列转发，不跨隔离域搬运 self。
        DispatchQueue.main.async { [weak self] in
            self?.onCookiesChanged?()
        }
    }
}

// MARK: - LinuxDoCookieCommit
//
// Swift 移植 android/app/src/main/java/com/aizeek/newsnook/LinuxDoCookieCommit.java。
// 语义（逐条对齐 Java 版与 LinuxDoCookieCommitTest）：
//   1. cookies 为空 → 立即 success，不调用 writer。
//   2. 所有 cookie 都写入成功 → success 恰好一次。
//   3. 任一个写入失败（false 或抛异常）→ failure 恰好一次，之后不再 success。
//   4. 同一个回调被重复触发、或失败后其他回调才成功 → 不再产生第二次结果。
// 因为结果只能二选一且只发生一次，这里用一个锁保护的终态标志实现，
// 替代 Java 的 AtomicBoolean.compareAndSet。
final class LinuxDoCookieCommit {

    /// Cookie 写入器。`completed` 必须被调用且只能调用一次；
    /// 写入失败时传 `false`。抛异常等同于失败。
    protocol Writer {
        func write(cookie: String, completed: @escaping (Bool) -> Void) throws
    }

    /// 便捷闭包形式（对应 Java 的 lambda writer）。
    struct ClosureWriter: Writer {
        let body: (String, @escaping (Bool) -> Void) throws -> Void
        init(_ body: @escaping (String, @escaping (Bool) -> Void) throws -> Void) {
            self.body = body
        }
        func write(cookie: String, completed: @escaping (Bool) -> Void) throws {
            try body(cookie, completed)
        }
    }

    private let lock = NSLock()
    private var remaining: Int
    private var finished = false
    private let successHandler: () -> Void
    private let failureHandler: () -> Void

    private init(count: Int, success: @escaping () -> Void, failure: @escaping () -> Void) {
        remaining = count
        successHandler = success
        failureHandler = failure
    }

    /// 提交一组 Set-Cookie。对应 Java
    /// `commit(List<String>, Writer, Runnable success, Runnable failure)`。
    ///
    /// 与 Java 版一样按顺序调用 writer；一旦进入终态（成功或失败）就停止后续写入。
    /// 结果回调都在锁外触发，避免 writer 同步回调时重入死锁。
    static func commit(
        cookies: [String],
        writer: Writer,
        success: @escaping () -> Void,
        failure: @escaping () -> Void
    ) {
        guard !cookies.isEmpty else {
            success()
            return
        }
        let commit = LinuxDoCookieCommit(count: cookies.count, success: success, failure: failure)
        for cookie in cookies {
            if commit.isFinished { break }
            // Java 用 delivered 保证同一个 writer 回调只算一次。
            let delivered = DeliveredFlag()
            do {
                try writer.write(cookie: cookie) { accepted in
                    guard delivered.claim() else { return }
                    if accepted {
                        commit.completeSuccessIfLast()
                    } else {
                        commit.completeFailure()
                    }
                }
            } catch {
                commit.completeFailure()
            }
        }
    }

    /// 便利重载：直接用闭包当 writer。
    static func commit(
        cookies: [String],
        write: @escaping (String, @escaping (Bool) -> Void) throws -> Void,
        success: @escaping () -> Void,
        failure: @escaping () -> Void
    ) {
        commit(cookies: cookies, writer: ClosureWriter(write), success: success, failure: failure)
    }

    private var isFinished: Bool {
        lock.lock()
        defer { lock.unlock() }
        return finished
    }

    private func completeSuccessIfLast() {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        remaining -= 1
        let isLast = remaining == 0
        if isLast { finished = true }
        lock.unlock()
        if isLast { successHandler() }
    }

    private func completeFailure() {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        lock.unlock()
        failureHandler()
    }

    /// 等价于 Java 的 `AtomicBoolean delivered`：同一个 writer 回调只算一次。
    private final class DeliveredFlag {
        private let lock = NSLock()
        private var claimed = false
        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if claimed { return false }
            claimed = true
            return true
        }
    }
}

// MARK: - 共享 Cookie 存储写入器

/// 把 `Set-Cookie` 写进 `WKWebsiteDataStore.default().httpCookieStore` 的 Writer。
///
/// Android 的 `CookieManager.setCookie(url, cookie, callback)` 会拿 URL 补全缺失的
/// Domain/Path；iOS 的 `WKHTTPCookieStore.setCookie` **不会**：`HTTPCookie(properties:)`
/// 解析失败（缺 Domain、或 Secure 但 URL 非 https 等）时返回 nil，此时回调 `false`，
/// `LinuxDoCookieCommit` 走 failure，JS 侧看到的是 CSRF 未确认（而不是静默成功）。
///
/// 因此插件包装层应在构造本 writer 之前，用 `normalizedSetCookie(_:responseURL:)`
/// 把 host-only cookie（无 Domain 属性）补成显式 Domain，语义才与 Android 等价。
struct LinuxDoHTTPCookieStoreWriter: LinuxDoCookieCommit.Writer {
    /// 目标 Cookie 存储，默认 `WKWebsiteDataStore.default().httpCookieStore`。
    let store: WKHTTPCookieStore

    init(store: WKHTTPCookieStore = WKWebsiteDataStore.default().httpCookieStore) {
        self.store = store
    }

    func write(cookie: String, completed: @escaping (Bool) -> Void) throws {
        guard let parsed = HTTPCookie(properties: Self.properties(from: cookie)) else {
            // 非法 Domain/Path/Secure 组合：与 Android 拒绝写入等价。
            completed(false)
            return
        }
        let store = self.store
        store.setCookie(parsed) {
            // WebKit 在主线程回调；入队主队列后再交付，保证回调线程一致。
            DispatchQueue.main.async {
                completed(true)
            }
        }
    }

    /// 解析 Set-Cookie 头。`HTTPCookie(properties:)` 需要 `Set-Cookie` 属性字典
    /// （`Domain`/`Path`/`Secure`/`Expires`/`Max-Age`/`SameSite` 等）。
    static func properties(from setCookie: String) -> [HTTPCookiePropertyKey: Any] {
        var properties: [HTTPCookiePropertyKey: Any] = [:]
        let segments = setCookie.split(separator: ";", omittingEmptySubsequences: false)
        for (index, rawSegment) in segments.enumerated() {
            let segment = rawSegment.trimmingCharacters(in: .whitespaces)
            if segment.isEmpty { continue }
            if index == 0 {
                // 第一段是 name=value（值里可能含 '='）。
                guard let separator = segment.firstIndex(of: "=") else { continue }
                let name = String(segment[segment.startIndex..<separator]).trimmingCharacters(in: .whitespaces)
                let value = String(segment[segment.index(after: separator)...])
                guard !name.isEmpty else { continue }
                properties[.name] = name
                properties[.value] = value
                continue
            }
            guard let separator = segment.firstIndex(of: "=") else {
                // 无值属性：Secure / HttpOnly。
                if segment.caseInsensitiveCompare("secure") == .orderedSame { properties[.secure] = "TRUE" }
                continue
            }
            let key = String(segment[segment.startIndex..<separator]).trimmingCharacters(in: .whitespaces).lowercased()
            let value = String(segment[segment.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            switch key {
            case "domain": properties[.domain] = value
            case "path": properties[.path] = value
            case "secure": properties[.secure] = "TRUE"
            case "expires": properties[.expires] = value
            case "max-age":
                if let seconds = TimeInterval(value) {
                    properties[.expires] = Date().addingTimeInterval(seconds)
                }
            case "samesite":
                // iOS 15 没有公开的 SameSite 常量，用非标准键透传（见 spec 的降级说明）。
                properties[HTTPCookiePropertyKey("SameSite")] = value
            default:
                break
            }
        }
        return properties
    }

    /// 与 Android `CookieManager.setCookie(url, cookie)` 的 URL 语义对齐：
    /// 缺 Domain 时用 responseURL 的 host 补全；缺 Path 时补 `/`。
    /// 其余属性（含未知属性）保持原样透传。
    static func normalizedSetCookie(_ setCookie: String, responseURL: URL?) -> String {
        var hasDomain = false
        var hasPath = false
        var hasSecure = false
        for rawSegment in setCookie.split(separator: ";", omittingEmptySubsequences: true) {
            let segment = rawSegment.trimmingCharacters(in: .whitespaces).lowercased()
            if segment.hasPrefix("domain=") { hasDomain = true }
            else if segment.hasPrefix("path=") { hasPath = true }
            else if segment == "secure" { hasSecure = true }
        }
        var normalized = setCookie
        if !hasPath { normalized += "; Path=/" }
        if !hasDomain, let host = responseURL?.host, !host.isEmpty {
            normalized += "; Domain=\(host)"
        }
        if !hasSecure, responseURL?.scheme?.lowercased() == "https" {
            normalized += "; Secure"
        }
        return normalized
    }
}

// MARK: - UIViewController 便捷扩展

extension LinuxDoBrowserSessionRecovery {
    /// 把默认 WebView 挂进 presenter 的视图层级（1×1、不可交互、透明）。
    /// iOS 的 WKWebView 必须真的进视图层级才会执行 JS，这一点与 Android 相同。
    /// 返回挂好的 WebView，调用方在会话结束后把它从父视图移除。
    @discardableResult
    static func attach(_ browser: WKWebView, to presenter: UIViewController) -> WKWebView {
        browser.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        browser.isOpaque = false
        browser.backgroundColor = .clear
        browser.isUserInteractionEnabled = false
        presenter.view.addSubview(browser)
        return browser
    }
}
