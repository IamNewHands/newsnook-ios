import Capacitor
import Foundation
import UIKit
import WebKit

/// 知乎独立账号认证桥（iOS 端），对齐 Android `ZhihuSessionPlugin.java`。
///
/// 这里只承载必须由知乎第一方页面完成的登录/注册/验证码流程；NewsNook 的推荐、
/// 问答、评论、编辑器等业务 UI 仍全部由 React 实现。认证成功的判定不依赖页面 DOM：
/// 拿当前登录 WebView 的 Cookie 去请求 `/api/v4/me`，只有拿到合法身份才把会话交回 JS。
///
/// Cookie 只在运行时经 Capacitor 返回给 JS，随后由 SecureStore 插件（iOS 侧是
/// Keychain 实现）持久化。本插件不写 Keychain / UserDefaults / 文件，也不打印 Cookie 值。
///
/// 线程模型：Capacitor 8 的 iOS bridge 在串行后台队列上调用插件方法
/// （`CapacitorBridge.swift` 的 `dispatchQueue.async`，**不是主线程**）。因此本插件的
/// 全部可变状态只在主线程读写：方法入口先取参数，再 `DispatchQueue.main.async`
/// 进入状态机；WebKit / UIKit 回调一律先切回主线程。
@objc(ZhihuSessionPlugin)
public final class ZhihuSessionPlugin: CAPPlugin, CAPBridgedPlugin, WKHTTPCookieStoreObserver {

    public let identifier = "ZhihuSessionPlugin"
    public let jsName = "ZhihuSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBrowserSession", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - 常量（与 Java 端逐字对齐）

    private static let signInURL = "https://www.zhihu.com/signin?next=%2F"
    private static let meURL = URL(string: "https://www.zhihu.com/api/v4/me")!
    private static let wwwOrigin = "https://www.zhihu.com"
    private static let apiOrigin = "https://api.zhihu.com"
    private static let wwwHost = "www.zhihu.com"
    private static let apiHost = "api.zhihu.com"
    /// 知乎第一方域的根；`.zhihu.com` 共享 Cookie 与任意子域都落在它下面。
    private static let zhihuDomain = "zhihu.com"

    /// `WKHTTPCookieStoreObserver` 触发的探测：去抖 + 最小间隔。
    /// Android 没有这条触发源（只有 onPageFinished），见 port spec「行为差异」。
    private static let observerProbeDebounce: TimeInterval = 0.6
    private static let observerProbeMinInterval: TimeInterval = 3
    /// 呈现兜底：present 之后这么久仍没挂上窗口，就当作打开失败并拒绝挂起的 call。
    private static let presentationWatchdog: TimeInterval = 2
    /// Cookie 恢复兜底：`WKHTTPCookieStore` 的 completion 万一不回，也不能让 promise 永久挂起。
    private static let cookieSetupWatchdog: TimeInterval = 2

    // MARK: - 状态（全部只在主线程访问）

    private var pendingCall: CAPPluginCall?
    private var authController: ZhihuAuthViewController?
    private var probing = false
    private var finishing = false
    private var closeRequested = false
    private var probeScheduled = false
    private var cookieSetupFinished = false
    private var lastProbeStartedAt: TimeInterval = 0
    private var capturedUserAgent = ""
    private var resumeWwwCookie = ""
    private var resumeApiCookie = ""
    private var identitySession: URLSession?
    private let identityRedirectBlocker = ZhihuIdentityRedirectBlocker()
    private var terminationObserver: NSObjectProtocol?

    // MARK: - 生命周期

    public override func load() {
        // Android 用 `handleOnDestroy()` 收口；Capacitor iOS 没有等价钩子，
        // 只能用进程终止通知兜底（详见 port spec §2）。
        terminationObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleAppWillTerminate()
        }
    }

    deinit {
        if let observer = terminationObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        identitySession?.invalidateAndCancel()
    }

    // MARK: - 插件方法

    @objc func authenticate(_ call: CAPPluginCall) {
        let requestedURL = call.getString("url") ?? Self.signInURL
        let wwwCookie = call.getString("wwwCookie") ?? ""
        let apiCookie = call.getString("apiCookie") ?? ""

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                // 插件已释放（bridge 已拆），直接按 Android 的文案拒绝。
                call.reject("ZH_AUTH_UNAVAILABLE", "当前视图控制器无法打开知乎认证页")
                return
            }
            // Java：pendingCall != null || authDialog != null → ZH_AUTH_BUSY
            guard self.pendingCall == nil, self.authController == nil else {
                self.rejectCall(call, code: "ZH_AUTH_BUSY", message: "已有知乎认证窗口正在进行")
                return
            }
            guard Self.isAllowedAuthURL(requestedURL), let initialURL = URL(string: requestedURL) else {
                self.rejectCall(call, code: "ZH_AUTH_URL_BLOCKED", message: "认证地址不属于知乎第一方 HTTPS 域名")
                return
            }

            self.pendingCall = call
            self.finishing = false
            self.closeRequested = false
            self.probing = false
            self.probeScheduled = false
            self.capturedUserAgent = ""
            self.resumeWwwCookie = wwwCookie
            self.resumeApiCookie = apiCookie
            self.openAuthUI(initialURL: initialURL)
        }
    }

    @objc func clearBrowserSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.clearZhihuCookies(in: WKWebsiteDataStore.default().httpCookieStore) {
                call.resolve()
            }
        }
    }

    // MARK: - 打开认证页

    private func openAuthUI(initialURL: URL) {
        // Java：pendingCall == null || getActivity().isFinishing() → ZH_AUTH_UNAVAILABLE
        guard pendingCall != nil, let host = bridge?.viewController, host.viewIfLoaded?.window != nil else {
            rejectPending(code: "ZH_AUTH_UNAVAILABLE", message: "当前视图控制器无法打开知乎认证页")
            return
        }

        let store = WKWebsiteDataStore.default().httpCookieStore
        cookieSetupFinished = false
        // 幂等的「可以开页了」：无论正常链路还是兜底定时器先到，都只开一次。
        let present: () -> Void = { [weak self] in
            guard let self, !self.cookieSetupFinished else { return }
            self.cookieSetupFinished = true
            self.presentAuthUI(host: host, initialURL: initialURL)
        }
        // Cookie 属于应用 WebView 进程全局。必须先清理「知乎域自身」的旧账号 Cookie，
        // 再恢复目标账号；不能清空整个 Cookie store，否则会破坏 NewsNook 其它站点登录态。
        clearZhihuCookies(in: store) { [weak self] in
            guard let self else { return }
            self.restoreCookieHeader(self.resumeWwwCookie, host: Self.wwwHost, in: store) { [weak self] in
                guard let self else { return }
                self.restoreCookieHeader(self.resumeApiCookie, host: Self.apiHost, in: store) {
                    present()
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.cookieSetupWatchdog) {
            present()
        }
    }

    private func presentAuthUI(host: UIViewController, initialURL: URL) {
        guard pendingCall != nil, authController == nil else { return }
        // 宿主已经在展示别的 modal 时 UIKit 会静默失败，这里显式拒绝而不是让 JS 永久挂起。
        guard host.presentedViewController == nil else {
            rejectPending(code: "ZH_AUTH_UNAVAILABLE", message: "当前视图控制器无法打开知乎认证页")
            return
        }

        let controller = ZhihuAuthViewController(initialURL: initialURL)
        controller.onPageFinished = { [weak self] url in
            guard let self, Self.isAllowedAuthURL(url) else { return }
            self.probeAuthenticatedIdentity(finalAttempt: false)
        }
        controller.onCloseRequested = { [weak self] in
            self?.requestAuthenticationClose()
        }
        controller.onUserAgentCaptured = { [weak self] userAgent in
            self?.capturedUserAgent = userAgent
        }
        controller.onDismissed = { [weak self] in
            self?.handleAuthUIDidDisappear()
        }

        authController = controller
        WKWebsiteDataStore.default().httpCookieStore.add(self)

        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .fullScreen
        host.present(navigation, animated: true)

        // 兜底：present 被 UIKit 静默拒绝时，viewDidDisappear 永远不会来，
        // 挂起的 call 会一直不 settle。这里超时后自检一次。
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.presentationWatchdog) { [weak self, weak controller] in
            guard let self, let controller, self.authController === controller else { return }
            guard controller.presentingViewController != nil, controller.viewIfLoaded?.window != nil else {
                self.rejectPending(code: "ZH_AUTH_UNAVAILABLE", message: "当前视图控制器无法打开知乎认证页")
                self.teardownAuthUI()
                return
            }
        }
    }

    /// 关闭 / 取消 / 系统收起统一走这里（等价 Android `dialog.setOnDismissListener`）。
    private func handleAuthUIDidDisappear() {
        if !finishing, pendingCall != nil {
            cancelAuthenticationNow()
        }
        teardownAuthUI()
    }

    private func teardownAuthUI() {
        guard let controller = authController else { return }
        authController = nil
        WKWebsiteDataStore.default().httpCookieStore.remove(self)
        controller.detach()
    }

    private func dismissAuthUI() {
        guard let controller = authController else { return }
        let presented = controller.navigationController ?? controller
        // 等价 Android `authDialog.isShowing()`：已经收起时不再重复 dismiss。
        guard presented.presentingViewController != nil else { return }
        presented.dismiss(animated: true)
    }

    // MARK: - 身份探测

    /// 认证完成只以第一方 `/api/v4/me` 为准，避免依赖登录页 DOM/文案。
    private func probeAuthenticatedIdentity(finalAttempt: Bool) {
        guard pendingCall != nil, !finishing else { return }
        if finalAttempt { closeRequested = true }
        guard !probing else { return }
        probing = true
        lastProbeStartedAt = Date().timeIntervalSince1970

        let store = WKWebsiteDataStore.default().httpCookieStore
        readCookieHeader(store: store, host: Self.wwwHost) { [weak self] wwwCookie in
            guard let self else { return }
            self.readCookieHeader(store: store, host: Self.apiHost) { [weak self] apiCookie in
                guard let self else { return }
                guard self.pendingCall != nil, !self.finishing else {
                    self.probing = false
                    return
                }
                // `/api/v4/me` 位于 www.zhihu.com：同名 Cookie 冲突时以 www 域当前值为准。
                let checkedCookieHeader = Self.mergeCookieHeaders([apiCookie, wwwCookie])
                if checkedCookieHeader.isEmpty {
                    self.probing = false
                    if finalAttempt { self.cancelAuthenticationNow() }
                    return
                }
                self.performIdentityRequest(
                    cookieHeader: checkedCookieHeader,
                    wwwCookie: wwwCookie,
                    apiCookie: apiCookie,
                    finalAttempt: finalAttempt
                )
            }
        }
    }

    private func performIdentityRequest(
        cookieHeader: String,
        wwwCookie: String,
        apiCookie: String,
        finalAttempt: Bool
    ) {
        var request = URLRequest(url: Self.meURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.wwwOrigin + "/", forHTTPHeaderField: "Referer")
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        let userAgent = capturedUserAgent.trimmingCharacters(in: .whitespacesAndNewlines)
        if !userAgent.isEmpty {
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }

        let task = sharedIdentitySession().dataTask(with: request) { [weak self] data, response, error in
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let succeeded = error == nil && (200...299).contains(status) && !text.isEmpty
            let identity: ZhihuIdentity? = succeeded ? Self.parseIdentity(text) : nil

            DispatchQueue.main.async {
                guard let self else { return }
                self.probing = false
                guard let identity else {
                    self.finishFailedProbe(checkedCookieHeader: cookieHeader, finalAttempt: finalAttempt)
                    return
                }
                self.finishSuccess(
                    identity,
                    wwwCookie: wwwCookie,
                    apiCookie: apiCookie,
                    userAgent: userAgent
                )
            }
        }
        task.resume()
    }

    /// 用户点关闭时如果恰好有旧页面的校验请求在飞行，旧请求拿的可能是登录前的 Cookie。
    /// 失败后重新比较 Cookie：只有 Cookie 未变化时才真正取消，否则用最新会话再校验一次。
    private func finishFailedProbe(checkedCookieHeader: String, finalAttempt: Bool) {
        guard finalAttempt || closeRequested else { return }
        guard pendingCall != nil, !finishing else { return }

        let store = WKWebsiteDataStore.default().httpCookieStore
        readCookieHeader(store: store, host: Self.apiHost) { [weak self] apiCookie in
            guard let self else { return }
            self.readCookieHeader(store: store, host: Self.wwwHost) { [weak self] wwwCookie in
                guard let self, self.pendingCall != nil, !self.finishing else { return }
                let latest = Self.mergeCookieHeaders([apiCookie, wwwCookie])
                if !latest.isEmpty, latest != checkedCookieHeader {
                    self.probeAuthenticatedIdentity(finalAttempt: true)
                } else {
                    self.cancelAuthenticationNow()
                }
            }
        }
    }

    private func requestAuthenticationClose() {
        guard !finishing, pendingCall != nil else { return }
        closeRequested = true
        guard !probing else { return }
        probeAuthenticatedIdentity(finalAttempt: true)
    }

    // MARK: - 收口

    private func finishSuccess(
        _ identity: ZhihuIdentity,
        wwwCookie: String,
        apiCookie: String,
        userAgent: String
    ) {
        guard !finishing, let call = pendingCall else { return }
        finishing = true
        pendingCall = nil
        call.resolve([
            "accountId": identity.accountId,
            "name": identity.name,
            "urlToken": identity.urlToken,
            "avatarUrl": identity.avatarURL,
            "headline": identity.headline,
            "wwwCookie": wwwCookie,
            "apiCookie": apiCookie,
            "userAgent": userAgent,
            "profileJson": identity.profileJson,
        ])
        dismissAuthUI()
    }

    private func cancelAuthenticationNow() {
        guard !finishing else { return }
        finishing = true
        closeRequested = false
        let call = pendingCall
        pendingCall = nil
        rejectCall(call, code: "ZH_AUTH_CANCELLED", message: "未检测到已登录的知乎账号")
        dismissAuthUI()
    }

    private func rejectPending(code: String, message: String) {
        let call = pendingCall
        pendingCall = nil
        finishing = true
        rejectCall(call, code: code, message: message)
    }

    /// Capacitor 的 reject 参数顺序在 Android 与 iOS 上都是「message 在前、code 在后」，
    /// 而 Java 端本插件一直把 ASCII 错误码放在 message 位、中文说明放在 code 位
    /// （`call.reject("ZH_AUTH_BUSY", "已有知乎认证窗口正在进行")`）。JS 用
    /// `error.message.includes('ZH_AUTH_CANCELLED')` 判定取消，所以这个「错位」是
    /// JS 可见契约的一部分，不能顺手纠正。详见 port spec §1。
    private func rejectCall(_ call: CAPPluginCall?, code: String, message: String) {
        call?.reject(code, message)
    }

    private func handleAppWillTerminate() {
        // 对齐 Java `handleOnDestroy()`。
        identitySession?.invalidateAndCancel()
        identitySession = nil
        if pendingCall != nil {
            rejectPending(code: "ZH_AUTH_DESTROYED", message: "知乎认证页已被系统关闭")
        }
        dismissAuthUI()
        teardownAuthUI()
    }

    // MARK: - Cookie 读写

    private func sharedIdentitySession() -> URLSession {
        if let existing = identitySession { return existing }
        let configuration = URLSessionConfiguration.ephemeral
        // 与 OkHttp 客户端对齐：不跟随重定向、不碰任何 Cookie 存储，Cookie 由调用方显式给。
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        let created = URLSession(
            configuration: configuration,
            delegate: identityRedirectBlocker,
            delegateQueue: nil
        )
        identitySession = created
        return created
    }

    private func readCookieHeader(store: WKHTTPCookieStore, host: String, completion: @escaping (String) -> Void) {
        store.getAllCookies { cookies in
            let header = Self.cookieHeader(from: cookies, host: host, path: "/")
            DispatchQueue.main.async { completion(header) }
        }
    }

    /// 清掉全部 `*.zhihu.com` Cookie（含 `.zhihu.com` 共享域与各子域 host-only）。
    /// Android 按两个 origin 逐个删除；`WKHTTPCookieStore` 只能按条删，因此这里按域过滤，
    /// 范围更大但同样只影响知乎域，不会碰其它站点。
    private func clearZhihuCookies(in store: WKHTTPCookieStore, completion: @escaping () -> Void) {
        store.getAllCookies { cookies in
            let targets = cookies.filter { Self.isZhihuCookieDomain($0.domain) }
            DispatchQueue.main.async {
                guard !targets.isEmpty else {
                    completion()
                    return
                }
                var remaining = targets.count
                for cookie in targets {
                    store.delete(cookie) {
                        DispatchQueue.main.async {
                            remaining -= 1
                            if remaining == 0 { completion() }
                        }
                    }
                }
            }
        }
    }

    /// 把 JS 传来的 `name=value; name=value` 恢复成 host-only Cookie（Path=/、Secure）。
    private func restoreCookieHeader(
        _ header: String,
        host: String,
        in store: WKHTTPCookieStore,
        completion: @escaping () -> Void
    ) {
        let cookies = Self.cookiePairs(from: header).compactMap { pair -> HTTPCookie? in
            HTTPCookie(properties: [
                .name: pair.name,
                .value: pair.value,
                .domain: host,
                .path: "/",
                .secure: "TRUE",
            ])
        }
        guard !cookies.isEmpty else {
            completion()
            return
        }
        var remaining = cookies.count
        for cookie in cookies {
            store.setCookie(cookie) {
                DispatchQueue.main.async {
                    remaining -= 1
                    if remaining == 0 { completion() }
                }
            }
        }
    }

    // MARK: - WKHTTPCookieStoreObserver

    /// 知乎会在登录过程中滚动下发 Cookie。Android 只靠 `onPageFinished` 触发探测；
    /// iOS 的 Cookie store 与网络进程同步存在延迟，这里额外用 Cookie 变化补一次触发，
    /// 用去抖 + 最小间隔压住请求量（见 port spec「行为差异」）。
    @objc public func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        DispatchQueue.main.async { [weak self] in
            self?.scheduleObserverDrivenProbe()
        }
    }

    private func scheduleObserverDrivenProbe() {
        guard pendingCall != nil, !finishing, !probing, !probeScheduled, authController != nil else { return }
        let elapsed = Date().timeIntervalSince1970 - lastProbeStartedAt
        let delay = max(Self.observerProbeDebounce, Self.observerProbeMinInterval - elapsed)
        probeScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            self.probeScheduled = false
            guard self.pendingCall != nil, !self.finishing, self.authController != nil else { return }
            self.probeAuthenticatedIdentity(finalAttempt: false)
        }
    }

    // MARK: - 纯函数（与 Java 静态方法一一对应）

    static func isAllowedAuthURL(_ raw: String) -> Bool {
        guard !raw.isEmpty, let components = URLComponents(string: raw) else { return false }
        guard components.scheme?.lowercased() == "https" else { return false }
        guard let host = components.host?.lowercased(), !host.isEmpty else { return false }
        return host == Self.zhihuDomain || host.hasSuffix("." + Self.zhihuDomain)
    }

    private static func isZhihuCookieDomain(_ rawDomain: String) -> Bool {
        var domain = rawDomain.lowercased()
        if domain.hasPrefix(".") { domain = String(domain.dropFirst()) }
        return domain == Self.zhihuDomain || domain.hasSuffix("." + Self.zhihuDomain)
    }

    private static func cookieHeader(from cookies: [HTTPCookie], host: String, path: String) -> String {
        var pairs: [(name: String, value: String)] = []
        for cookie in cookies where cookieApplies(cookie, host: host, path: path) {
            pairs.append((cookie.name, cookie.value))
        }
        return pairs.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// 等价 Android `CookieManager.getCookie(origin)`：域匹配 + 路径匹配 + 未过期。
    private static func cookieApplies(_ cookie: HTTPCookie, host: String, path: String) -> Bool {
        let domain = cookie.domain.lowercased()
        let target = host.lowercased()
        let domainMatches: Bool
        if domain.hasPrefix(".") {
            let bare = String(domain.dropFirst())
            domainMatches = target == bare || target.hasSuffix(domain)
        } else {
            domainMatches = target == domain
        }
        guard domainMatches else { return false }
        if let expires = cookie.expiresDate, expires <= Date() { return false }
        return pathMatches(requestPath: path, cookiePath: cookie.path.isEmpty ? "/" : cookie.path)
    }

    private static func pathMatches(requestPath: String, cookiePath: String) -> Bool {
        if requestPath == cookiePath { return true }
        guard requestPath.hasPrefix(cookiePath) else { return false }
        if cookiePath.hasSuffix("/") { return true }
        let index = requestPath.index(requestPath.startIndex, offsetBy: cookiePath.count)
        return requestPath[index] == "/"
    }

    /// 与 Java `mergeCookieHeaders` 一致：后者覆盖前者，但保留首次出现的顺序。
    private static func mergeCookieHeaders(_ headers: [String]) -> String {
        var order: [String] = []
        var values: [String: String] = [:]
        for header in headers {
            for pair in cookiePairs(from: header) {
                if values[pair.name] == nil { order.append(pair.name) }
                values[pair.name] = pair.value
            }
        }
        return order.compactMap { name in values[name].map { "\(name)=\($0)" } }.joined(separator: "; ")
    }

    private static func cookiePairs(from header: String) -> [(name: String, value: String)] {
        var pairs: [(name: String, value: String)] = []
        for raw in header.split(separator: ";") {
            let pair = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let separator = pair.firstIndex(of: "="), separator != pair.startIndex else { continue }
            let name = String(pair[pair.startIndex..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(pair[pair.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            pairs.append((name, value))
        }
        return pairs
    }

    private static func parseIdentity(_ text: String) -> ZhihuIdentity? {
        guard
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            let profile = object as? [String: Any]
        else { return nil }
        guard let accountId = firstNonBlank(profile["id"], profile["url_token"]) else { return nil }
        return ZhihuIdentity(
            accountId: accountId,
            name: string(profile["name"]),
            urlToken: string(profile["url_token"]),
            avatarURL: string(profile["avatar_url"]),
            headline: string(profile["headline"]),
            // Java 用的是 `profile.toString()`（重新序列化）；这里保留原始响应正文。
            // 两者都是合法 JSON，JS 侧只原样存取，不比较字符串（见 port spec §3）。
            profileJson: text
        )
    }

    /// 等价 Java `optString(key, "")`：数字/布尔也转成字符串，缺失返回空串。
    private static func string(_ value: Any?) -> String {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    /// 等价 Java `firstNonBlank`：取第一个非空白值（`optString` 语义，数字同样接受）。
    private static func firstNonBlank(_ first: Any?, _ second: Any?) -> String? {
        if let value = nonBlank(first) { return value }
        return nonBlank(second)
    }

    private static func nonBlank(_ value: Any?) -> String? {
        let raw: String?
        if let text = value as? String {
            raw = text
        } else if let number = value as? NSNumber {
            raw = number.stringValue
        } else {
            raw = nil
        }
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// `/api/v4/me` 的身份结果；字段名对应 JS `NativeAuthResult`。
private struct ZhihuIdentity {
    let accountId: String
    let name: String
    let urlToken: String
    let avatarURL: String
    let headline: String
    let profileJson: String
}

/// 与 OkHttp `followRedirects(false)` / `followSslRedirects(false)` 对齐：不跟随重定向，
/// 3xx 原样交给上层判成「未登录」。单独一个对象是为了避免 URLSession 强引用插件本身。
private final class ZhihuIdentityRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// 受控知乎登录页容器：原生 chrome（标题「登录知乎」+ 关闭）+ WKWebView。
/// 对应 Android `openAuthDialog` 里自绘的 Dialog 与 WebViewClient。
final class ZhihuAuthViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    var onPageFinished: ((String) -> Void)?
    var onCloseRequested: (() -> Void)?
    var onUserAgentCaptured: ((String) -> Void)?
    var onDismissed: (() -> Void)?

    private let initialURL: URL
    private let webView: WKWebView
    private let noticeLabel = UILabel()
    private var userAgentRequested = false
    private var didReportDismissal = false

    init(initialURL: URL) {
        self.initialURL = initialURL
        let configuration = WKWebViewConfiguration()
        // 必须与插件读写 Cookie 用的是同一个 store（也是 Capacitor 主 WebView 的 store）。
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        // Android：setSupportMultipleWindows(false) + setJavaScriptCanOpenWindowsAutomatically(false)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        self.webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = "登录知乎"

        let close = UIBarButtonItem(
            image: UIImage(systemName: "xmark"),
            style: .plain,
            target: self,
            action: #selector(handleClose)
        )
        close.accessibilityLabel = "关闭"
        navigationItem.leftBarButtonItem = close

        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // Android 的系统返回键语义（优先回退历史）在 iOS 上对应 WebView 自带的边缘返回手势。
        webView.allowsBackForwardNavigationGestures = true

        noticeLabel.translatesAutoresizingMaskIntoConstraints = false
        noticeLabel.font = .systemFont(ofSize: 12)
        noticeLabel.textColor = .white
        noticeLabel.backgroundColor = UIColor.black.withAlphaComponent(0.78)
        noticeLabel.textAlignment = .center
        noticeLabel.numberOfLines = 0
        noticeLabel.layer.cornerRadius = 8
        noticeLabel.clipsToBounds = true
        noticeLabel.alpha = 0

        view.addSubview(webView)
        view.addSubview(noticeLabel)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            noticeLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            noticeLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            noticeLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
            noticeLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16),
        ])

        webView.load(URLRequest(url: initialURL))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureUserAgentIfNeeded()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard !didReportDismissal else { return }
        // 只有真的被收起（而不是被别的页面盖住）才算「窗口已关闭」。
        guard isBeingDismissed || presentingViewController == nil || navigationController?.isBeingDismissed == true else {
            return
        }
        didReportDismissal = true
        onDismissed?()
    }

    /// 对齐 Android `destroyAuthWebView()`。
    func detach() {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        if let blank = URL(string: "about:blank") {
            webView.load(URLRequest(url: blank))
        }
        webView.removeFromSuperview()
        onPageFinished = nil
        onCloseRequested = nil
        onUserAgentCaptured = nil
        onDismissed = nil
    }

    @objc private func handleClose() {
        onCloseRequested?()
    }

    private func captureUserAgentIfNeeded() {
        guard !userAgentRequested else { return }
        userAgentRequested = true
        webView.evaluateJavaScript("navigator.userAgent") { [weak self] value, _ in
            guard let self else { return }
            if let text = value as? String, !text.isEmpty {
                self.onUserAgentCaptured?(text)
            } else {
                // 取不到就允许下一次 didFinish 再试；始终取不到时 JS 侧会退回内置 UA。
                self.userAgentRequested = false
            }
        }
    }

    private func showNotice(_ text: String) {
        noticeLabel.text = text
        noticeLabel.layer.removeAllAnimations()
        noticeLabel.alpha = 1
        UIView.animate(withDuration: 0.25, delay: 2, options: [], animations: {
            self.noticeLabel.alpha = 0
        }, completion: nil)
    }

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let target = navigationAction.request.url?.absoluteString ?? ""
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !isMainFrame || ZhihuSessionPlugin.isAllowedAuthURL(target) {
            decisionHandler(.allow)
        } else {
            showNotice("已阻止跳出知乎第一方认证域名")
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        captureUserAgentIfNeeded()
        onPageFinished?(webView.url?.absoluteString ?? "")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showNotice("知乎页面加载失败，请检查网络后重试")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showNotice("知乎页面加载失败，请检查网络后重试")
    }

    // MARK: - WKUIDelegate

    /// Android `setSupportMultipleWindows(false)`：`target="_blank"` 不新开窗口，
    /// 允许的知乎链接在当前 WebView 里就地打开（用户协议/隐私政策等）。
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, ZhihuSessionPlugin.isAllowedAuthURL(url.absoluteString) {
            webView.load(URLRequest(url: url))
        } else {
            showNotice("已阻止跳出知乎第一方认证域名")
        }
        return nil
    }
}
