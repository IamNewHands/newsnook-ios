import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
const plist = readFileSync('ios/App/App/Info.plist', 'utf8')
const launch = readFileSync('ios/App/App/Base.lproj/LaunchScreen.storyboard', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

assert.doesNotMatch(pbx, /PRODUCT_BUNDLE_IDENTIFIER = com\.getcapacitor\.App/)
assert.equal(
  (pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.aizeek\.newsnook\.ios;/g) ?? []).length,
  2,
)
// MARKETING_VERSION 必须跟随 package.json 的 version（同步上游版本时由
// scripts/ios-set-marketing-version.mjs 更新），Debug 与 Release 各一处。
const expectedMarketingVersion = `MARKETING_VERSION = ${packageJson.version};`
assert.equal(
  (pbx.match(new RegExp(expectedMarketingVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [])
    .length,
  2,
  `project.pbxproj 中应恰好有 2 处 "${expectedMarketingVersion}"（Debug / Release），` +
    `且必须与 package.json 的 version（${packageJson.version}）一致`,
)
assert.match(plist, /<string>News Nook<\/string>/)
assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key>/)
assert.match(plist, /<key>NSPhotoLibraryAddUsageDescription<\/key>/)
assert.match(plist, /<key>NSAppTransportSecurity<\/key>/)
assert.doesNotMatch(plist, /<key>NSAllowsArbitraryLoads<\/key>/)
assert.match(pbx, /PrivacyInfo\.xcprivacy in Resources/)

// CapApp-SPM/Package.swift 由 `npx cap sync ios` 生成。在 Windows 上生成会把每个
// path 写成反斜杠形式，macOS 的 Swift 无法解析，因此这里拦住这种提交。
const spmManifest = readFileSync('ios/App/CapApp-SPM/Package.swift', 'utf8')
assert.doesNotMatch(
  spmManifest,
  /\\/,
  'CapApp-SPM/Package.swift 含反斜杠路径（通常是在 Windows 上跑了 cap sync ios），请在 macOS 上重新生成',
)
assert.doesNotMatch(
  spmManifest,
  /CapacitorStatusBar/,
  'CapApp-SPM/Package.swift 仍引用 @capacitor/status-bar；上游已改用 Capacitor 8 内置 SystemBars',
)

const privacyJson = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', 'ios/App/App/PrivacyInfo.xcprivacy'], {
    encoding: 'utf8',
  }),
)
assert.deepEqual(privacyJson.NSPrivacyAccessedAPITypes, [
  {
    NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
    NSPrivacyAccessedAPITypeReasons: ['C617.1'],
  },
  {
    NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
    NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
  },
])

const plistJson = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', 'ios/App/App/Info.plist'], {
    encoding: 'utf8',
  }),
)
const ats = plistJson.NSAppTransportSecurity
assert.equal(ats.NSAllowsArbitraryLoads, undefined)
assert.deepEqual(
  Object.keys(ats.NSExceptionDomains).sort(),
  ['126.com', '126.net', '163.com', 'netease.com'],
)
for (const exception of Object.values(ats.NSExceptionDomains)) {
  assert.deepEqual(exception, {
    NSExceptionAllowsInsecureHTTPLoads: true,
    NSIncludesSubdomains: true,
  })
}

assert.match(launch, /red="0\.0549" green="0\.0588" blue="0\.0706"/)
assert.equal(packageJson.scripts['ios:assets'], 'node scripts/generate-ios-assets.mjs')
assert.match(packageJson.scripts['ios:sync'], /^npm run ios:assets && /)

for (const file of [
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png',
]) {
  assert.equal(existsSync(file), true, `missing iOS image: ${file}`)
  assert.ok(statSync(file).size > 10_000, `unexpectedly small iOS image: ${file}`)
}

const iconInfo = execFileSync(
  'sips',
  ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'],
  { encoding: 'utf8' },
)
assert.match(iconInfo, /pixelWidth: 1024/)
assert.match(iconInfo, /pixelHeight: 1024/)
assert.match(iconInfo, /hasAlpha: no/)

for (const file of [
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png',
]) {
  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
    encoding: 'utf8',
  })
  assert.match(info, /pixelWidth: 2732/)
  assert.match(info, /pixelHeight: 2732/)
}

console.log('ios-project: ok')
