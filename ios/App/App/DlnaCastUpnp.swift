import Foundation

// MARK: - 错误

enum DlnaError: Error {
    case noLanInterface
    case localNetworkDenied
    case socketUnavailable
    case invalidResponse
    case soapFailed(action: String, code: Int, detail: String?)
    case manualDeviceNotFound
    case directPlaybackUnavailable
    case noSession
    case invalidRequest(String)

    /// 面向用户的文案：与 Java 侧同义，但按 iOS 的设置路径说清楚去哪儿放开权限。
    var message: String {
        switch self {
        case .noLanInterface:
            return "未连接可用于投屏的 Wi-Fi，请先连接电视所在的局域网"
        case .localNetworkDenied:
            return "局域网访问被系统阻止。请到「设置 → 隐私与安全性 → 本地网络」允许 NewsNook 后重试"
        case .socketUnavailable, .invalidResponse:
            return "无法建立局域网搜索通道，请稍后重试"
        case .soapFailed(let action, let code, let detail):
            let suffix = (detail?.isEmpty == false) ? "：\(detail!)" : ""
            return "\(action) failed (\(code))\(suffix)"
        case .manualDeviceNotFound:
            return "没有在这台设备上找到 DLNA 投屏服务。请确认电视已开启投屏/DLNA，且 IP 填的是电视的局域网地址"
        case .directPlaybackUnavailable:
            return "电视没有开始播放这个地址（可能是防盗链拦截，或电视不支持该视频格式）"
        case .noSession:
            return "投屏会话已结束"
        case .invalidRequest(let text):
            return text
        }
    }
}

// MARK: - 设备与服务

struct DlnaServiceEndpoint {
    let serviceType: String
    let controlURL: URL
}

struct DlnaRendererDevice {
    let id: String
    let name: String
    let manufacturer: String?
    let model: String?
    let host: String
    let descriptionURL: URL
    let avTransport: DlnaServiceEndpoint
    let renderingControl: DlnaServiceEndpoint?

    /// 与 Java `RendererDevice.toJson` 同形，JS 侧 `DlnaCastDevice` 直接消费。
    var json: [String: Any] {
        var result: [String: Any] = [
            "id": id,
            "name": name,
            "address": host,
            "supportsVolume": renderingControl != nil,
        ]
        if let manufacturer, !manufacturer.isEmpty { result["manufacturer"] = manufacturer }
        if let model, !model.isEmpty { result["model"] = model }
        return result
    }

    /// 手动添加的设备要落盘，所以序列化得比 JS 面更多（控制 URL 必须留下，
    /// 否则下次冷启动得重新发现一遍）。
    var record: [String: Any] {
        var result: [String: Any] = [
            "id": id,
            "name": name,
            "host": host,
            "descriptionURL": descriptionURL.absoluteString,
            "avTransportType": avTransport.serviceType,
            "avTransportURL": avTransport.controlURL.absoluteString,
        ]
        if let manufacturer { result["manufacturer"] = manufacturer }
        if let model { result["model"] = model }
        if let renderingControl {
            result["renderingControlType"] = renderingControl.serviceType
            result["renderingControlURL"] = renderingControl.controlURL.absoluteString
        }
        return result
    }

    /// 用户在「手动添加」里填了名字就用它覆盖电视自报的 friendlyName。
    func withName(_ newName: String) -> DlnaRendererDevice {
        DlnaRendererDevice(
            id: id,
            name: newName,
            manufacturer: manufacturer,
            model: model,
            host: host,
            descriptionURL: descriptionURL,
            avTransport: avTransport,
            renderingControl: renderingControl
        )
    }

    static func fromRecord(_ record: [String: Any]) -> DlnaRendererDevice? {        guard
            let id = record["id"] as? String,
            let name = record["name"] as? String,
            let host = record["host"] as? String,
            let description = record["descriptionURL"] as? String,
            let descriptionURL = URL(string: description),
            let avTransportType = record["avTransportType"] as? String,
            let avTransportURL = (record["avTransportURL"] as? String).flatMap({ URL(string: $0) })
        else { return nil }

        let renderingControl: DlnaServiceEndpoint? = {
            guard
                let type = record["renderingControlType"] as? String,
                let url = (record["renderingControlURL"] as? String).flatMap({ URL(string: $0) })
            else { return nil }
            return DlnaServiceEndpoint(serviceType: type, controlURL: url)
        }()

        return DlnaRendererDevice(
            id: id,
            name: name,
            manufacturer: record["manufacturer"] as? String,
            model: record["model"] as? String,
            host: host,
            descriptionURL: descriptionURL,
            avTransport: DlnaServiceEndpoint(
                serviceType: avTransportType,
                controlURL: avTransportURL
            ),
            renderingControl: renderingControl
        )
    }
}

// MARK: - SSDP

/// UPnP 发现。iOS 与 Android 最大的差别就在这里：Android 直接发 UDP 组播
/// （239.255.255.250:1900），iOS 上向组播地址发包需要 Apple 特批的
/// `com.apple.developer.networking.multicast` entitlement（自签/侧载拿不到，
/// `sendto` 直接 EACCES）。所以这里只走两条不需要该 entitlement 的路：
///
///   1. **单播 M-SEARCH 扫段**：按本机 IPv4 + 掩码算出候选地址，逐个把 M-SEARCH
///      单播发给 `<ip>:1900`。DLNA 渲染器按规范必须在 1900 上监听，绝大多数对
///      单播 M-SEARCH 也会回 LOCATION；单播只需要「本地网络」隐私权限（系统弹一次框）。
///   2. **手动填 IP**：见 `DlnaCastPlugin.addManualDevice`，同样先试单播 M-SEARCH。
enum DlnaSsdp {
    static let port: UInt16 = 1900
    static let maxLocations = 64
    /// 扫段上限：/24 是 254 个地址；/16 有 6 万多个，只扫网段开头这一段。
    static let maxSweepHosts = 254

    private static let searchTargets = [
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "urn:schemas-upnp-org:service:AVTransport:1",
    ]
    /// 第一轮没人应时补一发「全都报上来」——部分消费级电视只认泛发现。
    private static let fallbackTarget = "ssdp:all"

    /// 本机可用于投屏的 IPv4 接口（跳过回环、VPN、点对点与蜂窝）。
    static func localIPv4Interfaces() -> [(name: String, address: String, netmask: String)] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return [] }
        defer { freeifaddrs(head) }

        var results: [(name: String, address: String, netmask: String)] = []
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let interface = cursor {
            defer { cursor = interface.pointee.ifa_next }

            let flags = interface.pointee.ifa_flags
            guard flags & UInt32(IFF_UP) != 0, flags & UInt32(IFF_LOOPBACK) == 0 else {
                continue
            }
            guard
                let address = interface.pointee.ifa_addr,
                address.pointee.sa_family == UInt8(AF_INET)
            else { continue }

            let name = String(cString: interface.pointee.ifa_name)
            // utun/ipsec = VPN，awdl/llw = Apple 点对点，pdp_ip = 蜂窝：
            // 扫这些接口只会白等，真正要扫的是 en0（Wi-Fi）。
            if name.hasPrefix("utun") || name.hasPrefix("ipsec")
                || name.hasPrefix("awdl") || name.hasPrefix("llw")
                || name.hasPrefix("pdp_ip")
            {
                continue
            }
            guard let host = numericHost(address) else { continue }

            var netmask = "255.255.255.0"
            if let mask = interface.pointee.ifa_netmask, let value = numericHost(mask) {
                netmask = value
            }
            results.append((name: name, address: host, netmask: netmask))
        }
        return results
    }

    /// 由地址 + 掩码算出要扫的候选主机（去掉网络地址与广播地址）。
    static func sweepHosts(address: String, netmask: String, limit: Int = maxSweepHosts) -> [String] {
        guard let ip = ipv4Value(address), let mask = ipv4Value(netmask), mask != 0 else {
            return []
        }
        let network = ip & mask
        let broadcast = network | ~mask
        guard broadcast > network + 1 else { return [] }
        let span = broadcast - network - 1
        let count = min(span, UInt32(max(0, limit)))
        guard count > 0 else { return [] }
        return (1...count).map { offset in ipv4String(network &+ offset) }
    }

    /// 对给定主机单播 M-SEARCH，返回 `LOCATION → USN`。
    /// 必须在后台线程调用（内部是阻塞的收发循环）。
    static func search(hosts: [String], timeout: TimeInterval) throws -> [String: String] {
        guard !hosts.isEmpty, timeout > 0 else { return [:] }

        let descriptor = socket(AF_INET, SOCK_DGRAM, 0)
        guard descriptor >= 0 else { throw DlnaError.socketUnavailable }
        defer { close(descriptor) }

        // 200ms 收包超时：够短，能在一个 timeout 窗口里轮询到截止时间。
        var receiveTimeout = timeval(tv_sec: 0, tv_usec: 200_000)
        _ = setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_RCVTIMEO,
            &receiveTimeout,
            socklen_t(MemoryLayout<timeval>.size)
        )

        var local = sockaddr_in()
        local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        local.sin_family = sa_family_t(AF_INET)
        local.sin_port = 0
        local.sin_addr.s_addr = INADDR_ANY
        let bound = withUnsafePointer(to: &local) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
                bind(descriptor, address, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { throw DlnaError.socketUnavailable }

        let payloads = searchTargets.map { searchPayload(target: $0) }

        func burst(_ targets: [String]) -> Int32 {
            var failure: Int32 = 0
            for host in hosts {
                for target in targets {
                    let error = send(
                        descriptor: descriptor,
                        host: host,
                        payload: searchPayload(target: target)
                    )
                    if error != 0 { failure = error }
                }
            }
            return failure
        }

        let sendFailure = burst(searchTargets)
        // EACCES/EPERM 是「本地网络」权限被拒（或沙箱拦下）的典型 errno；
        // 明确报出来，别让用户以为家里没有电视。
        if sendFailure == EACCES || sendFailure == EPERM {
            throw DlnaError.localNetworkDenied
        }

        var locations: [String: String] = [:]
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        let retryAt = startedAt.addingTimeInterval(min(0.5, max(0.2, timeout / 2)))
        var didRetry = false

        while Date() < deadline, locations.count < maxLocations {
            if !didRetry, Date() >= retryAt {
                didRetry = true
                if locations.isEmpty {
                    // 第一轮一个都没回：补一发泛发现 + 组播形式的 HOST 头，
                    // 兼容那些只认标准 M-SEARCH 写法的老设备。
                    _ = burst(searchTargets + [fallbackTarget])
                } else {
                    _ = burst(searchTargets)
                }
            }

            var source = sockaddr_in()
            var sourceLength = socklen_t(MemoryLayout<sockaddr_in>.size)
            let received = withUnsafeMutablePointer(to: &source) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
                    recvfrom(descriptor, &buffer, buffer.count, 0, address, &sourceLength)
                }
            }
            // <= 0 是接收超时（EAGAIN）或可忽略的错误：继续等下一个窗口。
            guard received > 0 else { continue }

            let text = String(decoding: buffer[0..<received], as: UTF8.self)
            let headers = parseHeaders(text)
            guard let location = headers["location"], isHTTPURL(location) else { continue }
            if locations[location] == nil {
                locations[location] = headers["usn"] ?? ""
            }
        }
        return locations
    }

    private static func send(descriptor: Int32, host: String, payload: String) -> Int32 {
        var destination = sockaddr_in()
        destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destination.sin_family = sa_family_t(AF_INET)
        destination.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &destination.sin_addr) == 1 else { return 0 }

        let data = Data(payload.utf8)
        let sent = withUnsafePointer(to: &destination) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
                data.withUnsafeBytes { bytes in
                    sendto(
                        descriptor,
                        bytes.baseAddress,
                        bytes.count,
                        0,
                        address,
                        socklen_t(MemoryLayout<sockaddr_in>.size)
                    )
                }
            }
        }
        return sent < 0 ? errno : 0
    }

    /// M-SEARCH 报文。`HOST` 保持组播地址写法（与 Java 侧一致）：实测多数渲染器
    /// 只按 `MAN`/`ST` 判断，对 `HOST` 是组播还是本机地址不敏感；写本机地址反而
    /// 会让少数老设备不认。
    private static func searchPayload(target: String) -> String {
        "M-SEARCH * HTTP/1.1\r\n"
            + "HOST: 239.255.255.250:1900\r\n"
            + "MAN: \"ssdp:discover\"\r\n"
            + "MX: 2\r\n"
            + "ST: \(target)\r\n"
            + "\r\n"
    }

    static func parseHeaders(_ response: String) -> [String: String] {
        var headers: [String: String] = [:]
        for line in response.split(whereSeparator: { $0 == "\r" || $0 == "\n" }) {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let name = line[line.startIndex..<separator]
                .trimmingCharacters(in: .whitespaces)
                .lowercased()
            let value = line[line.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
            if !name.isEmpty, !value.isEmpty { headers[name] = value }
        }
        return headers
    }

    private static func numericHost(_ address: UnsafeMutablePointer<sockaddr>) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = getnameinfo(
            address,
            socklen_t(address.pointee.sa_len),
            &buffer,
            socklen_t(buffer.count),
            nil,
            0,
            NI_NUMERICHOST
        )
        guard result == 0 else { return nil }
        return String(cString: buffer)
    }

    private static func ipv4Value(_ text: String) -> UInt32? {
        var address = in_addr()
        guard inet_pton(AF_INET, text, &address) == 1 else { return nil }
        return UInt32(bigEndian: address.s_addr)
    }

    private static func ipv4String(_ value: UInt32) -> String {
        var address = in_addr(s_addr: value.bigEndian)
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &address, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else {
            return ""
        }
        return String(cString: buffer)
    }

    static func isHTTPURL(_ value: String) -> Bool {
        let lower = value.lowercased()
        return lower.hasPrefix("http://") || lower.hasPrefix("https://")
    }
}

// MARK: - XML

/// 设备描述解析。用 `XMLParser` 而不是 `XMLDocument`：后者只有 macOS 有。
enum DlnaXml {
    /// 只取第一个匹配的文本节点，用于读 SOAP 响应里的单个字段。
    static func firstText(in xml: String, localName: String) -> String? {
        let parser = XMLParser(data: Data(xml.utf8))
        let delegate = FirstTextParser(target: localName)
        parser.shouldProcessNamespaces = true
        parser.delegate = delegate
        parser.parse()
        return delegate.value
    }

    static func parseDeviceDescription(_ xml: String, location: URL) -> DlnaRendererDevice? {
        let parser = XMLParser(data: Data(xml.utf8))
        let delegate = DeviceDescriptionParser(location: location)
        parser.shouldProcessNamespaces = true
        parser.delegate = delegate
        parser.parse()
        let description = delegate.description

        // 没有 AVTransport 就不是能投屏的渲染器（可能是路由器/打印机之类的 UPnP 设备）。
        guard let avTransport = description.avTransport else { return nil }

        let host = location.host ?? ""
        let name = description.friendlyName
            ?? description.modelName
            ?? (host.isEmpty ? location.absoluteString : host)
        return DlnaRendererDevice(
            id: description.udn ?? location.absoluteString,
            name: name,
            manufacturer: description.manufacturer,
            model: description.modelName,
            host: host,
            descriptionURL: location,
            avTransport: avTransport,
            renderingControl: description.renderingControl
        )
    }

    /// 把 `controlURL` 解析成绝对地址（描述里的通常是相对路径）。
    static func resolve(_ controlURL: String, relativeTo location: URL) -> URL? {
        URL(string: controlURL, relativeTo: location)?.absoluteURL
    }

    static func xmlEscape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    static func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }
}

private final class FirstTextParser: NSObject, XMLParserDelegate {
    private let target: String
    private var buffer = ""
    private(set) var value: String?

    init(target: String) {
        self.target = target
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        if elementName == target { buffer = "" }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if value == nil { buffer += string }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        guard elementName == target, value == nil else { return }
        value = DlnaXml.nonEmpty(buffer)
        if value != nil { parser.abortParsing() }
    }
}

private final class DeviceDescriptionParser: NSObject, XMLParserDelegate {
    struct Description {
        var friendlyName: String?
        var manufacturer: String?
        var modelName: String?
        var udn: String?
        var deviceType: String?
        var avTransport: DlnaServiceEndpoint?
        var renderingControl: DlnaServiceEndpoint?
    }

    /// 描述文档里的 `controlURL` 相对的是**描述文档地址**，所以基准必须先拿到。
    private let location: URL
    private var buffer = ""
    private var serviceType: String?
    private var serviceControlURL: String?
    private(set) var description = Description()

    init(location: URL) {
        self.location = location
        super.init()
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        buffer = ""
        if elementName == "service" {
            serviceType = nil
            serviceControlURL = nil
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        buffer += string
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        defer { buffer = "" }
        let text = DlnaXml.nonEmpty(buffer) ?? ""
        switch elementName {
        case "friendlyName":
            if description.friendlyName == nil { description.friendlyName = text }
        case "manufacturer":
            if description.manufacturer == nil { description.manufacturer = text }
        case "modelName":
            if description.modelName == nil { description.modelName = text }
        case "UDN":
            if description.udn == nil { description.udn = text }
        case "deviceType":
            if description.deviceType == nil { description.deviceType = text }
        case "serviceType":
            serviceType = text
        case "controlURL":
            serviceControlURL = text
        case "service":
            if let type = serviceType, let control = serviceControlURL,
               let url = DlnaXml.resolve(control, relativeTo: location)
            {
                if type.contains(":service:AVTransport:"), description.avTransport == nil {
                    description.avTransport = DlnaServiceEndpoint(
                        serviceType: type,
                        controlURL: url
                    )
                } else if type.contains(":service:RenderingControl:"),
                          description.renderingControl == nil
                {
                    description.renderingControl = DlnaServiceEndpoint(
                        serviceType: type,
                        controlURL: url
                    )
                }
            }
            serviceType = nil
            serviceControlURL = nil
        default:
            break
        }
    }
}

// MARK: - HTTP / SOAP

/// 投屏用的同步 HTTP 客户端：只在后台队列调用（内部用信号量把 URLSession 拉成同步）。
///
/// 刻意**不用** App 的代理设置：电视在局域网里，走用户的 HTTP/SOCKS 代理必然失败
/// （对应 Java 侧的 `Proxy.NO_PROXY`）。
final class DlnaHttpClient {
    private let session: URLSession

    init(timeout: TimeInterval = 6) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        // 空字典 = 不使用任何代理（Java 侧同样是 Proxy.NO_PROXY）。
        configuration.connectionProxyDictionary = [:]
        session = URLSession(configuration: configuration)
    }

    func get(_ url: URL) throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, response) = try send(request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw DlnaError.invalidResponse
        }
        return String(decoding: data, as: UTF8.self)
    }

    func soap(_ endpoint: DlnaServiceEndpoint, action: String, body: String) throws -> String {
        let envelope =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
            + " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
            + "<s:Body>"
            + "<u:\(action) xmlns:u=\"\(DlnaXml.xmlEscape(endpoint.serviceType))\">"
            + body
            + "</u:\(action)>"
            + "</s:Body></s:Envelope>"

        var request = URLRequest(url: endpoint.controlURL)
        request.httpMethod = "POST"
        request.setValue("text/xml; charset=\"utf-8\"", forHTTPHeaderField: "Content-Type")
        request.setValue(
            "\"\(endpoint.serviceType)#\(action)\"",
            forHTTPHeaderField: "SOAPACTION"
        )
        request.httpBody = Data(envelope.utf8)

        let (data, response) = try send(request)
        let text = String(decoding: data, as: UTF8.self)
        guard let http = response as? HTTPURLResponse else { throw DlnaError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw DlnaError.soapFailed(
                action: action,
                code: http.statusCode,
                detail: DlnaXml.firstText(in: text, localName: "errorDescription")
            )
        }
        return text
    }

    /// URLSession 的 completion 在别的队列上跑，这里用信号量拉成同步调用。
    /// 返回值用类盒子装，避免在 Swift 6 并发模式下捕获可变局部变量。
    private final class ResultBox {
        var value: Result<(Data, URLResponse), Error>?
    }

    private func send(_ request: URLRequest) throws -> (Data, URLResponse) {
        let box = ResultBox()
        let semaphore = DispatchSemaphore(value: 0)
        session.dataTask(with: request) { data, response, error in
            if let error {
                box.value = .failure(error)
            } else if let data, let response {
                box.value = .success((data, response))
            } else {
                box.value = .failure(DlnaError.invalidResponse)
            }
            semaphore.signal()
        }.resume()
        semaphore.wait()
        guard let value = box.value else { throw DlnaError.invalidResponse }
        return try value.get()
    }
}

// MARK: - UPnP 时间

enum DlnaTime {
    /// `01:23:45` / `1:2:3.500` → 秒；`NOT_IMPLEMENTED` 等一律 0（与 Java 一致）。
    static func parse(_ value: String?) -> Double {
        guard let value, !value.isEmpty, value.uppercased() != "NOT_IMPLEMENTED" else { return 0 }
        let parts = value.trimmingCharacters(in: .whitespaces).split(separator: ":")
        guard parts.count == 3 else { return 0 }
        guard
            let hours = Double(parts[0]),
            let minutes = Double(parts[1]),
            let seconds = Double(parts[2])
        else { return 0 }
        return max(0, hours * 3600 + minutes * 60 + seconds)
    }

    static func format(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(
            format: "%02d:%02d:%02d",
            total / 3600,
            (total % 3600) / 60,
            total % 60
        )
    }
}

// MARK: - DIDL 元数据

enum DlnaMetadata {
    static func didl(mediaURL: String, title: String, mime: String) -> String {
        let escapedTitle = DlnaXml.xmlEscape(
            DlnaXml.nonEmpty(title) ?? "文章视频"
        )
        return
            "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\""
            + " xmlns:dc=\"http://purl.org/dc/elements/1.1/\""
            + " xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
            + "<item id=\"0\" parentID=\"0\" restricted=\"1\">"
            + "<dc:title>\(escapedTitle)</dc:title>"
            + "<upnp:class>object.item.videoItem</upnp:class>"
            + "<res protocolInfo=\"http-get:*:\(DlnaXml.xmlEscape(mime)):*\">"
            + DlnaXml.xmlEscape(mediaURL)
            + "</res></item></DIDL-Lite>"
    }

    /// 与 Java `mimeFor` 一致：hls 走 mpegurl，其余按扩展名猜，兜底 mp4。
    static func mime(mediaURL: String, format: String) -> String {
        if format.lowercased() == "hls" { return "application/vnd.apple.mpegurl" }
        let lower = mediaURL.lowercased()
        if lower.contains(".webm") { return "video/webm" }
        if lower.contains(".mov") { return "video/quicktime" }
        if lower.contains(".mkv") { return "video/x-matroska" }
        return "video/mp4"
    }
}
