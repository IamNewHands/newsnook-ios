import AuthenticationServices
import Foundation
import Security
import UIKit

// MARK: - 常量

/// Discourse 委托式 User API Key 认证（iOS 版）。
///
/// 与 Android `LinuxDoUserApiAuth.java` 一一对应：走官方浏览器流程
/// `/user-api-key/new`，由系统浏览器持有 Linux.do 会话，因此 GitHub / Google
/// 等站点启用的登录方式都能用，无需把浏览器 Cookie 复制进 App。
/// Linux.do 把加密后的凭据回传到 App 专属深链 `discourse://auth_redirect`。
///
/// 本文件是**纯 Swift 辅助类**，不是 Capacitor 插件：
/// 没有 `CAPPlugin` / `CAPBridgedPlugin` / `jsName`，插件外壳由另一个文件负责。
/// 调用方（`LinuxDoSessionPlugin.swift`）通过下面这些成员使用它：
/// `isAuthenticating()` / `hasValidCredential()` / `credential()` / `applyHeaders(...)` /
/// `authenticate(...)` / `cancel()` / `clearCredential()` / `destroy()` / `handleRedirect(...)`，
/// 以及嵌套类型 `Credential` 与 `AuthCallback`。
///
/// 全部成员不带访问修饰符，与仓库内 `ProxiedHttpPlugin.swift` 等文件同款做法，
/// 便于同 target 内的插件外壳直接引用。
final class LinuxDoUserApiAuth {

    // MARK: 常量

    static let origin = "https://linux.do"
    /// 客户端 id 前缀**故意与 Android 不同**（Android 是 `newsnook-android-v3-`）：
    /// Discourse 按 `client_id` 区分用户 API Key，两端各用一套，互不覆盖。
    static let clientIdPrefix = "newsnook-ios-v3-"
    static let applicationName = "NewsNook"
    static let scopes = "one_time_password"
    static let authMode = "browser-session"
    static let authRedirect = "discourse://auth_redirect"

    /// 认证链接与待处理 nonce 的最长存活时间（与 Java 的 15 分钟一致）。
    static let authMaxAgeMillis: Int64 = 15 * 60 * 1000
    /// 一次性密码（OTP）签发后的可用窗口（与 Java 的 10 分钟一致）。
    static let oneTimePasswordMaxAgeMillis: Int64 = 10 * 60 * 1000

    static let errorBusy = "LINUXDO_USER_API_BUSY"
    static let errorBrowser = "LINUXDO_USER_API_BROWSER"
    static let errorCrypto = "LINUXDO_USER_API_CRYPTO"
    static let errorCancelled = "LINUXDO_USER_API_CANCELLED"
    static let errorDenied = "LINUXDO_USER_API_DENIED"
    static let errorProtocol = "LINUXDO_USER_API_PROTOCOL"

    /// 展示认证网页所用的锚窗口。返回 nil 时 `authenticate` 走 `LINUXDO_USER_API_BROWSER` 失败。
    /// 由调用方注入（Java 里传的是 `Activity`，iOS 侧不允许用全局单例兜底）。
    typealias Presenter = () -> ASPresentationAnchor?

    // MARK: 嵌套类型

    /// 解密后落库的 Linux.do 凭据。字段与 Android `Credential` 完全同名。
    struct Credential: Sendable, Equatable {
        let key: String
        let clientId: String
        let apiVersion: Int
        let expiresAt: String
        let oneTimePassword: String
        let authorizedAtMillis: Int64

        init(
            key: String,
            clientId: String,
            apiVersion: Int,
            expiresAt: String?,
            oneTimePassword: String?,
            authorizedAtMillis: Int64
        ) {
            self.key = key
            self.clientId = clientId
            self.apiVersion = apiVersion
            self.expiresAt = expiresAt ?? ""
            self.oneTimePassword = oneTimePassword ?? ""
            self.authorizedAtMillis = authorizedAtMillis
        }

        /// `expiresAt` 为空视为「不过期」（与 Java `expired()` 一致）。
        func expired(now: Date = Date()) -> Bool {
            if expiresAt.isEmpty { return false }
            guard let expires = LinuxDoUserApiAuth.parseISO8601(expiresAt) else { return true }
            return expires.timeIntervalSince1970 <= now.timeIntervalSince1970
        }

        /// 只接受纯 ASCII 十六进制，且在签发后 10 分钟内才算可用。
        func hasUsableOneTimePassword(now: Date = Date()) -> Bool {
            guard LinuxDoUserApiAuth.isASCIIHex(oneTimePassword) else { return false }
            let age = Int64(now.timeIntervalSince1970 * 1000) - authorizedAtMillis
            return authorizedAtMillis > 0 && age >= 0 && age < LinuxDoUserApiAuth.oneTimePasswordMaxAgeMillis
        }

        /// 键名与 Android `toJson()` 逐字一致（`key` / `clientId` / `apiVersion` /
        /// `expiresAt` / `oneTimePassword` / `authorizedAtMillis`）。
        func toJsonObject() -> [String: Any] {
            var value: [String: Any] = [
                "key": key,
                "clientId": clientId,
                "apiVersion": apiVersion,
                "authorizedAtMillis": authorizedAtMillis,
            ]
            if !expiresAt.isEmpty { value["expiresAt"] = expiresAt }
            if !oneTimePassword.isEmpty { value["oneTimePassword"] = oneTimePassword }
            return value
        }

        func toJsonString() -> String? {
            guard
                let data = try? JSONSerialization.data(withJSONObject: toJsonObject(), options: []),
                let text = String(data: data, encoding: .utf8)
            else { return nil }
            return text
        }

        /// `key` / `clientId` / `apiVersion` 任一缺失即视为无效（与 Java 一致）。
        static func fromJsonObject(_ value: [String: Any]) -> Credential? {
            let key = value["key"] as? String ?? ""
            let clientId = value["clientId"] as? String ?? ""
            let apiVersion = intValue(value["apiVersion"])
            let expiresAt = value["expiresAt"] as? String ?? ""
            let oneTimePassword = value["oneTimePassword"] as? String ?? ""
            let authorizedAtMillis = longValue(value["authorizedAtMillis"])
            if key.isEmpty || clientId.isEmpty || apiVersion <= 0 { return nil }
            return Credential(
                key: key,
                clientId: clientId,
                apiVersion: apiVersion,
                expiresAt: expiresAt,
                oneTimePassword: oneTimePassword,
                authorizedAtMillis: authorizedAtMillis
            )
        }

        static func fromJsonString(_ text: String) -> Credential? {
            guard
                let data = text.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data, options: []),
                let value = object as? [String: Any]
            else { return nil }
            return fromJsonObject(value)
        }
    }

    /// Java `AuthCallback` 的 Swift 对应物：方法名保持 `onPending` / `onSuccess` / `onFailure`。
    ///
    /// 语义与 Java 相同：
    /// - `onPending(verificationUrl:expiresInSeconds:)`：浏览器已拉起，等待回流；
    /// - `onSuccess(credential:)`：凭据已校验并落库；
    /// - `onFailure(code:message:)`：失败或取消，`message` 是可直接展示给用户的中文。
    ///
    /// 线程约定：一律在主线程回调（Java 侧由调用方 `runOnUiThread` 保证）。
    /// 实现 `onFailure` 时必须保证恰好回调一次。
    protocol AuthCallback: AnyObject {
        func onPending(verificationUrl: String, expiresInSeconds: Int)
        func onSuccess(credential: Credential)
        func onFailure(code: String, message: String)
    }

    /// `LINUXDO_USER_API_*` 错误码 + 中文文案；方便插件外壳直接 `call.reject`。
    enum AuthError: Error, Equatable {
        case busy
        case browser
        case crypto
        case cancelled
        case denied(String)
        case cancelledByUser
        case protocolFailure

        var code: String {
            switch self {
            case .busy: return LinuxDoUserApiAuth.errorBusy
            case .browser: return LinuxDoUserApiAuth.errorBrowser
            case .crypto: return LinuxDoUserApiAuth.errorCrypto
            case .cancelled: return LinuxDoUserApiAuth.errorCancelled
            case .denied: return LinuxDoUserApiAuth.errorDenied
            case .cancelledByUser: return LinuxDoUserApiAuth.errorCancelled
            case .protocolFailure: return LinuxDoUserApiAuth.errorProtocol
            }
        }

        var message: String {
            switch self {
            case .busy: return "已有 Linux.do 第三方登录正在进行"
            case .browser: return "无法打开系统浏览器，请检查默认浏览器是否可用"
            case .crypto: return "无法准备 Linux.do 安全授权"
            case .cancelled: return "已取消 Linux.do 登录"
            case .denied(let reason): return reason
            case .cancelledByUser: return "你已取消或拒绝 Linux.do 授权"
            case .protocolFailure: return "Linux.do 授权回流校验失败，请重新登录"
            }
        }

        /// `access_denied` 之外的 error 参数文案（与 Java 的拼法一致）。
        static func denied(code: String) -> AuthError {
            .denied("Linux.do 第三方登录失败：" + code)
        }
    }

    // MARK: 私有存储键

    private static let userDefaultsKeyClientId = "linuxdo_user_api_auth.client_id"
    private static let userDefaultsKeyPendingNonce = "linuxdo_user_api_auth.pending_nonce"
    private static let userDefaultsKeyPendingStartedAt = "linuxdo_user_api_auth.pending_started_at"
    private static let keychainService = "com.aizeek.newsnook.linuxdo.userapikey"
    private static let keychainAccountCredential = "credential"
    private static let rsaKeyTag = "com.aizeek.newsnook.linuxdo.userapikey.rsa.v2"

    // MARK: 状态

    /// 保护 `authenticating` / `activeCallback` / `pendingNonce` / `cachedCredential`。
    /// 不用全局串行队列，避免「持锁后再同步等待主线程」造成互等。
    private let stateLock = NSLock()

    /// 与 Java `AtomicBoolean authenticating` 对应；只能通过 `compareAndSetAuthenticating` 改。
    private var authenticating = false
    /// **强引用**：Java 侧 `activeCallback` 也是强引用。若这里持弱引用，插件外壳一旦不额外
    /// 持有回调对象，`onPending` 就会静默丢失。`destroy()` / `clearPendingAuth()` 负责断开。
    private var activeCallback: AuthCallback?
    /// 已经对当前这次认证报过失败：`cancel()` 与 `ASWebAuthenticationSession` 的
    /// 完成回调可能先后触发，用它保证 `onFailure` 最多一次。
    private var callbackFailed = false
    private var pendingNonce = ""
    private var cachedCredential: Credential?

    private var session: ASWebAuthenticationSession?
    private var sessionContextProvider: WebAuthContextProvider?
    /// 系统是否已经回调过当前这次 `ASWebAuthenticationSession`（它没有可查询的结束状态）。
    private var sessionFinished = true

    /// 当前保留的 pending nonce 是否仍然新鲜（纯函数，供构造期使用）。
    private static func freshPendingNonce(now: Date = Date()) -> String {
        let defaults = UserDefaults.standard
        guard let nonce = defaults.string(forKey: userDefaultsKeyPendingNonce), !nonce.isEmpty else {
            return ""
        }
        let startedAt = defaults.double(forKey: userDefaultsKeyPendingStartedAt)
        guard startedAt > 0 else { return "" }
        let age = Int64(now.timeIntervalSince1970 * 1000) - Int64(startedAt)
        guard age <= authMaxAgeMillis else { return "" }
        return nonce
    }

    init() {
        // 对齐 Java：进程可能是在浏览器打开期间被系统杀掉的，此时持久化的 nonce
        // 仍然有效，`isAuthenticating()` 应当如实返回 true；真正的凭证靠
        // `pendingNonce()` 惰性读取，不在构造期做 IO。
        let restored = Self.freshPendingNonce()
        self.pendingNonce = restored
        self.authenticating = !restored.isEmpty
    }

    // MARK: 对外查询

    func isAuthenticating() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return authenticating
    }

    /// 返回可用凭据；内存缓存命中优先，否则读 Keychain。
    /// 读不到 / 解不出 / 已过期一律清空并返回 nil（与 Java 一致，绝不把坏数据留在库里）。
    func credential() -> Credential? {
        stateLock.lock()
        let cached = cachedCredential
        stateLock.unlock()
        if let cached, !cached.expired() { return cached }

        guard let text = readStoredCredential() else { return nil }
        guard let credential = Credential.fromJsonString(text), !credential.expired() else {
            clearCredential()
            return nil
        }
        stateLock.lock()
        cachedCredential = credential
        stateLock.unlock()
        return credential
    }

    func hasValidCredential() -> Bool {
        credential() != nil
    }

    /// 取认证头。返回空字典表示未登录（Java 版会直接 `return`，什么都不加）。
    func applyHeaders() -> [String: String] {
        guard let credential = credential() else { return [:] }
        return [
            "User-Api-Key": credential.key,
            "User-Api-Client-Id": credential.clientId,
        ]
    }

    // MARK: 对外操作

    func clearCredential() {
        stateLock.lock()
        cachedCredential = nil
        stateLock.unlock()
        deleteStoredCredential()
    }

    /// 只断开当前回调，保留持久化的 pending nonce（与 Java `destroy()` 一致）。
    func destroy() {
        stateLock.lock()
        activeCallback = nil
        stateLock.unlock()
        closeBrowserSession()
    }

    /// 发起授权。`presenter` 缺省时用前台场景的 key window。
    /// 必须在主线程调用（内部会触碰 `ASWebAuthenticationSession` 与 UI）。
    func authenticate(presenter: Presenter? = nil, callback: AuthCallback) {
        // 进程可能在浏览器打开期间被杀，此时没有活着的 JS promise 需要保留，
        // 允许一次新的显式登录立即替换掉持久化的 pending nonce。
        if isAuthenticating(), currentCallback() == nil { clearPendingAuth() }
        guard compareAndSetAuthenticating(expected: false, desired: true) else {
            DispatchQueue.main.async {
                callback.onFailure(code: Self.errorBusy, message: AuthError.busy.message)
            }
            return
        }

        let nonce = Self.randomHex(byteCount: 16)
        stateLock.lock()
        pendingNonce = nonce
        activeCallback = callback
        callbackFailed = false
        stateLock.unlock()
        persistPendingAuth(nonce: nonce, startedAtMillis: Self.nowMillis())

        let clientId = self.clientId()
        guard let url = Self.makeAuthorizationURL(nonce: nonce, clientId: clientId) else {
            finishFailure(callback: callback, error: .crypto)
            return
        }
        guard let anchor = (presenter ?? Self.defaultPresenter)() else {
            finishFailure(callback: callback, error: .browser)
            return
        }

        let contextProvider = WebAuthContextProvider(anchor: anchor)
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: Self.redirectScheme,
            completionHandler: { [weak self] callbackURL, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    // 系统已经收掉这次会话，先记下来，避免 handleRedirect 里再 cancel 一次。
                    self.sessionFinished = true
                    self.session = nil
                    self.sessionContextProvider = nil
                    guard let callbackURL else {
                        // 用户点了「取消」，或系统没能把深链交回来。
                        let active = self.currentCallback() ?? callback
                        if Self.isUserCancellation(error) {
                            self.finishFailure(callback: active, error: .cancelledByUser)
                        } else {
                            self.finishFailure(callback: active, error: .protocolFailure)
                        }
                        return
                    }
                    // 与 Android 一致：认不认这个 URL 由 handleRedirect 决定。
                    _ = self.handleRedirect(url: callbackURL)
                }
            }
        )
        // 必须走共享浏览器 Cookie 仓：GitHub / Google 的登录态都在系统 Safari 里。
        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = contextProvider
        self.session = session
        self.sessionContextProvider = contextProvider
        self.sessionFinished = false

        guard session.start() else {
            self.session = nil
            self.sessionContextProvider = nil
            finishFailure(callback: callback, error: .browser)
            return
        }

        callback.onPending(
            verificationUrl: url.absoluteString,
            expiresInSeconds: Int(Self.authMaxAgeMillis / 1000)
        )
    }

    /// 取消当前登录：清掉 pending 状态，并对活着的回调报一次 `LINUXDO_USER_API_CANCELLED`。
    func cancel() {
        let callback = currentCallback()
        let isFirst = markFailureReported()
        clearPendingAuth()
        closeBrowserSession()
        if let callback, isFirst {
            DispatchQueue.main.async {
                callback.onFailure(code: Self.errorCancelled, message: AuthError.cancelled.message)
            }
        }
    }

    /// 关掉浏览器面板（若还开着）。`ASWebAuthenticationSession` 没有「已结束」查询，
    /// 用 `sessionFinished` 记住系统是否已经回调过，避免重复 cancel。
    private func closeBrowserSession() {
        stateLock.lock()
        let alreadyFinished = sessionFinished
        sessionFinished = true
        stateLock.unlock()
        guard !alreadyFinished else { return }
        session?.cancel()
        session = nil
        sessionContextProvider = nil
    }

    /// 消费 `discourse://auth_redirect?payload=...&oneTimePassword=...`。
    /// 只有专门的 Linux.do 认证回流才返回 true；认领后解密与落库在后台串行队列完成。
    ///
    /// pending nonce 是持久化的，因此浏览器往返可以扛过进程被杀：即使原来的
    /// Capacitor promise 已经不存在，凭据仍会落库，下一次 `snapshot()` 能恢复会话。
    @discardableResult
    func handleRedirect(url: URL) -> Bool {
        guard Self.isAuthRedirect(url) else { return false }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let error = Self.empty(Self.queryValue(components, name: "error"))
        if !error.isEmpty {
            let callback = currentCallback()
            let isFirst = markFailureReported()
            let message = error.lowercased() == "access_denied"
                ? AuthError.cancelledByUser.message
                : AuthError.denied(code: error).message
            clearPendingAuth()
            closeBrowserSession()
            if let callback, isFirst {
                DispatchQueue.main.async {
                    callback.onFailure(code: Self.errorDenied, message: message)
                }
            }
            return true
        }

        let payload = Self.empty(Self.queryValue(components, name: "payload"))
        if payload.isEmpty {
            let callback = currentCallback()
            let isFirst = markFailureReported()
            clearPendingAuth()
            closeBrowserSession()
            if let callback, isFirst {
                DispatchQueue.main.async {
                    callback.onFailure(
                        code: Self.errorProtocol,
                        message: "Linux.do 未返回安全授权凭据"
                    )
                }
            }
            return true
        }

        let encryptedOtp = Self.empty(Self.queryValue(components, name: "oneTimePassword"))
        let callback = currentCallback()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var stage = "pending_nonce"
            do {
                let nonce = self.pendingNonceValue()
                if nonce.isEmpty { throw AuthFailure.missingNonce }
                stage = "otp_presence"
                if encryptedOtp.isEmpty { throw AuthFailure.missingOneTimePassword }
                stage = "otp_decrypt"
                let oneTimePassword = try self.decryptValue(encryptedOtp)
                stage = "payload_decrypt"
                let credential = try self.decryptCredential(
                    encryptedPayload: payload,
                    expectedNonce: nonce,
                    clientId: self.clientId(),
                    oneTimePassword: oneTimePassword
                )
                stage = "credential_store"
                try self.persistCredential(credential)

                // 先占住「已结束」标记，再清 pending：这样随后到来的
                // `ASWebAuthenticationSession` 完成回调不会再报一次失败。
                _ = self.markFailureReported()
                self.clearPendingAuth()
                DispatchQueue.main.async { self.closeBrowserSession() }
                if let callback {
                    DispatchQueue.main.async { callback.onSuccess(credential: credential) }
                }
            } catch {
                // 与 Java 同款诊断日志：只有阶段、长度、错误类型，绝不含凭据/nonce 明文。
                Self.log(
                    "auth_redirect_rejected stage=\(stage)"
                        + " payloadLength=\(payload.count)"
                        + " otpPresent=\(!encryptedOtp.isEmpty)"
                        + " otpLength=\(encryptedOtp.count)"
                        + " error=\(Self.describe(error))"
                )
                let isFirst = self.markFailureReported()
                self.clearPendingAuth()
                DispatchQueue.main.async { self.closeBrowserSession() }
                if let callback, isFirst {
                    DispatchQueue.main.async {
                        callback.onFailure(
                            code: Self.errorProtocol,
                            message: AuthError.protocolFailure.message
                        )
                    }
                }
            }
        }
        return true
    }

    // MARK: 并发原语

    private func compareAndSetAuthenticating(expected: Bool, desired: Bool) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard authenticating == expected else { return false }
        authenticating = desired
        return true
    }

    private func currentCallback() -> AuthCallback? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return activeCallback
    }

    /// 把「本次认证的失败已经报过」置位，并返回**本次**是否为第一次置位。
    /// 所有失败出口都必须先问它，才能保证 `onFailure` 恰好一次。
    private func markFailureReported() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        if callbackFailed { return false }
        callbackFailed = true
        return true
    }

    // MARK: 认证流程内部

    /// 与 Java `pendingNonce()` 相同：内存命中优先，否则回读持久化值并校验年龄。
    private func pendingNonceValue() -> String {
        stateLock.lock()
        let current = pendingNonce
        stateLock.unlock()
        if !current.isEmpty { return current }

        let stored = Self.freshPendingNonce()
        guard !stored.isEmpty else { return "" }
        stateLock.lock()
        pendingNonce = stored
        stateLock.unlock()
        return stored
    }

    private func clearPendingAuth() {
        stateLock.lock()
        pendingNonce = ""
        activeCallback = nil
        authenticating = false
        callbackFailed = false
        stateLock.unlock()
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: Self.userDefaultsKeyPendingNonce)
        defaults.removeObject(forKey: Self.userDefaultsKeyPendingStartedAt)
    }

    /// 报一次失败。用 `callbackFailed` 保证同一次认证的 `onFailure` 最多触发一次
    /// （`cancel()` 之后 `ASWebAuthenticationSession` 的完成回调还会再来一次）。
    private func finishFailure(callback: AuthCallback, error: AuthError) {
        let isFirst = markFailureReported()
        clearPendingAuth()
        guard isFirst else { return }
        DispatchQueue.main.async {
            callback.onFailure(code: error.code, message: error.message)
        }
    }

    private func persistPendingAuth(nonce: String, startedAtMillis: Int64) {
        let defaults = UserDefaults.standard
        defaults.set(nonce, forKey: Self.userDefaultsKeyPendingNonce)
        defaults.set(Double(startedAtMillis), forKey: Self.userDefaultsKeyPendingStartedAt)
    }

    private func clientId() -> String {
        let defaults = UserDefaults.standard
        let existing = defaults.string(forKey: Self.userDefaultsKeyClientId) ?? ""
        if existing.hasPrefix(Self.clientIdPrefix) { return existing }
        let created = Self.clientIdPrefix + Self.randomHex(byteCount: 16)
        defaults.set(created, forKey: Self.userDefaultsKeyClientId)
        return created
    }

    // MARK: 授权 URL

    private static let redirectScheme = "discourse"

    private static func makeAuthorizationURL(nonce: String, clientId: String) -> URL? {
        guard var components = URLComponents(string: origin + "/user-api-key/new") else { return nil }
        let pem = (try? publicKeyPem()) ?? nil
        guard let pem else { return nil }
        components.queryItems = [
            URLQueryItem(name: "scopes", value: scopes),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "auth_redirect", value: authRedirect),
            URLQueryItem(name: "application_name", value: applicationName),
            URLQueryItem(name: "public_key", value: pem),
        ]
        return components.url
    }

    private static func isAuthRedirect(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return false
        }
        let scheme = components.scheme ?? ""
        let host = components.host ?? ""
        return scheme.lowercased() == "discourse" && host.lowercased() == "auth_redirect"
    }

    private static func queryValue(_ components: URLComponents?, name: String) -> String? {
        components?.queryItems?.first(where: { $0.name == name })?.value
    }

    /// 默认锚窗口：前台活跃场景的 key window。与 Android 传 `Activity` 对应；
    /// iOS 侧不允许把这个做成全局单例，所以只在调用方未注入 `Presenter` 时兜底。
    private static func defaultPresenter() -> ASPresentationAnchor? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        guard let scene = active else { return nil }
        return scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first
    }

    // MARK: 浏览器会话

    /// `ASWebAuthenticationSession` 的锚点持有者。会话强引用它，所以这里只存窗口。
    private final class WebAuthContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
        private let anchor: ASPresentationAnchor

        init(anchor: ASPresentationAnchor) {
            self.anchor = anchor
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            anchor
        }
    }

    private static func isUserCancellation(_ error: Error?) -> Bool {
        guard let error = error as? ASWebAuthenticationSessionError else { return false }
        return error.code == .canceledLogin
    }

    // MARK: 凭据落库（Keychain）

    /// iOS 没有「可加密的 Keychain 封装」，Keychain 本身就是加密存储：
    /// `kSecClassGenericPassword` + `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
    /// 等价于 Android 的「AndroidKeyStore AES-256-GCM 密钥 + 密文落 SharedPreferences」，
    /// 且条目不随备份迁移（对齐 Android Keystore 换机即失效）。
    /// 因此这里**不做二次加密**，省掉一整层密钥管理，风险更低。
    private func persistCredential(_ credential: Credential) throws {
        guard let json = credential.toJsonString(), let data = json.data(using: .utf8) else {
            throw AuthFailure.credentialEncode
        }
        let base = Self.credentialQuery()
        let updateStatus = SecItemUpdate(
            base as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess {
            stateLock.lock()
            cachedCredential = credential
            stateLock.unlock()
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw AuthFailure.keychain(Self.describe(status: updateStatus))
        }
        // update 的 query 里不能带 kSecAttrAccessible，否则 SecItemUpdate 会报 errSecParam。
        var addQuery = base
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw AuthFailure.keychain(Self.describe(status: addStatus))
        }
        stateLock.lock()
        cachedCredential = credential
        stateLock.unlock()
    }

    /// 读不到 / 解不出 UTF-8 / 类型不符一律当作「没有值」并顺手清掉（与 Java 同款取舍）。
    private func readStoredCredential() -> String? {
        var query = Self.credentialQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { return nil }
        guard let data = result as? Data, let text = String(data: data, encoding: .utf8) else {
            deleteStoredCredential()
            return nil
        }
        return text
    }

    private func deleteStoredCredential() {
        SecItemDelete(Self.credentialQuery() as CFDictionary)
    }

    private static func credentialQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccountCredential,
        ]
    }

    // MARK: RSA 密钥与解密

    /// 生成/取回 RSA-2048 私钥（仅解密用途），语义对齐 AndroidKeyStore 的
    /// `newsnook_linuxdo_user_api_rsa_v2`：`PURPOSE_DECRYPT` + RSA/ECB/PKCS1Padding。
    private static func loadOrCreatePrivateKey() throws -> SecKey {
        if let existing = loadPrivateKey() { return existing }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: Data(rsaKeyTag.utf8),
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ],
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw AuthFailure.keychain("rsa keygen failed")
        }
        _ = error // 只保留生成失败这个事实；CFError 细节不写进日志。
        return key
    }

    private static func loadPrivateKey() -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrApplicationTag as String: Data(rsaKeyTag.utf8),
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let value = result else { return nil }
        // query 指定了 kSecClassKey，取回来的必然是 SecKey；用 unsafeBitCast 而不是
        // `as!`，避免 CFTypeRef → SecKey 的强制转换在部分 SDK 上报警告。
        return unsafeBitCast(value, to: SecKey.self)
    }

    /// 导出 `-----BEGIN PUBLIC KEY-----` PEM。
    ///
    /// `SecKeyCopyExternalRepresentation` 对 RSA 公钥返回的是 **PKCS#1**
    /// （`RSAPublicKey ::= SEQUENCE { modulus, publicExponent }`），而 Android
    /// `PublicKey.getEncoded()` 返回 **X.509 SubjectPublicKeyInfo**，PEM 头也是
    /// `BEGIN PUBLIC KEY`。两者不一致时 Discourse 端 `OpenSSL::PKey::RSA.new` 会解不出来，
    /// 所以这里手工补上固定的 SPKI 前缀（2048 位 RSA 的算法标识是定值）。
    static func publicKeyPem() throws -> String {
        let privateKey = try loadOrCreatePrivateKey()
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw AuthFailure.missingPublicKey
        }
        guard let raw = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
            throw AuthFailure.missingPublicKey
        }
        let spki = Self.subjectPublicKeyInfoPrefix(rsaModulusLength: raw.count) + raw
        let base64 = spki.base64EncodedString()
        var pem = "-----BEGIN PUBLIC KEY-----\n"
        var index = base64.startIndex
        while index < base64.endIndex {
            let next = base64.index(index, offsetBy: 64, limitedBy: base64.endIndex) ?? base64.endIndex
            pem += String(base64[index..<next]) + "\n"
            index = next
        }
        pem += "-----END PUBLIC KEY-----\n"
        return pem
    }

    /// X.509 SubjectPublicKeyInfo 的固定前缀（RSA + `rsaEncryption` + NULL 参数）。
    /// `SEQUENCE { SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }, BIT STRING { 0x00, <PKCS#1> } }`
    private static func subjectPublicKeyInfoPrefix(rsaModulusLength: Int) -> Data {
        // BIT STRING 内容 = 未用位数 0x00（1 字节）+ PKCS#1 字节。
        let bitStringLength = rsaModulusLength + 1
        // 外层 SEQUENCE 内容 = 15 字节算法标识（30 0D 06 09 … 05 00）
        //   + BIT STRING 头（03 + DER 长度域）+ BIT STRING 内容。
        let outerLength = 15 + derLengthFieldLength(bitStringLength) + 1 + bitStringLength

        var data = Data()
        data.append(0x30)
        data.append(derLength(outerLength))
        // AlgorithmIdentifier：SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
        data.append(contentsOf: [
            0x30, 0x0D, 0x06, 0x09,
            0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01,
            0x01, 0x05, 0x00,
        ])
        data.append(0x03)
        data.append(derLength(bitStringLength))
        data.append(0x00)
        return data
    }

    /// DER 长度域编码：短形式（< 128）1 字节，否则 0x80|n + n 字节大端。
    private static func derLength(_ length: Int) -> Data {
        if length < 0x80 { return Data([UInt8(length)]) }
        var bytes: [UInt8] = []
        var remaining = length
        while remaining > 0 {
            bytes.insert(UInt8(remaining & 0xFF), at: 0)
            remaining >>= 8
        }
        return Data([0x80 | UInt8(bytes.count)] + bytes)
    }

    private static func derLengthFieldLength(_ length: Int) -> Int {
        derLength(length).count
    }

    /// Base64(RSA/ECB/PKCS1Padding) 解出 UTF-8 字符串；与 Discourse 默认响应格式一致。
    private func decryptValue(_ encryptedPayload: String) throws -> String {
        guard let encrypted = Self.base64Decode(encryptedPayload) else {
            throw AuthFailure.invalidBase64
        }
        let privateKey = try Self.loadOrCreatePrivateKey()
        guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, .rsaEncryptionPKCS1) else {
            throw AuthFailure.unsupportedAlgorithm
        }
        var error: Unmanaged<CFError>?
        guard let plain = SecKeyCreateDecryptedData(
            privateKey,
            .rsaEncryptionPKCS1,
            encrypted as CFData,
            &error
        ) as Data? else {
            throw AuthFailure.decryptFailed
        }
        guard let text = String(data: plain, encoding: .utf8) else {
            throw AuthFailure.decryptFailed
        }
        return text
    }

    /// 校验 nonce、抽出 key / api / expires_at，并用 OTP 补齐凭据。
    /// 校验顺序与 Java 逐条对齐（nonce → key/api/otp），保证 `stage` 诊断标签一致。
    private func decryptCredential(
        encryptedPayload: String,
        expectedNonce: String,
        clientId: String,
        oneTimePassword: String
    ) throws -> Credential {
        let plaintext = try decryptValue(encryptedPayload)
        guard
            let data = plaintext.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data, options: []),
            let json = object as? [String: Any]
        else {
            throw AuthFailure.invalidPayload
        }

        let nonce = json["nonce"] as? String ?? ""
        if expectedNonce.isEmpty || !Self.constantTimeEquals(expectedNonce, nonce) {
            throw AuthFailure.nonceMismatch
        }
        let key = json["key"] as? String ?? ""
        let api = Self.intValue(json["api"])
        let expiresAt = json["expires_at"] as? String ?? ""
        if key.isEmpty || api <= 0 || !Self.isASCIIHex(oneTimePassword) {
            throw AuthFailure.invalidPayload
        }
        return Credential(
            key: key,
            clientId: clientId,
            apiVersion: api,
            expiresAt: expiresAt,
            oneTimePassword: oneTimePassword,
            authorizedAtMillis: Self.nowMillis()
        )
    }

    // MARK: 静态工具

    private static func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    /// 与 Java 的两条模式等价：`yyyy-MM-dd'T'HH:mm:ssXXX` 与带毫秒的 `.SSSXXX`。
    /// `ISO8601DateFormatter` 不接受 `SSS`，所以带小数秒的走 `DateFormatter`。
    static func parseISO8601(_ value: String) -> Date? {
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: value) { return date }

        let fractional = DateFormatter()
        fractional.locale = Locale(identifier: "en_US_POSIX")
        fractional.timeZone = TimeZone(identifier: "UTC")
        fractional.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        return fractional.date(from: value)
    }

    private static func base64Decode(_ value: String) -> Data? {
        // 先剥空白，再宽松解码，对齐 Android `Base64.DEFAULT` 的宽容行为。
        let stripped = value.filter { !$0.isWhitespace }
        if let data = Data(base64Encoded: stripped) { return data }
        return Data(base64Encoded: stripped, options: .ignoreUnknownCharacters)
    }

    static func randomHex(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        if status != errSecSuccess {
            // 兜底：绝不能返回可预测的 nonce；宁可让调用方在下一步失败。
            bytes = (0..<byteCount).map { _ in UInt8.random(in: 0...255) }
        }
        var builder = ""
        builder.reserveCapacity(byteCount * 2)
        for byte in bytes {
            builder += String(format: "%02x", Int(byte))
        }
        return builder
    }

    private static func constantTimeEquals(_ left: String, _ right: String) -> Bool {
        let a = Array(left.utf8)
        let b = Array(right.utf8)
        if a.count != b.count { return false }
        var diff: UInt8 = 0
        for index in 0..<a.count {
            diff |= a[index] ^ b[index]
        }
        return diff == 0
    }

    private static func intValue(_ value: Any?) -> Int {
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String { return Int(text) ?? 0 }
        return 0
    }

    private static func longValue(_ value: Any?) -> Int64 {
        if let number = value as? NSNumber { return number.int64Value }
        if let text = value as? String { return Int64(text) ?? 0 }
        return 0
    }

    private static func empty(_ value: String?) -> String {
        value ?? ""
    }

    /// Java 的 `^[0-9a-fA-F]+$` 等价物：**只认 ASCII 十六进制**。
    /// 不能用 `Character.isHexDigit`，它会放行全角等 Unicode 数字。
    static func isASCIIHex(_ value: String) -> Bool {
        guard !value.isEmpty else { return false }
        for scalar in value.unicodeScalars {
            let isDigit = scalar.value >= 0x30 && scalar.value <= 0x39
            let isLower = scalar.value >= 0x61 && scalar.value <= 0x66
            let isUpper = scalar.value >= 0x41 && scalar.value <= 0x46
            if !isDigit && !isLower && !isUpper { return false }
        }
        return true
    }

    private static func describe(status: OSStatus) -> String {
        if let message = SecCopyErrorMessageString(status, nil) as String? { return message }
        return "OSStatus \(status)"
    }

    private static func describe(_ error: Error) -> String {
        if let failure = error as? AuthFailure { return failure.label }
        return String(describing: type(of: error)) + ":" + error.localizedDescription
    }

    /// 不打印任何凭据/nonce 明文。
    private static func log(_ message: String) {
        NSLog("[LinuxDoUserApiAuth] %@", message)
    }
}

// MARK: - 内部错误

/// 内部失败原因。不对外暴露，只用来生成诊断标签与错误码。
private enum AuthFailure: Error {
    case missingNonce
    case missingOneTimePassword
    case invalidBase64
    case decryptFailed
    case unsupportedAlgorithm
    case nonceMismatch
    case invalidPayload
    case missingPublicKey
    case credentialEncode
    case keychain(String)

    var label: String {
        switch self {
        case .missingNonce: return "missing pending nonce"
        case .missingOneTimePassword: return "missing one-time password"
        case .invalidBase64: return "invalid base64"
        case .decryptFailed: return "rsa decrypt failed"
        case .unsupportedAlgorithm: return "unsupported rsa algorithm"
        case .nonceMismatch: return "nonce mismatch"
        case .invalidPayload: return "invalid credential payload"
        case .missingPublicKey: return "missing public key"
        case .credentialEncode: return "credential encode failed"
        case .keychain(let detail): return "keychain: " + detail
        }
    }
}
