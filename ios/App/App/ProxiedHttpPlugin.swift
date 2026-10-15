import Capacitor
import Foundation

/// 支持可选 HTTP / HTTPS 隧道的原生 HTTP（`ProxiedHttp` 的 iOS 端）。
///
/// 对齐 Android `android/app/src/main/java/com/aizeek/newsnook/ProxiedHttpPlugin.java`
/// 的 JS 可见契约：选项键、响应字段（`status` / `headers` / `setCookies` / `data`）、
/// 默认超时、`followRedirects` 语义与中文错误文案都保持一致。
///
/// Android 用 OkHttp 的 `Proxy` + `Authenticator`，iOS 侧对应物是
/// `URLSessionConfiguration.connectionProxyDictionary`：
///
/// - `type: "http"`：写入 `HTTPEnable/HTTPProxy/HTTPPort` 与 `HTTPSEnable/HTTPSProxy/HTTPSPort`
///   （CoreFoundation 的 `kCFNetworkProxies*` 键名去前缀）。带凭据时**不能**指望
///   `HTTPProxyUsername/HTTPProxyPassword`——Apple 公开 SDK 里没有这两个键，写了会被忽略；
///   改为在 session delegate 里回应代理的 407 挑战，等价于 OkHttp 的 `proxyAuthenticator`。
/// - `type: "socks5"`：**iOS 不提供任何公开的 SOCKS 代理开关**。CoreFoundation 里没有
///   `kCFNetworkProxiesSOCKS*` 常量，`URLSession` 也不实现 SOCKS5 握手，把臆造键塞进
///   `connectionProxyDictionary` 只会被忽略——那等于静默直连，是最坏的结果。
///   因此这里**显式 reject**，JS 侧拿到明确的中文错误，而不是一个走错出口的请求。
///   真正的 SOCKS5 需要自建 socket/TLS 层（见 port spec 的「不可移植 / 降级」一节）。
///
/// Cookie：刻意关闭 `httpShouldSetCookies` 并清空 `httpCookieStorage`，让 `URLSession`
/// 原样透传响应头，这样同名多条 `Set-Cookie` 能逐条进入 `setCookies` 数组
/// （知乎 transport 手工合并 cookie，逗号拼接会破坏 `Expires=Wed, 09 Jun ...`）。
@objc(ProxiedHttpPlugin)
public final class ProxiedHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ProxiedHttpPlugin"
    public let jsName = "ProxiedHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    /// 与 Android 端一致的默认值（毫秒）。
    private static let defaultConnectTimeout = 15000
    private static let defaultReadTimeout = 25000
    /// `Content-Type` fallback，对齐 OkHttp 端的 `MediaType.parse(...)`。
    private static let formContentType = "application/x-www-form-urlencoded; charset=UTF-8"
    private static let maxMethodLength = 20

    /// `URLSession` 自己管理、不接受调用方覆盖的请求头。
    private static let reservedRequestHeaders: Set<String> = [
        "content-length", "transfer-encoding", "host", "connection"
    ]

    /// 进行中的任务，供 `deinit` 统一取消。
    private var inFlight: [UUID: URLSessionDataTask] = [:]
    private let inFlightLock = NSLock()

    @objc func request(_ call: CAPPluginCall) {
        guard let rawUrl = call.getString("url"), !rawUrl.isEmpty else {
            call.reject("缺少 url")
            return
        }
        guard let url = URL(string: rawUrl), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            call.reject("url 无效或协议不受支持")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        guard Self.isValidMethod(method) else {
            call.reject("不支持的 HTTP 方法：\(method)")
            return
        }

        let requestHeaders = Self.stringDictionary(call.getObject("headers")) ?? [:]
        let textBody = call.getString("data")
        let base64Body = call.getString("dataBase64")
        let omitContentType = call.getBool("omitContentType", false)
        let connectTimeout = Self.sanitizedTimeout(
            call.getInt("connectTimeout"), fallback: Self.defaultConnectTimeout
        )
        let readTimeout = Self.sanitizedTimeout(
            call.getInt("readTimeout"), fallback: Self.defaultReadTimeout
        )
        let followRedirects = call.getBool("followRedirects", false)

        var decodedBody: Data?
        if let base64Body {
            // Android 用 Base64.DEFAULT（宽松解码，忽略换行/空白），这里对齐。
            guard let decoded = Data(base64Encoded: base64Body, options: [.ignoreUnknownCharacters]) else {
                call.reject("请求体 dataBase64 不是有效 base64")
                return
            }
            decodedBody = decoded
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Double(readTimeout) / 1000
        configuration.timeoutIntervalForResource = Double(connectTimeout + readTimeout) / 1000 * 4
        // 默认 `Accept-Encoding` 由 URLSession 自行协商（gzip/deflate/br 并在解压后交付），
        // 与 OkHttp 的透明 gzip 行为一致。
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil

        var proxyAuth: ProxyAuth?
        if let proxy = Self.stringDictionary(call.getObject("proxy")) {
            switch Self.configureProxy(configuration, proxy: proxy) {
            case .success(let auth):
                proxyAuth = auth
            case .failure(let message):
                call.reject(message)
                return
            }
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        for (name, value) in requestHeaders where !Self.reservedRequestHeaders.contains(name.lowercased()) {
            request.setValue(value, forHTTPHeaderField: name)
        }

        if method == "POST" || method == "PUT" || method == "PATCH" {
            let mediaType: String?
            if omitContentType {
                mediaType = nil
            } else if let declared = Self.headerValue(requestHeaders, "Content-Type") {
                mediaType = declared
            } else {
                mediaType = Self.formContentType
            }
            if let mediaType {
                // Android 是 `header()` 语义（覆盖同名），这里同样只覆盖 Content-Type。
                request.setValue(mediaType, forHTTPHeaderField: "Content-Type")
            }
            request.httpBody = base64Body != nil ? (decodedBody ?? Data()) : Data((textBody ?? "").utf8)
        } else {
            // GET / HEAD / DELETE 不带请求体，对齐 Java 的 `requestBuilder.method(method, null)`。
            request.httpBody = nil
        }

        // `URLSessionConfiguration` 没有「不跟随重定向」的开关，只能由 delegate 决定；
        // 代理的 407 认证挑战同样走这个 delegate。session 会强引用 delegate 直到
        // invalidate，因此不需要额外持有它。
        let delegate = ProxiedHttpSessionDelegate(
            followRedirects: followRedirects,
            proxyAuth: proxyAuth
        )
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        let taskId = UUID()
        let settlement = Self.makeOnce()

        let task = session.dataTask(with: request) { [weak self] data, response, error in
            defer { session.finishTasksAndInvalidate() }
            guard settlement.claim() else { return }
            self?.removeInFlight(taskId)

            if let error {
                let message = (error as NSError).localizedDescription
                DispatchQueue.main.async {
                    call.reject(message.isEmpty ? "网络请求失败" : message)
                }
                return
            }
            guard let http = response as? HTTPURLResponse else {
                DispatchQueue.main.async { call.reject("网络请求失败") }
                return
            }

            let headers = Self.responseHeaders(http)
            let setCookies = Self.setCookieValues(http)
            let encoded = (data ?? Data()).base64EncodedString()
            DispatchQueue.main.async {
                call.resolve([
                    "status": http.statusCode,
                    "headers": headers,
                    "setCookies": setCookies,
                    "data": encoded
                ])
            }
        }
        // 看门狗：`URLSession` 的超时以「两次数据到达之间」计，缺一次总时长兜底；
        // 对齐 Android 端最终也会抛 IOException 而不是永远挂住。
        let budget = Double(connectTimeout + readTimeout) / 1000 + 5
        DispatchQueue.main.asyncAfter(deadline: .now() + budget) { [weak self] in
            guard settlement.claim() else { return }
            task.cancel()
            session.invalidateAndCancel()
            self?.removeInFlight(taskId)
            call.reject("请求超时")
        }

        addInFlight(taskId, task: task)
        task.resume()
    }

    deinit {
        inFlightLock.lock()
        let tasks = Array(inFlight.values)
        inFlight.removeAll()
        inFlightLock.unlock()
        for task in tasks {
            task.cancel()
        }
    }

    private func addInFlight(_ id: UUID, task: URLSessionDataTask) {
        inFlightLock.lock()
        inFlight[id] = task
        inFlightLock.unlock()
    }

    private func removeInFlight(_ id: UUID) {
        inFlightLock.lock()
        inFlight.removeValue(forKey: id)
        inFlightLock.unlock()
    }

    // MARK: - 代理

    private enum ProxyConfigurationResult {
        case success(ProxyAuth?)
        case failure(String)
    }

    /// 带凭据的代理：`connectionProxyDictionary` 没有用户名/密码键（Apple 公开 SDK
    /// 里不存在 `kCFNetworkProxiesHTTPProxyUsername` 之类的常量），只能靠 407 挑战回调。
    /// `fileprivate`：同文件的 session delegate 需要读它。
    fileprivate struct ProxyAuth {
        let credential: URLCredential
        let host: String
        let port: Int
    }

    private static func configureProxy(
        _ configuration: URLSessionConfiguration,
        proxy: [String: String]
    ) -> ProxyConfigurationResult {
        let type = (proxy["type"] ?? "http").lowercased()
        let host = proxy["host"] ?? ""
        guard !host.isEmpty, let port = Int(proxy["port"] ?? ""), port > 0, port <= 65535 else {
            return .failure("代理主机或端口无效")
        }
        let username = proxy["username"] ?? ""
        let password = proxy["password"] ?? ""

        // iOS 没有 SOCKS5 通道；宁可明确报错，也不能静默直连。
        guard type != "socks5" else {
            return .failure(
                "iOS 暂不支持 SOCKS5 代理：系统 URLSession 没有公开的 SOCKS 开关，"
                + "继续执行只会静默直连。请改用 HTTP/HTTPS 代理，或使用系统 VPN / 全局代理。"
            )
        }

        let dictionary: [AnyHashable: Any] = [
            // 同时打开 HTTP 与 HTTPS 两组键：HTTPS 目标走 CONNECT 隧道，http:// 目标走绝对 URI。
            "HTTPEnable": 1,
            "HTTPProxy": host,
            "HTTPPort": port,
            "HTTPSEnable": 1,
            "HTTPSProxy": host,
            "HTTPSPort": port
        ]

        var auth: ProxyAuth?
        if !username.isEmpty {
            // 对齐 Android：用户名非空才装认证器；密码缺省为空串。
            // 不走 `httpAdditionalHeaders`：HTTPS 走 CONNECT 隧道时那个头会跟着隧道内的
            // 请求发给源站，既认证不到代理，又把凭据泄露给源站。只保留 407 挑战回调。
            auth = ProxyAuth(
                credential: URLCredential(user: username, password: password, persistence: .forSession),
                host: host,
                port: port
            )
        }
        configuration.connectionProxyDictionary = dictionary
        return .success(auth)
    }

    // MARK: - 响应

    private static func responseHeaders(_ response: HTTPURLResponse) -> [String: Any] {
        var headers: [String: Any] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            if let text = value as? String {
                headers[name] = text
            } else if let number = value as? NSNumber {
                headers[name] = number.stringValue
            }
        }
        return headers
    }

    /// 逐条返回 `Set-Cookie`。优先用 `allHeaderFields` 里的数组形态；
    /// 万一平台把它合成了一条逗号串，再按「逗号 + 合法 cookie 名」切回去。
    private static func setCookieValues(_ response: HTTPURLResponse) -> [String] {
        let raw = response.allHeaderFields.first { key, _ in
            (key as? String)?.lowercased() == "set-cookie"
        }?.value

        if let list = raw as? [String] {
            let values = list.filter { !$0.isEmpty }
            if values.count > 1 { return values }
            if let single = values.first { return splitJoinedSetCookie(single) }
            return []
        }
        if let text = raw as? String, !text.isEmpty {
            return splitJoinedSetCookie(text)
        }
        return []
    }

    /// 仅在逗号后面紧跟 `name=`（合法 cookie 名）时才切分。
    /// `Expires=Wed, 09 Jun 2021 10:18:14 GMT` 里逗号后是空格 + 数字，不会误切。
    private static func splitJoinedSetCookie(_ value: String) -> [String] {
        var segments: [String] = []
        var current = ""
        let characters = Array(value)
        var index = 0

        while index < characters.count {
            let character = characters[index]
            if character == "," {
                var lookahead = index + 1
                while lookahead < characters.count, characters[lookahead] == " " {
                    lookahead += 1
                }
                if looksLikeCookieNameStart(characters, from: lookahead) {
                    segments.append(current)
                    current = ""
                    index = lookahead
                    continue
                }
            }
            current.append(character)
            index += 1
        }
        segments.append(current)

        return segments
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func looksLikeCookieNameStart(_ characters: [Character], from start: Int) -> Bool {
        var index = start
        var sawCharacter = false
        while index < characters.count {
            let character = characters[index]
            if character == "=" {
                return sawCharacter
            }
            if character == ";" || character == "," || character == " " || character == "\t" {
                return false
            }
            guard isCookieNameCharacter(character) else { return false }
            sawCharacter = true
            index += 1
        }
        return false
    }

    /// RFC 6265 cookie-name = token。
    private static func isCookieNameCharacter(_ character: Character) -> Bool {
        guard let scalar = character.unicodeScalars.first, character.unicodeScalars.count == 1 else {
            return false
        }
        switch scalar {
        case "!", "#", "$", "%", "&", "'", "*", "+", "-", ".", "^", "_", "`", "|", "~":
            return true
        default:
            return CharacterSet.alphanumerics.contains(scalar)
        }
    }

    // MARK: - 工具

    private static func isValidMethod(_ method: String) -> Bool {
        guard !method.isEmpty, method.count <= maxMethodLength else { return false }
        return method.allSatisfy { character in
            guard let scalar = character.unicodeScalars.first,
                  character.unicodeScalars.count == 1 else { return false }
            return CharacterSet.uppercaseLetters.contains(scalar)
                || CharacterSet.decimalDigits.contains(scalar)
                || scalar == "-"
        }
    }

    private static func sanitizedTimeout(_ value: Int?, fallback: Int) -> Int {
        guard let value, value > 0 else { return fallback }
        return min(value, 600_000)
    }

    private static func headerValue(_ headers: [String: String], _ name: String) -> String? {
        let target = name.lowercased()
        for (key, value) in headers where key.lowercased() == target {
            return value
        }
        return nil
    }

    private static func stringDictionary(_ object: JSObject?) -> [String: String]? {
        guard let object else { return nil }
        // 注意：`JSObject` 是 `[String: JSValue]`（JSValue 是空协议），不能桥接成
        // NSDictionary，只能逐项按动态类型取值。
        var result: [String: String] = [:]
        for (name, value) in object {
            if let text = value as? String {
                result[name] = text
            } else if let number = value as? NSNumber {
                // JS 数字经 Capacitor 变成 NSNumber；端口必须是整数形态，
                // 否则 "8080.0" 这种字符串会让 Int(...) 解析失败。
                let double = number.doubleValue
                result[name] = double == double.rounded() ? String(number.intValue) : number.stringValue
            }
        }
        return result
    }

    /// 保证 `resolve` / `reject` / 看门狗三者只有一个生效（`CAPPluginCall` 不能重复结算）。
    private static func makeOnce() -> OnceClaim {
        OnceClaim()
    }

    /// 只允许第一次 `claim()` 返回 true；其余返回 false。
    private final class OnceClaim {
        private var claimed = false
        private let lock = NSLock()

        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if claimed { return false }
            claimed = true
            return true
        }
    }
}

/// 会话级 delegate：管两件 `URLSessionConfiguration` 管不了的事。
///
/// 1. **重定向**：iOS 的 `URLSessionConfiguration` / `URLSessionTask` 都没有
///    `followRedirects` 属性（那是 OkHttp 的）。返回 `nil` 表示拒绝跟随，此时
///    completion handler 会拿到原始 3xx 响应，JS 侧（`lib/http.ts` / 知乎 transport）
///    自行按 `Location` 决定下一步。
/// 2. **代理认证**：`connectionProxyDictionary` 没有用户名/密码键，代理要求认证时
///    只能在这里回应 407 挑战。用 host/port 判定「这是代理的挑战」而不是源站的，
///    避免把代理凭据交给源站。
private final class ProxiedHttpSessionDelegate: NSObject, URLSessionTaskDelegate {
    private let followRedirects: Bool
    private let proxyAuth: ProxiedHttpPlugin.ProxyAuth?

    init(followRedirects: Bool, proxyAuth: ProxiedHttpPlugin.ProxyAuth?) {
        self.followRedirects = followRedirects
        self.proxyAuth = proxyAuth
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(followRedirects ? request : nil)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard let auth = proxyAuth else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        let space = challenge.protectionSpace
        guard space.host == auth.host, space.port == auth.port else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, auth.credential)
    }
}
