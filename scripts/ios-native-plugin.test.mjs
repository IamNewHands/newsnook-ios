import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const plugin = readFileSync('ios/App/App/DeviceMediaControlsPlugin.swift', 'utf8')
const apple = readFileSync('ios/App/App/AppleTranslationPlugin.swift', 'utf8')
const controller = readFileSync('ios/App/App/MainViewController.swift', 'utf8')
const storyboard = readFileSync('ios/App/App/Base.lproj/Main.storyboard', 'utf8')
const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
const nativeTs = readFileSync('src/features/translation/native.ts', 'utf8')
const appDelegate = readFileSync('ios/App/App/AppDelegate.swift', 'utf8')
const jsSyncNotification = readFileSync('src/features/sync/nativeNotification.ts', 'utf8')
const infoPlist = readFileSync('ios/App/App/Info.plist', 'utf8')
const jsReadAloudNative = readFileSync('src/features/readAloud/native.ts', 'utf8')

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
  {
    jsName: 'SyncNotification',
    className: 'SyncNotificationPlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/SyncNotificationPlugin.java',
    swift: 'ios/App/App/SyncNotificationPlugin.swift',
    jsFile: 'src/features/sync/nativeNotification.ts',
  },
  {
    jsName: 'ReadAloud',
    className: 'ReadAloudPlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/ReadAloudPlugin.java',
    swift: 'ios/App/App/ReadAloudPlugin.swift',
    jsFile: 'src/features/readAloud/native.ts',
  },
  {
    jsName: 'DlnaCast',
    className: 'DlnaCastPlugin',
    java: 'android/app/src/main/java/com/aizeek/newsnook/DlnaCastPlugin.java',
    swift: 'ios/App/App/DlnaCastPlugin.swift',
    jsFile: 'src/lib/dlnaCast.ts',
    // iOS 上组播 SSDP 需要 Apple 特批的 multicast entitlement，自签拿不到，
    // 所以多了「手动填电视 IP」这条补偿路径——这三个方法 Java 侧不存在。
    extraMethods: ['addManualDevice', 'removeManualDevice', 'listManualDevices'],
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

  // iOS 专属方法（例如 DlnaCast 的手动填 IP）单独声明，不混进 Java 方法表，
  // 这样「Java 加了方法但 Swift 忘了」仍然会被抓出来。
  const extraMethods = plugin.extraMethods ?? []
  for (const method of extraMethods) {
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
    [...methods, ...extraMethods].sort(),
    `${plugin.swift} method table must match ${plugin.java} + iOS-only extras exactly`,
  )

  // 工程登记：pbxproj 的文件引用 + Sources 条目 + MainViewController 实例注册，
  // 缺任何一处，编译期就少了这个类（app 本地插件不在 capacitor.config.json 的
  // packageClassList 里，必须显式注册）。
  assert.match(controller, new RegExp(`registerPluginInstance\\(${plugin.className}\\(\\)\\)`))
  assert.match(pbx, new RegExp(`${plugin.className}\\.swift in Sources`))
  assert.match(pbx, new RegExp(`${plugin.className}\\.swift \\*/ = \\{isa = PBXFileReference`))
}

// SyncNotification：Android 的 NotificationChannel + PendingIntent 换成
// UNUserNotificationCenter + ApplicationDelegateProxy 深链，但「不打扰」的定位要保住。
const syncNotification = readFileSync('ios/App/App/SyncNotificationPlugin.swift', 'utf8')
const syncNotificationJava = readFileSync(
  'android/app/src/main/java/com/aizeek/newsnook/SyncNotificationPlugin.java',
  'utf8',
)
assert.match(syncNotification, /^import UserNotifications$/m)
assert.match(syncNotification, /UNUserNotificationCenter/)
// 通知 id 就是调用方给的字符串：同 id 覆盖而不是堆叠（Java 侧是稳定哈希，同一语义）。
assert.match(syncNotification, /UNNotificationRequest\(identifier: id, content: content, trigger: nil\)/)
// 低优先级对齐 Android 的 IMPORTANCE_LOW：不响铃、不弹横幅、不加角标。
// 因此只申请 .alert，interruptionLevel 用 passive。
assert.match(syncNotification, /requestAuthorization\(options: \[\.alert\]\)/)
assert.match(syncNotification, /content\.interruptionLevel = \.passive/)
assert.doesNotMatch(syncNotification, /requestAuthorization\(options: \[[^\]]*\.(sound|badge)/)
assert.doesNotMatch(syncNotification, /content\.sound/)
// 「用户关掉通知」与「还没决定」都必须 resolve 而不是 reject——通知是加分项，
// 缺了不能影响同步（Java 侧同样静默跳过）。
assert.match(syncNotification, /case \.authorized, \.provisional, \.ephemeral:/)
assert.match(syncNotification, /case \.notDetermined:/)
assert.match(syncNotification, /case \.denied|default:/)
// 深链 scheme 必须与 JS 的 SYNC_ROUTE_PREFIX 一致，否则点开通知落不到「账户与同步」。
assert.match(syncNotification, /routeScheme = "newsnook:\/\/sync\/"/)
assert.match(jsSyncNotification, /'newsnook:\/\/sync\/'/)
// delegate 必须在 App 启动完成前装好，否则「点通知冷启动」那一次回调直接丢。
// 装配点因此是 AppDelegate 而不是插件（插件要等 Capacitor bridge 起来才存在）。
assert.match(syncNotification, /final class SyncNotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate/)
assert.match(appDelegate, /UNUserNotificationCenter\.current\(\)\.delegate = SyncNotificationCenterDelegate\.shared/)
assert.match(syncNotification, /ApplicationDelegateProxy\.shared\.application\(/)
// reject 文案与 Java 逐字一致（调用方可能直接在 UI 上展示）。
for (const message of ['id, title and body are required', 'id is required']) {
  assert.ok(syncNotificationJava.includes(`"${message}"`), `java is missing reject text: ${message}`)
  assert.ok(syncNotification.includes(`"${message}"`), `swift is missing reject text: ${message}`)
}
// JS 侧平台闸门必须放开 iOS，否则插件写好了也永远不会被调用。
assert.match(jsSyncNotification, /NATIVE_NOTIFICATION_PLATFORMS = \['android', 'ios'\]/)

// ReadAloud：Android 的 TextToSpeech + 前台 Service + MediaSession 换成
// AVSpeechSynthesizer + 后台音频会话 + MPNowPlayingInfoCenter。
const readAloud = readFileSync('ios/App/App/ReadAloudPlugin.swift', 'utf8')
const readAloudJava = readFileSync(
  'android/app/src/main/java/com/aizeek/newsnook/ReadAloudPlugin.java',
  'utf8',
)
assert.match(readAloud, /^import AVFoundation$/m)
assert.match(readAloud, /^import MediaPlayer$/m)
assert.match(readAloud, /AVSpeechSynthesizer\(\)/)
assert.match(readAloud, /AVAudioPlayer\(contentsOf:/)
// 后台朗读靠 UIBackgroundModes: audio；缺了它 App 一进后台就被挂起。
assert.match(infoPlist, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>/)
// 锁屏 / 控制中心：Android 的 MediaSession 回调换成 MPRemoteCommandCenter。
assert.match(readAloud, /MPNowPlayingInfoCenter/)
assert.match(readAloud, /MPRemoteCommandCenter\.shared\(\)/)
for (const command of ['playCommand', 'pauseCommand', 'togglePlayPauseCommand', 'stopCommand', 'nextTrackCommand', 'previousTrackCommand']) {
  assert.match(readAloud, new RegExp(`${command}\\.addTarget`), `missing remote command: ${command}`)
}
// 音频焦点与「耳机拔出」：Android 的 AUDIOFOCUS_* / ACTION_AUDIO_BECOMING_NOISY
// 在 iOS 上是 AVAudioSession 的打断与路由变化通知，必须都接上，
// 否则来电后朗读不会暂停、拔耳机会外放。
assert.match(readAloud, /AVAudioSession\.interruptionNotification/)
assert.match(readAloud, /AVAudioSession\.routeChangeNotification/)
for (const type of ['"focus-loss"', '"focus-gain"', '"noisy"']) {
  assert.ok(readAloud.includes(`emit(${type})`), `swift is missing event: ${type}`)
}
// 字符偏移必须按 UTF-16 码元计数（Java String 下标 / JS substring 同一套），
// Swift 的 String.count 是字素簇，用错会让 seekByCharacter 漂移。
assert.match(readAloud, /fullText\.utf16\.count/)
assert.match(readAloud, /String\(decoding: units\[index\.\.\.\], as: UTF16\.self\)/)
assert.doesNotMatch(readAloud, /fullText\.count/)
// base64 解码 + 落盘（最大 18 MB）不能占主线程——与 Android 的 ioExecutor 对齐。
assert.match(readAloud, /ioQueue\.async/)
// reject 文案与 Java 逐字一致。
for (const message of [
  '缺少朗读文本或 utteranceId',
  '缺少 AI TTS 音频或 utteranceId',
  'AI TTS 音频过大',
  '无法创建朗读缓存目录',
]) {
  assert.ok(readAloudJava.includes(`"${message}"`), `java is missing reject text: ${message}`)
  assert.ok(readAloud.includes(`"${message}"`), `swift is missing reject text: ${message}`)
}
// JS 侧平台闸门与 provider / media 分支都必须放开 iOS，否则插件写了也不会被调用。
assert.match(jsReadAloudNative, /NATIVE_READ_ALOUD_PLATFORMS = \['android', 'ios'\]/)
const readAloudProviderFactory = readFileSync(
  'src/features/readAloud/providers/factory.ts',
  'utf8',
)
const readAloudMediaFactory = readFileSync('src/features/readAloud/media/factory.ts', 'utf8')
for (const [name, source] of [
  ['providers/factory.ts', readAloudProviderFactory],
  ['media/factory.ts', readAloudMediaFactory],
]) {
  assert.match(
    source,
    /platform === 'android' \|\| platform === 'ios'/,
    `${name} must route iOS to the native ReadAloud path`,
  )
}

// DlnaCast：Android 用 UDP 组播做 SSDP 发现，iOS 上组播需要 Apple 特批的
// com.apple.developer.networking.multicast（自签拿不到，sendto 直接 EACCES），
// 因此换成单播扫段 + 手动填 IP。控制面（SOAP）两边一致。
const dlna = readFileSync('ios/App/App/DlnaCastPlugin.swift', 'utf8')
const dlnaUpnp = readFileSync('ios/App/App/DlnaCastUpnp.swift', 'utf8')
const dlnaJava = readFileSync(
  'android/app/src/main/java/com/aizeek/newsnook/DlnaCastPlugin.java',
  'utf8',
)
const jsDlna = readFileSync('src/lib/dlnaCast.ts', 'utf8')
// 只允许单播：出现组播套接字选项就说明有人把 Android 的写法照搬过来了。
assert.match(dlnaUpnp, /sendto\(/)
assert.doesNotMatch(dlnaUpnp, /IP_MULTICAST_IF|IP_ADD_MEMBERSHIP|MulticastSocket/)
// 单播扫段要算本机网段；手动填 IP 要先试单播 M-SEARCH 再退回探测描述路径。
assert.match(dlnaUpnp, /getifaddrs/)
assert.match(dlnaUpnp, /sweepHosts\(/)
assert.match(dlna, /resolveManualDevice/)
assert.match(dlna, /manualSearchSeconds/)
// 「本地网络」隐私权限在 iOS 14+ 是弹窗，必须有用途说明，否则系统不给弹。
assert.match(infoPlist, /<key>NSLocalNetworkUsageDescription<\/key>/)
// UPnP 动作面：少一个都会让投屏在某个环节静默失败。
for (const action of [
  'SetAVTransportURI',
  'Play',
  'Pause',
  'Stop',
  'Seek',
  'GetTransportInfo',
  'GetPositionInfo',
  'GetMediaInfo',
  'GetVolume',
  'SetVolume',
]) {
  assert.ok(dlna.includes(`"${action}"`), `swift is missing UPnP action: ${action}`)
}
// 直连确认的判据与 Java 一致：连续 1.8 秒 playing 才算成功。
assert.match(dlna, /directProbeStableSeconds: TimeInterval = 1\.8/)
// 本轮只做直连：没有本机中转服务器（proxy 模式）。真加了就要同步改这里。
assert.doesNotMatch(dlna, /NWListener/)
assert.match(dlna, /mode: "direct"/)
// reject 文案与 Java 逐字一致。
for (const message of [
  '缺少投屏设备',
  '当前视频是临时媒体流，无法发送到电视',
  'DASH 视频源暂不支持投屏',
  '投屏设备已失效，请重新搜索',
]) {
  assert.ok(dlnaJava.includes(`"${message}"`), `java is missing reject text: ${message}`)
  assert.ok(dlna.includes(`"${message}"`), `swift is missing reject text: ${message}`)
}
// JS 侧：平台闸门放开 iOS，手动添加只对 iOS 暴露。
assert.match(jsDlna, /NATIVE_CAST_PLATFORMS = \['android', 'ios'\]/)
assert.match(jsDlna, /export function isManualDlnaDeviceSupported/)
assert.match(jsDlna, /registerPlugin<DlnaCastPlugin>\('DlnaCast'\)/)
// AirPlay：走 WebKit 的 webkitShowPlaybackTargetPicker（路由 video 元素本身），
// 前提是 video 声明了 x-webkit-airplay。
const airPlay = readFileSync('src/components/inkVideoPlayer/airPlay.ts', 'utf8')
const inkPlayer = readFileSync('src/components/InkVideoPlayer.tsx', 'utf8')
assert.match(airPlay, /webkitShowPlaybackTargetPicker/)
assert.match(inkPlayer, /setAttribute\('x-webkit-airplay', 'allow'\)/)
assert.match(inkPlayer, /onAirPlay=\{startAirPlay\}/)
// 投屏浮层要同时提供两条路径的入口。
const castOverlay = readFileSync('src/components/inkVideoPlayer/CastOverlay.tsx', 'utf8')
assert.match(castOverlay, /onAddManualDevice/)
assert.match(castOverlay, /onAirPlay/)

// 原生插件缺席时的降级契约。iOS 上 MediaSniffer 还没移植，而
// `prepareNativeMediaPlayback` 是投屏（connectCastDevice）与播放器的必经调用；
// 它一旦抛错，投屏就必然失败。所以这三处原生调用必须降级而不是 reject。
const mediaSnifferNative = readFileSync('src/features/mediaSniffer/native.ts', 'utf8')
for (const marker of [
  "log.sniffer.debug('native media prepare skipped'",
  "log.sniffer.debug('native stream proxy unavailable'",
  "log.sniffer.debug('native sniff unavailable'",
]) {
  assert.ok(mediaSnifferNative.includes(marker), `native.ts is missing degrade guard: ${marker}`)
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
