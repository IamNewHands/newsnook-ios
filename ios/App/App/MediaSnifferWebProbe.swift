import Foundation
import UIKit
import WebKit

/// 嗅探用的 WKWebView 基类：装探针脚本 + 收 `WKScriptMessageHandler` 上报，
/// 去重后交给子类。
///
/// 与 Android 的差别：Android 的探针靠 `WebViewClient.shouldInterceptRequest`
/// 拿网络层事件，iOS 拿不到（见 `MediaSnifferStreamProxy` 的说明），所以这里的
/// 观察结果**全部**来自注入脚本（fetch/XHR/MSE/performance/DOM/播放器配置）。
class MediaSnifferWebViewHost: NSObject, WKScriptMessageHandler {
    let sessionId: String
    private let maxBodyText: Int
    private let usesEphemeralStore: Bool
    private let onObservation: (JSObject) -> Void
    private var observations: [JSObject] = []
    private var identities = Set<String>()
    private var webView: WKWebView?

    init(
        sessionId: String,
        maxBodyText: Int = 262144,
        usesEphemeralStore: Bool = true,
        onObservation: @escaping (JSObject) -> Void
    ) {
        self.sessionId = sessionId
        self.maxBodyText = maxBodyText
        self.usesEphemeralStore = usesEphemeralStore
        self.onObservation = onObservation
    }

    var currentWebView: WKWebView? { webView }
    var collected: [JSObject] { observations }

    /// 建 WebView、装脚本、发请求。必须在主线程调用。
    @discardableResult
    func load(url: String, referrer: String?, frame: CGRect) -> WKWebView? {
        guard let target = URL(string: url) else { return nil }
        let configuration = WKWebViewConfiguration()
        if usesEphemeralStore {
            // 一次性嗅探不该污染用户正常浏览的 Cookie / 缓存；
            // 「原站播放器」要沿用正常会话，所以那个用默认 store。
            configuration.websiteDataStore = .nonPersistent()
        }
        let controller = configuration.userContentController
        controller.addUserScript(
            WKUserScript(
                source: MediaSnifferProbeScript.make(
                    nonce: sessionId,
                    maxBodyText: maxBodyText
                ),
                injectionTime: .atDocumentStart,
                // 跨域 iframe 里才是播放器本体，必须一起注入。
                forMainFrameOnly: false
            )
        )
        controller.add(self, name: MediaSnifferProbeScript.messageHandlerName)

        let created = WKWebView(frame: frame, configuration: configuration)
        created.isOpaque = false
        created.backgroundColor = .clear
        webView = created

        var request = URLRequest(url: target)
        if let referrer, let refURL = URL(string: referrer) {
            request.setValue(refURL.absoluteString, forHTTPHeaderField: "Referer")
        }
        created.load(request)
        return created
    }

    func stop() {
        guard let webView else { return }
        webView.stopLoading()
        webView.configuration.userContentController
            .removeScriptMessageHandler(forName: MediaSnifferProbeScript.messageHandlerName)
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
        self.webView = nil
    }

    /// 让页面把 `window.__newsnookMediaEvents` 交回来（补上可能被优先级淘汰、
    /// 因而没有即时上报的那些条目）。
    func collectFromPage(completion: @escaping () -> Void) {
        guard let webView else {
            completion()
            return
        }
        webView.evaluateJavaScript(
            "window.__newsnookCollectMedia ? JSON.stringify(window.__newsnookCollectMedia()) : '[]'"
        ) { [weak self] result, _ in
            if let json = result as? String {
                self?.merge(json: json)
            }
            completion()
        }
    }

    private func merge(json: String) {
        guard
            let data = json.data(using: .utf8),
            let raw = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]
        else { return }
        for item in raw {
            guard let payload = JSTypes.coerceDictionaryToJSObject(item as NSDictionary) else {
                continue
            }
            admit(payload, notify: false)
        }
    }

    func admit(_ payload: JSObject, notify: Bool) {
        let identity = Self.identity(payload)
        guard !identities.contains(identity) else { return }
        identities.insert(identity)
        observations.append(payload)
        if notify { onObservation(payload) }
    }

    private static func identity(_ payload: JSObject) -> String {
        [
            payload["source"] as? String ?? "",
            payload["url"] as? String ?? "",
            payload["mimeType"] as? String ?? "",
            payload["drmKeySystem"] as? String ?? "",
            payload["bodyText"] == nil ? "" : "body",
        ].joined(separator: "|")
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == MediaSnifferProbeScript.messageHandlerName else { return }
        guard
            let dictionary = message.body as? [String: Any],
            let payload = JSTypes.coerceDictionaryToJSObject(dictionary as NSDictionary)
        else { return }
        admit(payload, notify: true)
    }
}

/// 一次性嗅探：加载页面、等安静窗口或超时，然后把结果交回去。
final class MediaSnifferProbe: MediaSnifferWebViewHost {
    private static let quietWindow: TimeInterval = 0.8
    private static let pollInterval: TimeInterval = 0.2
    /// 页面刚加载完就立刻「安静退出」会在真正的媒体请求之前结束会话，给一段宽限。
    private static let loadGrace: TimeInterval = 1.5

    private let onFinish: ([JSObject], String?) -> Void
    private var finished = false
    private var loadedAt: Date?
    private var pollTimer: Timer?
    private var timeoutTimer: Timer?

    init(
        sessionId: String,
        onObservation: @escaping (JSObject) -> Void,
        onFinish: @escaping ([JSObject], String?) -> Void
    ) {
        self.onFinish = onFinish
        super.init(sessionId: sessionId, onObservation: onObservation)
    }

    func start(url: String, referrer: String?, timeoutMs: Int) {
        guard load(url: url, referrer: referrer, frame: CGRect(x: 0, y: 0, width: 1, height: 1)) != nil
        else {
            finish()
            return
        }
        currentWebView?.navigationDelegate = self
        timeoutTimer = Timer.scheduledTimer(
            withTimeInterval: TimeInterval(timeoutMs) / 1000,
            repeats: false
        ) { [weak self] _ in
            self?.finish()
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        timeoutTimer?.invalidate()
        timeoutTimer = nil
        pollTimer?.invalidate()
        pollTimer = nil
        let pageUrl = currentWebView?.url?.absoluteString
        collectFromPage { [weak self] in
            guard let self else { return }
            let collected = self.collected
            self.stop()
            self.onFinish(collected, pageUrl)
        }
    }

    /// 安静退出：JS 侧已经把「抓到重点」的时间戳写在 `__newsnookLastHighValueAt`，
    /// 这里只读这一个数，避免把 `isHighValue` 的规则复制成第二份真相。
    private func pollQuietWindow() {
        guard !finished, let webView = currentWebView else { return }
        guard let loadedAt, Date().timeIntervalSince(loadedAt) >= Self.loadGrace else { return }
        webView.evaluateJavaScript("Number(window.__newsnookLastHighValueAt) || 0") { [weak self] result, _ in
            guard let self, !self.finished else { return }
            let lastMillis = (result as? NSNumber)?.doubleValue ?? 0
            guard lastMillis > 0 else { return }
            let idle = Date().timeIntervalSince1970 - lastMillis / 1000
            if idle >= Self.quietWindow { self.finish() }
        }
    }
}

extension MediaSnifferProbe: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadedAt = Date()
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(
            withTimeInterval: Self.pollInterval,
            repeats: true
        ) { [weak self] _ in
            self?.pollQuietWindow()
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        // 加载失败也把已经收到的观察结果交回去，别让上层干等。
        finish()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        finish()
    }
}

/// 可见的「原站播放器」会话：把原站页面放进一个覆盖在 WebView 之上的原生视图里，
/// 同时用同一份探针脚本持续上报媒体地址。
///
/// 与 Android 的差别：Android 会做音频静音 / 画面置空 / onResume 之类的细节处理，
/// iOS 这里只做「显示 / 隐藏 + 位置」，其余交给页面自己。
final class MediaSnifferLiveSession: MediaSnifferWebViewHost {
    private var container: UIView?
    private var bounds: CGRect = .zero
    private var visible = true

    init(sessionId: String, onObservation: @escaping (JSObject) -> Void) {
        super.init(
            sessionId: sessionId,
            usesEphemeralStore: false,
            onObservation: onObservation
        )
    }

    func start(url: String, referrer: String?, in host: UIView) {
        let container = UIView(frame: host.bounds)
        container.backgroundColor = .clear
        container.clipsToBounds = true
        // 与 Android 一样先隐藏：JS 拿到 session 后再调 setLiveSessionBounds 定位，
        // 定位前的每一帧都不该闪出来。
        container.isHidden = true
        host.addSubview(container)
        self.container = container

        guard
            let webView = load(url: url, referrer: referrer, frame: container.bounds)
        else { return }
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(webView)
    }

    func setVisible(_ next: Bool) {
        visible = next
        applyVisibility()
    }

    func setBounds(_ rect: CGRect, cornerRadius: CGFloat) {
        bounds = rect
        guard let container else { return }
        container.frame = rect
        container.layer.cornerRadius = max(0, cornerRadius)
        currentWebView?.frame = CGRect(origin: .zero, size: rect.size)
        applyVisibility()
    }

    private func applyVisibility() {
        guard let container else { return }
        // 有位置才显示：没定位过就显示会盖住整个界面。
        container.isHidden = !visible || bounds.isEmpty
    }

    func teardown() {
        stop()
        container?.removeFromSuperview()
        container = nil
        bounds = .zero
    }
}
