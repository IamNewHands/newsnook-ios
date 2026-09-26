import Capacitor
import UIKit
import UserNotifications

/// 同步通知的 iOS 出口：只负责投递，什么值得通知由 JS 侧 `features/sync/notifier` 决定。
///
/// 与 Android `SyncNotificationPlugin` 的三条硬规矩一一对应：
/// 1. 只有一个通知类别（iOS 不需要像 Android 那样显式建渠道，权限粒度由系统设置页给），
///    用户在系统设置里可以单独关掉；
/// 2. 通知 id 就是调用方给的字符串本身 —— 同 id 覆盖而不是堆叠，与 Java 侧
///    `notificationId(id)` 的稳定哈希是同一语义，且不会哈希碰撞；
/// 3. 不在冷启动时索要通知权限：第一次真的要发通知时才请求，没授权就静默跳过，
///    同步照常进行。
///
/// 点开通知走与分享深链同一条路：把 `newsnook://sync/<route>` 交给
/// `ApplicationDelegateProxy`，Capacitor 的 App 插件会以 `appUrlOpen`（运行中）
/// 或 `launchUrl`（冷启动）送给 JS，落地页由 JS 侧决定。
@objc(SyncNotificationPlugin)
public final class SyncNotificationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SyncNotificationPlugin"
    public let jsName = "SyncNotification"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    /// 与 Java 侧 `ROUTE_SCHEME` 逐字一致；JS 的 `syncRouteFromAppUrl` 按它剥前缀。
    static let routeScheme = "newsnook://sync/"
    /// 深链 route 在通知 `userInfo` 里的键。取自定义名字而不是 `route`，
    /// 避免与系统/未来键名撞车。
    static let routeKey = "newsnookSyncRoute"

    @objc func notify(_ call: CAPPluginCall) {
        guard
            let id = call.getString("id"), !id.isEmpty,
            let title = call.getString("title"),
            let body = call.getString("body")
        else {
            call.reject("id, title and body are required")
            return
        }
        let route = call.getString("route", "account-sync") ?? "account-sync"

        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                Self.deliver(id: id, title: title, body: body, route: route, call: call)
            case .notDetermined:
                // 只在真的要发通知时才弹权限框：冷启动不打扰用户，
                // 与 Android「不为了同步在启动时索要 POST_NOTIFICATIONS」一致。
                center.requestAuthorization(options: [.alert]) { granted, _ in
                    if granted {
                        Self.deliver(id: id, title: title, body: body, route: route, call: call)
                    } else {
                        // 用户拒绝：这是明确表态，不追问、不报错
                        call.resolve()
                    }
                }
            default:
                // .denied / 未知：用户关掉了通知，静默跳过
                call.resolve()
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("id is required")
            return
        }
        let center = UNUserNotificationCenter.current()
        // 已投递与待投递都要撤：同一个 id 可能在通知中心里已经躺着一条。
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
        call.resolve()
    }

    private static func deliver(
        id: String,
        title: String,
        body: String,
        route: String,
        call: CAPPluginCall
    ) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.userInfo = [routeKey: route]
        // Android 侧是 IMPORTANCE_LOW 渠道：不响铃、不弹横幅、不加角标。
        // iOS 用 passive 打断级别对齐这个「不打扰」的定位，因此不申请 .sound/.badge
        // 权限，也不设置 sound。interruptionLevel 需要 iOS 15+，正好是部署下限。
        content.interruptionLevel = .passive

        // trigger: nil = 立即投递；identifier 用调用方的字符串，同 id 覆盖。
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { _ in
            // 投递失败（例如用户在两次调用之间收回了权限）不影响同步本身，
            // 与 Java 侧吞掉 SecurityException 的处理保持一致。
            call.resolve()
        }
    }
}

/// `UNUserNotificationCenter` 的 delegate 必须在 App 启动完成前装好，
/// 否则「点通知冷启动」那一次回调会直接丢失 —— 而插件要等 Capacitor bridge
/// 起来才存在，所以装配点在 `AppDelegate`，这里只放实现。
final class SyncNotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = SyncNotificationCenterDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // 前台不展示：Android 侧 IMPORTANCE_LOW 同样不打扰用户，前台已经有 Toast /
        // 页面反馈，再叠一条系统横幅是重复打扰。空数组即「什么都不展示」。
        completionHandler([])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if
            let route = userInfo[SyncNotificationPlugin.routeKey] as? String,
            let url = URL(string: SyncNotificationPlugin.routeScheme + route)
        {
            DispatchQueue.main.async {
                // 与分享深链共用同一条入口：运行中会触发 App 插件的 appUrlOpen，
                // 冷启动会留在 ApplicationDelegateProxy.lastURL 里给 getLaunchUrl。
                _ = ApplicationDelegateProxy.shared.application(
                    UIApplication.shared,
                    open: url,
                    options: [:]
                )
            }
        }
        completionHandler()
    }
}
