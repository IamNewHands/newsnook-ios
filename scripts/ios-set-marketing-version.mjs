#!/usr/bin/env node
/**
 * 把 iOS 工程的 MARKETING_VERSION 同步为指定版本号。
 *
 * iOS 的 CFBundleShortVersionString 来自 MARKETING_VERSION；它必须与上游版本一致，
 * 否则设备端（SideStore / SideInstaller / LiveContainer）无法正确判断「有新版本」。
 * CI 构建时也会用 xcodebuild 命令行覆盖，这个脚本负责让本地 Xcode 打开工程时
 * 看到的版本号同样正确。
 *
 * 用法：
 *   node scripts/ios-set-marketing-version.mjs          # 取 package.json 的 version
 *   node scripts/ios-set-marketing-version.mjs 1.8.7    # 显式指定
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PBX = 'ios/App/App.xcodeproj/project.pbxproj'

const version =
  process.argv[2] || JSON.parse(readFileSync('package.json', 'utf8')).version

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本号格式不合法：${version}（期望 X.Y.Z）`)
  process.exit(1)
}

const before = readFileSync(PBX, 'utf8')
const matches = before.match(/\bMARKETING_VERSION = /g) || []
if (matches.length === 0) {
  console.error(`${PBX} 中没有找到 MARKETING_VERSION`)
  process.exit(1)
}

const after = before.replace(
  /(\bMARKETING_VERSION = )([^;]+)(;)/g,
  (_match, head, _old, tail) => `${head}${version}${tail}`,
)

if (after === before) {
  console.log(`MARKETING_VERSION 已是 ${version}，无需修改`)
  process.exit(0)
}

writeFileSync(PBX, after)
console.log(`MARKETING_VERSION → ${version}（共 ${matches.length} 处）`)
