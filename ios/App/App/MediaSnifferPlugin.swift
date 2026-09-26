import Capacitor
import Foundation
import UIKit

/// iOS 侧的媒体嗅探与播放中转。
///
/// **架构与 Android 不同，这是本轮移植最需要说明的一处：**
/// Android 靠 `WebViewClient.shouldInterceptRequest` 在网络层拦下 WebView 的每一个
/// 子请求，所以 `sniff` 能拿到全部媒体请求。WKWebView 跑在独立网络进程，iOS 15–17
/// **没有**公开的 HTTPS 子请求拦截 API（`URLProtocol` 对 WKWebView 无效，只有
/// iOS 18+ 的 `proxyConfigurations`），所以 iOS 分两条路补：
///
/// 1. **观察**：注入探针脚本（`MediaSnifferProbeScript`），钩 `fetch` /
///    `XMLHttpRequest` / `MediaSource` / `requestMediaKeySystemAccess`，扫
///    `performance` 资源条目与 `<video>/<audio>/<source>`，再递归翻播放器配置对象。
///    覆盖绝大多数直连播放器，但拿不到跨进程的媒体子请求与 Service Worker 内部的
///    请求——这是平台限制，不是没写完。
/// 2. **中转**：`MediaSnifferStreamProxy` 在 127.0.0.1 起一个只服务
///    `GET /stream?url=…` 的小 HTTP 服务，把 `preparePlayback` 注册的
///    Referer / User-Agent / Origin 补上再拉上游。JS 侧把 `<video src>` 换成这个
///    地址（`nativeStreamProxyUrl`），于是防盗链源也能播——这正是 Android 靠
///    拦截实现的那件事，在 iOS 上改成显式换地址。
@objc(MediaSnifferPlugin)
public final class MediaSnifferPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MediaSnifferPlugin"
    public let jsName = "MediaSniffer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sniff", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preparePlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStreamProxyPort", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLiveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLiveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLiveSessionVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLiveSessionBounds", returnType: CAPPluginReturnPromise),
    ]

    // 与 Java 侧同名的边界值。
    private static let minTimeoutMs = 1500
    private static let maxTimeoutMs = 12000
    private static let maxBodyTextBytes = 262144
    /// 与 Java `SAFE_REQUEST_HEADERS` 一致：只放行这几类，别把 Authorization 之类的
    /// 敏感头交给任意上游地址。
    private static let safeRequestHeaders: Set<String> = [
        "accept", "accept-language", "origin", "referer", "user-agent",
    ]

    /// 一次性嗅探按 sessionId 持有；结束即移除，避免泄漏 WebView。
    private var probes: [String: MediaSnifferProbe] = [:]
    /// 可见的「原站播放器」会话最多一个（与 Java 的 liveWebView 一致）。
    private var liveSession: MediaSnifferLiveSession?
    private var liveSessionId: String?

    // MARK: - 嗅探

    @objc func sniff(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), Self.isAllowedPageURL(url) else {
            call.reject("仅支持 HTTP/HTTPS 原文地址")
            return
        }
        let requested = call.getInt("timeoutMs", 6000)
        let timeoutMs = min(Self.maxTimeoutMs, max(Self.minTimeoutMs, requested))
        var referrer = call.getString("referrer")
        if !Self.isAllowedPageURL(referrer) { referrer = nil }
        let sessionId = Self.nonBlank(call.getString("sessionId", "")) ?? UUID().uuidString

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("嗅探失败：插件已释放")
                return
            }
            let probe = MediaSnifferProbe(
                sessionId: sessionId,
                onObservation: { [weak self] payload in
                    self?.notifyListeners(
                        "mediaObservation",
                        data: ["sessionId": sessionId, "observation": payload]
                    )
                },
                onFinish: { [weak self] observations, pageUrl in
                    self?.probes.removeValue(forKey: sessionId)
                    var result: [String: Any] = ["observations": observations]
                    if let pageUrl, !pageUrl.isEmpty { result["pageUrl"] = pageUrl }
                    call.resolve(result)
                }
            )
            self.probes[sessionId] = probe
            probe.start(url: url, referrer: referrer, timeoutMs: timeoutMs)
        }
    }

    // MARK: - 播放上下文与本地中转

    @objc func preparePlayback(_ call: CAPPluginCall) {
        let url = call.getString("url", "")
        var sourcePage = call.getString("sourcePage")
        if !Self.isAllowedPageURL(sourcePage) { sourcePage = nil }

        let opaque = url.hasPrefix("blob:") || url.hasPrefix("data:")
        if opaque {
            if sourcePage == nil {
                call.reject("媒体地址无效")
                return
            }
            // blob:/data: 没有可代理的地址，本机中转帮不上忙；
            // Android 也只在有 sourcePage 时注册一个「原点种子」上下文。
            call.resolve()
            return
        }
        guard Self.isAllowedPageURL(url) else {
            call.reject("媒体地址无效")
            return
        }

        // 与 Android 一致：上下文按目标 URL 注册，中转请求回来时用它补请求头。
        // 这里不区分 `intercept`：JS 只在需要中转时才会去问 `getStreamProxyPort`，
        // 注册本身没有副作用。
        MediaSnifferStreamProxy.shared.register(
            url: url,
            headers: Self.safeHeaders(call.getObject("headers")),
            proxy: Self.proxyConfig(call.getObject("proxy"))
        )
        call.resolve()
    }

    @objc func getStreamProxyPort(_ call: CAPPluginCall) {
        do {
            let port = try MediaSnifferStreamProxy.shared.ensureStarted()
            call.resolve(["port": port])
        } catch {
            call.reject(MediaSnifferError.proxyStartFailed.message)
        }
    }

    // MARK: - 原站播放器（可见 WebView）

    @objc func startLiveSession(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), Self.isAllowedPageURL(url) else {
            call.reject("仅支持 HTTP/HTTPS 原文地址")
            return
        }
        var referrer = call.getString("referrer")
        if !Self.isAllowedPageURL(referrer) { referrer = nil }
        let sessionId = Self.nonBlank(call.getString("sessionId", "")) ?? UUID().uuidString

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("原站播放器未能启动")
                return
            }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("原站播放器未能启动")
                return
            }
            // 与 Java 一致：同时只保留一个 live session。
            self.teardownLiveSession()

            let session = MediaSnifferLiveSession(sessionId: sessionId) { [weak self] payload in
                self?.notifyListeners(
                    "mediaObservation",
                    data: ["sessionId": sessionId, "observation": payload]
                )
            }
            session.start(url: url, referrer: referrer, in: host)
            self.liveSession = session
            self.liveSessionId = sessionId
            call.resolve()
        }
    }

    @objc func stopLiveSession(_ call: CAPPluginCall) {
        let requested = Self.nonBlank(call.getString("sessionId", ""))
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve()
                return
            }
            // 不匹配的 sessionId 不动别人的会话。
            if requested == nil || requested == self.liveSessionId {
                self.teardownLiveSession()
            }
            call.resolve()
        }
    }

    @objc func setLiveSessionVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible", true)
        DispatchQueue.main.async { [weak self] in
            self?.liveSession?.setVisible(visible)
            call.resolve()
        }
    }

    @objc func setLiveSessionBounds(_ call: CAPPluginCall) {
        let x = call.getDouble("x", 0)
        let y = call.getDouble("y", 0)
        let width = call.getDouble("width", 0)
        let height = call.getDouble("height", 0)
        let cornerRadius = call.getDouble("cornerRadius", 0)
        DispatchQueue.main.async { [weak self] in
            guard let self, let session = self.liveSession else {
                call.resolve()
                return
            }
            guard width > 0, height > 0 else {
                // 宽高为 0 说明 JS 那边还没量到位置，先藏起来。
                session.setVisible(false)
                call.resolve()
                return
            }
            session.setBounds(
                CGRect(x: x, y: y, width: width, height: height),
                cornerRadius: cornerRadius
            )
            call.resolve()
        }
    }

    deinit {
        // 插件被销毁时别把 WebView 留在视图树里。
        let session = liveSession
        liveSession = nil
        liveSessionId = nil
        DispatchQueue.main.async {
            session?.teardown()
        }
    }

    private func teardownLiveSession() {
        liveSession?.teardown()
        liveSession = nil
        liveSessionId = nil
    }

    // MARK: - 工具

    private static func isAllowedPageURL(_ value: String?) -> Bool {
        guard let value, !value.isEmpty else { return false }
        let lower = value.lowercased()
        return lower.hasPrefix("http://") || lower.hasPrefix("https://")
    }

    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private static func safeHeaders(_ object: JSObject?) -> [String: String] {
        guard let object else { return [:] }
        var result: [String: String] = [:]
        for (key, value) in object {
            guard safeRequestHeaders.contains(key.lowercased()) else { continue }
            guard let text = value as? String, !text.isEmpty else { continue }
            result[key] = text
        }
        return result
    }

    /// 只有 HTTP 代理能用：iOS 没有 SOCKS5 的公开通道（与 ProxiedHttp 一致）。
    private static func proxyConfig(_ object: JSObject?) -> MediaSnifferStreamProxy.ProxyConfig? {
        guard let object else { return nil }
        guard let type = object["type"] as? String, type == "http" else { return nil }
        guard
            let host = object["host"] as? String, !host.isEmpty,
            let port = object["port"] as? Int, port > 0
        else { return nil }
        return MediaSnifferStreamProxy.ProxyConfig(host: host, port: port)
    }
}
