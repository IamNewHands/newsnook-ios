import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const required = [
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/AppDelegate.swift',
  'ios/App/App/Info.plist',
  'ios/App/CapApp-SPM/Package.swift',
]

for (const file of required) {
  assert.equal(existsSync(file), true, `missing generated iOS file: ${file}`)
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(packageJson.dependencies['@capacitor/ios'], '8.4.2')

const swiftPackage = readFileSync('ios/App/CapApp-SPM/Package.swift', 'utf8')
assert.match(swiftPackage, /platforms: \[\.iOS\(\.v15\)\]/)
assert.match(swiftPackage, /capacitor-swift-pm\.git/)

// 深链 scheme：分享链接（newsnook://a/<token>）与账号 OAuth 回流
// （newsnook://auth/callback）共用同一个 scheme。Info.plist 不注册 CFBundleURLTypes，
// 系统就不会把 URL 交回 App：iOS 上登录回不来、分享深链也打不开。
const infoPlist = readFileSync('ios/App/App/Info.plist', 'utf8')
const protocolTs = readFileSync('packages/contracts/src/protocol.ts', 'utf8')
const callbackUrl = /MOBILE_AUTH_CALLBACK_URL\s*=\s*'([^']+)'/.exec(protocolTs)?.[1]
assert.ok(callbackUrl, 'packages/contracts/src/protocol.ts must define MOBILE_AUTH_CALLBACK_URL')
const scheme = callbackUrl.slice(0, callbackUrl.indexOf('://'))
assert.ok(scheme.length > 0, `cannot derive scheme from ${callbackUrl}`)
assert.match(infoPlist, /<key>CFBundleURLTypes<\/key>/)
assert.match(infoPlist, /<key>CFBundleURLSchemes<\/key>/)
assert.match(
  infoPlist,
  new RegExp(`<string>${scheme}</string>`),
  `Info.plist must register the ${scheme}:// scheme used by MOBILE_AUTH_CALLBACK_URL`,
)

// 任何 ASWebAuthenticationSession 的 callbackURLScheme 都必须在 Info.plist 注册，
// 否则授权页回来后系统不会把 URL 交回 App —— 表现为「点了登录，面板关掉就再没反应」。
// 期望值从 Swift 源码派生：既认字面量，也认 `Self.xxx` 常量引用（否则测试会空跑通过）。
const swiftDir = 'ios/App/App'
const swiftFiles = readdirSync(swiftDir).filter((name) => name.endsWith('.swift'))
const callbackSchemes = new Set()
let usesAuthSession = false
for (const name of swiftFiles) {
  const source = readFileSync(`${swiftDir}/${name}`, 'utf8')
  if (source.includes('ASWebAuthenticationSession(')) usesAuthSession = true
  for (const match of source.matchAll(/callbackURLScheme:\s*("([^"]+)"|(?:Self\.)?([A-Za-z_]\w*))/g)) {
    if (match[2]) {
      callbackSchemes.add(match[2])
      continue
    }
    const constant = new RegExp(`(?:static\\s+)?let\\s+${match[3]}\\s*=\\s*"([^"]+)"`).exec(source)
    assert.ok(constant, `${name}: cannot resolve callbackURLScheme constant ${match[3]}`)
    callbackSchemes.add(constant[1])
  }
}
if (usesAuthSession) {
  assert.ok(
    callbackSchemes.size > 0,
    'ASWebAuthenticationSession is used but no callbackURLScheme could be derived',
  )
}
for (const callbackScheme of callbackSchemes) {
  assert.match(
    infoPlist,
    new RegExp(`<string>${callbackScheme}</string>`),
    `Info.plist must register the ${callbackScheme}:// scheme used by ASWebAuthenticationSession`,
  )
}

console.log('ios-platform: ok')
