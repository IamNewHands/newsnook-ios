import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

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

console.log('ios-platform: ok')
