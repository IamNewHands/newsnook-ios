import Capacitor
import Foundation
import Security

/// Keychain 支撑的安全存储：长期 Session token 与同步下来的 Secret 明文只走这里。
///
/// Android 侧是「AndroidKeyStore 生成 AES-256-GCM 密钥 + 密文 Base64 落 SharedPreferences」，
/// iOS 没有等价的可加密 Keychain 封装，直接用 `kSecClassGenericPassword` 把明文交给
/// Security 框架保管：密钥材料由系统 secure enclave / 系统 keybag 派生，App 拿不到，
/// 备份时也带不走（见 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`）。
///
/// JS 可见契约与 `SecureStorePlugin.java` 完全一致：
/// - `set({key, value})` 成功 `resolve()`（空对象），缺参 `reject("key and value are required")`
/// - `get({key})` 永远 `resolve({value: string | null})`，缺参 `reject("key is required")`
/// - `remove({key})` 成功 `resolve()`，缺参 `reject("key is required")`
///
/// 读不到、读坏了、解不出 UTF-8 一律当作「没有值」并顺手清掉，绝不把明文写进日志；
/// 上层会退回未登录 / 重新填 Secret，而不是卡在错误里。
@objc(SecureStorePlugin)
public final class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStorePlugin"
    public let jsName = "SecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]

    /// Keychain 里所有条目共用的 service。将来若存储格式要变，换这个 service 即可
    /// 与旧条目隔离（account 保持 JS 传来的原始 key，不做前缀，见 port spec）。
    private static let keychainService = "com.aizeek.newsnook.securestore"

    /// Capacitor 在后台串行队列 `bridge` 上调用插件方法；这里再串行化一次，
    /// 保证同一 key 的「读改写」不会互相穿插。Keychain API 本身线程安全，
    /// 所以不阻塞主线程，也不会因为并发调用而破坏条目。
    private let queue = DispatchQueue(label: "com.aizeek.newsnook.securestore")

    // MARK: - Plugin methods

    @objc func set(_ call: CAPPluginCall) {
        guard
            let key = call.getString("key"), !key.isEmpty,
            let value = call.getString("value")
        else {
            call.reject("key and value are required")
            return
        }

        queue.sync {
            let data = Data(value.utf8)
            let base = Self.baseQuery(for: key)

            // 先 update 再 add：比 delete+add 少一个「删成功、加失败」的窗口。
            // 注意 update 的 query 里不能带 kSecAttrAccessible，否则 SecItemUpdate 会报 errSecParam。
            let updateStatus = SecItemUpdate(
                base as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
            if updateStatus == errSecSuccess {
                call.resolve([:])
                return
            }
            if updateStatus != errSecItemNotFound {
                call.reject("secure store write failed: \(Self.code(updateStatus))")
                return
            }

            var addQuery = base
            addQuery[kSecValueData as String] = data
            // ThisDeviceOnly：条目不随 iCloud/iTunes 备份迁移到新设备，语义对齐 Android
            // Keystore 密钥「不可导出、换机即失效」。AfterFirstUnlock：开机后首次解锁起可用，
            // 不要求当前处于解锁态（与 Android setUserAuthenticationRequired(false) 同款取舍）。
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess {
                call.resolve([:])
                return
            }
            call.reject("secure store write failed: \(Self.code(addStatus))")
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }

        queue.sync {
            var query = Self.baseQuery(for: key)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne

            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            // 显式标注类型：resolve 有多个重载，字典字面量不标注会推断成 [String: NSNull] 之类。
            let missing: [String: Any] = ["value": NSNull()]
            if status == errSecItemNotFound {
                call.resolve(missing)
                return
            }
            if status != errSecSuccess {
                call.reject("secure store read failed: \(Self.code(status))")
                return
            }

            // 类型不符（不是 Data）说明条目不是本插件写的：按 Android 处理坏密文的办法
            // 清掉并当作没有值，避免上层反复读到一个永远解不开的条目。
            guard let data = result as? Data else {
                Self.deleteItem(for: key)
                call.resolve(missing)
                return
            }
            guard let value = String(data: data, encoding: .utf8) else {
                Self.deleteItem(for: key)
                call.resolve(missing)
                return
            }

            let found: [String: Any] = ["value": value]
            call.resolve(found)
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }

        queue.sync {
            let status = Self.deleteItem(for: key)
            if status == errSecSuccess {
                call.resolve([:])
                return
            }
            call.reject("secure store remove failed: \(Self.code(status))")
        }
    }

    // MARK: - Keychain helpers

    /// 定位一个条目的最小 query：class + service + account。
    /// 不带 `kSecAttrAccessible` / `kSecValueData`：前者只允许出现在 add，后者只允许出现在 add/update。
    private static func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
        ]
    }

    /// 删除成功返回 errSecSuccess；条目本来就不存在也当成功（remove 幂等，不打扰调用方）。
    @discardableResult
    private static func deleteItem(for key: String) -> OSStatus {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        return status == errSecItemNotFound ? errSecSuccess : status
    }

    /// 只把 OSStatus 数字带出去，绝不带 key / value / 明文。
    private static func code(_ status: OSStatus) -> String {
        "OSStatus \(status)"
    }
}
