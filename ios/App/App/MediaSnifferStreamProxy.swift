import Foundation

/// 本机媒体中转：把 `GET /stream?url=<原始地址>` 转成「带上抓到的 Referer /
/// User-Agent / Origin」的上游请求，再把响应（含 `Range`）原样流回。
///
/// 与 Android `LocalStreamProxy` 同契约：
/// - 只监听 `127.0.0.1` 的临时端口，路由只有 `GET /stream`；
/// - 上游请求头来自 `preparePlayback` 注册的上下文（白名单见 `MediaSnifferPlugin`）；
/// - `Range` 原样透传；响应头除 `connection` / `keep-alive` / `transfer-encoding` /
///   `content-encoding` / `host` 外全部转发，缺 `Accept-Ranges` 时补一个；
/// - 响应体边收边发，不先缓到内存（视频可能几百 MB）。
///
/// 为什么 iOS 需要它：WKWebView 跑在独立网络进程，iOS 15–17 **没有**公开的 HTTPS
/// 子请求拦截 API（`URLProtocol` 对 WKWebView 无效，只有 iOS 18+ 的
/// `proxyConfigurations`）。所以 Android 那套「OkHttp 拦截 WebView 请求」在 iOS 上
/// 不成立，改成 JS 把 `<video src>` 换成这个本机中转地址（`nativeStreamProxyUrl`），
/// 由本类补上防盗链需要的请求头。
///
/// 用 BSD socket 而不是 `NWListener`：只需要「accept → 读一个 GET 头 → 流式回写」，
/// 裸 socket 的阻塞语义更好推理，而且能显式设 `SO_NOSIGPIPE`（否则客户端断开时
/// `send` 会发 SIGPIPE 直接把进程干掉）。
final class MediaSnifferStreamProxy {
    static let shared = MediaSnifferStreamProxy()

    struct PlaybackContext {
        let headers: [String: String]
        let proxy: ProxyConfig?
    }

    struct ProxyConfig {
        let host: String
        let port: Int
    }

    private let lock = NSLock()
    private var contexts: [String: PlaybackContext] = [:]
    private var listenDescriptor: Int32 = -1
    private var listenPort = 0

    private init() {}

    // MARK: - 上下文注册

    func register(url: String, headers: [String: String], proxy: ProxyConfig?) {
        lock.lock()
        contexts[url] = PlaybackContext(headers: headers, proxy: proxy)
        lock.unlock()
    }

    func context(for url: String) -> PlaybackContext? {
        lock.lock()
        defer { lock.unlock() }
        return contexts[url]
    }

    // MARK: - 生命周期

    /// 幂等启动，返回监听端口。
    func ensureStarted() throws -> Int {
        lock.lock()
        defer { lock.unlock() }
        if listenDescriptor >= 0, listenPort > 0 { return listenPort }

        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw MediaSnifferError.proxyStartFailed }

        var reuse: Int32 = 1
        _ = setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_REUSEADDR,
            &reuse,
            socklen_t(MemoryLayout<Int32>.size)
        )
        // 客户端随时可能断开（用户拖进度条就会取消旧请求），没有这个选项
        // 一次 send 失败就是整个 App 被 SIGPIPE 杀掉。
        var noSignal: Int32 = 1
        _ = setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_NOSIGPIPE,
            &noSignal,
            socklen_t(MemoryLayout<Int32>.size)
        )

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        guard inet_pton(AF_INET, "127.0.0.1", &address.sin_addr) == 1 else {
            close(descriptor)
            throw MediaSnifferError.proxyStartFailed
        }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { raw in
                bind(descriptor, raw, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, listen(descriptor, 50) == 0 else {
            close(descriptor)
            throw MediaSnifferError.proxyStartFailed
        }

        var actual = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &actual) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { raw in
                getsockname(descriptor, raw, &length)
            }
        }
        guard named == 0 else {
            close(descriptor)
            throw MediaSnifferError.proxyStartFailed
        }

        listenDescriptor = descriptor
        listenPort = Int(UInt16(bigEndian: actual.sin_port))
        Thread.detachNewThread { [weak self] in
            self?.acceptLoop(descriptor)
        }
        return listenPort
    }

    private func acceptLoop(_ descriptor: Int32) {
        while true {
            var clientAddress = sockaddr_in()
            var length = socklen_t(MemoryLayout<sockaddr_in>.size)
            let client = withUnsafeMutablePointer(to: &clientAddress) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { raw in
                    accept(descriptor, raw, &length)
                }
            }
            if client < 0 {
                // EINTR 是信号打断，继续等；其他错误说明监听套接字没了。
                if errno == EINTR { continue }
                return
            }
            var noSignal: Int32 = 1
            _ = setsockopt(
                client,
                SOL_SOCKET,
                SO_NOSIGPIPE,
                &noSignal,
                socklen_t(MemoryLayout<Int32>.size)
            )
            var timeout = timeval(tv_sec: 30, tv_usec: 0)
            _ = setsockopt(
                client,
                SOL_SOCKET,
                SO_RCVTIMEO,
                &timeout,
                socklen_t(MemoryLayout<timeval>.size)
            )
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handle(client: client)
            }
        }
    }

    // MARK: - 单个请求

    private func handle(client: Int32) {
        defer { close(client) }
        guard let request = Self.readRequest(client) else {
            Self.writeError(client, code: 400, reason: "Bad Request")
            return
        }
        guard request.method == "GET" else {
            Self.writeError(client, code: 405, reason: "Method Not Allowed")
            return
        }
        guard request.path == "/stream" else {
            Self.writeError(client, code: 404, reason: "Not Found")
            return
        }
        guard let target = request.query["url"], !target.isEmpty else {
            Self.writeError(client, code: 400, reason: "Missing url")
            return
        }
        guard let context = context(for: target) else {
            // 与 Android 一致：没注册过上下文的地址不代拉，避免变成开放代理。
            Self.writeError(client, code: 404, reason: "Playback Context Missing")
            return
        }

        let relay = StreamRelayTask(
            descriptor: client,
            context: context,
            range: request.headers["range"]
        )
        relay.run(target: target)
    }

    // MARK: - HTTP 解析与写出

    private struct HttpRequest {
        let method: String
        let path: String
        let query: [String: String]
        let headers: [String: String]
    }

    private static func readRequest(_ descriptor: Int32) -> HttpRequest? {
        var buffer = [UInt8]()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while buffer.count < 16 * 1024 {
            let received = recv(descriptor, &chunk, chunk.count, 0)
            if received <= 0 { return nil }
            buffer.append(contentsOf: chunk[0..<received])
            guard let end = headerEndIndex(buffer) else { continue }
            let head = String(decoding: buffer[0..<end], as: UTF8.self)
            return parseHead(head)
        }
        return nil
    }

    private static func headerEndIndex(_ bytes: [UInt8]) -> Int? {
        guard bytes.count >= 4 else { return nil }
        for index in 0...(bytes.count - 4) {
            if bytes[index] == 13, bytes[index + 1] == 10,
               bytes[index + 2] == 13, bytes[index + 3] == 10
            {
                return index
            }
        }
        return nil
    }

    private static func parseHead(_ head: String) -> HttpRequest? {
        let lines = head.split(whereSeparator: { $0 == "\r" || $0 == "\n" })
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }

        let method = String(parts[0]).uppercased()
        let target = String(parts[1])
        var path = target
        var queryText = ""
        if let mark = target.firstIndex(of: "?") {
            path = String(target[target.startIndex..<mark])
            queryText = String(target[target.index(after: mark)...])
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let name = line[line.startIndex..<separator]
                .trimmingCharacters(in: .whitespaces)
                .lowercased()
            let value = line[line.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { headers[name] = value }
        }
        return HttpRequest(
            method: method,
            path: path,
            query: parseQuery(queryText),
            headers: headers
        )
    }

    static func parseQuery(_ text: String) -> [String: String] {
        var result: [String: String] = [:]
        for pair in text.split(separator: "&") where !pair.isEmpty {
            guard let separator = pair.firstIndex(of: "=") else { continue }
            let name = String(pair[pair.startIndex..<separator])
            let raw = String(pair[pair.index(after: separator)...])
            result[name] = raw.replacingOccurrences(of: "+", with: " ").removingPercentEncoding
                ?? raw
        }
        return result
    }

    static func writeError(_ descriptor: Int32, code: Int, reason: String) {
        let body = Array(reason.utf8)
        var head = "HTTP/1.1 \(code) \(reason)\r\n"
        head += "Content-Type: text/plain; charset=utf-8\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        writeAll(descriptor, Array(head.utf8))
        writeAll(descriptor, body)
    }

    static func writeAll(_ descriptor: Int32, _ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        bytes.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let written = send(descriptor, base + offset, buffer.count - offset, 0)
                if written <= 0 {
                    if errno == EINTR { continue }
                    // 客户端断开（拖进度条很常见）：放弃这次中转，不是错误。
                    return
                }
                offset += written
            }
        }
    }

    static func shouldSkipResponseHeader(_ name: String) -> Bool {
        switch name.lowercased() {
        case "connection", "keep-alive", "transfer-encoding", "content-encoding", "host":
            return true
        default:
            return false
        }
    }

    static func reasonPhrase(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 206: return "Partial Content"
        case 301: return "Moved Permanently"
        case 302: return "Found"
        case 304: return "Not Modified"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 416: return "Range Not Satisfiable"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        default: return "OK"
        }
    }
}

enum MediaSnifferError: Error {
    case proxyStartFailed
    case pageNotAllowed
    case mediaUrlInvalid
    case liveSessionUnsupported

    var message: String {
        switch self {
        case .proxyStartFailed:
            return "无法启动本地视频代理"
        case .pageNotAllowed:
            return "仅支持 HTTP/HTTPS 原文地址"
        case .mediaUrlInvalid:
            return "媒体地址无效"
        case .liveSessionUnsupported:
            return "iOS 暂不支持原站播放器内嵌视图"
        }
    }
}

/// 一次中转：URLSession 边收边写回客户端 socket，`run` 阻塞到结束。
private final class StreamRelayTask: NSObject, URLSessionDataDelegate {
    private let descriptor: Int32
    private let context: MediaSnifferStreamProxy.PlaybackContext
    private let range: String?
    private let semaphore = DispatchSemaphore(value: 0)
    private var session: URLSession?
    private var didWriteHead = false

    init(
        descriptor: Int32,
        context: MediaSnifferStreamProxy.PlaybackContext,
        range: String?
    ) {
        self.descriptor = descriptor
        self.context = context
        self.range = range
    }

    func run(target: String) {
        guard let url = URL(string: target) else {
            MediaSnifferStreamProxy.writeError(descriptor, code: 502, reason: "Invalid Upstream Url")
            return
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        // 长视频可能连着放几小时，资源超时必须放宽。
        configuration.timeoutIntervalForResource = 3600
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        if let proxy = context.proxy {
            // iOS 只支持 HTTP 代理隧道（SOCKS5 没有公开通道，与 ProxiedHttp 一致）。
            // 带认证的代理这里不处理：`connectionProxyDictionary` 不带凭据，
            // 需要认证时由调用方改用直连或换不带认证的代理。
            configuration.connectionProxyDictionary = [
                "HTTPEnable": 1,
                "HTTPProxy": proxy.host,
                "HTTPPort": proxy.port,
                "HTTPSEnable": 1,
                "HTTPSProxy": proxy.host,
                "HTTPSPort": proxy.port,
            ]
        }

        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        self.session = session

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        for (name, value) in context.headers where !value.isEmpty {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let range, !range.isEmpty {
            request.setValue(range, forHTTPHeaderField: "Range")
        }

        session.dataTask(with: request).resume()
        semaphore.wait()
        session.invalidateAndCancel()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            MediaSnifferStreamProxy.writeError(
                descriptor,
                code: 502,
                reason: "Bad Upstream Response"
            )
            completionHandler(.cancel)
            return
        }

        var head = "HTTP/1.1 \(http.statusCode) "
            + "\(MediaSnifferStreamProxy.reasonPhrase(http.statusCode))\r\n"
        head += "Connection: close\r\n"
        for (name, value) in http.allHeaderFields {
            let key = "\(name)"
            if MediaSnifferStreamProxy.shouldSkipResponseHeader(key) { continue }
            head += "\(key): \(value)\r\n"
        }
        if http.value(forHTTPHeaderField: "Accept-Ranges") == nil {
            head += "Accept-Ranges: bytes\r\n"
        }
        head += "\r\n"
        MediaSnifferStreamProxy.writeAll(descriptor, Array(head.utf8))
        didWriteHead = true
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        MediaSnifferStreamProxy.writeAll(descriptor, [UInt8](data))
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        // 上游还没回响应就失败：补一个 502，别让客户端一直等。
        if !didWriteHead {
            MediaSnifferStreamProxy.writeError(
                descriptor,
                code: 502,
                reason: "Empty Upstream Response"
            )
        }
        semaphore.signal()
    }
}
