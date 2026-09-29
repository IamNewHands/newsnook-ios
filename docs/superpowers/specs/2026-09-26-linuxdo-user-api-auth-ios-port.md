# Linux.do User API Key 认证 iOS 移植规格（LinuxDoUserApiAuth）

- 日期：2026-09-26
- 上游源文件（source of truth）：`android/app/src/main/java/com/aizeek/newsnook/LinuxDoUserApiAuth.java`（555 行）
- 移植产物：`ios/App/App/LinuxDoUserApiAuth.swift`（917 行）
- JS 契约：`src/features/linuxdo/session/native.ts`、`src/features/linuxdo/types.ts`
- 调用方（本规格的服务对象，另一个 agent 的文件）：`ios/App/App/LinuxDoSessionPlugin.swift`（尚未存在）
- 部署目标：iOS 15.0；无第三方依赖；本文件是**纯 Swift 辅助类**，不是 Capacitor 插件。

## 0. 一句话结论

Android 版「系统浏览器持有 Linux.do 会话 → Discourse 用我们提供的 RSA 公钥加密凭据 → 深链回流解密」的流程在 iOS 上可以**一对一保留**，唯一必须换掉的机制是浏览器载体（Custom Tabs → `ASWebAuthenticationSession`）与本地加密存储（AndroidKeyStore + AES-GCM → Keychain）。

**本移植未编译、未上真机验证**：Windows 主机上没有 Xcode，也没有 `swiftc`，所有结论都来自静态阅读与逐条比对，风险清单见第 5 节。

## 1. 成员对照表

### 1.1 公开常量

| Java | Swift | 谁用 / 必须做什么 |
|---|---|---|
| `ORIGIN` | `static let origin` | 拼授权 URL；值不变 |
| `CLIENT_ID_PREFIX` | `static let clientIdPrefix` | **值改为 `newsnook-ios-v3-`**（Android 是 `newsnook-android-v3-`）。Discourse 按 `client_id` 区分 User API Key，两端必须各用一套，否则同一账号下互相顶掉 |
| `APPLICATION_NAME` | `static let applicationName` | 授权页展示名；值不变 |
| `SCOPES` | `static let scopes` | 值不变（`one_time_password`） |
| `AUTH_MODE` | `static let authMode` | 插件外壳把它填进 `snapshot.authMode`；值不变（`browser-session`，对应 `LinuxDoAuthMode` 联合类型） |
| `AUTH_REDIRECT` | `static let authRedirect` | 值不变（`discourse://auth_redirect`） |
| （无） | `static let authMaxAgeMillis` / `oneTimePasswordMaxAgeMillis` | Java 私有常量转公开，便于外壳复用 |
| （无） | `static let errorBusy/Browser/Crypto/Cancelled/Denied/Protocol` | 六个 `LINUXDO_USER_API_*` 错误码；与 Java 里硬编码的字符串逐字一致 |

### 1.2 嵌套类型

| Java | Swift | 说明 |
|---|---|---|
| `interface AuthCallback` | `protocol AuthCallback: AnyObject` | 方法名保持 `onPending` / `onSuccess` / `onFailure`；线程约定改为「一律主线程回调」 |
| `AuthCallback.onPending(String,int)` | `onPending(verificationUrl:expiresInSeconds:)` | 外壳收到后把 `expiresInSeconds`（固定 900）透给 JS |
| `AuthCallback.onSuccess(Credential)` | `onSuccess(credential:)` | 外壳据此 resolve `LinuxDoSessionSnapshot` |
| `AuthCallback.onFailure(String,String)` | `onFailure(code:message:)` | `message` 可直接 `call.reject` |
| `Credential` 六个字段 | `struct Credential` 同名字段 | `key` / `clientId` / `apiVersion` / `expiresAt` / `oneTimePassword` / `authorizedAtMillis` |
| `Credential.expired()` | `func expired(now:) -> Bool` | 语义一致：`expiresAt` 为空 = 不过期；解析失败 = 过期 |
| `Credential.hasUsableOneTimePassword()` | `func hasUsableOneTimePassword(now:) -> Bool` | 语义一致：ASCII 十六进制 + 10 分钟窗口 |
| `Credential.toJson()` | `toJsonObject()` / `toJsonString()` | 键名逐字一致；`toJsonObject` 给外壳拼 snapshot 用 |
| `Credential.fromJson(JSONObject)` | `static fromJsonObject(_:)` / `fromJsonString(_:)` | `key`/`clientId` 为空或 `apiVersion <= 0` → nil |
| （无） | `enum AuthError: Error` | 把 `LINUXDO_USER_API_*` 错误码 + 中文文案绑在一起，外壳可 `catch` 后直接 `reject` |

### 1.3 实例成员（外壳按这些名字调用）

| Java | Swift | 谁调用 / 必须做什么 |
|---|---|---|
| `LinuxDoUserApiAuth(Context)` | `init()` | 外壳在插件 `load()` 里建一次。**不再吃 Context**；副作用只有读一次 UserDefaults 判断是否有未过期的 pending nonce |
| `isAuthenticating()` | `isAuthenticating() -> Bool` | 外壳：`snapshot()` 里判断是否要报「登录进行中」 |
| `credential()` | `credential() -> Credential?` | 外壳：`snapshot()` / `request()` 取 `User-Api-Key` |
| `hasValidCredential()` | `hasValidCredential() -> Bool` | 外壳：`snapshot().authenticated` |
| `applyHeaders(Request.Builder)` | `applyHeaders() -> [String: String]` | **签名变了**：iOS 不引 OkHttp，返回头字典；空字典 = 未登录。外壳把它并进自己的 `URLRequest`（键 `User-Api-Key` / `User-Api-Client-Id`） |
| `clearCredential()` | `clearCredential()` | 外壳：`clearUserApiKey()` 实现 |
| `authenticate(Activity, AuthCallback)` | `authenticate(presenter: Presenter? = nil, callback: AuthCallback)` | 外壳：`authenticateUserApiKey()` 实现。**必须在主线程调用** |
| `cancel()` | `cancel()` | 外壳：`cancelUserApiKeyAuth()` 实现 |
| `destroy()` | `destroy()` | 外壳：插件 `deinit` / `handleOnDestroy`。只断回调与关面板，保留 pending nonce |
| `handleRedirect(Uri)` | `handleRedirect(url: URL) -> Bool` | 返回 true 表示「这是 Linux.do 的认证回流，我认领了」。外壳在 `AppDelegate` / `SceneDelegate` 的 `open url` 里转发；也用于 `ASWebAuthenticationSession` 的完成回调 |

### 1.4 私有机制（不对外，但外壳需要知道行为）

| Java 私有成员 | Swift 私有对应物 | 行为差异 |
|---|---|---|
| `restorePendingAuth()` | `init` 内 `freshPendingNonce()` + `pendingNonceValue()` | 一致：15 分钟内的 nonce 让 `isAuthenticating()` 初值为 true |
| `pendingNonce()` | `pendingNonceValue()` | 一致：内存优先，否则回读并校验年龄 |
| `clearPendingAuth()` | `clearPendingAuth()` | 一致；额外重置 `callbackFailed` |
| `finishFailure(...)` | `finishFailure(callback:error:)` | 一致；额外保证 `onFailure` 最多一次 |
| `decryptCredential(...)` | `decryptCredential(...)` | 校验顺序逐条对齐（nonce → key/api/otp） |
| `decryptValue(...)` | `decryptValue(...)` | `Cipher RSA/ECB/PKCS1Padding` → `SecKeyCreateDecryptedData(.rsaEncryptionPKCS1)` |
| `publicKeyPem()` | `publicKeyPem()`（**公开**，供外壳调试） | iOS 需手工补 X.509 SPKI 前缀，见 2.6 |
| `encryptStored` / `decryptStored` / `getOrCreateAesKey` | **整层删除** | 改为 Keychain 明文条目，见 2.4 |
| `persistCredential` | `persistCredential` | Keychain `SecItemUpdate` → `SecItemAdd` |
| `clientId()` | `clientId()` | UserDefaults 代替 SharedPreferences |
| `preferences()` | `UserDefaults.standard` | 见 2.5 |
| `isAuthRedirect` / `constantTimeEquals` / `randomHex` / `parseIso8601` / `empty` | 同名静态方法 | 逐条等价；`randomHex` 改 `SecRandomCopyBytes` |
| `openSystemBrowser(Activity, String)` | `ASWebAuthenticationSession` + `WebAuthContextProvider` | 见 2.1 |
| `TAG` + `Log.w` | `NSLog("[LinuxDoUserApiAuth] ...")` | 只打阶段/长度/错误类型，绝不打凭据 |

## 2. 最终 Swift API 表面（外壳可直接照抄）

```swift
final class LinuxDoUserApiAuth {

    // 常量
    static let origin: String                       // "https://linux.do"
    static let clientIdPrefix: String               // "newsnook-ios-v3-"
    static let applicationName: String              // "NewsNook"
    static let scopes: String                       // "one_time_password"
    static let authMode: String                     // "browser-session"
    static let authRedirect: String                 // "discourse://auth_redirect"
    static let authMaxAgeMillis: Int64              // 900_000
    static let oneTimePasswordMaxAgeMillis: Int64   // 600_000
    static let errorBusy: String                    // "LINUXDO_USER_API_BUSY"
    static let errorBrowser: String                 // "LINUXDO_USER_API_BROWSER"
    static let errorCrypto: String                  // "LINUXDO_USER_API_CRYPTO"
    static let errorCancelled: String               // "LINUXDO_USER_API_CANCELLED"
    static let errorDenied: String                  // "LINUXDO_USER_API_DENIED"
    static let errorProtocol: String                // "LINUXDO_USER_API_PROTOCOL"

    /// 展示认证网页的锚窗口。缺省用前台场景 key window。
    typealias Presenter = () -> ASPresentationAnchor?

    // 嵌套类型
    struct Credential: Sendable, Equatable {
        let key: String
        let clientId: String
        let apiVersion: Int
        let expiresAt: String
        let oneTimePassword: String
        let authorizedAtMillis: Int64

        init(key: String, clientId: String, apiVersion: Int,
             expiresAt: String?, oneTimePassword: String?, authorizedAtMillis: Int64)
        func expired(now: Date = Date()) -> Bool
        func hasUsableOneTimePassword(now: Date = Date()) -> Bool
        func toJsonObject() -> [String: Any]
        func toJsonString() -> String?
        static func fromJsonObject(_ value: [String: Any]) -> Credential?
        static func fromJsonString(_ text: String) -> Credential?
    }

    protocol AuthCallback: AnyObject {
        func onPending(verificationUrl: String, expiresInSeconds: Int)
        func onSuccess(credential: Credential)
        func onFailure(code: String, message: String)
    }

    enum AuthError: Error, Equatable {
        case busy, browser, crypto, cancelled
        case denied(String)          // 已含中文前缀
        case cancelledByUser         // 用户拒绝/点了取消
        case protocolFailure
        var code: String { get }
        var message: String { get }
    }

    // 生命周期
    init()

    // 查询
    func isAuthenticating() -> Bool
    func credential() -> Credential?
    func hasValidCredential() -> Bool
    func applyHeaders() -> [String: String]     // ["User-Api-Key": …, "User-Api-Client-Id": …]

    // 操作
    func authenticate(presenter: Presenter? = nil, callback: AuthCallback)   // 主线程
    func cancel()
    func clearCredential()
    func destroy()
    @discardableResult func handleRedirect(url: URL) -> Bool

    // 工具（外壳拼 snapshot 时可复用）
    static func publicKeyPem() throws -> String
    static func parseISO8601(_ value: String) -> Date?
    static func randomHex(byteCount: Int) -> String
    static func isASCIIHex(_ value: String) -> Bool
}
```

### 外壳接线要点

1. `snapshot()` 的字段来源：`authenticated = hasValidCredential()`；`authMode = hasValidCredential() ? LinuxDoUserApiAuth.authMode : "none"`；`apiVersion = credential()?.apiVersion`；`expiresAt = credential()?.expiresAt`（为空时**不要**放进 payload，与 Java 的 `toJson()` 取舍一致）；`currentUser` / `userAgent` 由外壳自己填（本类不管）。
2. `authenticateUserApiKey()` 建议在主线程起 `authenticate`，在 `onPending` 里只记录状态、不要 resolve（JS 侧在等最终结果）。
3. `onFailure` 保证最多一次，但**不保证**在 `cancelUserApiKeyAuth()` 返回前到达（`DispatchQueue.main.async`）；外壳不要靠返回值判断失败已送达。
4. 冷启动深链：`AppDelegate.application(_:open:options:)` 里把 URL 交给 `handleRedirect`，返回 true 时**不要**再走别的分支。

## 3. Android → iOS 机制映射

| # | Android 机制 | iOS 替代 | 为什么这样选 | 降级 / 不可移植项与 JS 可见后果 |
|---|---|---|---|---|
| 3.1 | `CustomTabsIntent` 打开系统浏览器，靠 `Intent` 深链把 `discourse://auth_redirect` 交回 | `ASWebAuthenticationSession(url:callbackURLScheme:"discourse")` | 与 Custom Tabs 语义最接近：**复用系统浏览器的共享 Cookie 仓**（GitHub / Google 登录态都在那里），`prefersEphemeralWebBrowserSession = false` 显式要求共享 Cookie。反过来 `WKWebView` 是独立 Cookie 仓，用户得在 App 内重新登录 GitHub/Google，直接违背 Java 注释里写明的设计意图 | `callbackURLScheme` 只做**前缀匹配**：任何 `discourse://…` 都会结束会话，再由 `handleRedirect` 判 `scheme==discourse && host==auth_redirect`。风险见 5.2。JS 可见后果：无（契约不变） |
| 3.2 | Android 不需要在 `AndroidManifest.xml` 注册 `discourse://` 也能收到深链（Custom Tabs 直接回 Intent） | `ASWebAuthenticationSession` 拦截回调**不要求**在 Info.plist 注册 `CFBundleURLTypes` | 这是选它而不是 WKWebView 的第二个理由：本任务禁止改 `Info.plist`。`WKWebView` 方案反而必须注册 scheme（或 `decidePolicyFor` 拦截） | 若某些 iOS 版本仍要求注册 scheme，会话会直接报错 → 走到 `LINUXDO_USER_API_PROTOCOL`。真机必测，见 5.2 |
| 3.3 | `Handler` / `runOnUiThread` | `DispatchQueue.main.async` | 所有 `AuthCallback` 回调统一主线程，与 Java 由调用方 `runOnUiThread` 保证的效果一致 | 无 |
| 3.4 | 解密/落库在调用线程（Capacitor 后台线程） | `DispatchQueue.global(qos: .userInitiated)` 里做 RSA 解密 + Keychain 写入 | `handleRedirect` 要保持同步返回 Bool，所以只能把重活甩到后台 | 顺序：先解密成功再回调，JS 侧不会看到「半成功」 |
| 3.5 | `Context` / `Activity` 传入 | `Presenter = () -> ASPresentationAnchor?` 闭包 + 缺省取前台场景 key window | 满足「不许用全局单例」；外壳可以传 `bridge.viewController.view.window` | 拿不到窗口 → `LINUXDO_USER_API_BROWSER`（文案「无法打开系统浏览器，请检查默认浏览器是否可用」）。真机上几乎不会发生 |
| 3.6 | `AtomicBoolean` | `NSLock` 保护的普通 `Bool` + `compareAndSetAuthenticating` | iOS 15 没有 `ManagedAtomic`；`NSLock` 无重入，代码里没有嵌套加锁 | 无 |
| 3.7 | `SharedPreferences.commit()`（同步） | `UserDefaults.standard.set`（内存即时，磁盘异步） | iOS 没有等价的同步小存储；pending nonce 只在「进程被杀后重启」场景读，落盘延迟不影响正确性 | 极小：极端掉电可能丢 nonce → 用户重登一次 |
| 3.8 | AndroidKeyStore RSA-2048 / `RSA/ECB/PKCS1Padding` | `SecKeyCreateRandomKey`（`kSecAttrKeyTypeRSA` + 2048 + `kSecAttrIsPermanent` + tag `…rsa.v2`）/ `SecKeyCreateDecryptedData(.rsaEncryptionPKCS1)` | 算法与填充必须一致，否则 Discourse 加密出来的密文解不开 | 无（前提是 PEM 导出正确，见 3.9） |
| 3.9 | `PublicKey.getEncoded()` = X.509 SubjectPublicKeyInfo，PEM 头 `BEGIN PUBLIC KEY` | `SecKeyCopyExternalRepresentation` 返回的是 **PKCS#1**，代码手工补 SPKI 前缀后再 Base64 | 不补前缀的话 Discourse 端 `OpenSSL::PKey::RSA.new` 解不出 PEM，整个授权流程必然失败 | 无（失败即 `LINUXDO_USER_API_CRYPTO`）；这是最高风险项，见 5.1 |
| 3.10 | AndroidKeyStore AES-256-GCM 密钥 + 密文 Base64 落 SharedPreferences | Keychain `kSecClassGenericPassword` + `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，**明文 JSON 直接存**（不二次加密） | iOS 没有「Keystore 可加密 Keychain 条目」的等价物；Keychain 本身就是加密存储。省掉一层密钥管理 = 少一类失败模式。`ThisDeviceOnly` 对齐 Android Keystore「不可导出、换机即失效」 | 无 JS 可见差异。副作用：凭据只在本机、不进备份（与 Android 同款取舍） |
| 3.11 | `Credential` 存 SharedPreferences 键 `credential` | Keychain service `com.aizeek.newsnook.linuxdo.userapikey` / account `credential` | 与 `SecureStorePlugin.swift` 同款命名习惯，但与它**不同 service**，避免和账户 Session 撞条目 | 无 |
| 3.12 | `Uri.getQueryParameter` | `URLComponents.queryItems` | 等价 | 无 |
| 3.13 | `SimpleDateFormat` 两条 ISO-8601 模式 | `ISO8601DateFormatter`（无小数秒）+ `DateFormatter` `yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX` | `ISO8601DateFormatter` 不认 `SSS`，必须分两条 | 无 |
| 3.14 | `java.security.SecureRandom` | `SecRandomCopyBytes`（失败时退到 `UInt8.random`） | 与 Android 同为 CSPRNG 优先 | 无 |
| 3.15 | `oneTimePassword.matches("^[0-9a-fA-F]+$")` | `isASCIIHex` 手写标量比较 | 不能用 `Character.isHexDigit`，它会放行全角数字 | 无（更严格，等价于 Java 正则） |
| 3.16 | `applyHeaders(Request.Builder)` | `applyHeaders() -> [String: String]` | 不引 OkHttp | 外壳需自己把字典并进 `URLRequest`；键名与 Java 完全一致 |
| 3.17 | `FLAG_ACTIVITY_NO_HISTORY`（浏览器任务不留历史） | `closeBrowserSession()` 在成功/失败/取消时主动 `session.cancel()` | ASWebAuthenticationSession 没有等价 flag | 无 JS 可见差异 |
| 3.18 | 进程被杀后靠 Manifest 深链冷启动恢复 | **没有等价路径**：`ASWebAuthenticationSession` 是进程内对象，进程一死会话就没了 | iOS 系统限制 | 见 5.5。pending nonce 仍会保留 15 分钟，但用户必须重新点一次登录 |

### 未移植（故意）

- `openSystemBrowser` 的「Custom Tabs 不可用则退到 `ACTION_VIEW`」兜底：iOS 上没有对应概念，`ASWebAuthenticationSession.start()` 返回 false 时直接报 `LINUXDO_USER_API_BROWSER`。
- `encryptStored` / `decryptStored` / `getOrCreateAesKey`：见 3.10。
- `TAG` 日志里的 `errorValue.getClass().getSimpleName()`：改为 `AuthFailure.label` 或 Swift 类型名，信息量等价。

## 4. 验证方案

**前提：本文件在 Windows 上未编译、未上机。以下步骤必须在 macOS + 真机上做，结果才算数。**

### 4.1 编译期（macOS，5 分钟）

1. `npx cap sync ios`（**必须在 macOS 上做**：Windows 会把反斜杠路径写进 `Package.swift`）。
2. 把 `LinuxDoUserApiAuth.swift` 加进 App target（注册由中央处理，本任务不动 `project.pbxproj`）。
3. `xcodebuild -scheme App -destination 'generic/platform=iOS' build`；重点看：
   - `SecKeyCreateRandomKey` / `SecKeyCreateDecryptedData` / `unsafeBitCast` 是否有警告；
   - `ASWebAuthenticationSessionError.code == .canceledLogin` 是否解析；
   - `Data.append(contentsOf: [0x30, 0x0D, …])` 的字面量推断。

### 4.2 真机点通（10 分钟，必须有可用 Linux.do 账号）

1. 设置 → 打开 Linux.do 登录 → 弹出系统浏览器面板（**不是** App 内嵌 WebView）→ 地址栏应是 `https://linux.do/user-api-key/new?...`。
2. 面板内应能看到 Linux.do 自己的登录态（若之前用 Safari 登录过则免登录）→ 点授权。
3. 回到 App 后 `snapshot().authenticated == true`，且 `apiVersion >= 1`。
4. 杀掉 App 再打开：仍是已登录（Keychain 生效）。
5. 退出登录（`clearUserApiKey`）→ `snapshot().authenticated == false`；重开 App 仍是未登录。
6. 二次点击登录 → 立刻拿到 `LINUXDO_USER_API_BUSY`（说明 `isAuthenticating` 生效）。
7. 登录中途点面板「取消」→ 中文文案「你已取消或拒绝 Linux.do 授权」，且**只报一次**失败。
8. 用未登录 Safari 的隐私窗口场景（或先清 Safari 的 linux.do Cookie）复测：应能在面板里用 GitHub/Google 完成登录 → 证明共享 Cookie 仓成立。
9. 抓 Console 日志确认 `auth_redirect_rejected` **没有**出现；若出现，看 `stage=`：
   - `pending_nonce` → nonce 丢失；
   - `otp_decrypt` / `payload_decrypt` → RSA 或 PEM 问题（最高风险，见 5.1）；
   - `credential_store` → Keychain 写入失败。

### 4.3 现有 `npm run test:*` 能覆盖到什么

- `npm run test:linuxdo`（= `linuxdo.test.ts` + `test:linuxdo-readsync`）跑的是 **TypeScript 侧**的解析/请求/视图逻辑，**不加载任何 Swift**，因此对本次移植的直接覆盖是 **0**。
- 它仍有间接价值：这些脚本会断言 `LinuxDoSessionSnapshot` 的字段名与 `authMode` 取值，可作为「Swift 侧填的 snapshot 字段名有没有写错」的对照表。
- `linuxdo-browser-session-probe.test.ts` 覆盖的是 `browser-session` 那条**另一条**链路（`authenticate` / `prepareBrowserSession`），与本类无关，不要拿它的通过当作本类的验证。
- 结论：**没有可自动化的验证**，第 4.2 节的真机点通是唯一有效证据。

## 5. 不确定项（按风险从高到低）

| # | 风险 | 不确定什么 | 错了会怎样 | 怎么快速判定 / 兜底 |
|---|---|---|---|---|
| 5.1 | **高** | `SecKeyCopyExternalRepresentation` 对 RSA 公钥返回的到底是 PKCS#1 还是已经是 X.509；以及手写的 SPKI 前缀长度编码是否正确 | Discourse 端解不出 PEM → 授权页直接报错，或回流解密失败（`stage=otp_decrypt` / `payload_decrypt`）。整条链路不可用 | 真机跑第 4.2 步 1，看授权页是否正常渲染（正常渲染就说明 PEM 被接受）。兜底方案：改成输出 `-----BEGIN RSA PUBLIC KEY-----` + 原始 PKCS#1（Discourse 的 `OpenSSL::PKey::RSA.new` 同样接受），只需改 `publicKeyPem()` 一处 |
| 5.2 | **高** | `ASWebAuthenticationSession` 用未在 `Info.plist` 注册的 `discourse://` scheme 能否收到回调 | 面板点完授权后什么都不发生 → 用户卡住，最后走 `LINUXDO_USER_API_PROTOCOL` | 真机跑第 4.2 步 1–3。若失败：唯一出路是让另一个 agent 往 `Info.plist` 加 `CFBundleURLTypes`（本任务禁止改），或整体改用 `WKWebView` + `decidePolicyFor` |
| 5.3 | 中 | `callbackURLScheme` 是前缀匹配，Linux.do 若回传 `discourse://` 下的别的 host 会误判 | 会话提前结束，`handleRedirect` 返回 false，但回调已经被消费 → 认证静默失败 | 看 `auth_redirect_rejected` 是否出现。当前实现依赖 Linux.do 只回传 `discourse://auth_redirect`（Java 侧同样假设） |
| 5.4 | 中 | iOS 15 上 `SecKeyCreateRandomKey` + `kSecAttrApplicationTag` 的可查询性；tag 是 `Data` 还是 `String` | 每次授权都新生成一把 RSA 私钥 → 上一次的 `pending` 凭据永远解不开 | 真机连续登录两次；若第二次失败就是这个问题。兜底：`kSecAttrApplicationTag` 改用 `rsaKeyTag` 字符串（macOS 语义）或改走 `kSecAttrLabel` |
| 5.5 | 中 | 进程被杀后 `pendingNonce` 恢复但 `ASWebAuthenticationSession` 已死 | 用户看到「登录进行中」但没有任何面板；`cancel` 一次即可恢复 | 真机：登录到一半上划杀掉 App 再打开。兜底：`isAuthenticating()` 的初值可以改为恒 false，代价是丢掉 Java 的「扛过进程死亡」语义 |
| 5.6 | 中 | `AuthCallback` 由强引用改为「类自身强持有」后，外壳若把回调实现做成 plugin 自身会形成环 | 插件实例不释放（不是崩溃，是泄漏） | 让外壳用一个独立的小 adapter 对象实现 `AuthCallback`，或在 `destroy()` 里断链（已实现） |
| 5.7 | 低 | `NSLock` + `DispatchQueue.main.async` 的组合在 `closeBrowserSession()` 里的重入 | 理论死锁 | 已规避：所有跨队列都是 `async`，从不同步等主线程；`sessionFinished` 保证 `cancel()` 不重复触发完成回调 |
| 5.8 | 低 | 原 Java 文件实际 555 行（任务描述写 502 行） | 可能漏了任务作者认为存在的成员 | 已按仓库里的实际文件逐条对照，未发现多余成员 |
| 5.9 | 低 | `client_id` 前缀改成 `newsnook-ios-v3-` 后，老用户（若曾用 Android 版登录）在 Linux.do 账号设置里会看到两个授权条目 | 无功能影响，只是列表多一条 | 用户可在 Linux.do 设置里手动撤销旧条目 |

## 6. 明确不做的事

- 不改 `project.pbxproj`、`MainViewController.swift`、`Package.swift`、任何 TypeScript 文件。
- 不读也不移植 `LinuxDoSessionPlugin.java`（1661 行，另一个 agent 的职责）；本类只保证上面那套成员名可被它识别。
- 不从 Linux.do 原生层移植任何其它东西（浏览器会话准备、上传、CSRF 等都不在范围内）。
