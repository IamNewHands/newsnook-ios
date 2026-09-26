import Capacitor
import Foundation

/// iOS 侧的 DLNA 投屏（UPnP MediaRenderer 遥控）。
///
/// 与 Android 侧的能力边界差别，两条都写在这里，免得以后当成 bug 查：
///
/// 1. **发现**：Android 发 UDP 组播（239.255.255.250:1900），iOS 上向组播地址发包
///    需要 Apple 特批的 `com.apple.developer.networking.multicast` entitlement，
///    自签/侧载拿不到。这里改成单播 M-SEARCH 扫段（见 `DlnaSsdp`），并额外提供
///    `addManualDevice` 让用户直接填电视 IP —— 两条路都不需要那个 entitlement。
/// 2. **兼容中转（proxy 模式）**：Android 在电视无法直连视频源时会把视频经本机
///    前台服务中转（`CastMediaProxy` + `DlnaCastForegroundService`）。iOS 侧本轮
///    只做直连：中转需要一个本机 HTTP 服务器，属于独立能力，未实现。
///    直连确认失败时会明确 reject（而不是静默失败），`mode` 始终回 `direct`。
@objc(DlnaCastPlugin)
public final class DlnaCastPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DlnaCastPlugin"
    public let jsName = "DlnaCast"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "control", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        // iOS 专属：手动填电视 IP —— 单播扫段之外的第二条发现路径。
        CAPPluginMethod(name: "addManualDevice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeManualDevice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listManualDevices", returnType: CAPPluginReturnPromise),
    ]

    // 与 Java 侧同名的边界值。
    private static let minDiscoveryMs = 800
    private static let maxDiscoveryMs = 6000
    private static let directProbeSeconds: TimeInterval = 3.2
    private static let directProbeStableSeconds: TimeInterval = 1.8
    private static let savedCastTTL: TimeInterval = 12 * 60 * 60
    private static let manualSearchSeconds: TimeInterval = 2.0
    private static let manualDefaultsKey = "newsnook_dlna_manual_devices"
    private static let resumeDefaultsKey = "newsnook_dlna_cast_resume"
    /// 手动填 IP 时，除了单播 M-SEARCH 之外还按这些常见路径探测设备描述。
    private static let descriptionProbePaths = [
        "/",
        "/description.xml",
        "/rootDesc.xml",
        "/upnp/description.xml",
        "/dmr/description.xml",
    ]

    /// 所有网络与状态操作都在这个串行队列上跑；`devices` / `sessions` 只在这里读写。
    private let workQueue = DispatchQueue(label: "com.aizeek.newsnook.dlna-cast", qos: .userInitiated)
    private let http = DlnaHttpClient()

    private var devices: [String: DlnaRendererDevice] = [:]
    private var sessions: [String: DlnaCastSession] = [:]

    // MARK: - 发现

    @objc func discover(_ call: CAPPluginCall) {
        let requested = call.getInt("timeoutMs", 2600)
        let timeoutMs = min(Self.maxDiscoveryMs, max(Self.minDiscoveryMs, requested))

        workQueue.async { [weak self] in
            guard let self else {
                Self.reject(call, "搜索投屏设备失败：插件已释放")
                return
            }
            do {
                let found = try self.discoverRenderers(timeoutMs: timeoutMs)
                // 手动添加的设备带 `manual: true`，JS 侧据此给「移除」入口。
                let manualIds = Set(self.manualDevices.keys)
                let payload: [[String: Any]] = found.map { device in
                    var json = device.json
                    if manualIds.contains(device.id) { json["manual"] = true }
                    return json
                }
                Self.resolve(call, ["devices": payload])
            } catch {
                Self.reject(call, Self.discoveryFailureMessage(error))
            }
        }
    }

    @objc func addManualDevice(_ call: CAPPluginCall) {
        guard let raw = DlnaXml.nonEmpty(call.getString("address", "")) else {
            call.reject("请填写电视的 IP 地址")
            return
        }
        let label = DlnaXml.nonEmpty(call.getString("name", ""))

        workQueue.async { [weak self] in
            guard let self else {
                Self.reject(call, "添加投屏设备失败：插件已释放")
                return
            }
            do {
                var device = try self.resolveManualDevice(address: raw)
                if let label { device = device.withName(label) }
                var manual = self.manualDevices
                manual[device.id] = device
                self.manualDevices = manual
                self.devices[device.id] = device
                Self.resolve(call, ["device": Self.manualJSON(device)])
            } catch {
                Self.reject(call, Self.describe(error))
            }
        }
    }

    @objc func removeManualDevice(_ call: CAPPluginCall) {
        guard let deviceId = DlnaXml.nonEmpty(call.getString("deviceId", "")) else {
            call.reject("缺少投屏设备")
            return
        }
        workQueue.async { [weak self] in
            guard let self else {
                Self.resolve(call)
                return
            }
            var manual = self.manualDevices
            manual.removeValue(forKey: deviceId)
            self.manualDevices = manual
            self.devices.removeValue(forKey: deviceId)
            Self.resolve(call)
        }
    }

    @objc func listManualDevices(_ call: CAPPluginCall) {
        workQueue.async { [weak self] in
            guard let self else {
                Self.resolve(call, ["devices": []])
                return
            }
            let payload: [[String: Any]] = self.manualDevices.values
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                .map { Self.manualJSON($0) }
            Self.resolve(call, ["devices": payload])
        }
    }

    // MARK: - 投屏

    @objc func start(_ call: CAPPluginCall) {
        guard let deviceId = DlnaXml.nonEmpty(call.getString("deviceId", "")) else {
            call.reject("缺少投屏设备")
            return
        }
        guard
            let rawURL = call.getString("url"),
            DlnaSsdp.isHTTPURL(rawURL),
            let mediaURL = URL(string: rawURL)
        else {
            call.reject("当前视频是临时媒体流，无法发送到电视")
            return
        }
        let title = call.getString("title", "文章视频")
        let format = call.getString("format", "progressive")
        guard format.lowercased() != "dash" else {
            call.reject("DASH 视频源暂不支持投屏")
            return
        }
        let requestedPosition = call.getDouble("positionSeconds") ?? 0
        let startPosition = requestedPosition.isFinite ? max(0, requestedPosition) : 0

        workQueue.async { [weak self] in
            guard let self else {
                Self.reject(call, "无法开始投屏：插件已释放")
                return
            }
            guard let device = self.devices[deviceId] else {
                Self.reject(call, "投屏设备已失效，请重新搜索")
                return
            }
            do {
                try self.setTransportURI(
                    device: device,
                    mediaURL: mediaURL,
                    title: title,
                    format: format
                )
                try self.playWithRetry(device: device)
                guard self.confirmDirectPlayback(device: device) else {
                    throw DlnaError.directPlaybackUnavailable
                }
                if startPosition >= 1 {
                    // 少数渲染器在播放推进一次之前会拒绝 Seek；失败不算致命。
                    try? self.seek(device: device, seconds: startPosition)
                }
                let session = DlnaCastSession(
                    id: UUID().uuidString,
                    device: device,
                    mode: "direct",
                    sourceURL: mediaURL,
                    transportURL: mediaURL
                )
                self.sessions[session.id] = session
                self.saveResume(session)
                Self.resolve(call, session.json)
            } catch {
                Self.reject(call, "无法开始投屏：" + Self.describe(error))
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        workQueue.async { [weak self] in
            guard let self else {
                Self.resolve(call, [:])
                return
            }
            guard let saved = self.loadResume() else {
                Self.resolve(call, [:])
                return
            }
            // 与 Java 一致：超过 TTL 的「上次投屏」不再恢复。
            guard Date().timeIntervalSince1970 - saved.savedAt <= Self.savedCastTTL else {
                self.clearResume()
                Self.resolve(call, [:])
                return
            }

            let device = saved.device
            do {
                let state = try self.readTransportState(device: device)
                guard state != "stopped" else {
                    self.clearResume()
                    Self.resolve(call, [:])
                    return
                }
                guard ["playing", "paused", "transitioning"].contains(state) else {
                    Self.resolve(call, [:])
                    return
                }
                guard
                    let currentURI = try self.readCurrentTransportURI(device: device),
                    currentURI == saved.transportURL
                else {
                    self.clearResume()
                    Self.resolve(call, [:])
                    return
                }

                let session = DlnaCastSession(
                    id: UUID().uuidString,
                    device: device,
                    mode: "direct",
                    sourceURL: saved.sourceURL,
                    transportURL: saved.transportURL
                )
                self.sessions[session.id] = session
                let transport: (state: String, current: Double, duration: Double)
                do {
                    transport = try self.readTransportStatus(device: device)
                } catch {
                    transport = (state, 0, 0)
                }
                Self.resolve(call, [
                    "session": session.json,
                    "status": self.statusJSON(session: session, transport: transport),
                ])
            } catch {
                // 电视可能刚断电：恢复失败不打扰用户，静默返回空。
                Self.resolve(call, [:])
            }
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        guard let sessionId = DlnaXml.nonEmpty(call.getString("sessionId", "")) else {
            call.reject("投屏会话已结束")
            return
        }
        workQueue.async { [weak self] in
            guard let self else {
                Self.reject(call, "投屏会话已结束")
                return
            }
            guard let session = self.sessions[sessionId] else {
                Self.reject(call, "投屏会话已结束")
                return
            }
            do {
                let transport = try self.readTransportStatus(device: session.device)
                Self.resolve(call, self.statusJSON(session: session, transport: transport))
            } catch {
                Self.reject(call, "读取投屏状态失败：" + Self.describe(error))
            }
        }
    }

    @objc func control(_ call: CAPPluginCall) {
        guard
            let sessionId = DlnaXml.nonEmpty(call.getString("sessionId", "")),
            let action = DlnaXml.nonEmpty(call.getString("action", ""))
        else {
            call.reject("缺少投屏控制命令")
            return
        }
        let value = call.getDouble("value")

        workQueue.async { [weak self] in
            guard let self else {
                Self.reject(call, "投屏会话已结束")
                return
            }
            guard let session = self.sessions[sessionId] else {
                Self.reject(call, "投屏会话已结束")
                return
            }
            do {
                switch action {
                case "play":
                    _ = try self.soap(session.device.avTransport, "Play", self.playBody())
                case "pause":
                    _ = try self.soap(session.device.avTransport, "Pause", Self.instanceBody())
                case "seek":
                    guard let value, value.isFinite else {
                        throw DlnaError.invalidRequest("缺少跳转位置")
                    }
                    try self.seek(device: session.device, seconds: max(0, value))
                case "volume":
                    guard let value, value.isFinite else {
                        throw DlnaError.invalidRequest("缺少音量值")
                    }
                    try self.setVolume(device: session.device, value: value)
                default:
                    throw DlnaError.invalidRequest("不支持的投屏控制命令")
                }
                Self.resolve(call)
            } catch {
                Self.reject(call, "投屏控制失败：" + Self.describe(error))
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let sessionId = DlnaXml.nonEmpty(call.getString("sessionId", "")) else {
            call.resolve()
            return
        }
        workQueue.async { [weak self] in
            guard let self else {
                Self.resolve(call)
                return
            }
            guard let session = self.sessions.removeValue(forKey: sessionId) else {
                Self.resolve(call)
                return
            }
            // 电视可能已经离线；本地状态无论如何都要清掉。
            _ = try? self.soap(session.device.avTransport, "Stop", Self.instanceBody())
            self.clearResume()
            Self.resolve(call)
        }
    }

    // MARK: - 发现实现（workQueue）

    private func discoverRenderers(timeoutMs: Int) throws -> [DlnaRendererDevice] {
        // UserDefaults 读一次就够，后面 merge 时还要用同一份快照。
        let manual = manualDevices

        var hosts = Set<String>()
        for interface in DlnaSsdp.localIPv4Interfaces() {
            hosts.formUnion(
                DlnaSsdp.sweepHosts(address: interface.address, netmask: interface.netmask)
            )
        }
        // 手动添加过的电视也一起搜：它们可能在别的网段，或对扫段不敏感。
        for device in manual.values { hosts.insert(device.host) }

        guard !hosts.isEmpty else { throw DlnaError.noLanInterface }

        let locations = try DlnaSsdp.search(
            hosts: Array(hosts),
            timeout: TimeInterval(timeoutMs) / 1000
        )

        var found: [String: DlnaRendererDevice] = [:]
        for location in locations.keys {
            // 一台设备描述读不出来不能挡住其他电视（与 Java 的处理一致）。
            guard let url = URL(string: location), let device = try? readDescription(at: url) else {
                continue
            }
            found[device.id] = device
        }
        // 手动添加的设备即使这轮没应答也列出来：用户明确加过，宁可让他试一次。
        for device in manual.values where found[device.id] == nil {
            found[device.id] = device
        }

        devices = found
        return found.values.sorted {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    private func readDescription(at url: URL) throws -> DlnaRendererDevice {
        let xml = try http.get(url)
        guard let device = DlnaXml.parseDeviceDescription(xml, location: url) else {
            throw DlnaError.invalidResponse
        }
        return device
    }

    private func resolveManualDevice(address: String) throws -> DlnaRendererDevice {
        let parsed = try Self.parseAddress(address)

        // 1) 单播 M-SEARCH：DLNA 规范要求渲染器在 1900 上监听，这条路最可靠。
        if let locations = try? DlnaSsdp.search(
            hosts: [parsed.host],
            timeout: Self.manualSearchSeconds
        ) {
            for location in locations.keys {
                guard let url = URL(string: location), let device = try? readDescription(at: url)
                else { continue }
                return device
            }
        }

        // 2) 退一步：部分设备不回应单播 M-SEARCH，按常见描述路径探测。
        var ports: [Int] = []
        if let port = parsed.port { ports.append(port) }
        if !ports.contains(80) { ports.append(80) }
        for port in ports {
            for path in Self.descriptionProbePaths {
                guard let url = URL(string: "http://\(parsed.host):\(port)\(path)") else {
                    continue
                }
                if let device = try? readDescription(at: url) { return device }
            }
        }
        throw DlnaError.manualDeviceNotFound
    }

    /// 接受 `192.168.1.10`、`192.168.1.10:8080`、`http://192.168.1.10:8080/` 三种写法。
    private static func parseAddress(_ raw: String) throws -> (host: String, port: Int?) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), let scheme = url.scheme, !scheme.isEmpty,
           let host = url.host
        {
            return (host, url.port)
        }
        // 只填 host / host:port 时 URL(string:) 会把整串当路径，所以手工拆。
        let parts = trimmed.split(separator: ":", maxSplits: 1)
        let host = parts.first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !host.isEmpty else { throw DlnaError.manualDeviceNotFound }
        var port: Int?
        if parts.count == 2 {
            port = Int(parts[1].trimmingCharacters(in: .whitespaces))
        }
        return (host, port)
    }

    // MARK: - 手动设备持久化

    /// 手动添加的电视存 UserDefaults：用户手输过一次 IP，不该每次冷启动都重输。
    private var manualDevices: [String: DlnaRendererDevice] {
        get {
            guard let records = UserDefaults.standard.array(forKey: Self.manualDefaultsKey)
            else { return [:] }
            var result: [String: DlnaRendererDevice] = [:]
            for item in records {
                guard
                    let record = item as? [String: Any],
                    let device = DlnaRendererDevice.fromRecord(record)
                else { continue }
                result[device.id] = device
            }
            return result
        }
        set {
            UserDefaults.standard.set(
                newValue.values.map { $0.record },
                forKey: Self.manualDefaultsKey
            )
        }
    }

    // MARK: - 恢复记录

    private struct SavedCast {
        let device: DlnaRendererDevice
        let mode: String
        let sourceURL: URL
        let transportURL: URL
        let savedAt: TimeInterval
    }

    private func saveResume(_ session: DlnaCastSession) {
        UserDefaults.standard.set(
            [
                "device": session.device.record,
                "mode": session.mode,
                "sourceURL": session.sourceURL.absoluteString,
                "transportURL": session.transportURL.absoluteString,
                "savedAt": Date().timeIntervalSince1970,
            ] as [String: Any],
            forKey: Self.resumeDefaultsKey
        )
    }

    private func loadResume() -> SavedCast? {
        guard
            let record = UserDefaults.standard.dictionary(forKey: Self.resumeDefaultsKey),
            let deviceRecord = record["device"] as? [String: Any],
            let device = DlnaRendererDevice.fromRecord(deviceRecord),
            let mode = record["mode"] as? String,
            let sourceURL = (record["sourceURL"] as? String).flatMap({ URL(string: $0) }),
            let transportURL = (record["transportURL"] as? String).flatMap({ URL(string: $0) }),
            let savedAt = (record["savedAt"] as? NSNumber)?.doubleValue
        else { return nil }
        return SavedCast(
            device: device,
            mode: mode,
            sourceURL: sourceURL,
            transportURL: transportURL,
            savedAt: savedAt
        )
    }

    private func clearResume() {
        UserDefaults.standard.removeObject(forKey: Self.resumeDefaultsKey)
    }

    // MARK: - UPnP 动作（workQueue）

    private func soap(
        _ endpoint: DlnaServiceEndpoint,
        _ action: String,
        _ body: String
    ) throws -> String {
        try http.soap(endpoint, action: action, body: body)
    }

    private static func instanceBody() -> String {
        "<InstanceID>0</InstanceID>"
    }

    private func playBody() -> String {
        "<InstanceID>0</InstanceID><Speed>1</Speed>"
    }

    private func setTransportURI(
        device: DlnaRendererDevice,
        mediaURL: URL,
        title: String,
        format: String
    ) throws {
        let escapedURL = DlnaXml.xmlEscape(mediaURL.absoluteString)
        let mime = DlnaMetadata.mime(mediaURL: mediaURL.absoluteString, format: format)
        let metadata = DlnaMetadata.didl(
            mediaURL: mediaURL.absoluteString,
            title: title,
            mime: mime
        )
        let body = Self.instanceBody()
            + "<CurrentURI>\(escapedURL)</CurrentURI>"
            + "<CurrentURIMetaData>\(DlnaXml.xmlEscape(metadata))</CurrentURIMetaData>"
        do {
            _ = try soap(device.avTransport, "SetAVTransportURI", body)
        } catch {
            // 部分老电视拒绝 DIDL 元数据，但接受同一地址配空元数据。
            let fallback = Self.instanceBody()
                + "<CurrentURI>\(escapedURL)</CurrentURI>"
                + "<CurrentURIMetaData></CurrentURIMetaData>"
            _ = try soap(device.avTransport, "SetAVTransportURI", fallback)
        }
    }

    private func playWithRetry(device: DlnaRendererDevice) throws {
        do {
            _ = try soap(device.avTransport, "Play", playBody())
        } catch {
            Thread.sleep(forTimeInterval: 0.18)
            _ = try soap(device.avTransport, "Play", playBody())
        }
    }

    private func readTransportState(device: DlnaRendererDevice) throws -> String {
        let xml = try soap(device.avTransport, "GetTransportInfo", Self.instanceBody())
        return Self.normalizeTransportState(
            DlnaXml.firstText(in: xml, localName: "CurrentTransportState")
        )
    }

    private func readCurrentTransportURI(device: DlnaRendererDevice) throws -> String? {
        let positionXML = try soap(device.avTransport, "GetPositionInfo", Self.instanceBody())
        if let uri = DlnaXml.nonEmpty(DlnaXml.firstText(in: positionXML, localName: "TrackURI")) {
            return uri
        }
        let mediaXML = try soap(device.avTransport, "GetMediaInfo", Self.instanceBody())
        return DlnaXml.nonEmpty(DlnaXml.firstText(in: mediaXML, localName: "CurrentURI"))
    }

    private func readTransportStatus(
        device: DlnaRendererDevice
    ) throws -> (state: String, current: Double, duration: Double) {
        let transportXML = try soap(device.avTransport, "GetTransportInfo", Self.instanceBody())
        let positionXML = try soap(device.avTransport, "GetPositionInfo", Self.instanceBody())
        return (
            Self.normalizeTransportState(
                DlnaXml.firstText(in: transportXML, localName: "CurrentTransportState")
            ),
            DlnaTime.parse(DlnaXml.firstText(in: positionXML, localName: "RelTime")),
            DlnaTime.parse(DlnaXml.firstText(in: positionXML, localName: "TrackDuration"))
        )
    }

    private func readVolume(device: DlnaRendererDevice) throws -> Double {
        guard let control = device.renderingControl else {
            throw DlnaError.invalidRequest("设备不支持音量控制")
        }
        let xml = try soap(
            control,
            "GetVolume",
            Self.instanceBody() + "<Channel>Master</Channel>"
        )
        let raw = (DlnaXml.firstText(in: xml, localName: "CurrentVolume") ?? "")
            .trimmingCharacters(in: .whitespaces)
        guard let value = Int(raw) else {
            throw DlnaError.invalidRequest("设备返回了无效音量")
        }
        return min(1, max(0, Double(value) / 100))
    }

    private func setVolume(device: DlnaRendererDevice, value: Double) throws {
        guard let control = device.renderingControl else {
            throw DlnaError.invalidRequest("设备不支持音量控制")
        }
        let percent = Int((min(1, max(0, value)) * 100).rounded())
        _ = try soap(
            control,
            "SetVolume",
            Self.instanceBody()
                + "<Channel>Master</Channel>"
                + "<DesiredVolume>\(percent)</DesiredVolume>"
        )
    }

    private func seek(device: DlnaRendererDevice, seconds: Double) throws {
        _ = try soap(
            device.avTransport,
            "Seek",
            Self.instanceBody()
                + "<Unit>REL_TIME</Unit>"
                + "<Target>\(DlnaTime.format(seconds))</Target>"
        )
    }

    /// 与 Java `confirmDirectPlayback` 同判据：连续 1.8 秒处于 playing 才算直连成功，
    /// 期间一旦从 playing 掉到 stopped 就判定失败（多半是防盗链或格式不支持）。
    private func confirmDirectPlayback(device: DlnaRendererDevice) -> Bool {
        let deadline = Date().addingTimeInterval(Self.directProbeSeconds)
        var playingSince: Date?
        var observedPlaying = false

        while Date() < deadline {
            if let state = try? readTransportState(device: device) {
                if state == "playing" {
                    observedPlaying = true
                    if playingSince == nil { playingSince = Date() }
                    if let since = playingSince,
                       Date().timeIntervalSince(since) >= Self.directProbeStableSeconds
                    {
                        return true
                    }
                } else if state == "stopped", observedPlaying {
                    return false
                } else if state != "transitioning" {
                    playingSince = nil
                }
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
    }

    private static func normalizeTransportState(_ state: String?) -> String {
        guard let state else { return "unknown" }
        let upper = state.trimmingCharacters(in: .whitespaces).uppercased()
        if upper == "PLAYING" { return "playing" }
        if upper.hasPrefix("PAUSED") { return "paused" }
        if upper == "STOPPED" || upper == "NO_MEDIA_PRESENT" { return "stopped" }
        if upper == "TRANSITIONING" { return "transitioning" }
        return "unknown"
    }

    private func statusJSON(
        session: DlnaCastSession,
        transport: (state: String, current: Double, duration: Double)
    ) -> [String: Any] {
        var result: [String: Any] = [
            "state": transport.state,
            "current": transport.current,
            "duration": transport.duration,
            "deviceName": session.device.name,
        ]
        // 音量是可选能力：读不到就不给 volume 字段，JS 侧据此隐藏音量条。
        if session.device.renderingControl != nil,
           let volume = try? readVolume(device: session.device)
        {
            result["volume"] = volume
        }
        return result
    }

    // MARK: - 文案与桥接

    private static func manualJSON(_ device: DlnaRendererDevice) -> [String: Any] {
        var json = device.json
        json["manual"] = true
        return json
    }

    private static func discoveryFailureMessage(_ error: Error) -> String {
        // 「本地网络」被拒时不要把前缀叠上去——那句话本身就是完整指引。
        if let dlna = error as? DlnaError, case .localNetworkDenied = dlna {
            return dlna.message
        }
        return "搜索投屏设备失败：" + describe(error)
    }

    private static func describe(_ error: Error) -> String {
        if let dlna = error as? DlnaError { return dlna.message }
        let message = (error as NSError).localizedDescription
        return message.isEmpty ? "未知错误" : message
    }

    /// Capacitor 的 `resolve` / `reject` 不在主队列上调用，统一回到主线程再回。
    private static func resolve(_ call: CAPPluginCall, _ data: [String: Any] = [:]) {
        DispatchQueue.main.async { call.resolve(data) }
    }

    private static func reject(_ call: CAPPluginCall, _ message: String) {
        DispatchQueue.main.async { call.reject(message) }
    }
}

private struct DlnaCastSession {
    let id: String
    let device: DlnaRendererDevice
    let mode: String
    let sourceURL: URL
    let transportURL: URL

    var json: [String: Any] {
        [
            "id": id,
            "deviceId": device.id,
            "deviceName": device.name,
            "mode": mode,
        ]
    }
}
