# SecureStore 插件 iOS 移植（Keychain 版）

日期：2026-09-26
状态：**已落盘、未编译、未真机验证**（Windows 主机无 Xcode；本机无法编译任何 Swift）
交付物：
- `ios/App/App/SecureStorePlugin.swift`
- 本文档
- 附带静态断言脚本 `scripts/secure-store-ios.test.mjs`（新增；未改 `package.json`，需用 `node scripts/secure-store-ios.test.mjs` 直接跑）

源真值：`android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java`
JS 契约：`src/features/account/native.ts`（`set` / `get` / `remove`，`get` resolve `{ value: string | null }`）
调用方：`secureStore.ts`、`secretStore.ts`、`authClient.ts`、`src/features/zhihu/session/store.ts`

---

## 1. 方法表：Java → Swift → JS 契约

| Java `@PluginMethod` | Java 参数校验 | Swift 对应 | JS 调用（`registerPlugin('SecureStore')`） |
|---|---|---|---|
| `set(PluginCall)` | `key` 非空且 `value != null`，否则 `reject("key and value are required")` | `@objc func set(_ call: CAPPluginCall)`；`CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)` | `SecureStoreNative.set({ key, value }): Promise<void>` |
| `get(PluginCall)` | `key` 非空，否则 `reject("key is required")` | `@objc func get(_ call: CAPPluginCall)` | `SecureStoreNative.get({ key }): Promise<{ value: string \| null }>` |
| `remove(PluginCall)` | `key` 非空，否则 `reject("key is required")` | `@objc func remove(_ call: CAPPluginCall)` | `SecureStoreNative.remove({ key }): Promise<void>` |

resolve / reject 形状逐条对齐（reject 文案逐字照抄 Java，调用方可能在 UI 上直接展示）：

| 场景 | Java | Swift |
|---|---|---|
| `set` 成功 | `call.resolve()` → `{}` | `call.resolve([:])` → `{}` |
| `set` 缺参 | `reject("key and value are required")` | 同左 |
| `set` 落盘失败 | `reject("secure store write failed: " + 异常类名)` | `reject("secure store write failed: OSStatus <n>")` |
| `get` 无此 key | `resolve({value: null})`（**不是错误**） | `resolve(["value": NSNull()])` → `{"value":null}` |
| `get` 缺参 | `reject("key is required")` | 同左 |
| `get` 密文坏 / 解不开 | 删掉该 key，`resolve({value: null})` | 删掉该 item，`resolve(["value": NSNull()])` |
| `remove` 成功 | `call.resolve()` | `call.resolve([:])` |
| `remove` 缺参 | `reject("key is required")` | 同左 |
| `remove` 失败 | `reject("secure store remove failed: commit")` | `reject("secure store remove failed: OSStatus <n>")` |

与 Java 的两处**有意**差异（都在错误路径，不影响成功路径契约）：

1. `remove` 幂等：iOS `SecItemDelete` 对不存在的条目返回 `errSecItemNotFound`，Swift 侧把它归一成成功。Java 的 `commit()` 删不存在的 key 也返回 `true`，行为一致；显式归一只是为了不把「本来就没有」当失败上报。
2. 错误文案里放的是 `OSStatus` 数字而不是 Java 的异常类名（iOS 没有对应异常类型）。都不含 key / value / 明文。

命名映射要点：
- `jsName = "SecureStore"`，`identifier = "SecureStorePlugin"`，类名 `SecureStorePlugin`（`@objc(SecureStorePlugin)`），与 `native.ts` 的 `registerPlugin<SecureStorePlugin>('SecureStore')` 对齐。
- Swift 里 `set` / `get` 是保留字，声明必须写成 ``@objc func `set`(_ call: CAPPluginCall)``。`CAPPluginMethod.m` 用 `NSSelectorFromString(name + ":")` 拼 selector，所以只要方法名保持 `set:` / `get:` / `remove:`，JS 侧方法名就是 `set` / `get` / `remove`。

---

## 2. 存储映射：Android → iOS

| 维度 | Android（现状） | iOS（本次移植） |
|---|---|---|
| 密钥/密钥材料 | `AndroidKeyStore` 生成 AES-256，App 拿不到密钥材料 | 无自管密钥；`kSecClassGenericPassword` 条目由系统 keybag / Secure Enclave 派生密钥保护，App 同样拿不到 |
| 算法 | `AES/GCM/NoPadding`，128-bit tag，12-byte IV | 不适用（由 Security 框架整体保护，无自管密文格式） |
| 落盘位置 | 私有 `SharedPreferences("newsnook_secure_store")` | Keychain（generic password 条目） |
| 条目定位 | prefs key = JS 传来的 key | `kSecAttrService` = `com.aizeek.newsnook.securestore`（常量），`kSecAttrAccount` = JS 传来的 key（原样，不加前缀） |
| 值编码 | `Base64(iv) + ":" + Base64(ciphertext)` | `Data(value.utf8)` 直接存 `kSecValueData` |
| 写入语义 | `commit()` 同步刷盘（登录事务不能丢） | `SecItemUpdate` → 不存在则 `SecItemAdd`，同步返回即落盘 |
| 访问时机 | 不绑生物识别，`setUserAuthenticationRequired(false)`，后台同步可无人值守读写 | `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`：开机后首次解锁起可用，**不要求当前处于解锁态** |
| 换机 / 备份 | Keystore 密钥不可导出；恢复出厂或换机后旧密文永久解不开 | `ThisDeviceOnly`：条目**不随** iCloud/iTunes 备份迁移到新设备 |
| 读取失败 | 删掉 prefs 条目并返回 `null` | 删掉 Keychain 条目并返回 `null` |

### 为什么选 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`

- **`AfterFirstUnlock`（而非 `WhenUnlocked`）**：对应 Java 注释里的显式取舍「不绑定生物识别：同步要在后台无人值守地跑」。`WhenUnlocked` 在锁屏状态下 `SecItemCopyMatching` 会返回 `errSecInteractionNotAllowed`，而本插件是同步引擎 / Secret 水合的读路径，锁屏后台读失败会被上层当成「没有值」，等于凭空登出。选 `AfterFirstUnlock` 让「开机后已解锁过一次」即可读，与 Android 侧「不要求用户在场」的语义一致。安全上仍满足：设备重启且**从未**解锁前，条目不可读。
- **`ThisDeviceOnly`**：这是关键的一条，直接对齐 Android Keystore「密钥材料不可导出」的语义。它排除 `kSecAttrSynchronizable` 的 iCloud 钥匙串同步，也排除备份迁移，所以登录 token 与 Secret 不会因为一次 iCloud 备份出现在第二台设备上。
- 备选 `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` 被否掉：它要求用户设置锁屏密码，未设密码的设备上 `SecItemAdd` 直接失败——会把「没设密码」变成「无法登录」，属于功能回归。

### 应用重装 / 首次解锁前，分别会发生什么

| 事件 | iOS 行为 | 与 Android 的差别 |
|---|---|---|
| 设备重启后、首次解锁前 | `SecItemCopyMatching` 返回 `errSecInteractionNotAllowed`（`-25308`）；本实现把它当读失败 reject，JS 侧 `secureStore.ts` 捕获后按 `null` 处理 → 视为未登录 | Android 同样读不到（Keystore 不可用），行为等价 |
| App 卸载后重装（同一设备） | **Keychain 条目仍在**：iOS 删除 App 不清 Keychain。重新装回后 session 还在，可能直接是已登录态 | **与 Android 不同**。Android 卸载会带走 `SharedPreferences`，重装是干净状态。若产品要求「重装即登出」，需要在 `AppDelegate` 或首次启动时按 `kSecAttrService` 清一遍，本移植**没有**做这件事（不发明额外行为） |
| 换新设备 / 从备份恢复 | 条目不存在（`ThisDeviceOnly`）→ `{value: null}` → 未登录，用户重新登录 | 与 Android 的「旧密文永久解不开 → 清掉 → 未登录」结果一致，只是机制不同 |
| 用户改了锁屏密码 / 重设 Face ID | 条目**不受影响**（未绑 `kSecAccessControl` 生物识别） | Android 侧绑定生物识别的 Keystore key 会失效；本插件在 Android 上已显式 `setUserAuthenticationRequired(false)`，所以两边都不受影响 |
| 设备恢复出厂 | 条目随 keybag 一起消失 | 同 Android |

---

## 3. 迁移 / 行为差异与「要不要版本前缀」

- Android 落盘的是**密文**（`iv:ciphertext` 的 Base64），iOS 落盘的是**明文 Data**（由 Keychain 保护）。两者**格式互不兼容**，也不可能互相读取：Android 的密文只有那台设备的 Keystore key 能解。
- 因此不存在「Android 数据搬到 iOS」的迁移路径。跨平台迁移本来就靠云端同步（`features/sync` + Secret 同步），本地 SecureStore 只是落盘介质。
- **推荐做法（本移植采用）：account 保持 JS 传来的原始 key，不加任何前缀/版本号；迁移能力留在 `kSecAttrService` 常量上。** 理由：
  1. iOS 上此前没有任何 SecureStore 数据，加前缀只是新增一层纯装饰，还要在文档里解释「为什么 iOS 的 account 和 Android 的 prefs key 不一样」。
  2. 将来若真要换存储格式（例如改成加密 blob、或需要区分新旧语义），把 `keychainService` 从 `com.aizeek.newsnook.securestore` 换成 `...securestore.v2` 即可让新旧条目天然隔离，旧条目留在旧 service 下不影响新逻辑；需要清理时按旧 service 删一遍即可。
  3. Android 侧 `KEY_ALIAS = "newsnook.secure.store.v1"` 的 v1 是**密钥别名**版本，不是 key 的命名空间；照抄成 account 前缀会制造一个假的对应关系。
- 本次**没有**实现任何惰性迁移 / 双读逻辑（不发明额外行为）。唯一新增的常量是 service 字符串。

---

## 4. 体积上限：大 JSON 能不能存

- JS 侧实际负载量级（按代码估算，非实测）：
  - `account.session`：`{token, expiresAt, userId}` 的 JSON，几百字节。
  - `secret.<key>`：翻译 API Key / AI Provider Key / 代理地址，通常 < 1 KB。
  - `site.zhihu.<account>.session`：含 `wwwCookie` / `apiCookie` / `userAgent` / `profileJson`，是最大的一项，典型几 KB，极端情况十几 KB。
- 实测数据：**无**（本机不能跑 iOS）。公开资料对「单个 generic password 条目能放多大」没有正式文档化上限，社区经验值是大约 16 KB 以上开始出现 `errSecParam`（`-50`），不同 iOS 版本行为不一致。本次没有找到可引用的权威数字，所以不把它当硬约束写进代码。
- 本实现的取舍：**不预检、不截断、不拆分**，超过系统上限时 `SecItemAdd` 会返回错误，插件按契约 `reject("secure store write failed: OSStatus <n>")`；`get` 侧读不出来按坏值处理（删除 + 返回 `null`），上层退回未登录 / 让用户重新填 Secret。也就是说超限只会「存不上」，不会写出半截数据。
- 如果真机上发现知乎 session 这类大对象超限，正确修法是把值切块成多个条目（`<key>#0`、`<key>#1`…）并在插件里做透明拼装——**这属于新行为，本次不做**，需要时单独提需求。

---

## 5. 线程安全 / 非阻塞

- Capacitor 8 的 iOS bridge 在 `CapacitorBridge.swift:507` 用 `dispatchQueue.async`（串行队列，label `"bridge"`）调用插件方法，**不在主线程**。所以本实现同步做 Keychain I/O 不会卡 UI。
- 插件内部再加一把 `private let queue = DispatchQueue(label: "com.aizeek.newsnook.securestore")`，三个方法体都在 `queue.sync` 里执行：保证「同 key 的 update→add」不会被另一次调用穿插成两条条目（`SecItemUpdate` 返回 `errSecItemNotFound` 到 `SecItemAdd` 之间存在窗口）。
- `SecItemAdd` / `SecItemUpdate` / `SecItemCopyMatching` / `SecItemDelete` 本身线程安全，Apple 文档允许并发调用；这里串行化只是为了条目级语义。
- `call.resolve` / `call.reject` 在 bridge 队列上调用是安全的：`CapacitorBridge.toJs` 内部 `DispatchQueue.main.async` 回到主线程再交给 WebView。
- 没有使用 `DispatchQueue.main.sync`（会死锁风险），没有后台线程回调后忘记 resolve 的分支：所有路径都在同一个 `queue.sync` 闭包里以 resolve/reject 收尾。

---

## 6. 验证

### 本机（Windows）已做

| 项 | 命令 | 结果 |
|---|---|---|
| 新插件的静态断言 | `node scripts/secure-store-ios.test.mjs` | **通过**（jsName / 三个方法表 / `@objc` 实现 / Keychain API / accessibility 常量 / reject 文案与 Java 逐字一致 / 无 print 明文） |
| 既有 iOS 插件断言回归 | `node scripts/ios-native-plugin.test.mjs` | **通过**（未破坏 `DeviceMediaControls` / `AppleTranslation` 的既有约束） |
| JS 契约回归 | `npm run test:account-auth`、`test:secure-secret-hydration`、`test:zhihu-session` | **未能运行**：`npx tsx` 拉起 esbuild service 时报 `Error: spawn EPERM`（`node_modules/esbuild/lib/main.js:2272 ensureServiceIsRunning`）。这是本会话沙箱禁止 `child_process` 管道 stdio 的已知限制，与本次改动无关；需要在不带该限制的环境里补跑 |

### 必须在 macOS / 真机上做（本机无法完成）

1. **编译**：`ios/App/App.xcodeproj` 在 macOS 上 `xcodebuild`（或 CI `.github/workflows/ios-build.yml` 的 `macos-26` 未签名 IPA 构建）。这是唯一能证明 Swift 能编译的手段。
2. **工程登记**（**本次未做，明确留给调用方**）：`project.pbxproj` 三处（PBXBuildFile / PBXFileReference / group + Sources）、`MainViewController.swift` 的 `bridge?.registerPluginInstance(SecureStorePlugin())`。未登记时文件不参与编译，`Capacitor.isPluginAvailable('SecureStore')` 为 false。
3. **真机点检清单**：
   - 登录 → 杀进程 → 重开：仍为已登录（session 读回成功）。
   - 设置页写入 AI 翻译 Key → 杀进程 → 重开：Key 仍在（`hydrateRuntimeSecrets` 回填成功）。
   - 知乎账号登录 → 杀进程 → 重开：账号仍在（`site.zhihu.<id>.session` 读回成功）。
   - 登出 → 杀进程 → 重开：仍是未登录（`remove` 生效，`get` 返回 `null`）。
   - 设备重启后**不**解锁、冷启动 App：`get` 报 `errSecInteractionNotAllowed`，JS 侧按 `null` 处理，不应出现崩溃或卡死循环。
   - 卸载重装：观察是否仍为已登录（见 §2 表格，这是已知的与 Android 不同的行为）。
4. **JS 契约回归**：`npm run test:account-auth`、`npm run test:secure-secret-hydration`、`npm run test:zhihu-session`（在能跑 `tsx` 的环境）。
5. **一个必须先决定的 JS 侧问题（本移植解决不了）**：`src/features/account/authClient.ts` 用 `Capacitor.getPlatform() === 'android'` 判定 native bearer 路径（`createPlatformAccountAdapter` 把 iOS 归为 `platform: 'web'`）。即使 iOS 侧 SecureStore 可用，账号 session 在 iOS 上**仍然不会**走 SecureStore 落盘，登录也不会跨重启保持。要让本插件对账号真正生效，需要在 JS 侧把判据改成「平台原生 + `isPluginAvailable('SecureStore')`」。本次任务禁止改任何 TypeScript 文件，所以这一条只作为结论上报。

---

## 7. 不确定项（按风险从高到低）

1. **未编译**。Swift 全文一次都没有过编译器。最可能的语法/类型风险点：
   - ``@objc func `set`(_ call: CAPPluginCall)`` 的反引号保留字写法（我对 Objective-C selector 会是 `set:` 有把握，但没编译验证过；若编译器报错，退路是写成 `@objc(set:) func setValue(_ call: CAPPluginCall)`，同时把 `CAPPluginMethod(name:)` 保持为 `"set"`）。
   - `[kSecValueData as String: data] as CFDictionary` 这种字面量直接桥接（写法保守，但仍是本文件里最容易出类型推断问题的一行）。
   - `call.resolve([:])` 与 `call.resolve(missing)` 的重载选择（`resolve()` / `resolve(_:)` / `resolve(with:)` 三个重载并存，已显式标注 `[String: Any]` 降低风险）。
2. **`NSNull` 的 JSON 序列化**：`PluginCallResult.swift:19` 用 `JSONSerialization.isValidJSONObject` 校验后序列化；`NSNull` 是合法 JSON 对象（`null`），因此 `{"value":null}` 应该能原样到 JS。没有实机验证。若这里出问题，`get` 的「没有值」语义会从 `null` 变成 reject 或丢字段——这是**最伤契约**的一处。
3. **`errSecInteractionNotAllowed`（-25308）时我选择 reject 而不是 `{value:null}`**：已全仓 grep 确认 `SecureStoreNative` 只在 `src/features/account/secureStore.ts` 被引用（`get` catch → `null`、`set` catch → 抛出、`remove` catch → 吞掉），所有上层（`secretStore.ts` / `authClient.ts` / `zhihu/session/store.ts`）都经 `SecureStore` 接口调用，因此锁屏后台读失败会被统一降级成「没有值」，与 Java 行为一致。剩余风险仅是：`set` 在锁屏态抛错会让调用方看到一次写失败（Android 侧同样会失败）。
4. **Keychain 条目在 App 卸载重装后仍然存在**：确认过 Apple 的文档语义，但「产品是否接受重装仍登录」是产品决策，不是技术判断。当前实现不做清理。
5. **单条目体积上限没有权威数字**：见 §4。若知乎 session 真超过系统上限，症状是 `set` reject（不会静默丢数据），需要真机确认。
6. **`queue.sync` 与 bridge 串行队列叠加**：两把锁串行，理论上没有死锁路径（本插件从不在自己的 queue 里再进 bridge 队列），但 `queue.sync` 在极端并发下会串行排队；Keychain 操作是微秒级，我判断不影响可感知延迟，未实测。
7. **`kSecAttrService` 取值 `com.aizeek.newsnook.securestore`** 是本移植新引入的常量。它与 `PRODUCT_BUNDLE_IDENTIFIER = com.aizeek.newsnook.ios` 不同（不需要相同），但若将来有 App Extension 需要共享，会需要 `kSecAttrAccessGroup` + Keychain Sharing entitlement——本次没有加。
8. **错误文案与 Java 不完全逐字一致**（`OSStatus <n>` vs Java 异常类名）。成功路径与缺参路径逐字一致；失败路径的差异已在上文列明。若产品要求完全一致，需要约定一套共享错误码。

---

## 8. 与本次任务边界的对照

- 只新增 `ios/App/App/SecureStorePlugin.swift`、本文档、`scripts/secure-store-ios.test.mjs`。
- **未**改 `project.pbxproj`、`MainViewController.swift`、`Package.swift`、任何 TypeScript 文件（登记与 JS 判据由调用方集中处理）。
- 部署目标 iOS 15.0（`project.pbxproj` / `Package.swift` 均为 `.v15`）：本文件只用 iOS 15 之前就存在的 `Security` 公开 API（`SecItem*`、`kSecClassGenericPassword`、`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` 自 iOS 4 起可用），无 `@available` 分支需要。
- 无第三方依赖：只 `import Capacitor / Foundation / Security`。
