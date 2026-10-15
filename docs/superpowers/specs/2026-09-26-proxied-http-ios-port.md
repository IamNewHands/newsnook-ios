# ProxiedHttp iOS 移植规格（2026-09-26）

把 Android 的 `android/app/src/main/java/com/aizeek/newsnook/ProxiedHttpPlugin.java`
移植为 iOS Swift：`ios/App/App/ProxiedHttpPlugin.swift`。

- 源：OkHttp 4 + `java.net.Proxy` / `Authenticator`
- 目标：`URLSession` + `URLSessionConfiguration.connectionProxyDictionary`
- 约束：iOS 15.0（`ios/App/CapApp-SPM/Package.swift` → `platforms: [.iOS(.v15)]`）、Swift 5.9、无第三方依赖
- **本文档对应的 Swift 文件未经编译、未经真机验证**（Windows 主机无 Xcode）。所有"已实现"均应读作"按源码写的"。

## 1. 方法表

| Java `@PluginMethod` | Swift 对应 | JS 契约 |
|---|---|---|
| `request(PluginCall)` | `@objc func request(_ call: CAPPluginCall)` | `ProxiedHttp.request(options) → Promise<{status:number, headers:Record<string,string>, setCookies?:string[], data:string}>` |

`jsName` 为 `"ProxiedHttp"`，与 `src/features/proxy/nativeHttp.ts` 的
`registerPlugin<ProxiedHttpPlugin>('ProxiedHttp')` 一致；`@objc(ProxiedHttpPlugin)` 与
`public let identifier = "ProxiedHttpPlugin"` 对齐现有 iOS 插件（`DeviceMediaControlsPlugin`、
`AppleTranslationPlugin`）的写法。

注册不由本文件负责：`MainViewController.swift` 的 `capacitorDidLoad()` 由调用方统一添加
`bridge?.registerPluginInstance(ProxiedHttpPlugin())`（本次改动未触碰该文件）。

## 2. 选项映射表（JS key → Swift 处理 → 线上格式）

| JS key | 类型 | Java 行为 | Swift 行为 | 线上效果 |
|---|---|---|---|---|
| `url` | string | 必填；空/缺 → reject `缺少 url` | 同；额外校验 scheme ∈ {http, https}，否则 reject `url 无效或协议不受支持` | `URLRequest(url:)` |
| `method` | string | 缺省 `GET`，`toUpperCase()` | 同；额外做 token 校验（≤20 字符，仅 `A-Z0-9-`），非法 → reject `不支持的 HTTP 方法：X` | `httpMethod` |
| `headers` | Record<string,string> | 逐键 `Request.Builder.header()`（覆盖同名，大小写不敏感） | 逐键 `URLRequest.setValue(_:forHTTPHeaderField:)`（同样覆盖同名），但**剔除** `Content-Length`/`Transfer-Encoding`/`Host`/`Connection` | 请求头，键的大小写按 JS 传入保留 |
| `data` | string | POST/PUT/PATCH 的 UTF-8 文本体 | `Data(text.utf8)` | 请求体 |
| `dataBase64` | string | 存在时优先，`Base64.DEFAULT` 解码；失败 → reject `请求体 dataBase64 不是有效 base64` | 存在时优先，`Data(base64Encoded:options:.ignoreUnknownCharacters)`；失败 → 同文案 reject | 请求体原始字节 |
| `omitContentType` | boolean | 默认 false；true 时 POST/PUT/PATCH 不带 Content-Type | 同 | `mediaType == nil` |
| `proxy.type` | `'http' \| 'socks5'` | `socks5` → `Proxy.Type.SOCKS`，其余 → `Proxy.Type.HTTP` | `http` → `connectionProxyDictionary`；`socks5` → **显式 reject**（见 §4.1） | — |
| `proxy.host` / `proxy.port` | string / number | 缺失、空、或 `port <= 0` → reject `代理主机或端口无效` | 同；`port` 兼容 `NSNumber` 与数字字符串 | `HTTPProxy`/`HTTPPort`/`HTTPSProxy`/`HTTPSPort` |
| `proxy.username` / `proxy.password` | string | 用户名非空才装 `Authenticator`，密码缺省 `""` | 用户名非空才写 `HTTPProxyUsername`/`HTTPProxyPassword`，密码缺省 `""` | 代理 407 时由 URLSession 自动重试 |
| `connectTimeout` | number(ms) | 默认 `15000` | 默认 `15000`；`<=0` 回落默认值；上限 600000 | 参与 `timeoutIntervalForResource` 与看门狗预算 |
| `readTimeout` | number(ms) | 默认 `25000`，同时用于 writeTimeout | 默认 `25000`；`<=0` 回落默认值；上限 600000 | `timeoutIntervalForRequest`（空闲超时，语义与 OkHttp `readTimeout` 对齐） |
| `followRedirects` | boolean | 默认 **false**；同时设 `followRedirects` 与 `followSslRedirects` | 默认 **false**；由 per-request 的 `URLSessionTaskDelegate`（`RedirectController`）在 `willPerformHTTPRedirection` 里 `completionHandler(nil)` 阻止跟随 | false 时 3xx + `Location` 原样回到 JS |

## 3. 响应字段映射表

| JS 字段 | Java 来源 | Swift 来源 |
|---|---|---|
| `status` | `response.code()` | `HTTPURLResponse.statusCode` |
| `headers` | `response.headers().names()` 逐个取值（同名只留最后一个） | `HTTPURLResponse.allHeaderFields` 逐键转字符串；**保留线上的原始大小写**（`upload.ts` 会读 `response.headers.etag` / `ETag` / `Etag`） |
| `setCookies` | `response.headers("Set-Cookie")` 全部条目 | `allHeaderFields` 中 `set-cookie` 的值；数组形态直接逐条返回，字符串形态走 `splitJoinedSetCookie` 还原（见 §4.2） |
| `data` | `Base64.encodeToString(bytes, NO_WRAP)` | `Data.base64EncodedString()`（无换行） |

## 4. 机制替换表

| Android 机制 | iOS 替换 | 差异与处理 |
|---|---|---|
| `OkHttpClient` 进程级复用（dispatcher / connectionPool / TLS session 复用） | 每请求一个 `URLSessionConfiguration.ephemeral` + `URLSession` | **有性能差异**：丢连接池与 TLS 会话复用。知乎连续分页会比 Android 多几次 TLS 握手。修复方向：缓存共享 `URLSession`（配置差异只在 timeout/proxy，可按 timeout 分桶），本次未做，见 §6-U4 |
| `clientBuilder.proxy(Proxy(HTTP, InetSocketAddress))` | `configuration.connectionProxyDictionary` 写 `HTTPEnable/HTTPProxy/HTTPPort` + `HTTPSEnable/HTTPSProxy/HTTPSPort` | HTTPS 目标由 URLSession 走 CONNECT 隧道；`http://` 目标走绝对 URI。两组键都开，因为无法预知目标 scheme |
| `clientBuilder.proxy(Proxy(SOCKS, ...))` | **无对应物** | 见 §4.1 |
| `proxyAuthenticator`（407 后补 `Proxy-Authorization: Basic`，已带则返回 null 防循环） | `HTTPProxyUsername` / `HTTPProxyPassword` | URLSession 内置 407 重试，天然只重试一次；**JS 看不到 `Proxy-Authorization` 头**（与 Android 的 `response.request().header(...)` 判断等价地不会死循环） |
| OkHttp `followRedirects(false)` / `followSslRedirects(false)` | 无配置开关。iOS 的 `URLSessionConfiguration` 和 `URLSessionTask` **都没有** `followRedirects` 属性；只能用 per-request 的 `URLSessionTaskDelegate` 实现 `urlSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`，回 `nil` 拒绝跟随 | delegate 由 session 强引用，**不得**反向捕获 session（会成环）。回 `nil` 后 completion handler 立即拿到原始 3xx，符合 `lib/http.ts` 自己按 `Location` 跳的预期 |
| OkHttp 显式 cookie jar | 刻意**关闭**：`httpShouldSetCookies = false`、`httpCookieStorage = nil`、`httpCookieAcceptPolicy = .never` | 目的是让 `Set-Cookie` 原样出现在响应头里，而不是被系统 cookie store 吞掉。会话维护本来就在 JS（`ZhihuCredentialStore`），iOS 不需要 `HTTPCookieStorage` 参与 |
| OkHttp 透明 gzip（自动加 `Accept-Encoding: gzip` 并解压） | URLSession 自动协商 `Accept-Encoding`（gzip/deflate/br）并交付解压后的字节 | 行为等价；**JS 传入的 `Accept-Encoding` 可能被 URLSession 覆盖或改写**，`Content-Encoding` 也可能因解压被移除 |
| OkHttp `readTimeout`（两次数据到达之间） | `timeoutIntervalForRequest` | 语义一致 |
| OkHttp `connectTimeout` | 无独立项 | 折进 `timeoutIntervalForResource = (connect+read)*4`，并额外加一个 `(connect+read)+5s` 的 `DispatchQueue` 看门狗 reject `请求超时` |
| OkHttp 的响应体读取（`responseBody.bytes()`，受 readTimeout 约束） | `dataTask` 完成回调里的 `Data` | 受 `timeoutIntervalForRequest` + 看门狗约束 |
| `IOException` → `call.reject(error.getMessage())` | `NSError.localizedDescription`；为空时回落 `网络请求失败` | 文案形态不同（英文系统错误 vs OkHttp 描述），但都是 reject |
| `@CapacitorPlugin(name="ProxiedHttp")` 自动注册 | `CAPBridgedPlugin` + `MainViewController.capacitorDidLoad()` 手动 `registerPluginInstance` | 由调用方接线 |

### 4.1 SOCKS5：不支持（明确 reject，不静默直连）

**Java 到底做了什么**：`proxyObj.type == "socks5"` 时用
`new Proxy(Proxy.Type.SOCKS, new InetSocketAddress(host, port))`。OkHttp 走 `SocketFactory`
建一个 TCP 连接后执行 SOCKS5 握手（含用户名/密码子协商），**域名在代理侧解析**（等价
`socks5h`）。所以 Android 的 `socks5` 是"真 SOCKS5 + 远端 DNS"。

**iOS 的现实**：`URLSessionConfiguration.connectionProxyDictionary` 的公开支持面只有
HTTP/HTTPS 代理。CoreFoundation 里没有 `kCFNetworkProxiesSOCKSEnable` /
`kCFNetworkProxiesSOCKSProxy` / `kCFNetworkProxiesSOCKSPort` 这类常量，`URLSession` 也不
实现 SOCKS5 握手。把臆造的键塞进字典会被忽略——那就是**静默直连**，比报错更糟（用户以为
流量走了代理，实际是明文出网）。iOS 系统设置里的"代理"面板同样只有 HTTP/HTTPS。

**本次实现**：`proxy.type == "socks5"` 直接
`call.reject("iOS 暂不支持 SOCKS5 代理：系统 URLSession 没有公开的 SOCKS 开关，继续执行只会静默直连。请改用 HTTP/HTTPS 代理，或使用系统 VPN / 全局代理。")`。

**JS 侧会看到**：`nativeProxiedRequest` 的 Promise 被 reject，message 为上面这段中文。
调用链上：
- `src/lib/http.ts` → `HTTP <status>` 之外的 reject 会冒泡为请求失败（`fetchSourceText` 的错误路径）
- `src/features/proxy/testConnection.ts` → 该 target 记为 `success: false`，`errorMessage` 就是这段中文（"测试代理"会明确显示不支持，而不是假成功）
- `src/features/zhihu/transport/android.ts` / `editor/upload.ts` → 抛错，知乎工作区不可用（SOCKS 用户改用 HTTP 代理即可）

**注意**：`src/features/proxy/transport.ts` 的 `resolveProxyTransport()` 仍会在 iOS 上把
`socks5` 判为 `native-tunnel`（它只看 `Capacitor.isNativePlatform()`，不区分 Android/iOS）。
本插件是唯一的运行时闸门；如果调用方希望设置页提前提示，需要另开一轮改 `transport.ts`
（本次任务明令不改 TypeScript）。

**如果要真做**：需要自建 socket + TLS 层，规模估计：

| 组件 | 内容 | 估计 |
|---|---|---|
| SOCKS5 客户端 | 版本/方法协商、用户名密码子协商、CONNECT 请求、应答解析、远端 DNS | 250–350 行 |
| TLS 包装 | `NWConnection` + `NWProtocolTLS`（或 `CFStream`/Security 框架），证书校验策略 | 150–250 行 |
| HTTP/1.1 客户端 | 请求序列化、chunked 与 `Content-Length` 解析、gzip 解压、`Set-Cookie` 收集 | 300–450 行 |
| 总 | 不支持 HTTP/2、连接池、重定向语义需另写 | **约 700–1050 行 + 3–5 个工作日**，且需真机联调 |

结论：不在本次范围内，给明确 reject 而不是半成品。

### 4.2 Cookie：重复 `Set-Cookie` 必须逐条保留

知乎 `applyZhihuResponseCookies()`（`src/features/zhihu/transport/android.ts:86`）逐条处理
`setCookies`，用 `;` 切分取 `name=value`；`Expires=Wed, 09 Jun 2021 10:18:14 GMT` 自带逗号，
所以**逗号拼接会直接破坏会话**。

实现顺序：
1. 关闭 `httpShouldSetCookies` / 清空 `httpCookieStorage` → 期望 `URLSession` 把多条
   `Set-Cookie` 作为数组放进 `allHeaderFields["Set-Cookie"]`，逐条原样返回。
2. 若平台仍合成单条字符串，`splitJoinedSetCookie` 按"逗号后紧跟合法 cookie 名（token）"切分。
   日期里的 `, 09 Jun` 逗号后是空格 + 数字，不构成 cookie 名，不会误切。
3. `setCookies` 恒为数组（可能为空 `[]`），不是 `undefined`；JS 侧
   `response.setCookies?.length ? ... : legacySetCookie` 两条路都能走。

## 5. 不可移植 / 降级清单

| 项 | 状态 | JS 可见行为 |
|---|---|---|
| `socks5` 代理 | **不支持**（显式 reject） | Promise reject，中文错误文案，见 §4.1 |
| 进程级连接池 / TLS 会话复用 | 降级：每请求一个 `URLSession` | 无 JS 可见差异，仅延迟与 TLS 握手次数变差 |
| 请求头 `Content-Length`/`Transfer-Encoding`/`Host`/`Connection` | 忽略（URLSession 自己管） | 与 Android 基本一致；极端场景（手工指定 `Content-Length`）行为不同 |
| `Accept-Encoding` | URLSession 可能覆盖 | 若调用方显式传入 `Accept-Encoding: identity`，不保证被尊重 |
| 独立 `connectTimeout` | 降级为总预算 | 连接阶段超时可能比 Android 更宽松（由总预算兜底） |
| `Proxy-Authorization` 请求头 | 不出现在响应/重定向链上 | JS 看不到；不会死循环 |
| HTTP/2 | URLSession 默认协商 h2 | 与 OkHttp 一致（OkHttp 也默认 h2）；如代理只支持 h1 由 URLSession 自行回落 |
| 取消（AbortSignal） | 不支持 | 与 Android 现状一致：`nativeHttp.ts` 无 cancel 方法，JS 侧靠 `abortable()` 忽略结果 |
| 系统 `HTTPCookieStorage` 写入 | 刻意不做 | JS 侧自己管 cookie（Keystore 快照） |
| 明文 HTTP（`http://`） | 保留支持 | iOS 需 `Info.plist` ATS 例外（`NSAllowsArbitraryLoads` 或域名例外），否则 URLSession 直接报 ATS 错误；Android 侧靠 `usesCleartextTraffic`。**本次未改 Info.plist**，需调用方确认现有配置 |
| 代理运行前提 | 需要"用户显式配置 + 用户可见用途" | App Review 对 `connectionProxyDictionary` 可能追问；本功能是用户自填代理，属正当用途 |

## 6. 不确定点（供 review，按风险排序）

| # | 风险 | 不确定内容 | 若判断错的后果 |
|---|---|---|---|
| U1 | 高 | `connectionProxyDictionary` 的键名我用了去前缀形态（`HTTPProxy`/`HTTPSProxy`/`HTTPEnable`/`HTTPSEnable`/`HTTPPort`/`HTTPSPort`/`HTTPProxyUsername`/`HTTPProxyPassword`）。这是 CFNetwork 文档化的 `kCFNetworkProxies*` 常量值；但"去掉 `kCFNetworkProxies` 前缀"是我的推断，未在设备上验证 | 代理不生效 → 变成直连（最坏情况）。真机验证必须确认出口 IP |
| U2 | 高 | `httpShouldSetCookies = false` + `httpCookieStorage = nil` 之后，`allHeaderFields["Set-Cookie"]` 是否稳定保留（数组形态） | 拿不到 `setCookies` → 知乎会话不再滚动更新，表现为"登录后偶发失效" |
| U3 | 中 | 重定向靠 `URLSessionTaskDelegate.willPerformHTTPRedirection` + `completionHandler(nil)` 阻止；该签名在 iOS 15 上应可用，但 delegate 的调用时序（尤其 3xx 响应体是否完整交付）未在设备上验证 | `followRedirects: false` 行为不符 → 知乎/OSS 收到跟随后的响应，状态码与 Location 都不是期望值 |
| U4 | 中 | 每请求一个 `URLSession` 的性能损失是否可接受（Android 明确注释过不能这么做） | 知乎分页变慢；如不可接受需改为共享 session 按 timeout 分桶 |
| U5 | 中 | `Data(base64Encoded:options:.ignoreUnknownCharacters)` 与 Android `Base64.DEFAULT` 的宽松度是否完全等价（后者容忍非字母表字符） | 极端输入下一边解码成功一边 reject |
| U6 | 低 | `headers` / `proxy` 逐项按动态类型取字符串（`JSObject` 是 `[String: JSValue]`，空协议值，不能桥接成 `NSDictionary`）；数字型 `port` 用 `doubleValue` 判整后转 `intValue` | 若 Capacitor 以非 `String`/`NSNumber` 形态传值，该字段被忽略 → `代理主机或端口无效` |
| U7 | 低 | `URLRequest.setValue` 是否保留 JS 传入的头部大小写 | `upload.ts` 读 `response.headers.etag`（响应侧已按线上原始大小写返回，风险主要在请求侧） |
| U8 | 低 | 看门狗预算 `(connect+read)/1000 + 5s` 是否会在慢速大文件上传（OSS 20MB GIF）时误杀 | 长上传被提前 reject `请求超时`（可调大预算） |
| U9 | 低 | 看门狗闭包 `[weak self]` + `guard let self else` 需要 Swift 5.7+；仓库已有同样写法（`DeviceMediaControlsPlugin`），判定安全 | 编译失败（概率低） |
| U10 | 低 | 响应头值若为 `NSNull` 会被跳过 | 个别头缺失，JS 侧本就走 `?? undefined` 兜底 |
| U11 | 低 | `@objc(ProxiedHttpPlugin)` 的 Objective-C 名与 `identifier` 同名是否影响注册 | 注册失败 → JS 调用静默失败（由调用方接线时验证） |
| U12 | 低 | `URLSessionConfiguration.ephemeral` 下 `urlCache = nil` 是否合法（ephemeral 本就有内存缓存） | 运行时警告，不致命 |

## 7. 验证清单（必须在 macOS / 真机上做）

**编译与注册**
1. macOS 上 `npm run ios:sync`（Windows 会写坏 `Package.swift` 路径，禁止在 Windows 生成）后打开 Xcode 工程，确认 `ProxiedHttpPlugin.swift` 已加入 target 的 Sources。
2. `MainViewController.capacitorDidLoad()` 里加 `bridge?.registerPluginInstance(ProxiedHttpPlugin())`。
3. 真机日志确认 `Capacitor.isPluginAvailable('ProxiedHttp') === true`。

**HTTP 代理（U1 的判定实验）**
4. 起一个本地 HTTP 代理（如 mitmproxy / Squid），`ProxyPrefs.mode = 'always'`，`proxyUrl = http://<host>:<port>`。
5. 请求 `https://feeds.bbci.co.uk/news/rss.xml`：代理侧必须看到 CONNECT 记录；断网后必须失败（证明没有偷偷直连）。
6. 带用户名/密码：确认 407 → 重试 → 200；错误密码必须 reject 而不是无限重试。
7. 请求 `http://` 明文目标（网易 `3g.163.com`）：确认走绝对 URI 而不是 CONNECT。

**SOCKS5（拒绝路径）**
8. `proxyUrl = socks5://127.0.0.1:1080`：确认 Promise reject，message 含"iOS 暂不支持 SOCKS5 代理"；**抓包确认没有任何直连请求发出**。
9. 设置页"测试代理"：三个 target 全部 `success: false` 且 `errorMessage` 是同一段中文。

**Cookie（U2 的判定实验）**
10. 知乎登录后连续请求 `www.zhihu.com` 与 `api.zhihu.com`，确认响应里 `setCookies` 数组长度 ≥ 2（有 `_xsrf`/`BEC` 滚动更新时）。
11. 构造一个返回两条 `Set-Cookie`（其中一条带 `Expires=Wed, 09 Jun 2027 10:18:14 GMT`）的测试端点，确认 `setCookies.length === 2` 且 `Expires` 完整。

**重定向（U3 的判定实验）**
12. `followRedirects: false` 请求一个 302 端点：确认 `status === 302` 且 `headers.location` 存在。
13. `followRedirects: true`：确认拿到最终 200。
14. `followRedirects: false` 的 302 响应体若带内容，确认 body 完整（delegate 回 `nil` 后 completion handler 应立刻交付原始响应）。
15. 确认 `RedirectController` 没有成环：多次请求后插件实例可正常释放（`deinit` 里取消任务不报错）。

**二进制体**
14. OSS 上传路径（`zhihu/editor/upload.ts`）：`dataBase64` 上传 PNG/GIF，确认字节一致（对比 MD5）。
15. `omitContentType: true` + `data: ''` 的 `?uploads` 初始化请求：抓包确认**没有** `Content-Type` 头。
16. 默认 POST（`lib/http.ts` 的 `nativePost`）：确认无显式 Content-Type 时发的是 `application/x-www-form-urlencoded; charset=UTF-8`。
17. HEAD / DELETE：确认无请求体。

**超时**
18. `connectTimeout: 1000` 打不可达地址：确认在数秒内 reject（不是 60s 系统默认）。

**相关测试脚本**（本次未改任何 TS，以下用于回归既有契约）
- `npm run test:proxy` — `scripts/proxy-routing.test.ts`：`resolveProxyTransport` 的隧道判定、`socks5` → `native-tunnel` 不变（iOS 的闸门在本插件，不在 TS）
- `npm run test:native-http` — `scripts/native-http-response.test.ts`：base64 → 文本/JSON 解码路径
- `npm run test:zhihu-session` — cookie 合并与会话滚动
- `npm run test:zhihu-editor` — `dataBase64` / `omitContentType` / OSS 分片上传
- `npm run test:zhihu`（或 `test:zhihu-protocol`）— 知乎 transport 端到端契约
- `npm run test:ios-native-plugin`（若存在同名脚本）— 建议未来新增断言：`jsName = "ProxiedHttp"`、`CAPPluginMethod(name: "request"`、`@objc func request(`，与 `scripts/ios-native-plugin.test.mjs` 同形

## 8. 未改动文件（明确声明）

本次只新增/修改两个文件：
- `ios/App/App/ProxiedHttpPlugin.swift`（新增）
- `docs/superpowers/specs/2026-09-26-proxied-http-ios-port.md`（本文）

未触碰：`project.pbxproj`、`MainViewController.swift`、`CapApp-SPM/Package.swift`、
任何 TypeScript、任何 Java、任何测试脚本。

---

## 附：落地评审修正（2026-09-26，父代理核对 Capacitor/Foundation 公开 API 后）

本节记录对上面 §4 不确定项的复核结论与已落地的代码修正，以本节为准。

### U1（代理键名）— 部分推翻
- `HTTPEnable` / `HTTPProxy` / `HTTPPort` / `HTTPSEnable` / `HTTPSProxy` / `HTTPSPort` 这六个
  去前缀键名是社区通行且被 Apple 文档示例使用的写法，**保留**。
- `HTTPProxyUsername` / `HTTPProxyPassword` **不是 Apple 公开 SDK 的键**（不存在
  `kCFNetworkProxiesHTTPProxyUsername` 之类的常量），写进 `connectionProxyDictionary`
  会被忽略 → 需要认证的代理会稳定 407。已删除这两个键。
- 也不能改用 `httpAdditionalHeaders` 预置 `Proxy-Authorization`：HTTPS 走 CONNECT 隧道时
  该头会跟着隧道内的请求发给**源站**，既认证不到代理，又把凭据泄露给源站。
- 落地做法：`ProxiedHttpSessionDelegate` 增加
  `urlSession(_:task:didReceive:completionHandler:)`，用 `protectionSpace.host/port`
  与配置的代理 host/port 比对确认「这是代理的挑战」，再回 `.useCredential`。
  这等价于 OkHttp 的 `proxyAuthenticator`，且不会把凭据交给源站。

### U3（重定向）— 已确认并修正
`URLSessionTask` 没有 `followRedirects` 属性（那是 OkHttp 的），原稿直接赋值会**编译失败**。
已改为 `URLSessionTaskDelegate.urlSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`
回 `nil`（不跟随）/ `request`（跟随）。

### U6（JSObject 取值）— 已确认并修正
`JSObject` 是 `[String: JSValue]`（`JSValue` 是空协议），**不能** `as NSDictionary`。
已改为逐项按动态类型取字符串；数字走 `NSNumber`（整数形态取 `intValue`，避免 `"8080.0"`）。

### 仍然有效的不确定项
U2（关闭 cookie 存储后 `allHeadersFields` 的 Set-Cookie 形态）、U4（每请求一个 URLSession
丢掉连接池/TLS 复用，知乎分页变慢）、U5（base64 宽松度等价性）只能靠真机/CI 验证。
