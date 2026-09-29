import AuthenticationServices
import Capacitor
import Foundation
import UIKit
import WebKit

/// Linux.do 第一方会话插件（iOS 端），对齐 Android
/// `android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java`。
///
/// 可见的 WKWebView 只用于 Cloudflare 验证与登录；社区业务 UI 仍全部由 React 实现，
/// 通过 Discourse JSON API 通信。当 Cloudflare 接受浏览器网络身份但拒绝 URLSession 时，
/// 同源隐藏 WebView 可以透明承载本次 App 会话的 API 流量。浏览器会话的唯一真相是
/// `WKWebsiteDataStore`，本插件不额外持久化任何 Cookie。
///
/// **本文件覆盖 10 个会话/请求方法 + 4 个上传方法 + 1 个媒体方法**（见 `pluginMethods`，共 15 项）。
/// 4 个上传方法（`beginUpload` / `appendUploadChunk` / `finishUpload` / `cancelUpload`）
/// 与 `linuxDoUploadProgress` 事件在文件末的「上传」段落实现（见 port spec §13）。
/// `fetchMedia` 是 iOS 侧新增（Android 无对应方法）：Linux.do 主站的图片同样落在
/// Cloudflare 挑战后面，宿主 WebView 的跨站 `<img>` 与 `CapacitorHttp` 都拿不到放行，
/// 只能复用本插件的会话 Cookie / 隐藏同源传输通道把字节取回来（见 §7b）。
///
/// 线程模型：Capacitor 8 的 iOS bridge 在串行后台队列上调用插件方法
/// （`CapacitorBridge.swift` 的 `dispatchQueue.async`，**不是主线程**）。
/// 因此：
///   - 全部可变状态只在主线程读写；方法入口先同步取参数，再 `DispatchQueue.main.async`
///     进入状态机；
///   - 需要跨线程查询的状态（`pendingCall` / `pendingUserApiCall` / `finishing` 等）
///     由 `stateLock`（NSLock）保护，只在主队列读写；
///   - WebKit / UIKit / URLSession 回调一律先切回主线程；
///   - 依赖的 `LinuxDoBrowserSessionRecovery` 是 `@MainActor`，用
///     `Task { @MainActor in ... }` 进入（iOS 15 安全；不使用 `MainActor.assumeIsolated`）。
@objc(LinuxDoSessionPlugin)
public final class LinuxDoSessionPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "LinuxDoSessionPlugin"
    public let jsName = "LinuxDoSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticateUserApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelUserApiKeyAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearUserApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "browserSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareBrowserSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchConnectTrustPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBrowserSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendUploadChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelUpload", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - 常量（与 Java 端逐字对齐）

    private static let origin = "https://linux.do"
    private static let connectOrigin = "https://connect.linux.do"
    private static let connectMaxRedirects = 8
    private static let loginURL = "https://linux.do/login"
    private static let sessionURL = "https://linux.do/session/current.json"
    /// Java：`ORIGIN + "/session/csrf.json?newsnook_otp_csrf=1"`。
    private static let otpCsrfURL = origin + "/session/csrf.json?newsnook_otp_csrf=1"
    /// Java：`OTP_EXCHANGE_TIMEOUT_MILLIS = 2L * 60L * 1000L`。
    private static let otpExchangeTimeout: TimeInterval = 2 * 60
    /// Android 是 `SharedPreferences("linuxdo_session_cache")`；iOS 用 `UserDefaults`，
    /// 键名加前缀以避免污染同一 UserDefaults 域（见 port spec §2）。
    private static let sessionCacheKeyLastUser = "linuxdo_session_cache.last_user"
    private static let browserBridgeName = "NewsNookLinuxDoBridge"
    private static let browserResponseChunkChars = 32 * 1024
    private static let browserResponseMaxChars = 16 * 1024 * 1024
    private static let browserRequestTimeout: TimeInterval = 35
    /// Java `syncResponseCookies` 里的 5s Cookie 提交超时。
    private static let cookieCommitTimeout: TimeInterval = 5
    /// Java `ensureBrowserTransport` 里的 15s 通道建立超时。
    private static let browserTransportTimeout: TimeInterval = 15
    /// Java `identityClient`：connect 15s / read 30s / write 120s、不跟随重定向。
    private static let identityConnectTimeout: TimeInterval = 15
    private static let identityReadTimeout: TimeInterval = 30
    /// Java `appendUploadChunk`：`256L * 1024L * 1024L`。
    private static let uploadMaxBytes = 256 * 1024 * 1024
    /// 上传连接超时对齐 Java `identityClient` 的 connectTimeout（15s）。
    private static let uploadConnectTimeout: TimeInterval = 15
    /// Java `identityClient` 的 writeTimeout 是 120s；iOS 没有单独的写超时，
    /// 用 `timeoutIntervalForRequest` 近似（空闲读超时，非总时长上限）。
    private static let uploadWriteTimeout: TimeInterval = 120
    /// Java `File.createTempFile("linuxdo-upload-", ".tmp", getCacheDir())` 的前缀/后缀。
    private static let uploadTempPrefix = "linuxdo-upload-"
    private static let uploadTempSuffix = ".tmp"

    // MARK: - 状态（全部只在主线程读写；跨线程查询由 stateLock 保护）

    private let stateLock = NSLock()
    /// 保护 `pendingCall` / `pendingUserApiCall` / `finishing` / `preferBrowserTransport`。
    private var pendingCall: CAPPluginCall?
    private var pendingUserApiCall: CAPPluginCall?
    private var pendingOtpCredential: LinuxDoUserApiAuth.Credential?
    private var exchangingOtp = false
    private var probing = false
    private var finishing = false
    private var preferBrowserTransport = false
    private var verifiedUserAgent = ""

    /// 用户 API Key 授权（Keychain + ASWebAuthenticationSession）。
    private var userApiAuth: LinuxDoUserApiAuth?
    /// 第一方浏览器会话恢复器（`@MainActor`）。
    private var browserSessionRecovery: LinuxDoBrowserSessionRecovery?

    /// 可见的登录/验证 WKWebView 容器。
    private var sessionController: LinuxDoSessionViewController?
    private var sessionWebView: WKWebView?
    private var otpWatchdog: DispatchWorkItem?

    /// 隐藏的同源浏览器传输通道（等价 Android `browserTransportWebView`）。
    private var browserTransportWebView: WKWebView?
    private var browserTransportReady = false
    private var browserTransportInitializing = false
    /// 隐藏传输 WebView 的等待者：传输就绪时回调 `(webView, nil)`，
    /// 初始化失败时回调 `(nil, 原因)`。与 `ensureBrowserTransport(_:)` 的
    /// completion 类型必须一致，否则调用点传 `nil` 会失去上下文类型。
    private var browserTransportWaiters: [(WKWebView?, String?) -> Void] = []
    private var browserTransportTimeout: DispatchWorkItem?

    /// 恢复器自己挂载的 WKWebView（会话结束时移除）。
    private var pendingRecoveryWebView: WKWebView?
    /// 挂起中的浏览器 fetch（等价 Java `browserFetches`）。
    private final class PendingBrowserFetch {
        let callback: (BrowserFetchResponse?, String?) -> Void
        var status = 0
        var headers: [String: String] = [:]
        var body = ""
        var overflow = false
        var responseUrl = ""
        var started = false
        var timeout: DispatchWorkItem?
        init(callback: @escaping (BrowserFetchResponse?, String?) -> Void) {
            self.callback = callback
        }
    }
    private var browserFetches: [String: PendingBrowserFetch] = [:]

    private var identitySession: URLSession?
    private let identityRedirectBlocker = LinuxDoIdentityRedirectBlocker()
    private var terminationObserver: NSObjectProtocol?
    private var backgroundObserver: NSObjectProtocol?

    // MARK: - 上传状态（只在主线程读写；不跨线程查询，故不进 stateLock）

    /// 一次上传的暂存会话，对齐 Java `UploadSession`（`file` / `fileName` / `mimeType` /
    /// `bytesWritten`）。`bytesWritten` 只在主队列累加。
    private final class UploadSession {
        let file: URL
        let fileName: String
        let mimeType: String
        var bytesWritten = 0
        /// `finishUpload` 发出请求后填入，供 `cancelUpload` 取消在途任务。
        var task: URLSessionUploadTask?
        /// `cleanupUpload` 会置位，阻止已排队的完成回调重复 resolve/reject。
        var settled = false
        /// 上一次已上报的整数百分比（对齐 Java 的 `lastPercent` 节流）。
        var lastNotifiedPercent = -1
        init(file: URL, fileName: String, mimeType: String) {
            self.file = file
            self.fileName = fileName
            self.mimeType = mimeType
        }
    }

    /// Java `ConcurrentHashMap<String, UploadSession> uploadSessions`。
    private var uploadSessions: [String: UploadSession] = [:]
    /// 上传专用 URLSession：把 `URLSessionTaskDelegate` 只挂在这里，
    /// 避免影响 `sharedIdentitySession()` 现有的 `LinuxDoIdentityRedirectBlocker` 委托。
    private var uploadSession: URLSession?

    /// 浏览器 fetch 结果（等价 Java `BrowserFetchResponse`）。
    private struct BrowserFetchResponse {
        let status: Int
        let data: String
        let headers: [String: String]
        let responseUrl: String
        let transport: String

        init(status: Int, data: String, headers: [String: String], responseUrl: String, transport: String = "browser") {
            self.status = status
            self.data = data
            self.headers = headers
            self.responseUrl = responseUrl
            self.transport = transport
        }
    }

    // MARK: - 生命周期

    public override func load() {
        userApiAuth = LinuxDoUserApiAuth()
        // `LinuxDoBrowserSessionRecovery` 是 `@MainActor` 类型，构造只能在主线程；
        // Capacitor 本就在主线程调 `load()`，这里显式 hop 一次让编译器满意。
        // `withRecovery` 对 nil 有守卫，构造完成前的调用只会静默跳过（启动瞬间的窗口）。
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.browserSessionRecovery = LinuxDoBrowserSessionRecovery()
        }
        captureBridgeUserAgent()
        // Android 用 `handleOnDestroy()` 收口；Capacitor iOS 没有等价钩子，
        // 只能用进程终止通知兜底（与 ZhihuSessionPlugin 同款做法）。
        terminationObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleAppWillTerminate()
        }
        // iOS 没有 CookieManager.flush()：进入后台时回读一次 httpCookieStore，
        // 让 WKWebsiteDataStore 立刻处理待落盘的 Cookie（等价 flush 的落盘意图）。
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.flushCookies()
        }
    }

    deinit {
        if let terminationObserver {
            NotificationCenter.default.removeObserver(terminationObserver)
        }
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
        identitySession?.invalidateAndCancel()
        // 上传会话与暂存文件必须显式收口：iOS 的 tmp/ 不像 Android cacheDir 那样
        // 由系统自动回收（见 port spec §13「清理与失败语义」）。
        cleanupAllUploads()
    }

    // MARK: - 1) authenticateUserApiKey

    @objc func authenticateUserApiKey(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("已有 Linux.do 系统浏览器登录正在进行", LinuxDoUserApiAuth.errorBusy)
                return
            }
            guard let auth = self.userApiAuth else {
                call.reject("无法准备 Linux.do 安全授权", LinuxDoUserApiAuth.errorCrypto)
                return
            }
            // Java：userApiAuth.isAuthenticating() || pendingUserApiCall != null
            //       || pendingCall != null || dialog != null
            if auth.isAuthenticating()
                || self.readPendingUserApiCall() != nil
                || self.readPendingCall() != nil
                || self.sessionController != nil {
                call.reject("已有 Linux.do 系统浏览器登录正在进行", LinuxDoUserApiAuth.errorBusy)
                return
            }
            self.writePendingUserApiCall(call)
            auth.authenticate(presenter: self.presenterAnchor, callback: LinuxDoApiAuthCallback(
                onSuccess: { [weak self] credential in
                    guard let self else { return }
                    self.redeemUserApiSession(call: call, credential: credential)
                },
                onFailure: { [weak self] code, message in
                    guard let self else { return }
                    guard self.readPendingUserApiCall() === call else { return }
                    self.writePendingUserApiCall(nil)
                    // Java 的 `call.reject(message, code)`：message 在前、code 在后，
                    // 这个「错位」是 JS 可见契约的一部分，不能顺手纠正。
                    call.reject(message, code)
                }
            ))
        }
    }

    // MARK: - 2) cancelUserApiKeyAuth

    @objc func cancelUserApiKeyAuth(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve()
                return
            }
            self.userApiAuth?.cancel()
            if let pending = self.readPendingUserApiCall() {
                self.writePendingUserApiCall(nil)
                self.pendingOtpCredential = nil
                self.exchangingOtp = false
                self.userApiAuth?.clearCredential()
                pending.reject("已取消 Linux.do 登录", LinuxDoUserApiAuth.errorCancelled)
            }
            self.dismissSessionDialog()
            call.resolve()
        }
    }

    // MARK: - 3) clearUserApiKey

    @objc func clearUserApiKey(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve()
                return
            }
            self.userApiAuth?.cancel()
            guard let credential = self.userApiAuth?.credential() else {
                self.userApiAuth?.clearCredential()
                self.clearCachedSessionUser()
                call.resolve()
                return
            }

            // 尽力而为地远端吊销；本地登出必须永远成功（Java 同款取舍）。
            let url = URL(string: Self.origin + "/user-api-key/revoke")
            var request = URLRequest(url: url ?? URL(string: Self.origin)!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(credential.key, forHTTPHeaderField: "User-Api-Key")
            request.setValue(credential.clientId, forHTTPHeaderField: "User-Api-Client-Id")
            request.setValue("application/x-www-form-urlencoded; charset=UTF-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data()
            self.applyBrowserSessionHeaders(to: &request, forOrigin: Self.origin)

            let task = self.sharedIdentitySession().dataTask(with: request) { [weak self] _, _, _ in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.userApiAuth?.clearCredential()
                    self.clearCachedSessionUser()
                    call.resolve()
                }
            }
            task.resume()
        }
    }

    // MARK: - 4) authenticate

    @objc func authenticate(_ call: CAPPluginCall) {
        let initialUrl = call.getString("url") ?? Self.loginURL
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("当前视图控制器无法打开 Linux.do 验证页", "LINUXDO_SESSION_UNAVAILABLE")
                return
            }
            // Java：pendingCall != null || pendingUserApiCall != null || dialog != null
            if self.readPendingCall() != nil
                || self.readPendingUserApiCall() != nil
                || self.sessionController != nil {
                call.reject("已有 Linux.do 验证窗口正在进行", "LINUXDO_SESSION_BUSY")
                return
            }
            guard Self.isAllowedUrl(initialUrl), let url = URL(string: initialUrl) else {
                call.reject("只允许打开 linux.do 第一方 HTTPS 页面", "LINUXDO_SESSION_URL")
                return
            }
            self.writePendingCall(call)
            self.writeFinishing(false)
            self.openDialog(initialUrl: url, otpExchange: false)
        }
    }

    // MARK: - 5) snapshot

    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve(["authenticated": false, "authMode": "none"])
                return
            }
            let credential = self.userApiAuth?.credential()
            if let credential, credential.hasUsableOneTimePassword() {
                self.writePendingUserApiCall(call)
                self.redeemUserApiSession(call: call, credential: credential)
                return
            }
            if credential != nil { self.userApiAuth?.clearCredential() }
            self.collectSnapshot(call: call, finishDialog: false)
        }
    }

    // MARK: - 6) browserSnapshot

    @objc func browserSnapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.collectSnapshot(call: call, finishDialog: false)
        }
    }

    // MARK: - 7) request

    @objc func request(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let method = (call.getString("method") ?? "GET").uppercased()
        let body = call.getString("body") ?? ""
        let requestHeaders = Self.stringDictionary(call.getObject("headers"))
        let browserOnly = call.getBool("browserOnly", false)

        guard Self.isApiAllowedUrl(url) else {
            call.reject("只允许请求 linux.do 主站 HTTPS API", "LINUXDO_REQUEST_URL")
            return
        }
        guard method == "GET" || method == "POST" || method == "PUT" || method == "DELETE" else {
            call.reject("不支持的请求方法", "LINUXDO_REQUEST_METHOD")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Linux.do 网络请求失败", "LINUXDO_REQUEST_NETWORK")
                return
            }
            let onSuccess: (BrowserFetchResponse) -> Void = { [weak self] response in
                self?.resolveBrowserRequest(call: call, response: response)
            }
            let onFailure: (String) -> Void = { [weak self] message in
                guard let self else { return }
                if browserOnly {
                    call.reject(message, "LINUXDO_BROWSER_REQUEST")
                    return
                }
                // 浏览器传输只是会话级兼容路径，不是永久锁定。它的基础设施失效时
                // 回落到原生路径，让正常的 CF 探测决定是否真的需要再做一次浏览器验证。
                self.writePreferBrowserTransport(false)
                self.performNativeRequest(
                    call: call,
                    url: url,
                    method: method,
                    requestHeaders: requestHeaders,
                    body: body
                )
            }

            if browserOnly {
                self.performBrowserRequest(
                    url: url,
                    method: method,
                    requestHeaders: requestHeaders,
                    body: body,
                    onSuccess: onSuccess,
                    onFailure: onFailure
                )
                return
            }
            if self.readPreferBrowserTransport() {
                self.performBrowserRequest(
                    url: url,
                    method: method,
                    requestHeaders: requestHeaders,
                    body: body,
                    onSuccess: onSuccess,
                    onFailure: onFailure
                )
                return
            }
            self.performNativeRequest(
                call: call,
                url: url,
                method: method,
                requestHeaders: requestHeaders,
                body: body
            )
        }
    }

    // MARK: - 7b) fetchMedia

    /// 取 Linux.do 主站媒体字节（图片等），以 base64 回传。
    /// 宿主 WebView 的跨站 `<img>` 会被 Cloudflare 挑战拦下（`cf-mitigated: challenge`），
    /// `CapacitorHttp` 兜底又不带会话 Cookie；这里先带 Cookie 走 URLSession，命中挑战
    /// 再交给隐藏同源传输 WebView 取 blob 转 base64。iOS 新增，Android 无对应方法。
    @objc func fetchMedia(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let referer = call.getString("referer") ?? (Self.origin + "/")

        guard Self.isAllowedMediaUrl(url) else {
            call.reject("只允许请求 linux.do 站内与站点 CDN 的 HTTPS 媒体", "LINUXDO_MEDIA_URL")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Linux.do 媒体请求失败", "LINUXDO_MEDIA_NETWORK")
                return
            }
            self.performNativeMediaRequest(call: call, url: url, referer: referer)
        }
    }

    private func performNativeMediaRequest(call: CAPPluginCall, url: String, referer: String) {
        readCookieHeader(origin: Self.origin) { [weak self] cookie in
            guard let self, let target = URL(string: url) else {
                call.reject("Linux.do 媒体请求失败", "LINUXDO_MEDIA_NETWORK")
                return
            }
            let userAgent = self.currentUserAgent()
            var request = URLRequest(url: target)
            request.httpMethod = "GET"
            request.timeoutInterval = Self.identityReadTimeout
            request.setValue("image/avif,image/webp,image/apng,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
            request.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
            if !referer.isEmpty { request.setValue(referer, forHTTPHeaderField: "Referer") }
            if !userAgent.isEmpty { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
            if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }

            let task = self.sharedIdentitySession().dataTask(with: request) { [weak self] data, response, error in
                guard let self else { return }
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? 0
                let headers = http.map { Self.safeResponseHeaders($0) } ?? [:]
                let body = data ?? Data()
                let text = String(data: body, encoding: .utf8) ?? ""
                let challenged = Self.isCloudflareChallenge(status: status, body: text, headers: headers)
                let contentType = http?.value(forHTTPHeaderField: "Content-Type")?.lowercased()
                // 非图片正文（例如被换成 HTML 拦截页）也算失败，交给浏览器传输重试。
                let looksLikeMedia = contentType.map { $0.hasPrefix("image/") || $0.hasPrefix("video/") } ?? true
                if error == nil, !challenged, looksLikeMedia, (200...299).contains(status), !body.isEmpty {
                    DispatchQueue.main.async {
                        self.resolveMedia(call: call, status: status, contentType: contentType, data: body, transport: "native")
                    }
                    return
                }
                // 隐藏传输 WebView 只能主线程创建/使用，URLSession 回调在后台队列。
                DispatchQueue.main.async {
                    self.performBrowserMediaRequest(url: url, call: call)
                }
            }
            task.resume()
        }
    }

    /// 隐藏同源传输 WebView 取字节：脚本把响应读成 data URL，这里剥掉前缀还原 base64。
    private func performBrowserMediaRequest(url: String, call: CAPPluginCall) {
        performBrowserTransportRequest(
            url: url,
            method: "GET",
            requestHeaders: [:],
            body: "",
            binary: true,
            onSuccess: { response in
                guard (200...299).contains(response.status) else {
                    call.reject("Linux.do 媒体请求失败（HTTP \(response.status)）", "LINUXDO_MEDIA_HTTP")
                    return
                }
                let raw = response.data
                let base64: String
                if raw.hasPrefix("data:"), let comma = raw.firstIndex(of: ",") {
                    base64 = String(raw[raw.index(after: comma)...])
                } else {
                    base64 = raw
                }
                guard !base64.isEmpty else {
                    call.reject("Linux.do 媒体请求返回了空内容", "LINUXDO_MEDIA_EMPTY")
                    return
                }
                var result: [String: Any] = [:]
                result["status"] = response.status
                result["base64"] = base64
                result["contentType"] = Self.headerValue(response.headers, name: "content-type")
                    ?? Self.dataUrlContentType(raw)
                result["transport"] = response.transport
                call.resolve(result)
            },
            onFailure: { message in
                call.reject(message, "LINUXDO_MEDIA_BROWSER")
            }
        )
    }

    private func resolveMedia(call: CAPPluginCall, status: Int, contentType: String?, data: Data, transport: String) {
        var result: [String: Any] = [:]
        result["status"] = status
        result["base64"] = data.base64EncodedString()
        if let contentType, !contentType.isEmpty { result["contentType"] = contentType }
        result["transport"] = transport
        call.resolve(result)
    }

    private static func dataUrlContentType(_ value: String) -> String? {
        guard value.hasPrefix("data:"), let semicolon = value.firstIndex(of: ";") else { return nil }
        let type = String(value[value.index(value.startIndex, offsetBy: 5)..<semicolon])
        return type.isEmpty ? nil : type
    }

    // MARK: - 8) prepareBrowserSession

    @objc func prepareBrowserSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve(LinuxDoBrowserSessionRecovery.unavailable(reason: "activity"))
                return
            }
            self.withRecovery { recovery in
                // presenter 只用于校验；WebView 必须由这里挂进视图层级，
                // 否则 WKWebView 不执行 JS，探针永不返回（见依赖文件头注释）。
                var browser: WKWebView?
                if let presenter = self.presenterViewController() {
                    browser = LinuxDoBrowserSessionRecovery.attach(
                        LinuxDoBrowserSessionRecovery.defaultWebView(),
                        to: presenter
                    )
                }
                self.pendingRecoveryWebView = browser
                recovery.prepare(presenter: self.presenterViewController()) { result in
                    if Self.boolValue(result["ready"]) {
                        self.writePreferBrowserTransport(true)
                    }
                    call.resolve(result)
                }
            }
        }
    }

    // MARK: - 9) fetchConnectTrustPage

    @objc func fetchConnectTrustPage(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.performConnectTrustRequest(
                call: call,
                url: Self.connectOrigin + "/",
                redirectCount: 0
            )
        }
    }

    // MARK: - 10) clearBrowserSession

    @objc func clearBrowserSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve()
                return
            }
            self.withRecovery { recovery in recovery.cancel() }
            self.detachRecoveryWebView()
            self.destroyBrowserTransport(reason: "Linux.do 浏览器会话已清除")
            self.clearLinuxDoCookies { [weak self] succeeded in
                guard let self else {
                    call.resolve()
                    return
                }
                guard succeeded else {
                    call.reject("清理 Linux.do 会话失败", "LINUXDO_SESSION_CLEAR")
                    return
                }
                self.clearCachedSessionUser()
                self.verifiedUserAgent = ""
                // iOS 没有 CookieManager.flush()：回读一次 httpCookieStore 当作落盘确认。
                self.flushCookies()
                call.resolve()
            }
        }
    }

    // MARK: - 11) beginUpload / 12) appendUploadChunk / 13) finishUpload / 14) cancelUpload
    //
    // 对齐 Java `LinuxDoSessionPlugin.beginUpload` … `cleanupUpload`。
    // iOS 机制替换（详见 docs/superpowers/specs/2026-09-26-linuxdo-session-ios-port.md §13）：
    //   Android `File.createTempFile(..., getCacheDir())` + `FileOutputStream` 追加
    //     → `FileManager.default.temporaryDirectory` + `OutputStream` 追加；
    //   Android `UploadProgressRequestBody`（OkHttp 在 `writeTo` 里数字节）
    //     → `URLSession.uploadTask(with:fromFile:)`（文件型上传体）+ `URLSessionTaskDelegate`
    //       的 `urlSession(_:task:didSendBodyData:totalBytesSent:totalBytesExpectedToSend:)`。
    //        选它的原因：文件型 body 不占内存、由系统流式读取，`didSendBodyData` 是 iOS 15
    //        上唯一能拿到「真实网络已发送字节」的公开回调；`Data` 型 body 不上报该回调。

    @objc func beginUpload(_ call: CAPPluginCall) {
        // Java：`new File(call.getString("fileName", "upload.bin")).getName()`
        let rawName = call.getString("fileName") ?? "upload.bin"
        let fileName = Self.sanitizedUploadFileName(rawName)
        let mimeType = call.getString("mimeType") ?? "application/octet-stream"
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("无法创建上传临时文件", "LINUXDO_UPLOAD_PREPARE")
                return
            }
            do {
                let file = try Self.createUploadTempFile()
                let uploadId = UUID().uuidString
                self.uploadSessions[uploadId] = UploadSession(
                    file: file,
                    fileName: fileName,
                    mimeType: mimeType
                )
                call.resolve(["uploadId": uploadId])
            } catch {
                call.reject("无法创建上传临时文件", "LINUXDO_UPLOAD_PREPARE")
            }
        }
    }

    @objc func appendUploadChunk(_ call: CAPPluginCall) {
        let uploadId = call.getString("uploadId") ?? ""
        let base64 = call.getString("base64") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("上传会话已失效", "LINUXDO_UPLOAD_SESSION")
                return
            }
            guard let session = self.uploadSessions[uploadId] else {
                call.reject("上传会话已失效", "LINUXDO_UPLOAD_SESSION")
                return
            }
            guard !base64.isEmpty else {
                call.reject("上传分块为空", "LINUXDO_UPLOAD_CHUNK")
                return
            }
            guard let bytes = Self.decodeBase64Lenient(base64) else {
                self.cleanupUpload(uploadId)
                call.reject("文件分块编码无效", "LINUXDO_UPLOAD_BASE64")
                return
            }
            guard session.bytesWritten + bytes.count <= Self.uploadMaxBytes else {
                self.cleanupUpload(uploadId)
                call.reject("单个附件超过 256 MB", "LINUXDO_UPLOAD_TOO_LARGE")
                return
            }
            guard Self.appendUploadBytes(bytes, to: session.file) else {
                self.cleanupUpload(uploadId)
                call.reject("写入上传临时文件失败", "LINUXDO_UPLOAD_WRITE")
                return
            }
            session.bytesWritten += bytes.count
            call.resolve(["bytesWritten": session.bytesWritten])
        }
    }

    @objc func finishUpload(_ call: CAPPluginCall) {
        let uploadId = call.getString("uploadId") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("上传会话已失效", "LINUXDO_UPLOAD_SESSION")
                return
            }
            let removed = self.uploadSessions.removeValue(forKey: uploadId)
            guard let session = removed,
                  session.bytesWritten > 0,
                  FileManager.default.fileExists(atPath: session.file.path) else {
                // Java：`session != null` 时仍要删掉文件。
                if let orphan = removed { Self.removeUploadTempFile(orphan.file) }
                call.reject("上传会话已失效", "LINUXDO_UPLOAD_SESSION")
                return
            }

            let cookie = self.syncCookieHeader(origin: Self.origin)
            let userAgent = self.currentUserAgent()

            if self.userApiAuth?.hasValidCredential() == true {
                self.performUpload(
                    uploadId: uploadId,
                    session: session,
                    call: call,
                    cookie: cookie,
                    userAgent: userAgent,
                    csrf: ""
                )
                return
            }

            // Java：GET `/session/csrf.json`（不带 `newsnook_otp_csrf` 参数）。
            guard let csrfURL = URL(string: Self.origin + "/session/csrf.json") else {
                Self.removeUploadTempFile(session.file)
                call.reject("无法建立上传会话", "LINUXDO_UPLOAD_CSRF")
                return
            }
            var csrfRequest = URLRequest(url: csrfURL)
            csrfRequest.httpMethod = "GET"
            csrfRequest.setValue("application/json", forHTTPHeaderField: "Accept")
            if !cookie.isEmpty { csrfRequest.setValue(cookie, forHTTPHeaderField: "Cookie") }
            if !userAgent.isEmpty { csrfRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent") }

            let task = self.uploadURLSession().dataTask(with: csrfRequest) { [weak self] data, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                DispatchQueue.main.async {
                    guard let self else {
                        Self.removeUploadTempFile(session.file)
                        call.reject("无法建立上传会话", "LINUXDO_UPLOAD_CSRF")
                        return
                    }
                    guard error == nil else {
                        Self.removeUploadTempFile(session.file)
                        call.reject("无法建立上传会话", "LINUXDO_UPLOAD_CSRF")
                        return
                    }
                    var csrf = ""
                    if (200...299).contains(status), !text.isEmpty,
                       let object = Self.jsonObject(text) {
                        csrf = Self.stringValue(object["csrf"])
                    }
                    guard !csrf.isEmpty else {
                        Self.removeUploadTempFile(session.file)
                        call.reject("无法获取 CSRF Token", "LINUXDO_UPLOAD_CSRF")
                        return
                    }
                    self.performUpload(
                        uploadId: uploadId,
                        session: session,
                        call: call,
                        cookie: cookie,
                        userAgent: userAgent,
                        csrf: csrf
                    )
                }
            }
            task.resume()
        }
    }

    /// 等价 Java `performUpload`：multipart/form-data 发到 `/uploads.json`。
    private func performUpload(
        uploadId: String,
        session: UploadSession,
        call: CAPPluginCall,
        cookie: String,
        userAgent: String,
        csrf: String
    ) {
        guard let target = URL(string: Self.origin + "/uploads.json") else {
            Self.removeUploadTempFile(session.file)
            call.reject("上传失败", "LINUXDO_UPLOAD_NETWORK")
            return
        }
        let boundary = "NewsNookLinuxDoBoundary-\(UUID().uuidString)"
        let bodyFile = Self.createMultipartBodyFile(
            boundary: boundary,
            fileName: session.fileName,
            mimeType: session.mimeType,
            fileURL: session.file
        )
        guard let bodyFile else {
            Self.removeUploadTempFile(session.file)
            call.reject("上传失败", "LINUXDO_UPLOAD_NETWORK")
            return
        }

        var request = URLRequest(url: target)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        if !csrf.isEmpty { request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token") }
        if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        if !userAgent.isEmpty { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
        // Java：`userApiAuth.applyHeaders(uploadBuilder)`。
        for (name, value) in (userApiAuth?.applyHeaders() ?? [:]) {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let task = uploadURLSession().uploadTask(with: request, fromFile: bodyFile) { [weak self, weak session] data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let setCookies = (response as? HTTPURLResponse).map { Self.setCookieHeaders(from: $0) } ?? []
            DispatchQueue.main.async {
                Self.removeUploadTempFile(bodyFile)
                // 先删暂存文件（`cleanupUpload` 可能已删过一次，幂等）。
                if let session { Self.removeUploadTempFile(session.file) }
                guard let liveSession = session, !liveSession.settled else { return }
                liveSession.settled = true
                liveSession.task = nil
                // 兜底：若 `didSendBodyData` 在本机/本网络路径上没有回报，
                // 至少让 JS 的 0.15 + 0.8 * 1.0 收敛到 0.95（与 Java 的 100% 上报同义）。
                if error == nil {
                    self?.notifyUploadProgress(
                        uploadId: uploadId,
                        sentBytes: Int64(liveSession.bytesWritten),
                        totalBytes: Int64(liveSession.bytesWritten)
                    )
                }
                // JS Promise 必须收敛：插件已释放时也不能静默挂起。
                guard let self else {
                    call.reject("上传失败", "LINUXDO_UPLOAD_NETWORK")
                    return
                }
                if let error {
                    // 主动取消走 `cancelUpload`，这里只在未取消时报网络失败。
                    if (error as NSError).code == NSURLErrorCancelled { return }
                    call.reject("上传失败", "LINUXDO_UPLOAD_NETWORK")
                    return
                }
                self.commitResponseCookies(setCookies: setCookies, responseURL: response?.url) {
                    guard (200...299).contains(status) else {
                        call.reject(text.isEmpty ? "上传失败" : text, "LINUXDO_UPLOAD_HTTP")
                        return
                    }
                    guard !text.isEmpty, let object = Self.jsonObject(text) else {
                        call.reject("无法解析上传结果", "LINUXDO_UPLOAD_PARSE")
                        return
                    }
                    call.resolve(object)
                } failed: {
                    // 等价 Java `syncResponseCookies` 抛错被 catch 住后走 PARSE 分支。
                    call.reject("无法解析上传结果", "LINUXDO_UPLOAD_PARSE")
                }
            }
        }
        session.task = task
        task.resume()
    }

    @objc func cancelUpload(_ call: CAPPluginCall) {
        let uploadId = call.getString("uploadId") ?? ""
        DispatchQueue.main.async { [weak self] in
            self?.cleanupUpload(uploadId)
            call.resolve()
        }
    }

    /// 等价 Java `cleanupUpload`：摘掉会话并删除暂存文件。
    /// 若上传任务已在途，先取消（取消后完成回调会因 `settled` 静默退出）。
    private func cleanupUpload(_ uploadId: String) {
        guard let session = uploadSessions.removeValue(forKey: uploadId) else { return }
        session.settled = true
        session.task?.cancel()
        session.task = nil
        Self.removeUploadTempFile(session.file)
    }

    /// 进程级清理：Java `handleOnDestroy()` 依赖 cacheDir 由系统回收，
    /// iOS 的 `tmp/` 不会自动回收，所以在应用终止时显式取消并删除。
    private func cleanupAllUploads() {
        for (_, session) in uploadSessions {
            session.settled = true
            session.task?.cancel()
            session.task = nil
            Self.removeUploadTempFile(session.file)
        }
        uploadSessions.removeAll()
        uploadSession?.invalidateAndCancel()
        uploadSession = nil
    }

    /// 等价 Java `notifyUploadProgress`：`progress` 是**网络**进度（0…1），
    /// `sentBytes`/`totalBytes` 是整个 multipart 请求体的字节数。
    /// 必须在主线程调用（`uploadSessions` 与 `notifyListeners` 都在主队列）。
    private func notifyUploadProgress(uploadId: String, sentBytes: Int64, totalBytes: Int64) {
        let progress = totalBytes > 0 ? min(1.0, Double(sentBytes) / Double(totalBytes)) : 0.0
        // 只放 `Int` / `Double` / `String`：`CAPPlugin.h` 的
        // `notifyListeners:data:` 收 `NSDictionary<NSString *, id>`，这三类能稳定过桥。
        notifyListeners("linuxDoUploadProgress", data: [
            "uploadId": uploadId,
            "sentBytes": Int(sentBytes),
            "totalBytes": Int(totalBytes),
            "progress": progress,
        ])
    }

    // MARK: - 上传辅助（主线程）

    /// Java `File.createTempFile("linuxdo-upload-", ".tmp", getCacheDir())`。
    /// iOS 用 `FileManager.default.temporaryDirectory`（= `NSTemporaryDirectory()`）。
    private static func createUploadTempFile() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
        for _ in 0..<8 {
            let candidate = directory
                .appendingPathComponent(uploadTempPrefix + UUID().uuidString)
                .appendingPathExtension("tmp")
            if !FileManager.default.fileExists(atPath: candidate.path) {
                guard FileManager.default.createFile(atPath: candidate.path, contents: nil) else {
                    throw CocoaError(.fileWriteUnknown)
                }
                return candidate
            }
        }
        throw CocoaError(.fileWriteFileExists)
    }

    private static func removeUploadTempFile(_ file: URL) {
        try? FileManager.default.removeItem(at: file)
    }

    /// 等价 `FileOutputStream(session.file, true)` 的追加写。
    private static func appendUploadBytes(_ bytes: Data, to file: URL) -> Bool {
        guard let stream = OutputStream(url: file, append: true) else { return false }
        stream.open()
        defer { stream.close() }
        guard stream.streamStatus == .open || stream.streamStatus == .writing else { return false }
        var remaining = bytes
        while !remaining.isEmpty {
            let written = remaining.withUnsafeBytes { buffer -> Int in
                guard let base = buffer.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                return stream.write(base, maxLength: buffer.count)
            }
            if written <= 0 { return false }
            remaining = remaining.dropFirst(written)
        }
        return true
    }

    /// Java `Base64.decode(base64, Base64.DEFAULT)` 的宽松语义：忽略换行/空白，
    /// 遇到非法字符返回 nil（Java 抛 `IllegalArgumentException`），
    /// 缺失的 `=` 填充由 `Data(base64Encoded:)` 容忍。
    private static func decodeBase64Lenient(_ raw: String) -> Data? {
        var cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.contains("\n") || cleaned.contains("\r") || cleaned.contains(" ") || cleaned.contains("\t") {
            cleaned = cleaned.components(separatedBy: .whitespacesAndNewlines).joined()
        }
        guard !cleaned.isEmpty else { return Data() }
        return Data(base64Encoded: cleaned, options: .ignoreUnknownCharacters)
    }

    /// 等价 `new File(name).getName()`：只取最后一段文件名。
    private static func sanitizedUploadFileName(_ raw: String) -> String {
        let normalized = raw.replacingOccurrences(of: "\\", with: "/")
        let name = normalized.components(separatedBy: "/").last ?? ""
        return name.isEmpty ? "upload.bin" : name
    }

    /// Java `MultipartBody.FORM.addFormDataPart("upload_type", "composer")` +
    /// `addFormDataPart("file", fileName, fileBody)` 的等价物，写成临时文件供
    /// `uploadTask(with:fromFile:)` 使用。
    private static func createMultipartBodyFile(
        boundary: String,
        fileName: String,
        mimeType: String,
        fileURL: URL
    ) -> URL? {
        let directory = FileManager.default.temporaryDirectory
        let bodyURL = directory
            .appendingPathComponent(uploadTempPrefix + "body-" + UUID().uuidString)
            .appendingPathExtension("tmp")
        FileManager.default.createFile(atPath: bodyURL.path, contents: nil)
        guard let output = OutputStream(url: bodyURL, append: false) else { return nil }
        output.open()
        defer { output.close() }

        let head = "--\(boundary)\r\n"
            + "Content-Disposition: form-data; name=\"upload_type\"\r\n\r\n"
            + "composer\r\n"
            + "--\(boundary)\r\n"
            + "Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n"
            + "Content-Type: \(mimeType)\r\n\r\n"
        guard streamWrite(Data(head.utf8), to: output) else {
            removeUploadTempFile(bodyURL)
            return nil
        }
        guard streamFileBody(fileURL, to: output) else {
            removeUploadTempFile(bodyURL)
            return nil
        }
        guard streamWrite(Data("\r\n--\(boundary)--\r\n".utf8), to: output) else {
            removeUploadTempFile(bodyURL)
            return nil
        }
        return bodyURL
    }

    private static func streamWrite(_ bytes: Data, to stream: OutputStream) -> Bool {
        var remaining = bytes
        while !remaining.isEmpty {
            let written = remaining.withUnsafeBytes { buffer -> Int in
                guard let base = buffer.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                return stream.write(base, maxLength: buffer.count)
            }
            if written <= 0 { return false }
            remaining = remaining.dropFirst(written)
        }
        return true
    }

    private static func streamFileBody(_ fileURL: URL, to output: OutputStream) -> Bool {
        guard let input = InputStream(url: fileURL) else { return false }
        input.open()
        defer { input.close() }
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        // 不用 `hasBytesAvailable`：它对文件流在 EOF 前可能返回 false。
        // 按 `read` 返回 0 判 EOF（对齐 `FileInputStream.read` 的语义）。
        while true {
            let read = buffer.withUnsafeMutableBytes { raw -> Int in
                guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                return input.read(base, maxLength: raw.count)
            }
            if read < 0 { return false }
            if read == 0 { break }
            guard streamWrite(Data(buffer[0..<read]), to: output) else { return false }
        }
        return true
    }

    /// 上传专用 URLSession：`didSendBodyData` 的委托只挂这里，不干扰
    /// `sharedIdentitySession()` 的 `LinuxDoIdentityRedirectBlocker`。
    private func uploadURLSession() -> URLSession {
        if let existing = uploadSession { return existing }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = Self.uploadWriteTimeout
        // 与 OkHttp `identityClient` 一致：不跟随重定向。
        configuration.timeoutIntervalForResource = Self.uploadWriteTimeout * 8
        let created = URLSession(
            configuration: configuration,
            delegate: self,
            delegateQueue: nil
        )
        uploadSession = created
        return created
    }

    // MARK: - 状态访问（主线程读写；锁只用于跨线程查询）

    private func readPendingCall() -> CAPPluginCall? {
        stateLock.lock(); defer { stateLock.unlock() }
        return pendingCall
    }

    private func writePendingCall(_ value: CAPPluginCall?) {
        stateLock.lock(); pendingCall = value; stateLock.unlock()
    }

    private func readPendingUserApiCall() -> CAPPluginCall? {
        stateLock.lock(); defer { stateLock.unlock() }
        return pendingUserApiCall
    }

    private func writePendingUserApiCall(_ value: CAPPluginCall?) {
        stateLock.lock(); pendingUserApiCall = value; stateLock.unlock()
    }

    private func writeFinishing(_ value: Bool) {
        stateLock.lock(); finishing = value; stateLock.unlock()
    }

    private func readFinishing() -> Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        return finishing
    }

    private func readPreferBrowserTransport() -> Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        return preferBrowserTransport
    }

    private func writePreferBrowserTransport(_ value: Bool) {
        stateLock.lock(); preferBrowserTransport = value; stateLock.unlock()
    }

    // MARK: - 恢复器 / presenter / UA

    /// 进入 `@MainActor` 的恢复器。用 `Task { @MainActor in ... }` 而不是
    /// `MainActor.assumeIsolated`（iOS 17 才有），保证 iOS 15 可编译。
    private func withRecovery(_ body: @escaping @MainActor (LinuxDoBrowserSessionRecovery) -> Void) {
        guard let recovery = browserSessionRecovery else { return }
        Task { @MainActor in body(recovery) }
    }

    private func presenterViewController() -> UIViewController? {
        bridge?.viewController
    }

    /// 与 `LinuxDoUserApiAuth.defaultPresenter()` 同源的兜底锚窗口。
    private func presenterAnchor() -> ASPresentationAnchor? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        guard let scene = active else { return nil }
        return scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first
    }

    private func captureBridgeUserAgent() {
        // Android 在 `load()` 里读 `bridge.getWebView().getSettings().getUserAgentString()`。
        let ua = bridge?.webView?.customUserAgent ?? ""
        if !ua.isEmpty { verifiedUserAgent = ua }
    }

    /// 等价 Java `currentUserAgent()`。
    private func currentUserAgent() -> String {
        // `WKWebView.customUserAgent` 是 String?：必须先解包再判空，不能直接 `.isEmpty`。
        if let view = sessionWebView, let ua = view.customUserAgent, !ua.isEmpty {
            verifiedUserAgent = ua
            return ua
        }
        if !verifiedUserAgent.isEmpty { return verifiedUserAgent }
        if let ua = bridge?.webView?.customUserAgent, !ua.isEmpty { return ua }
        return ""
    }

    // MARK: - 用户 API Key 会话兑换

    private func redeemUserApiSession(call: CAPPluginCall, credential: LinuxDoUserApiAuth.Credential) {
        guard credential.hasUsableOneTimePassword() else {
            writePendingUserApiCall(nil)
            userApiAuth?.clearCredential()
            call.reject("Linux.do 授权未返回可用的一次性登录凭据，请重新登录", "LINUXDO_USER_API_OTP")
            return
        }
        pendingOtpCredential = credential
        exchangingOtp = false
        // 可见的 WebView 导航会带 HTML 导向的 Accept 头，Discourse 的无扩展名
        // `/session/csrf` 因此返回 HTML not-found，兑换会永久等待。显式用 JSON 路由；
        // `.json` 后缀也能在 Cloudflare 挑战重定向后保持响应格式确定。
        guard let url = URL(string: Self.otpCsrfURL) else {
            writePendingUserApiCall(nil)
            pendingOtpCredential = nil
            userApiAuth?.clearCredential()
            call.reject("Linux.do 授权已完成，但一次性会话兑换失败，请重试", "LINUXDO_USER_API_OTP")
            return
        }
        openDialog(initialUrl: url, otpExchange: true)
    }

    /// 等价 Java `burnUserApiCredential`：尽力而为地远端吊销一次性凭据。
    private func burnUserApiCredential(_ credential: LinuxDoUserApiAuth.Credential) {
        userApiAuth?.clearCredential()
        guard let url = URL(string: Self.origin + "/user-api-key/revoke") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(credential.key, forHTTPHeaderField: "User-Api-Key")
        request.setValue(credential.clientId, forHTTPHeaderField: "User-Api-Client-Id")
        request.setValue("application/x-www-form-urlencoded; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data()
        // 一次性密码作用域访问不了普通 API，本地删除已经足够；结果忽略。
        let task = sharedIdentitySession().dataTask(with: request) { _, _, _ in }
        task.resume()
    }

    // MARK: - 会话缓存（UserDefaults）

    private func sessionCacheDefaults() -> UserDefaults {
        UserDefaults.standard
    }

    /// 等价 Java `cacheSessionUser`：会话提示是尽力而为的，永远不替代服务端真相。
    private func cacheSessionUser(_ user: [String: Any]) {
        var cached: [String: Any] = [:]
        cached["id"] = Self.intValue(user["id"])
        cached["username"] = Self.stringValue(user["username"])
        cached["name"] = Self.stringValue(user["name"])
        cached["avatar_template"] = Self.stringValue(user["avatar_template"])
        cached["trust_level"] = Self.intValue(user["trust_level"])
        cached["unread_notifications"] = Self.intValue(user["unread_notifications"])
        let unread = Self.intValue(user["unread_notifications"])
        cached["all_unread_notifications_count"] = Self.intValue(user["all_unread_notifications_count"], fallback: unread)
        if user["can_use_templates"] != nil {
            cached["can_use_templates"] = Self.boolValue(user["can_use_templates"])
        }
        guard let data = try? JSONSerialization.data(withJSONObject: cached, options: []),
              let text = String(data: data, encoding: .utf8) else { return }
        sessionCacheDefaults().set(text, forKey: Self.sessionCacheKeyLastUser)
    }

    private func cachedSessionUser() -> [String: Any]? {
        guard let value = sessionCacheDefaults().string(forKey: Self.sessionCacheKeyLastUser),
              !value.isEmpty,
              let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data, options: []),
              let user = object as? [String: Any] else {
            return nil
        }
        return Self.stringValue(user["username"]).isEmpty ? nil : user
    }

    private func clearCachedSessionUser() {
        sessionCacheDefaults().removeObject(forKey: Self.sessionCacheKeyLastUser)
    }

    /// 等价 Java `userObject`：键名与 JS `LinuxDoUser` 逐字一致。
    private func userObject(_ user: [String: Any]) -> [String: Any] {
        var current: [String: Any] = [:]
        current["id"] = Self.intValue(user["id"])
        current["username"] = Self.stringValue(user["username"])
        current["name"] = Self.stringValue(user["name"])
        current["avatarTemplate"] = Self.avatarUrl(Self.stringValue(user["avatar_template"]))
        current["trustLevel"] = Self.intValue(user["trust_level"])
        current["unreadNotifications"] = Self.intValue(user["unread_notifications"])
        let unread = Self.intValue(user["unread_notifications"])
        current["allUnreadNotificationsCount"] = Self.intValue(
            user["all_unread_notifications_count"],
            fallback: unread
        )
        if user["can_use_templates"] != nil {
            current["canUseTemplates"] = Self.boolValue(user["can_use_templates"])
        }
        return current
    }

    private static func avatarUrl(_ template: String) -> String {
        if template.isEmpty { return "" }
        return origin + template.replacingOccurrences(of: "{size}", with: "96")
    }

    // MARK: - 快照

    private func collectSnapshot(call: CAPPluginCall, finishDialog: Bool) {
        if probing {
            // Java：probing.compareAndSet(false, true) 失败时用缓存用户兜底。
            let cached = cachedSessionUser()
            resolveSnapshot(
                call: call,
                finishDialog: finishDialog,
                cookie: "",
                userAgent: currentUserAgent(),
                user: cached
            )
            return
        }
        probing = true

        readCookieHeader(origin: Self.origin) { [weak self] cookie in
            guard let self else { return }
            let userAgent = self.currentUserAgent()
            var request = URLRequest(url: URL(string: Self.sessionURL)!)
            request.httpMethod = "GET"
            request.timeoutInterval = Self.identityReadTimeout
            request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
            request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
            if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            if !userAgent.isEmpty { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }

            let task = self.sharedIdentitySession().dataTask(with: request) { data, response, error in
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                var user: [String: Any]?
                // Java：`response.isSuccessful()` = 2xx。
                let successful = (200...299).contains(status)
                var definitiveLogout = status == 401
                var parsed = false
                if error == nil, successful, !text.isEmpty {
                    if let root = Self.jsonObject(text) {
                        parsed = true
                        user = root["current_user"] as? [String: Any]
                        if user == nil, let fallback = root["user"] as? [String: Any] { user = fallback }
                        if user == nil, root["current_user"] != nil || root["user"] != nil {
                            definitiveLogout = true
                        }
                    }
                }

                DispatchQueue.main.async {
                    var resolved = user
                    if resolved == nil {
                        if definitiveLogout {
                            self.clearCachedSessionUser()
                        } else if !parsed || !successful {
                            resolved = self.cachedSessionUser()
                        }
                    }
                    self.probing = false
                    self.resolveSnapshot(
                        call: call,
                        finishDialog: finishDialog,
                        cookie: cookie,
                        userAgent: userAgent,
                        user: resolved
                    )
                }
            }
            task.resume()
        }
    }

    private func resolveSnapshot(
        call: CAPPluginCall,
        finishDialog: Bool,
        cookie: String,
        userAgent: String,
        user: [String: Any]?
    ) {
        let userApiExchange = readPendingUserApiCall() === call
        let credential = pendingOtpCredential
        if let user { cacheSessionUser(user) }
        if finishDialog, user != nil {
            withRecovery { recovery in recovery.cancel() }
            writePreferBrowserTransport(true)
        }
        if userApiExchange, user == nil {
            writePendingUserApiCall(nil)
            pendingOtpCredential = nil
            exchangingOtp = false
            userApiAuth?.clearCredential()
            call.reject("Linux.do 授权已完成，但一次性会话兑换失败，请重试", "LINUXDO_USER_API_OTP")
            finishDialogNow()
            return
        }

        var result: [String: Any] = [:]
        result["authenticated"] = user != nil
        result["authMode"] = user != nil ? "browser-session" : "none"
        result["userAgent"] = userAgent
        if let user { result["currentUser"] = userObject(user) }

        if userApiExchange {
            writePendingUserApiCall(nil)
            pendingOtpCredential = nil
            exchangingOtp = false
            if let credential { burnUserApiCredential(credential) }
            call.resolve(result)
            finishDialogNow()
        } else if finishDialog, readPendingCall() === call {
            writePendingCall(nil)
            call.resolve(result)
            finishDialogNow()
        } else {
            call.resolve(result)
        }
    }

    // MARK: - 登录 / 验证 WebView

    /// 等价 Java `openDialog(String)`。
    private func openDialog(initialUrl: URL, otpExchange: Bool) {
        let hasPendingCall = readPendingCall() != nil
        let hasOtpExchange = readPendingUserApiCall() != nil && pendingOtpCredential != nil
        guard hasPendingCall || hasOtpExchange else {
            rejectPending(code: "LINUXDO_SESSION_UNAVAILABLE", message: "当前 Activity 无法打开 Linux.do 验证页")
            return
        }
        guard let host = presenterViewController(), !host.isBeingDismissed, !host.isMovingFromParent else {
            rejectPending(code: "LINUXDO_SESSION_UNAVAILABLE", message: "当前 Activity 无法打开 Linux.do 验证页")
            return
        }
        guard host.presentedViewController == nil else {
            rejectPending(code: "LINUXDO_SESSION_UNAVAILABLE", message: "当前 Activity 无法打开 Linux.do 验证页")
            return
        }

        let controller = LinuxDoSessionViewController(initialURL: initialUrl, otpExchange: otpExchange)
        controller.onPageFinished = { [weak self] webView, url in
            guard let self else { return }
            if otpExchange {
                self.handleOtpPageFinished(webView: webView, value: url)
            } else if let components = URLComponents(string: url),
                      components.path == "/session/current.json",
                      components.queryItems?.contains(where: { $0.name == "newsnook_snapshot" && $0.value == "1" }) == true {
                self.collectWebViewSnapshot(webView: webView, call: self.readPendingCall(), finishDialog: true)
            }
        }
        controller.onCloseRequested = { [weak self] in
            self?.cancelPending()
        }
        controller.onDismissed = { [weak self] in
            guard let self else { return }
            self.destroySessionWebView()
            self.sessionController = nil
            if !self.readFinishing(), self.readPendingCall() != nil || self.readPendingUserApiCall() != nil {
                self.cancelPending()
            }
        }

        sessionController = controller
        sessionWebView = controller.webView

        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .fullScreen
        host.present(navigation, animated: true)

        if otpExchange {
            let otpCall = readPendingUserApiCall()
            let watchdog = DispatchWorkItem { [weak self] in
                guard let self else { return }
                guard let otpCall,
                      self.readPendingUserApiCall() === otpCall,
                      self.pendingOtpCredential != nil,
                      self.sessionWebView === controller.webView else { return }
                self.writePendingUserApiCall(nil)
                self.pendingOtpCredential = nil
                self.exchangingOtp = false
                self.userApiAuth?.clearCredential()
                otpCall.reject(
                    "Linux.do 安全会话建立超时，请重新授权；若出现 Cloudflare 验证请先完成验证",
                    "LINUXDO_USER_API_OTP_TIMEOUT"
                )
                self.finishDialogNow()
            }
            otpWatchdog = watchdog
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.otpExchangeTimeout, execute: watchdog)
        }
    }

    /// 等价 Java `handleOtpPageFinished`。
    ///
    /// 与 Android 的差异：Android 用 `document.body.innerText` 读 CSRF，因为它
    /// 把 JSON 文档渲染成 `<pre>`。iOS 的 WKWebView 对 `application/json` 响应
    /// 会走「原生 JSON 预览」渲染，`innerText` 不保证包含正文，因此这里改为在
    /// 同一文档内 `fetch('/session/csrf.json')` 取 CSRF —— 语义相同（同一 Cookie
    /// 会话、同一 Cloudflare 挑战通道），但读取路径不依赖渲染细节。见 port spec §3。
    private func handleOtpPageFinished(webView: WKWebView, value: String) {
        guard let call = readPendingUserApiCall(), let credential = pendingOtpCredential else { return }
        guard let components = URLComponents(string: value) else { return }
        guard components.host?.lowercased() == "linux.do" else { return }
        let path = components.path
        if path == "/session/current.json",
           components.queryItems?.contains(where: { $0.name == "newsnook_otp" && $0.value == "1" }) == true {
            flushCookies()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self, weak webView] in
                guard let self, let webView else { return }
                self.collectWebViewSnapshot(webView: webView, call: call, finishDialog: true)
            }
            return
        }
        guard path == "/session/csrf" || path == "/session/csrf.json" else { return }
        guard !exchangingOtp else { return }

        webView.evaluateJavaScript(Self.otpCsrfProbeScript) { [weak self, weak webView] value, _ in
            guard let self, let webView else { return }
            // 回调可能不在主线程；先解析出纯 Swift 值再入主队列。
            let csrf = Self.stringValue(value).trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async {
                guard !csrf.isEmpty else {
                    // Cloudflare 挑战页预期不是 JSON。保持可见让用户完成挑战；
                    // 成功后同一个 .json URL 会重新加载并再次进入本处理函数。
                    // openDialog 安装的看门狗保证不会永久转圈。
                    return
                }
                guard !self.exchangingOtp else { return }
                self.exchangingOtp = true
                let script = Self.otpExchangeScript(
                    oneTimePassword: credential.oneTimePassword,
                    csrf: csrf
                )
                webView.evaluateJavaScript(script) { _, _ in }
            }
        }
    }

    /// 等价 Java `collectWebViewSnapshot`。
    private func collectWebViewSnapshot(webView: WKWebView, call: CAPPluginCall?, finishDialog: Bool) {
        guard let call else { return }
        webView.evaluateJavaScript("document.body ? document.body.innerText : ''") { [weak self, weak webView] value, _ in
            let text = Self.stringValue(value)
            var user: [String: Any]?
            if !text.isEmpty, let root = Self.jsonObject(text) {
                user = root["current_user"] as? [String: Any]
                if user == nil { user = root["user"] as? [String: Any] }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                let finalUser = user
                if finalUser == nil, finishDialog, !(self.readPendingUserApiCall() === call) {
                    self.clearCachedSessionUser()
                }
                let userAgent = self.currentUserAgent()
                self.readCookieHeader(origin: Self.origin) { [weak self] cookie in
                    guard let self else { return }
                    self.resolveSnapshot(
                        call: call,
                        finishDialog: finishDialog,
                        cookie: cookie,
                        userAgent: userAgent,
                        user: finalUser
                    )
                }
            }
        }
    }

    /// 等价 Java `finishDialog`：`finishing` 置位期间收掉窗口，
    /// 避免 dismiss 回调把挂起的 call 当成「用户取消」。
    private func finishDialogNow() {
        writeFinishing(true)
        dismissSessionDialog()
        writeFinishing(false)
    }

    private func dismissSessionDialog() {
        guard let controller = sessionController else { return }
        let presented = controller.navigationController ?? controller
        guard presented.presentingViewController != nil else { return }
        presented.dismiss(animated: true)
    }

    private func destroySessionWebView() {
        otpWatchdog?.cancel()
        otpWatchdog = nil
        let view = sessionWebView
        sessionWebView = nil
        exchangingOtp = false
        guard let view else { return }
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.removeFromSuperview()
        view.load(URLRequest(url: URL(string: "about:blank")!))
    }

    /// 等价 Java `cancelPending`。
    private func cancelPending() {
        if let pending = readPendingCall() {
            pending.reject("已取消 Linux.do 登录/验证", "LINUXDO_SESSION_CANCELLED")
            writePendingCall(nil)
        }
        if let pending = readPendingUserApiCall() {
            pending.reject("已取消 Linux.do 登录", LinuxDoUserApiAuth.errorCancelled)
            writePendingUserApiCall(nil)
            pendingOtpCredential = nil
            exchangingOtp = false
            userApiAuth?.cancel()
            userApiAuth?.clearCredential()
        }
        dismissSessionDialog()
    }

    /// 等价 Java `rejectPending`。
    private func rejectPending(code: String, message: String) {
        if let call = readPendingCall() {
            writePendingCall(nil)
            call.reject(message, code)
        }
        if let call = readPendingUserApiCall() {
            writePendingUserApiCall(nil)
            pendingOtpCredential = nil
            exchangingOtp = false
            call.reject(message, code)
        }
    }

    private func handleAppWillTerminate() {
        // 对齐 Java `handleOnDestroy()`：取消在途上传并删除暂存文件。
        cleanupAllUploads()
        userApiAuth?.destroy()
        if let pending = readPendingCall() {
            pending.reject("应用正在关闭", "LINUXDO_SESSION_DESTROYED")
            writePendingCall(nil)
        }
        if let pending = readPendingUserApiCall() {
            pending.reject("应用正在关闭", LinuxDoUserApiAuth.errorCancelled)
            writePendingUserApiCall(nil)
        }
        dismissSessionDialog()
        destroySessionWebView()
        destroyBrowserTransport(reason: "应用正在关闭")
        withRecovery { recovery in recovery.cancel() }
        detachRecoveryWebView()
        sessionController = nil
    }

    /// 把恢复器用的 WKWebView 从视图层级摘掉并停止加载。
    private func detachRecoveryWebView() {
        guard let view = pendingRecoveryWebView else { return }
        pendingRecoveryWebView = nil
        view.stopLoading()
        view.navigationDelegate = nil
        view.removeFromSuperview()
    }

    // MARK: - Connect 信任页

    /// 等价 Java `performConnectTrustRequest`：不跟随重定向，手工逐跳校验目标域名。
    private func performConnectTrustRequest(call: CAPPluginCall, url: String, redirectCount: Int) {
        guard Self.isConnectTrustAllowedUrl(url) else {
            call.reject("Connect 跳转到了非 Linux.do 第一方地址", "LINUXDO_CONNECT_URL")
            return
        }
        guard redirectCount <= Self.connectMaxRedirects else {
            call.reject("Connect 登录跳转次数过多", "LINUXDO_CONNECT_REDIRECT")
            return
        }

        readCookieHeader(origin: Self.origin) { [weak self] cookie in
            guard let self, let target = URL(string: url) else {
                call.reject("Connect 网络请求失败", "LINUXDO_CONNECT_NETWORK")
                return
            }
            let userAgent = self.currentUserAgent()
            var request = URLRequest(url: target)
            request.httpMethod = "GET"
            request.timeoutInterval = Self.identityReadTimeout
            request.setValue(
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                forHTTPHeaderField: "Accept"
            )
            request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            request.setValue(Self.connectOrigin + "/", forHTTPHeaderField: "Referer")
            if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            if !userAgent.isEmpty { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }

            let task = self.sharedIdentitySession().dataTask(with: request) { data, response, error in
                guard error == nil, let http = response as? HTTPURLResponse else {
                    DispatchQueue.main.async {
                        call.reject("Connect 网络请求失败", "LINUXDO_CONNECT_NETWORK")
                    }
                    return
                }
                let status = http.statusCode
                let setCookies = Self.setCookieHeaders(from: http)
                let location = http.value(forHTTPHeaderField: "Location") ?? ""
                let finalUrl = http.url?.absoluteString ?? url
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let headers = Self.safeResponseHeaders(http)

                DispatchQueue.main.async {
                    self.commitResponseCookies(setCookies: setCookies, responseURL: http.url) {
                        if Self.isRedirectStatus(status), !location.isEmpty {
                            guard let base = URL(string: finalUrl),
                                  let next = URL(string: location, relativeTo: base)?.absoluteURL,
                                  Self.isConnectTrustAllowedUrl(next.absoluteString) else {
                                call.reject("Connect 返回了不受信任的跳转地址", "LINUXDO_CONNECT_REDIRECT_URL")
                                return
                            }
                            self.performConnectTrustRequest(
                                call: call,
                                url: next.absoluteString,
                                redirectCount: redirectCount + 1
                            )
                            return
                        }
                        var result: [String: Any] = [:]
                        result["status"] = status
                        result["data"] = text
                        result["finalUrl"] = finalUrl
                        result["headers"] = headers
                        call.resolve(result)
                    } failed: {
                        // Android 在跳转分支不会因为 Cookie 写失败而中断；这里同样只在
                        // 非跳转的最终响应上把 Cookie 同步失败当成错误。
                        if Self.isRedirectStatus(status), !location.isEmpty {
                            guard let base = URL(string: finalUrl),
                                  let next = URL(string: location, relativeTo: base)?.absoluteURL,
                                  Self.isConnectTrustAllowedUrl(next.absoluteString) else {
                                call.reject("Connect 返回了不受信任的跳转地址", "LINUXDO_CONNECT_REDIRECT_URL")
                                return
                            }
                            self.performConnectTrustRequest(
                                call: call,
                                url: next.absoluteString,
                                redirectCount: redirectCount + 1
                            )
                            return
                        }
                        call.reject("Connect 网络请求失败", "LINUXDO_CONNECT_NETWORK")
                    }
                }
            }
            task.resume()
        }
    }

    private static func isRedirectStatus(_ status: Int) -> Bool {
        status == 301 || status == 302 || status == 303 || status == 307 || status == 308
    }

    private static func isConnectTrustAllowedUrl(_ value: String) -> Bool {
        guard !value.isEmpty, let components = URLComponents(string: value) else { return false }
        guard components.scheme?.lowercased() == "https" else { return false }
        guard let host = components.host?.lowercased(), !host.isEmpty else { return false }
        return host == "linux.do" || host == "connect.linux.do"
    }

    // MARK: - 原生请求（URLSession 取代 OkHttp）

    private func performNativeRequest(
        call: CAPPluginCall,
        url: String,
        method: String,
        requestHeaders: [String: String],
        body: String
    ) {
        readCookieHeader(origin: Self.origin) { [weak self] cookie in
            guard let self, let target = URL(string: url) else {
                call.reject("Linux.do 网络请求失败", "LINUXDO_REQUEST_NETWORK")
                return
            }
            let userAgent = self.currentUserAgent()

            var request = URLRequest(url: target)
            request.httpMethod = method
            request.timeoutInterval = Self.identityReadTimeout
            for (key, value) in requestHeaders {
                if key.caseInsensitiveCompare("Cookie") == .orderedSame { continue }
                if key.caseInsensitiveCompare("User-Agent") == .orderedSame { continue }
                if value.isEmpty { continue }
                request.setValue(value, forHTTPHeaderField: key)
            }
            if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            if !userAgent.isEmpty { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
            if method != "GET" {
                // Java 默认 `application/x-www-form-urlencoded; charset=UTF-8`。
                let contentType = Self.headerValue(requestHeaders, name: "Content-Type")
                    ?? "application/x-www-form-urlencoded; charset=UTF-8"
                request.setValue(contentType, forHTTPHeaderField: "Content-Type")
                request.httpBody = body.data(using: .utf8)
            }

            let task = self.sharedIdentitySession().dataTask(with: request) { data, response, error in
                guard error == nil, let http = response as? HTTPURLResponse else {
                    DispatchQueue.main.async {
                        call.reject("Linux.do 网络请求失败", "LINUXDO_REQUEST_NETWORK")
                    }
                    return
                }
                let status = http.statusCode
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let responseHeaders = Self.safeResponseHeaders(http)
                let setCookies = Self.setCookieHeaders(from: http)

                DispatchQueue.main.async {
                    // 特别是：在匹配的会话 Cookie 被 Cookie 存储确认之前，
                    // 绝不把 CSRF token 交给 JS。
                    self.commitResponseCookies(setCookies: setCookies, responseURL: http.url) {
                        if !Self.isCloudflareChallenge(status: status, body: text, headers: responseHeaders) {
                            self.resolveRequest(call: call, status: status, data: text, headers: responseHeaders)
                            return
                        }
                        self.performBrowserRequest(
                            url: url,
                            method: method,
                            requestHeaders: requestHeaders,
                            body: body,
                            onSuccess: { [weak self] browserResponse in
                                guard let self else { return }
                                if !Self.isCloudflareChallenge(
                                    status: browserResponse.status,
                                    body: browserResponse.data,
                                    headers: browserResponse.headers
                                ) {
                                    self.writePreferBrowserTransport(true)
                                }
                                // 保留真实的回落结果，而不是最初的 native 403，
                                // 否则诊断会指向错误的跳。
                                self.resolveBrowserRequest(call: call, response: browserResponse)
                            },
                            onFailure: { [weak self] _ in
                                self?.resolveRequest(
                                    call: call,
                                    status: status,
                                    data: text,
                                    headers: responseHeaders
                                )
                            }
                        )
                    } failed: {
                        call.reject("Linux.do 会话 Cookie 同步失败", "LINUXDO_COOKIE_SYNC")
                    }
                }
            }
            task.resume()
        }
    }

    private func resolveRequest(call: CAPPluginCall, status: Int, data: String, headers: [String: String]) {
        var result: [String: Any] = [:]
        result["status"] = status
        result["data"] = data
        result["headers"] = headers
        result["transport"] = "native"
        call.resolve(result)
    }

    private func resolveBrowserRequest(call: CAPPluginCall, response: BrowserFetchResponse) {
        var result: [String: Any] = [:]
        result["status"] = response.status
        result["data"] = response.data
        result["headers"] = response.headers
        result["transport"] = response.transport
        result["responseUrl"] = response.responseUrl
        call.resolve(result)
    }

    /// 等价 Java `safeResponseUrl`：去掉 query 与 fragment。
    private static func safeResponseUrl(_ url: String) -> String {
        guard var components = URLComponents(string: url) else { return "" }
        components.query = nil
        components.fragment = nil
        return components.string ?? ""
    }

    /// 等价 Java `safeResponseHeaders`：跳过 Set-Cookie / Set-Cookie2。
    private static func safeResponseHeaders(_ response: HTTPURLResponse) -> [String: String] {
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            let name = String(describing: key)
            if name.caseInsensitiveCompare("Set-Cookie") == .orderedSame { continue }
            if name.caseInsensitiveCompare("Set-Cookie2") == .orderedSame { continue }
            headers[name] = String(describing: value)
        }
        return headers
    }

    /// URLSession 会把多条 `Set-Cookie` 折进 `allHeaderFields`，按 `, ` 拼接会破坏
    /// `Expires=Wed, 09 Jun ...`。优先走 `value(forHTTPHeaderField:)`，拿不到再用
    /// 已知的 `Expires=` 启发式切分（对齐 Android 的 `response.headers("Set-Cookie")`）。
    private static func setCookieHeaders(from response: HTTPURLResponse) -> [String] {
        if let raw = response.value(forHTTPHeaderField: "Set-Cookie") {
            if let split = splitCombinedSetCookie(raw) { return split }
            return raw.isEmpty ? [] : [raw]
        }
        for (key, value) in response.allHeaderFields where String(describing: key).caseInsensitiveCompare("Set-Cookie") == .orderedSame {
            let text = String(describing: value)
            return text.isEmpty ? [] : [text]
        }
        return []
    }

    private static func splitCombinedSetCookie(_ raw: String) -> [String]? {
        var parts: [String] = []
        var current = ""
        var index = raw.startIndex
        while index < raw.endIndex {
            if raw[index] == "," {
                let rest = raw[raw.index(after: index)...]
                let tail = rest.trimmingCharacters(in: .whitespaces)
                let looksLikeCookie = tail.contains("=")
                    && !tail.lowercased().hasPrefix("expires")
                    && !tail.lowercased().hasPrefix("max-age")
                    && !tail.lowercased().hasPrefix("path")
                    && !tail.lowercased().hasPrefix("domain")
                    && !tail.lowercased().hasPrefix("samesite")
                if looksLikeCookie {
                    parts.append(current.trimmingCharacters(in: .whitespaces))
                    current = ""
                    index = raw.index(after: index)
                    continue
                }
            }
            current.append(raw[index])
            index = raw.index(after: index)
        }
        if !current.trimmingCharacters(in: .whitespaces).isEmpty {
            parts.append(current.trimmingCharacters(in: .whitespaces))
        }
        guard parts.count > 1 else { return nil }
        guard parts.allSatisfy({ $0.contains("=") }) else { return nil }
        return parts
    }

    /// 等价 Java `isCloudflareChallenge`。
    private static func isCloudflareChallenge(status: Int, body: String, headers: [String: String]) -> Bool {
        if status != 403 && status != 429 && status != 503 { return false }
        let mitigated = headerIgnoreCase(headers, target: "cf-mitigated").lowercased()
        if mitigated.contains("challenge") { return true }

        var sample = body
        if sample.count > 128 * 1024 { sample = String(sample.prefix(128 * 1024)) }
        let lower = sample.lowercased()
        let marker = lower.contains("cf_chl_opt")
            || lower.contains("/cdn-cgi/challenge-platform")
            || lower.contains("cf-chl-")
            || lower.contains("challenge-form")
            || lower.contains("cf-turnstile")
            || lower.contains("<title>just a moment")
            || lower.contains("enable javascript and cookies to continue")
            || lower.contains("performing security verification")
        if !marker { return false }

        let server = headerIgnoreCase(headers, target: "server").lowercased()
        return server.contains("cloudflare")
            || !headerIgnoreCase(headers, target: "cf-ray").isEmpty
            || lower.contains("cloudflare")
            || lower.contains("cdn-cgi")
    }

    private static func headerIgnoreCase(_ headers: [String: String], target: String) -> String {
        for (key, value) in headers where key.caseInsensitiveCompare(target) == .orderedSame {
            return value
        }
        return ""
    }

    // MARK: - 浏览器传输

    /// 等价 Java `performBrowserRequest`。
    private func performBrowserRequest(
        url: String,
        method: String,
        requestHeaders: [String: String],
        body: String,
        onSuccess: @escaping (BrowserFetchResponse) -> Void,
        onFailure: @escaping (String) -> Void
    ) {
        guard Self.isApiAllowedUrl(url) else {
            onFailure("浏览器传输仅允许 linux.do 主站")
            return
        }

        // 这里只判空：真正的 `recovery` 由下面的 `withRecovery` 闭包给出，
        // 写成 `if let recovery` 会与闭包参数同名、且外层那个从没被用到。
        if browserSessionRecovery != nil {
            withRecovery { recovery in
                // 只有 `canRequest` 放行的三个第一方端点才走恢复文档，
                // 保证 CSRF token 与重试写入留在同一个第一方文档里。
                guard recovery.canRequest(url) else {
                    self.performBrowserTransportRequest(
                        url: url,
                        method: method,
                        requestHeaders: requestHeaders,
                        body: body,
                        onSuccess: onSuccess,
                        onFailure: onFailure
                    )
                    return
                }
                recovery.request(
                    url: url,
                    method: method,
                    headers: self.browserSafeRequestHeaders(requestHeaders),
                    body: body
                ) { result in
                    if let error = result["error"] as? String {
                        onFailure(error.isEmpty ? "Linux.do 浏览器请求失败" : error)
                        return
                    }
                    var headers: [String: String] = [:]
                    if let received = result["headers"] as? [String: Any] {
                        for (key, value) in received {
                            if key.caseInsensitiveCompare("set-cookie") == .orderedSame { continue }
                            if key.caseInsensitiveCompare("set-cookie2") == .orderedSame { continue }
                            headers[key] = Self.stringValue(value)
                        }
                    }
                    let status = Self.intValue(result["status"])
                    // 与隐藏传输一致：3xx 不把跳转页正文当响应交给 JS。
                    let responseBody = Self.isRedirectStatus(status) ? "" : Self.stringValue(result["data"])
                    onSuccess(BrowserFetchResponse(
                        status: status,
                        data: responseBody,
                        headers: headers,
                        responseUrl: Self.safeResponseUrl(Self.stringValue(result["responseUrl"])),
                        transport: "browser-firstparty"
                    ))
                }
            }
            return
        }

        performBrowserTransportRequest(
            url: url,
            method: method,
            requestHeaders: requestHeaders,
            body: body,
            onSuccess: onSuccess,
            onFailure: onFailure
        )
    }

    /// 隐藏传输通道（恢复文档不可用时使用）。
    /// `binary = true` 时脚本返回 data URL 字符串而不是正文文本（供 `fetchMedia` 取图片字节）。
    private func performBrowserTransportRequest(
        url: String,
        method: String,
        requestHeaders: [String: String],
        body: String,
        binary: Bool = false,
        onSuccess: @escaping (BrowserFetchResponse) -> Void,
        onFailure: @escaping (String) -> Void
    ) {
        ensureBrowserTransport { [weak self] webView, failureMessage in
            guard let self else { return }
            guard let webView else {
                onFailure(failureMessage ?? "无法建立 Linux.do 浏览器网络通道")
                return
            }
            let requestId = UUID().uuidString
            let pending = PendingBrowserFetch(callback: { response, message in
                if let response {
                    onSuccess(response)
                } else {
                    onFailure(message ?? "Linux.do 浏览器请求失败")
                }
            })
            self.browserFetches[requestId] = pending
            let timeout = DispatchWorkItem { [weak self] in
                guard let self else { return }
                guard self.browserFetches.removeValue(forKey: requestId) === pending else { return }
                pending.callback(nil, "Linux.do 浏览器请求超时")
            }
            pending.timeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.browserRequestTimeout, execute: timeout)

            let headers = self.browserSafeRequestHeaders(requestHeaders)
            guard let script = Self.browserFetchScript(
                requestId: requestId,
                url: url,
                method: method,
                headers: headers,
                body: method == "GET" ? nil : body,
                binary: binary
            ) else {
                self.browserFetches.removeValue(forKey: requestId)
                timeout.cancel()
                onFailure("无法启动 Linux.do 浏览器网络请求")
                return
            }
            webView.evaluateJavaScript(script) { _, error in
                guard error != nil else { return }
                DispatchQueue.main.async {
                    guard self.browserFetches.removeValue(forKey: requestId) === pending else { return }
                    timeout.cancel()
                    onFailure("无法启动 Linux.do 浏览器网络请求")
                }
            }
        }
    }

    /// 等价 Java `browserSafeRequestHeaders`。
    private func browserSafeRequestHeaders(_ requestHeaders: [String: String]) -> [String: String] {
        var headers: [String: String] = [:]
        for (key, value) in requestHeaders {
            if Self.isForbiddenBrowserHeader(key) { continue }
            if value.isEmpty { continue }
            headers[key] = value
        }
        return headers
    }

    /// 等价 Java `isForbiddenBrowserHeader`。
    private static func isForbiddenBrowserHeader(_ name: String) -> Bool {
        switch name.lowercased() {
        case "accept-charset", "accept-encoding", "connection", "content-length", "cookie",
             "cookie2", "date", "dnt", "expect", "host", "keep-alive", "origin", "referer",
             "te", "trailer", "transfer-encoding", "upgrade", "user-agent", "via":
            return true
        default:
            return false
        }
    }

    /// 等价 Java `ensureBrowserTransport`。
    private func ensureBrowserTransport(_ completion: @escaping (WKWebView?, String?) -> Void) {
        guard let presenter = presenterViewController(), !presenter.isBeingDismissed, !presenter.isMovingFromParent else {
            completion(nil, "当前 Activity 无法建立浏览器网络通道")
            return
        }
        if let existing = browserTransportWebView, browserTransportReady {
            completion(existing, nil)
            return
        }
        browserTransportWaiters.append(completion)
        if browserTransportInitializing { return }
        browserTransportInitializing = true

        let configuration = WKWebViewConfiguration()
        // 与 Capacitor 宿主 WebView 共享 Cookie / 进程池。
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isUserInteractionEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        webView.configuration.userContentController.add(self, name: Self.browserBridgeName)
        browserTransportWebView = webView
        browserTransportReady = false
        presenter.view.addSubview(webView)

        let timeout = DispatchWorkItem { [weak self, weak webView] in
            guard let self, let webView else { return }
            guard webView === self.browserTransportWebView, !self.browserTransportReady else { return }
            self.failBrowserTransportInitialization("建立 Linux.do 浏览器网络通道超时")
        }
        browserTransportTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.browserTransportTimeout, execute: timeout)

        // 同源 bootstrap：让 fetch() 拿到真实浏览器网络身份与同一份会话 Cookie，
        // 同时不把任意站点内容/脚本带进这个隐藏传输 WebView。
        // iOS 没有 `loadDataWithBaseURL`：用空响应 + baseURL 的 `loadHTMLString`
        // 等价（文档 origin 仍是 https://linux.do）。
        webView.loadHTMLString(
            "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
            baseURL: URL(string: Self.origin + "/")
        )
    }

    /// 等价 Java `failBrowserTransportInitialization`。
    private func failBrowserTransportInitialization(_ message: String) {
        browserTransportInitializing = false
        browserTransportReady = false
        browserTransportTimeout?.cancel()
        browserTransportTimeout = nil
        let failed = browserTransportWebView
        browserTransportWebView = nil
        if let failed {
            failed.stopLoading()
            failed.navigationDelegate = nil
            failed.configuration.userContentController.removeScriptMessageHandler(forName: Self.browserBridgeName)
            failed.removeFromSuperview()
            failed.load(URLRequest(url: URL(string: "about:blank")!))
        }
        let waiters = browserTransportWaiters
        browserTransportWaiters.removeAll()
        for waiter in waiters { waiter(nil, message) }
    }

    /// 等价 Java `destroyBrowserTransport`。
    private func destroyBrowserTransport(reason: String) {
        writePreferBrowserTransport(false)
        browserTransportReady = false
        browserTransportInitializing = false
        browserTransportTimeout?.cancel()
        browserTransportTimeout = nil

        let pendings = browserFetches
        browserFetches.removeAll()
        for (_, pending) in pendings {
            pending.timeout?.cancel()
            pending.callback(nil, reason)
        }

        let waiters = browserTransportWaiters
        browserTransportWaiters.removeAll()
        for waiter in waiters { waiter(nil, reason) }

        let view = browserTransportWebView
        browserTransportWebView = nil
        guard let view else { return }
        view.stopLoading()
        view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: Self.browserBridgeName)
        // 远端页面里留下的 bridge 引用也要清掉（等价 removeJavascriptInterface）。
        view.evaluateJavaScript("try{window.\(Self.browserBridgeName)=null}catch(e){}") { _, _ in }
        view.removeFromSuperview()
        view.load(URLRequest(url: URL(string: "about:blank")!))
    }

    /// 处理隐藏传输 WebView 回传的消息（对应 Android `BrowserFetchBridge`）。
    private func handleBrowserFetchMessage(_ message: [String: Any]) {
        guard let requestId = message["id"] as? String,
              let pending = browserFetches[requestId],
              let kind = message["kind"] as? String else { return }

        switch kind {
        case "start":
            pending.started = true
            pending.status = Self.intValue(message["status"])
            pending.responseUrl = Self.safeResponseUrl(Self.stringValue(message["url"]))
            var headers: [String: String] = [:]
            if let json = Self.jsonObject(Self.stringValue(message["headers"])) {
                for (key, value) in json {
                    if key.caseInsensitiveCompare("set-cookie") == .orderedSame { continue }
                    if key.caseInsensitiveCompare("set-cookie2") == .orderedSame { continue }
                    headers[key] = Self.stringValue(value)
                }
            }
            pending.headers = headers

        case "chunk":
            guard !pending.overflow else { return }
            let chunk = Self.stringValue(message["data"])
            if chunk.isEmpty { return }
            if pending.body.count + chunk.count > Self.browserResponseMaxChars {
                pending.overflow = true
                pending.body = ""
                return
            }
            pending.body += chunk

        case "done":
            guard browserFetches.removeValue(forKey: requestId) === pending else { return }
            pending.timeout?.cancel()
            if pending.overflow {
                pending.callback(nil, "Linux.do 浏览器响应过大")
                return
            }
            guard pending.started else {
                pending.callback(nil, "Linux.do 浏览器请求失败")
                return
            }
            // iOS 没有 CookieManager.flush()：回读一次 httpCookieStore 当作落盘确认。
            flushCookies()
            let data = Self.isRedirectStatus(pending.status) ? "" : pending.body
            pending.callback(BrowserFetchResponse(
                status: pending.status,
                data: data,
                headers: pending.headers,
                responseUrl: pending.responseUrl
            ), nil)

        case "error":
            guard browserFetches.removeValue(forKey: requestId) === pending else { return }
            pending.timeout?.cancel()
            let raw = Self.stringValue(message["message"])
            pending.callback(nil, raw.isEmpty ? "浏览器网络请求失败" : raw)

        default:
            return
        }
    }

    /// 在隐藏传输 WebView 里执行的 fetch 脚本（等价 Java `performBrowserRequest` 内联脚本）。
    /// `binary` 为真时把响应体读成 data URL（base64），供原生侧还原图片字节。
    private static func browserFetchScript(
        requestId: String,
        url: String,
        method: String,
        headers: [String: String],
        body: String?,
        binary: Bool = false
    ) -> String? {
        guard let headersJson = jsonLiteral(headers) else { return nil }
        let bodyExpression = body.flatMap { jsonLiteral($0) } ?? "undefined"
        let payloadExpression = binary
            ? "response.blob().then(function(blob){return new Promise(function(resolve){var reader=new FileReader();reader.onload=function(){resolve(String(reader.result||''));};reader.onerror=function(){resolve('');};reader.readAsDataURL(blob);});})"
            : "response.text()"
        // 媒体允许跟随跳转（图片常被 301 到 CDN）；API 语义仍是不跟随，由调用方自己处理。
        let redirectMode = binary ? "'follow'" : "'manual'"
        return """
        (function(){
          const id=\(jsonLiteral(requestId) ?? "\"\"");
          const bridge=window.\(browserBridgeName);
          if(!bridge){return;}
          const headers=\(headersJson);
          const aborter=new AbortController();
          const deadline=setTimeout(function(){aborter.abort();},30000);
          fetch(\(jsonLiteral(url) ?? "\"\""),{method:\(jsonLiteral(method) ?? "\"GET\""),headers:headers,credentials:'include',signal:aborter.signal,redirect:\(redirectMode),cache:'no-store',body:\(bodyExpression)})
          .then(function(response){
            const h={};
            response.headers.forEach(function(v,k){h[k]=v;});
            bridge.postMessage({id:id,kind:'start',status:response.status,headers:JSON.stringify(h),url:response.url});
            if(response.status>=300&&response.status<400){clearTimeout(deadline);bridge.postMessage({id:id,kind:'done'});return null;}
            return \(payloadExpression);
          })
          .then(function(text){
            if(text===null||text===undefined){return;}
            const size=\(browserResponseChunkChars);
            for(let i=0;i<text.length;i+=size){bridge.postMessage({id:id,kind:'chunk',data:text.slice(i,i+size)});}
            clearTimeout(deadline);
            bridge.postMessage({id:id,kind:'done'});
          })
          .catch(function(error){clearTimeout(deadline);bridge.postMessage({id:id,kind:'error',message:String(error&&error.message||error||'fetch failed')});});
        })();
        """
    }

    /// 等价 Java `JSONObject.quote`：产出带引号、已转义的 JSON 字符串字面量。
    private static func jsonLiteral(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
              let text = String(data: data, encoding: .utf8),
              text.count >= 2 else { return nil }
        return String(text.dropFirst().dropLast())
    }

    /// 字典 → JSON 对象字面量：隐藏传输 WebView 的 fetch 脚本要把 headers 内联成 JS 对象。
    private static func jsonLiteral(_ value: [String: String]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }

    /// OTP 兑换前的 CSRF 探针（见 `handleOtpPageFinished` 的差异说明）。
    private static let otpCsrfProbeScript = """
    (function(){try{return fetch('/session/csrf.json',{credentials:'include',cache:'no-store',redirect:'error',headers:{'Accept':'application/json','X-Requested-With':'XMLHttpRequest'}}).then(function(r){if(!r.ok||r.headers.get('cf-mitigated')==='challenge'){return '';}return r.json();}).then(function(p){return (p&&typeof p.csrf==='string')?p.csrf.trim():'';}).catch(function(){return '';});}catch(e){return '';}})()
    """

    /// OTP 兑换脚本，逐字对齐 Java `handleOtpPageFinished` 里的内联脚本。
    private static func otpExchangeScript(oneTimePassword: String, csrf: String) -> String {
        let target = jsonLiteral("/session/otp/" + oneTimePassword) ?? "\"\""
        let token = jsonLiteral(csrf) ?? "\"\""
        return """
        (function(){
          var target=\(target);
          fetch(target,{method:'POST',credentials:'include',redirect:'follow',headers:{'Accept':'application/json, text/javascript, */*; q=0.01','X-CSRF-Token':\(token),'X-Requested-With':'XMLHttpRequest'}})
          .then(function(response){location.replace('/session/current.json?newsnook_otp=1&status='+encodeURIComponent(String(response.status)))})
          .catch(function(){location.replace('/session/current.json?newsnook_otp=1&status=0')});
        })()
        """
    }

    // MARK: - Cookie 读写

    /// 等价 Java `manager.getCookie(ORIGIN)`：域匹配 + 路径匹配 + 未过期。
    private func readCookieHeader(origin: String, completion: @escaping (String) -> Void) {
        guard let host = URL(string: origin)?.host else {
            DispatchQueue.main.async { completion("") }
            return
        }
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            var pairs: [(name: String, value: String)] = []
            for cookie in cookies where Self.cookieApplies(cookie, host: host, path: "/") {
                pairs.append((cookie.name, cookie.value))
            }
            let header = pairs.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
            DispatchQueue.main.async { completion(header) }
        }
    }

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

    /// 等价 Java `syncResponseCookies`：逐条写入 Cookie 存储，5s 超时算失败。
    ///
    /// iOS 与 Android 的差异：`WKHTTPCookieStore.setCookie` 不会用 URL 补全
    /// Domain/Path，所以先用 `normalizedSetCookie(_:responseURL:)` 补齐，
    /// 否则 host-only cookie 会被 `HTTPCookie(properties:)` 直接判为非法。
    private func commitResponseCookies(
        setCookies: [String],
        responseURL: URL?,
        completed: @escaping () -> Void,
        failed: @escaping () -> Void
    ) {
        guard !setCookies.isEmpty else {
            completed()
            return
        }
        let writer = LinuxDoHTTPCookieStoreWriter()
        var settled = false
        let timeout = DispatchWorkItem {
            guard !settled else { return }
            settled = true
            failed()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.cookieCommitTimeout, execute: timeout)
        let normalized = setCookies.map {
            LinuxDoHTTPCookieStoreWriter.normalizedSetCookie($0, responseURL: responseURL)
        }
        LinuxDoCookieCommit.commit(
            cookies: normalized,
            writer: writer,
            success: {
                guard !settled else { return }
                settled = true
                timeout.cancel()
                completed()
            },
            failure: {
                guard !settled else { return }
                settled = true
                timeout.cancel()
                failed()
            }
        )
    }

    /// 等价 Java `clearLinuxDoCookies`，但按域过滤而不是按名删除。
    /// `WKHTTPCookieStore` 只能逐条删除；Android 用 `Max-Age=0` 逐名清。
    private func clearLinuxDoCookies(completion: @escaping (Bool) -> Void) {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let targets = cookies.filter { Self.isLinuxDoCookieDomain($0.domain) }
            DispatchQueue.main.async {
                guard !targets.isEmpty else {
                    completion(true)
                    return
                }
                let store = WKWebsiteDataStore.default().httpCookieStore
                var remaining = targets.count
                for cookie in targets {
                    store.delete(cookie) {
                        DispatchQueue.main.async {
                            remaining -= 1
                            if remaining == 0 { completion(true) }
                        }
                    }
                }
            }
        }
    }

    private static func isLinuxDoCookieDomain(_ rawDomain: String) -> Bool {
        var domain = rawDomain.lowercased()
        if domain.hasPrefix(".") { domain = String(domain.dropFirst()) }
        return domain == "linux.do" || domain.hasSuffix(".linux.do")
    }

    /// iOS 没有 `CookieManager.flush()`；回读一次 httpCookieStore 让
    /// WKWebsiteDataStore 立刻处理待落盘的 Cookie。
    private func flushCookies() {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { _ in }
    }

    /// 同步取一次 Cookie 头（等价 Java `CookieManager.getCookie(ORIGIN)`）。
    ///
    /// 用 `HTTPCookieStorage.shared` 的同步读取：它与 WKWebView 共享同一份
    /// 应用级 Cookie 存储，且在 iOS 15 上是唯一公开的同步入口
    /// （`WKHTTPCookieStore` 只有异步 `getAllCookies`）。域/路径/过期判定
    /// 与 `readCookieHeader` 保持一致。
    private func syncCookieHeader(origin: String) -> String {
        guard let host = URL(string: origin)?.host else { return "" }
        let cookies = HTTPCookieStorage.shared.cookies ?? []
        var pairs: [(name: String, value: String)] = []
        for cookie in cookies where Self.cookieApplies(cookie, host: host, path: "/") {
            pairs.append((cookie.name, cookie.value))
        }
        return pairs.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    private func applyBrowserSessionHeaders(to request: inout URLRequest, forOrigin origin: String) {
        let userAgent = currentUserAgent()
        if !userAgent.isEmpty { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
        let cookie = syncCookieHeader(origin: origin)
        if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
    }

    // MARK: - URL 允许列表

    /// 等价 Java `isApiAllowedUrl`：只允许 `https://linux.do`（不含子域）。
    private static func isApiAllowedUrl(_ value: String) -> Bool {
        guard !value.isEmpty, let components = URLComponents(string: value) else { return false }
        return components.scheme?.lowercased() == "https"
            && components.host?.lowercased() == "linux.do"
    }

    /// 等价 Java `isAllowedUrl`：`https://linux.do` 及其任意子域。
    fileprivate static func isAllowedUrl(_ value: String) -> Bool {
        guard !value.isEmpty, let components = URLComponents(string: value) else { return false }
        guard components.scheme?.lowercased() == "https" else { return false }
        guard let host = components.host?.lowercased(), !host.isEmpty else { return false }
        return host == "linux.do" || host.hasSuffix(".linux.do")
    }

    /// `fetchMedia` 放行的主机：站点自身（`linux.do` 及子域）与站点 CDN（`*.ldstatic.com`）。
    /// 真机实测正文图会落在 CDN 主机上（与头像同族）：宿主 WebView 直连被热链/挑战挡下，
    /// 又不在 `linux.do` 名下，所以这条通道必须能覆盖 CDN，否则正文图无路可取。
    private static func isAllowedMediaUrl(_ value: String) -> Bool {
        guard !value.isEmpty, let components = URLComponents(string: value) else { return false }
        guard components.scheme?.lowercased() == "https" else { return false }
        guard let host = components.host?.lowercased(), !host.isEmpty else { return false }
        if host == "linux.do" || host.hasSuffix(".linux.do") { return true }
        return host == "ldstatic.com" || host.hasSuffix(".ldstatic.com")
    }

    // MARK: - 会话级 HTTP 客户端

    /// 与 OkHttp `identityClient` 对齐：不跟随重定向、不碰任何 Cookie 存储、
    /// 连接 15s / 读 30s。Cookie 由调用方显式给。
    private func sharedIdentitySession() -> URLSession {
        if let existing = identitySession { return existing }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = Self.identityConnectTimeout
        configuration.timeoutIntervalForResource = Self.identityReadTimeout
        let created = URLSession(
            configuration: configuration,
            delegate: identityRedirectBlocker,
            delegateQueue: nil
        )
        identitySession = created
        return created
    }

    // MARK: - 纯工具

    /// `CAPPluginCall.getObject` 返回 `JSObject?`，而 `JSObject = [String: JSValue]`
    /// （`JSValue` 是空协议），不能当 `[String: Any]?` 传，也不能桥接成 NSDictionary。
    /// 必须按动态类型逐项取值——与 `ProxiedHttpPlugin.swift` 同款做法。
    private static func stringDictionary(_ object: JSObject?) -> [String: String] {
        guard let object else { return [:] }
        var result: [String: String] = [:]
        for (name, value) in object {
            if let text = value as? String {
                result[name] = text
            } else if let number = value as? NSNumber {
                let double = number.doubleValue
                result[name] = double == double.rounded() ? String(number.intValue) : number.stringValue
            }
        }
        return result
    }

    /// 等价 Java `optString(key, "")`：数字/布尔也转成字符串，缺失返回空串。
    private static func stringValue(_ value: Any?) -> String {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    /// 等价 Java `optInt(key, fallback)`。
    private static func intValue(_ value: Any?, fallback: Int = 0) -> Int {
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String, let parsed = Int(text) { return parsed }
        return fallback
    }

    /// 等价 Java `optBoolean(key, false)`。
    private static func boolValue(_ value: Any?) -> Bool {
        if let flag = value as? Bool { return flag }
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String { return text == "true" || text == "1" }
        return false
    }

    private static func headerValue(_ headers: [String: String], name: String) -> String? {
        for (key, value) in headers where key.caseInsensitiveCompare(name) == .orderedSame {
            return value
        }
        return nil
    }

    private static func jsonObject(_ text: String) -> [String: Any]? {
        guard !text.isEmpty, let data = text.data(using: .utf8) else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }
        return object as? [String: Any]
    }
}

// MARK: - WKNavigationDelegate（隐藏传输通道）

extension LinuxDoSessionPlugin: WKNavigationDelegate {
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 等价 Android `onPageFinished` 里把 browserTransportReady 置位。
        guard webView === browserTransportWebView, !browserTransportReady else { return }
        browserTransportReady = true
        browserTransportInitializing = false
        browserTransportTimeout?.cancel()
        browserTransportTimeout = nil
        let waiters = browserTransportWaiters
        browserTransportWaiters.removeAll()
        for waiter in waiters { waiter(webView, nil) }
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // 等价 Android `shouldOverrideUrlLoading`：只允许留在 linux.do 第一方。
        guard webView === browserTransportWebView else {
            decisionHandler(.allow)
            return
        }
        guard navigationAction.targetFrame?.isMainFrame ?? false else {
            decisionHandler(.allow)
            return
        }
        let target = navigationAction.request.url?.absoluteString ?? ""
        decisionHandler(Self.isAllowedUrl(target) ? .allow : .cancel)
    }
}

// MARK: - WKScriptMessageHandler（隐藏传输通道的桥）

extension LinuxDoSessionPlugin: WKScriptMessageHandler {
    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.browserBridgeName else { return }
        guard let payload = message.body as? [String: Any] else { return }
        DispatchQueue.main.async { [weak self] in
            self?.handleBrowserFetchMessage(payload)
        }
    }
}

// MARK: - URLSessionTaskDelegate（上传网络进度）

/// 取代 Android 的 `UploadProgressRequestBody`（OkHttp 在 `writeTo` 里累计已写字节）。
/// iOS 用文件型上传体 + 这个委托回调拿真实网络进度。
///
/// 回调在 `uploadURLSession()` 的委托队列（后台）上触发，所以先切回主线程再读
/// `uploadSessions`、再 `notifyListeners`。
extension LinuxDoSessionPlugin: URLSessionTaskDelegate {

    /// 单位：`totalBytesSent` = 已发送的整个 multipart 请求体字节数；
    /// `totalBytesExpectedToSend` = 请求体总字节数（= `Content-Length`）。
    /// `notifyUploadProgress` 把它换算成 `progress = sentBytes / totalBytes`。
    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard let uploadTask = task as? URLSessionUploadTask,
              totalBytesExpectedToSend > 0 else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let entry = self.uploadSessions.first(where: { $0.value.task === uploadTask }) else { return }
            guard !entry.value.settled else { return }
            // 对齐 Java：整数百分比变化才上报（Java 另有一条 160ms 节流，iOS 省略）。
            let percent = Int((Double(totalBytesSent) / Double(totalBytesExpectedToSend) * 100).rounded())
            guard percent != entry.value.lastNotifiedPercent || percent == 100 else { return }
            entry.value.lastNotifiedPercent = percent
            self.notifyUploadProgress(
                uploadId: entry.key,
                sentBytes: totalBytesSent,
                totalBytes: totalBytesExpectedToSend
            )
        }
    }
}

// MARK: - 用户 API Key 授权回调

/// 把 `LinuxDoUserApiAuth.AuthCallback` 适配成闭包。
///
/// 必须被强引用：依赖类内部对 `activeCallback` 是强引用（弱引用会静默丢 `onPending`）。
private final class LinuxDoApiAuthCallback: LinuxDoUserApiAuth.AuthCallback {
    private let onSuccessHandler: (LinuxDoUserApiAuth.Credential) -> Void
    private let onFailureHandler: (String, String) -> Void

    init(
        onSuccess: @escaping (LinuxDoUserApiAuth.Credential) -> Void,
        onFailure: @escaping (String, String) -> Void
    ) {
        self.onSuccessHandler = onSuccess
        self.onFailureHandler = onFailure
    }

    /// Java 的 `onPending` 是空实现：Capacitor 的 call 一直挂起到授权成功或失败。
    func onPending(verificationUrl: String, expiresInSeconds: Int) {}

    func onSuccess(credential: LinuxDoUserApiAuth.Credential) {
        onSuccessHandler(credential)
    }

    func onFailure(code: String, message: String) {
        onFailureHandler(code, message)
    }
}

// MARK: - 登录 / 验证页容器

/// 受控的 Linux.do 登录 / 验证容器，对应 Android `openDialog` 里自绘的 Dialog + WebViewClient。
///
/// iOS 机制替换：
///   `Dialog` + 自绘 chrome → 全屏 `UINavigationController` + 原生导航栏
///   `WebView`              → `WKWebView`（`.default()` 数据存储，与 Capacitor 宿主共享 Cookie）
///   `shouldOverrideUrlLoading` → `decidePolicyFor navigationAction`
///   `onPageFinished`       → `webView(_:didFinish:)`
///   `KEYCODE_BACK` 回退     → WebView 自带边缘返回手势
final class LinuxDoSessionViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    var onPageFinished: ((WKWebView, String) -> Void)?
    var onCloseRequested: (() -> Void)?
    var onDismissed: (() -> Void)?

    let webView: WKWebView

    private let initialURL: URL
    private let otpExchange: Bool
    private let noticeLabel = UILabel()
    private var didReportDismissal = false

    init(initialURL: URL, otpExchange: Bool) {
        self.initialURL = initialURL
        self.otpExchange = otpExchange
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
        view.backgroundColor = UIColor(red: 14 / 255, green: 15 / 255, blue: 18 / 255, alpha: 1)
        // Java：otpExchange ? "Linux.do · 正在建立安全会话" : "Linux.do · 登录与安全验证"
        title = otpExchange ? "Linux.do · 正在建立安全会话" : "Linux.do · 登录与安全验证"
        navigationController?.navigationBar.barStyle = .black
        navigationController?.navigationBar.tintColor = .white

        let close = UIBarButtonItem(
            image: UIImage(systemName: "xmark"),
            style: .plain,
            target: self,
            action: #selector(handleClose)
        )
        close.accessibilityLabel = "关闭"
        navigationItem.leftBarButtonItem = close

        if !otpExchange {
            // Java 的「完成」按钮：加载带 newsnook_snapshot=1 的 current.json，
            // 由插件在 didFinish 时抓取快照。
            let done = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(handleDone))
            navigationItem.rightBarButtonItem = done
        }

        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 14 / 255, green: 15 / 255, blue: 18 / 255, alpha: 1)

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

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard !didReportDismissal else { return }
        // 只有真的被收起（而不是被别的页面盖住）才算「窗口已关闭」。
        guard isBeingDismissed
            || presentingViewController == nil
            || navigationController?.isBeingDismissed == true else { return }
        didReportDismissal = true
        onDismissed?()
    }

    /// 对齐 Android `destroyWebView()`。
    func detach() {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
        onPageFinished = nil
        onCloseRequested = nil
        onDismissed = nil
    }

    @objc private func handleClose() {
        onCloseRequested?()
    }

    @objc private func handleDone() {
        // Java：sessionWebView.loadUrl(SESSION_URL + "?newsnook_snapshot=1")
        guard let url = URL(string: "https://linux.do/session/current.json?newsnook_snapshot=1") else { return }
        webView.load(URLRequest(url: url))
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
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !isMainFrame {
            decisionHandler(.allow)
            return
        }
        let target = navigationAction.request.url?.absoluteString ?? ""
        if LinuxDoSessionPlugin.isAllowedUrl(target) {
            decisionHandler(.allow)
        } else {
            // Java：Toast「已阻止跳出 Linux.do 第一方域名」
            showNotice("已阻止跳出 Linux.do 第一方域名")
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onPageFinished?(webView, webView.url?.absoluteString ?? "")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showNotice("Linux.do 页面加载失败，请检查网络后重试")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showNotice("Linux.do 页面加载失败，请检查网络后重试")
    }

    // MARK: - WKUIDelegate

    /// Android `setSupportMultipleWindows(false)`：`target="_blank"` 不新开窗口，
    /// 允许的 linux.do 链接在当前 WebView 里就地打开（用户协议/隐私政策等）。
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, LinuxDoSessionPlugin.isAllowedUrl(url.absoluteString) {
            webView.load(URLRequest(url: url))
        } else {
            showNotice("已阻止跳出 Linux.do 第一方域名")
        }
        return nil
    }
}

/// 与 OkHttp `identityClient.followRedirects(false)` 对齐：身份/凭据接口不跟随 3xx，
/// 由调用方自己读 `Location` 决定下一步（`clearUserApiKey` 的 revoke 也走它）。
/// `URLSessionConfiguration` 没有对应开关，只能用 task delegate 回 `nil` 拒绝跟随。
private final class LinuxDoIdentityRedirectBlocker: NSObject, URLSessionTaskDelegate {
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
