import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

console.log('ios-native-plugin: ok')
