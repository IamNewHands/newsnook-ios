import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const plugin = readFileSync('ios/App/App/DeviceMediaControlsPlugin.swift', 'utf8')
const apple = readFileSync('ios/App/App/AppleTranslationPlugin.swift', 'utf8')
const controller = readFileSync('ios/App/App/MainViewController.swift', 'utf8')
const storyboard = readFileSync('ios/App/App/Base.lproj/Main.storyboard', 'utf8')
const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
const nativeTs = readFileSync('src/features/translation/native.ts', 'utf8')

assert.match(plugin, /public let jsName = "DeviceMediaControls"/)
for (const method of [
  'getBrightness',
  'setBrightness',
  'clearBrightness',
  'getVolume',
  'setVolume',
]) {
  assert.match(plugin, new RegExp(`CAPPluginMethod\\(name: "${method}"`))
  assert.match(plugin, new RegExp(`@objc func ${method}\\(`))
}
assert.match(plugin, /UIApplication\.didEnterBackgroundNotification/)
assert.match(plugin, /MPVolumeView/)
assert.match(controller, /registerPluginInstance\(DeviceMediaControlsPlugin\(\)\)/)
assert.match(storyboard, /customClass="MainViewController"/)
assert.match(pbx, /DeviceMediaControlsPlugin\.swift in Sources/)
assert.match(pbx, /MainViewController\.swift in Sources/)
assert.doesNotMatch(plugin + controller + storyboard, /MlKitTranslation/)

// iOS 系统内置翻译（Translation 框架）：jsName、方法表、@objc 实现必须一一对应。
assert.match(apple, /public let jsName = "AppleTranslation"/)
for (const method of ['getLanguageStatus', 'prepareLanguagePack', 'translate']) {
  assert.match(apple, new RegExp(`CAPPluginMethod\\(name: "${method}"`))
  assert.match(apple, new RegExp(`@objc func ${method}\\(`))
}
// 整个插件类必须只在 iOS 18+ 注册，否则低版本系统上 JS 侧的能力探测会失真。
assert.match(apple, /@available\(iOS 18\.0, \*\)\s*\n@objc\(AppleTranslationPlugin\)/)
assert.match(controller, /if #available\(iOS 18\.0, \*\) \{\s*\n\s*bridge\?\.registerPluginInstance\(AppleTranslationPlugin\(\)\)/)
assert.match(pbx, /AppleTranslationPlugin\.swift in Sources/)
// 只用系统公开 API：宿主视图 + translationTask 借 session，下载走 prepareTranslation。
assert.match(apple, /import Translation/)
assert.match(apple, /\.translationTask\(/)
assert.match(apple, /session\.prepareTranslation\(\)/)
assert.match(apple, /session\.translations\(from: requests\)/)
assert.match(apple, /LanguageAvailability\(\)\.status\(from:/)
assert.doesNotMatch(apple, /MlKit/)
// JS 侧的 registerPlugin 名字必须与 Swift 的 jsName 完全一致，否则调用会静默失败。
assert.match(nativeTs, /registerPlugin<AppleTranslationApi>\('AppleTranslation'\)/)

// ── Android 专属插件的 iOS 移植一致性 ────────────────────────────────────────
// 期望值从 Android Java 源派生（单一真相），不手抄方法表：漏一个方法、漏一处工程
// 登记或漏 MainViewController 注册，iOS 侧 isPluginAvailable 就会是 false，
// 或者更糟——注册了但方法表对不上，调用直接走 Capacitor 的 UNIMPLEMENTED。
const portedPlugins = [
  {
    jsName: 'ProxiedHttp',
    className: 'ProxiedHttpPlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/ProxiedHttpPlugin.java',
    swift: 'ios/App/App/ProxiedHttpPlugin.swift',
    jsFile: 'src/features/proxy/nativeHttp.ts',
  },
  {
    jsName: 'SecureStore',
    className: 'SecureStorePlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java',
    swift: 'ios/App/App/SecureStorePlugin.swift',
    jsFile: 'src/features/account/native.ts',
  },
  {
    jsName: 'ZhihuSession',
    className: 'ZhihuSessionPlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/ZhihuSessionPlugin.java',
    swift: 'ios/App/App/ZhihuSessionPlugin.swift',
    jsFile: 'src/features/zhihu/session/native.ts',
  },
  {
    jsName: 'LinuxDoSession',
    className: 'LinuxDoSessionPlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java',
    swift: 'ios/App/App/LinuxDoSessionPlugin.swift',
    jsFile: 'src/features/linuxdo/session/native.ts',
  },
]

for (const plugin of portedPlugins) {
  assert.equal(existsSync(plugin.swift), true, `missing iOS port: ${plugin.swift}`)

  const swift = readFileSync(plugin.swift, 'utf8')
  const java = readFileSync(plugin.java, 'utf8')
  const js = readFileSync(plugin.jsFile, 'utf8')

  assert.match(swift, new RegExp(`@objc\\(${plugin.className}\\)`))
  assert.match(swift, new RegExp(`public let jsName = "${plugin.jsName}"`))
  assert.match(swift, new RegExp(`public let identifier = "${plugin.className}"`))
  // JS 侧的 registerPlugin 名字必须与 Swift 的 jsName 完全一致，否则调用会静默失败。
  assert.match(js, new RegExp(`registerPlugin(<[^>]*>)?\\('${plugin.jsName}'\\)`))

  const methods = [...java.matchAll(/@PluginMethod\s+(?:public\s+)?void\s+(\w+)\s*\(\s*PluginCall\s+\w+\s*\)/g)]
    .map((match) => match[1])
  assert.ok(methods.length > 0, `${plugin.java} exposes no @PluginMethod`)

  for (const method of methods) {
    assert.match(
      swift,
      new RegExp(`CAPPluginMethod\\(name: "${method}", returnType: CAPPluginReturnPromise\\)`),
      `${plugin.swift} is missing CAPPluginMethod(${method})`,
    )
    assert.match(
      swift,
      new RegExp(`@objc func ${method}\\(_ call: CAPPluginCall\\)`),
      `${plugin.swift} is missing @objc func ${method}(_ call:)`,
    )
  }

  const declared = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((match) => match[1])
  assert.deepEqual(
    declared.slice().sort(),
    methods.slice().sort(),
    `${plugin.swift} method table must match ${plugin.java} exactly`,
  )

  // 工程登记：pbxproj 的文件引用 + Sources 条目 + MainViewController 实例注册，
  // 缺任何一处，编译期就少了这个类（app 本地插件不在 capacitor.config.json 的
  // packageClassList 里，必须显式注册）。
  assert.match(controller, new RegExp(`registerPluginInstance\\(${plugin.className}\\(\\)\\)`))
  assert.match(pbx, new RegExp(`${plugin.className}\\.swift in Sources`))
  assert.match(pbx, new RegExp(`${plugin.className}\\.swift \\*/ = \\{isa = PBXFileReference`))
}

// ProxiedHttp：iOS 没有 URLSessionTask.followRedirects 这种属性（那是 OkHttp 的），
// 重定向必须由 URLSessionTaskDelegate 决定；写了这个属性会直接编译失败。
const proxiedHttp = readFileSync('ios/App/App/ProxiedHttpPlugin.swift', 'utf8')
assert.doesNotMatch(proxiedHttp, /task\.followRedirects/)
assert.match(proxiedHttp, /URLSessionTaskDelegate/)
assert.match(proxiedHttp, /willPerformHTTPRedirection/)
// SOCKS5 在 iOS 上没有公开通道：必须明确拒绝，绝不能静默直连。
assert.match(proxiedHttp, /socks5/)
assert.match(proxiedHttp, /iOS 暂不支持 SOCKS5 代理/)
// 代理凭据：HTTPProxyUsername/HTTPProxyPassword 不是 Apple 公开键，写了会被忽略 →
// 必须走 407 挑战回调，并且用 host/port 判定是代理的挑战（别把凭据交给源站）。
assert.doesNotMatch(proxiedHttp, /"(HTTPProxyUsername|HTTPProxyPassword)"\s*:/)
assert.match(proxiedHttp, /didReceive challenge: URLAuthenticationChallenge/)
assert.match(proxiedHttp, /space\.host == auth\.host/)
// Set-Cookie 必须逐条回给 JS（知乎 transport 手工合并 cookie）。
assert.match(proxiedHttp, /setCookies/)
assert.match(proxiedHttp, /splitJoinedSetCookie/)

// SecureStore：Keychain 取代 AndroidKeyStore + AES-GCM；策略与契约都要钉住。
const secureStore = readFileSync('ios/App/App/SecureStorePlugin.swift', 'utf8')
const secureStoreJava = readFileSync(
  'android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java',
  'utf8',
)
assert.match(secureStore, /^import Security$/m)
assert.match(secureStore, /kSecClassGenericPassword/)
assert.match(secureStore, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/)
assert.match(secureStore, /SecItemAdd\(/)
assert.match(secureStore, /SecItemUpdate\(/)
assert.match(secureStore, /SecItemCopyMatching\(/)
assert.match(secureStore, /SecItemDelete\(/)
assert.doesNotMatch(secureStore, /import (Alamofire|CryptoSwift|KeychainAccess)/)
// 「没有值」必须是 resolve({value: null})，不是 reject——JS 侧靠它区分未登录与错误。
assert.match(secureStore, /\["value": NSNull\(\)\]/)
// kSecAttrAccessible 只允许出现在 add：update 的 query 里带它会 errSecParam。
assert.doesNotMatch(
  secureStore.slice(secureStore.indexOf('private static func baseQuery'), secureStore.indexOf('@discardableResult')),
  /kSecAttrAccessible/,
)
// reject 文案与 Java 逐字一致（调用方可能直接在 UI 上展示）。
for (const message of [
  'key and value are required',
  'key is required',
  'secure store write failed: ',
  'secure store remove failed: ',
]) {
  assert.ok(secureStoreJava.includes(`"${message}`), `java is missing reject text: ${message}`)
  assert.ok(secureStore.includes(`"${message}`), `swift is missing reject text: ${message}`)
}
// 错误信息只带状态码，绝不带 key / value / 明文。
assert.match(secureStore, /private static func code\(_ status: OSStatus\) -> String/)
assert.doesNotMatch(secureStore, /print\(|NSLog\(|os_log/)

// 兜底：ios/App/App 下的每个 .swift 都必须在 Xcode target 的 Sources 里。
// 漏登记的文件「存在、测试也过」，但根本不参与编译 —— 真机上功能永远不可用。
for (const name of readdirSync('ios/App/App').filter((entry) => entry.endsWith('.swift'))) {
  assert.match(pbx, new RegExp(`${name} in Sources`), `${name} is not in the Xcode target Sources`)
  assert.match(
    pbx,
    new RegExp(`${name} \\*/ = \\{isa = PBXFileReference`),
    `${name} has no PBXFileReference`,
  )
}

console.log('ios-native-plugin: ok')
