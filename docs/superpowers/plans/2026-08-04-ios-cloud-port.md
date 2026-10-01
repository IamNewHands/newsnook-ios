# NewsNook iOS Cloud Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a buildable iOS 15+ Capacitor app that reuses the existing NewsNook React UI, supports cloud translation, photos and sharing, and provides native brightness and media-volume controls.

**Architecture:** Keep the existing Web and Android implementations unchanged and add Capacitor's Swift Package Manager iOS platform beside them. The bundled React app remains the product layer; a local Swift Capacitor plugin supplies only the two iOS-specific media controls. Official Capacitor plugins continue to handle HTTP, preferences, files, sharing, browser presentation and the status bar, while `@capacitor-community/media` handles photo-library saves.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Capacitor 8.4.2, Swift, Swift Package Manager, UIKit, MediaPlayer, AVFAudio, Xcode

---

## File map

- `package.json`: declare `@capacitor/ios`, iOS scripts, and new verification scripts.
- `package-lock.json`: lock the iOS package and its integrity metadata.
- `src/lib/nativePlatform.ts`: keep native splash-platform policy independently testable.
- `src/BootstrapRoot.tsx`: enable the existing React splash on iOS.
- `scripts/native-platform.test.ts`: test Web, Android, iOS, and development splash behavior.
- `scripts/ios-platform.test.mjs`: verify that Capacitor generated the expected SPM project.
- `scripts/ios-project.test.mjs`: verify bundle ID, permissions, ATS scope, launch resources, and build scripts.
- `scripts/ios-native-plugin.test.mjs`: verify the Swift bridge contract and storyboard registration.
- `scripts/generate-ios-assets.mjs`: deterministically build the iOS icon and launch image from `assets/logo.svg`.
- `ios/App/App.xcodeproj`: the Xcode project opened by the user.
- `ios/App/App/DeviceMediaControlsPlugin.swift`: iOS brightness and volume Capacitor plugin.
- `ios/App/App/MainViewController.swift`: register the local plugin and apply the dark WebView background.
- `ios/App/App/Info.plist`: photo-use descriptions and domain-scoped ATS exceptions.
- `ios/App/App/PrivacyInfo.xcprivacy`: Required Reason API declarations for Filesystem and Preferences.
- `ios/App/App/Base.lproj/Main.storyboard`: use `MainViewController` as the Capacitor root.
- `ios/App/App/Base.lproj/LaunchScreen.storyboard`: use the NewsNook dark launch background.
- `ios/App/App/Assets.xcassets`: generated app icon and splash images.
- `docs/ios-build.md`: Chinese Xcode, signing, simulator, and real-device instructions.

### Task 1: Add the Capacitor iOS SPM platform

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/ios-platform.test.mjs`
- Create: `ios/` through the Capacitor 8.4.2 generator

- [ ] **Step 1: Write the failing platform-structure test**

Create `scripts/ios-platform.test.mjs`:

```js
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
```

Add this script to `package.json`:

```json
"test:ios-platform": "node scripts/ios-platform.test.mjs"
```

- [ ] **Step 2: Run the platform test and confirm the red state**

Run:

```bash
npm run test:ios-platform
```

Expected: FAIL with `missing generated iOS file: ios/App/App.xcodeproj/project.pbxproj`.

- [ ] **Step 3: Install the exact iOS package from the public npm registry**

Run:

```bash
npm install --save-exact @capacitor/ios@8.4.2 --registry=https://registry.npmjs.org
```

Expected: `package.json` contains `"@capacitor/ios": "8.4.2"`, and `package-lock.json` contains the public npm tarball and integrity entry. The explicit registry is required because the configured internal mirror was observed to lag behind the public 8.4.2 release.

- [ ] **Step 4: Add iOS workflow scripts**

Add these entries to `package.json` beside the Android scripts:

```json
"ios:sync": "npm run build && npx cap sync ios",
"ios:open": "npm run ios:sync && npx cap open ios",
"ios:run": "npm run ios:sync && npx cap run ios --no-sync"
```

- [ ] **Step 5: Build Web assets and generate the SPM iOS project**

Run:

```bash
npm run build
npx cap add ios
```

Expected: Capacitor reports `ios platform added`, creates `ios/App/App.xcodeproj`, and generates `ios/App/CapApp-SPM/Package.swift` with iOS 15 as the platform.

- [ ] **Step 6: Run the platform test and Capacitor sync**

Run:

```bash
npm run test:ios-platform
npx cap sync ios
```

Expected: `ios-platform: ok`; Capacitor lists the installed iOS plugins without reporting an incompatible plugin.

- [ ] **Step 7: Commit the generated base platform**

```bash
git add package.json package-lock.json scripts/ios-platform.test.mjs ios
git commit -m "build: add Capacitor iOS platform"
```

### Task 2: Enable the existing startup splash on iOS

**Files:**
- Create: `src/lib/nativePlatform.ts`
- Create: `scripts/native-platform.test.ts`
- Modify: `src/BootstrapRoot.tsx:17`
- Modify: `package.json`

- [ ] **Step 1: Write the failing splash-policy test**

Create `scripts/native-platform.test.ts`:

```ts
import assert from 'node:assert/strict'

import { shouldUseStartupSplash } from '../src/lib/nativePlatform'

assert.equal(shouldUseStartupSplash('android', false), true)
assert.equal(shouldUseStartupSplash('ios', false), true)
assert.equal(shouldUseStartupSplash('web', false), false)
assert.equal(shouldUseStartupSplash('web', true), true)

console.log('native-platform: ok')
```

Add this script to `package.json`:

```json
"test:native-platform": "rolldown scripts/native-platform.test.ts --platform=node --format=esm --file=node_modules/.cache/newsnook/native-platform.test.mjs && node node_modules/.cache/newsnook/native-platform.test.mjs"
```

- [ ] **Step 2: Run the splash-policy test and confirm the red state**

Run:

```bash
npm run test:native-platform
```

Expected: FAIL because `src/lib/nativePlatform.ts` does not exist.

- [ ] **Step 3: Implement the platform policy**

Create `src/lib/nativePlatform.ts`:

```ts
export function shouldUseStartupSplash(platform: string, development: boolean): boolean {
  return platform === 'android' || platform === 'ios' || development
}
```

Update `src/BootstrapRoot.tsx` to import and use it:

```ts
import { shouldUseStartupSplash } from './lib/nativePlatform'

const SPLASH_ENABLED = shouldUseStartupSplash(
  Capacitor.getPlatform(),
  import.meta.env.DEV,
)
```

- [ ] **Step 4: Run focused and build verification**

Run:

```bash
npm run test:native-platform
npm run build
```

Expected: `native-platform: ok` and Vite completes the production build.

- [ ] **Step 5: Commit the cross-platform splash policy**

```bash
git add package.json src/BootstrapRoot.tsx src/lib/nativePlatform.ts scripts/native-platform.test.ts
git commit -m "feat: enable startup splash on iOS"
```

### Task 3: Configure the iOS target, ATS, and branded assets

**Files:**
- Create: `scripts/ios-project.test.mjs`
- Create: `scripts/generate-ios-assets.mjs`
- Modify: `package.json`
- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Modify: `ios/App/App/Info.plist`
- Modify: `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- Modify: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- Modify: `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`
- Modify: `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png`
- Modify: `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png`

- [ ] **Step 1: Write the failing iOS configuration test**

Create `scripts/ios-project.test.mjs`:

```js
import assert from 'node:assert/strict'
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
assert.equal((pbx.match(/MARKETING_VERSION = 1\.3\.6;/g) ?? []).length, 2)
assert.match(plist, /<string>News Nook<\/string>/)
assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key>/)
assert.match(plist, /<key>NSPhotoLibraryAddUsageDescription<\/key>/)
assert.match(plist, /<key>NSAppTransportSecurity<\/key>/)
assert.doesNotMatch(plist, /<key>NSAllowsArbitraryLoads<\/key>/)

for (const domain of ['163.com', '126.net', '126.com', 'netease.com']) {
  const escapedDomain = domain.replaceAll('.', '\\\.')
  assert.match(plist, new RegExp(`<key>${escapedDomain}<\\/key>`))
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

console.log('ios-project: ok')
```

Add this script to `package.json`:

```json
"test:ios-project": "node scripts/ios-project.test.mjs"
```

- [ ] **Step 2: Run the configuration test and confirm the red state**

Run:

```bash
npm run test:ios-project
```

Expected: FAIL because the generated target does not yet use `com.aizeek.newsnook.ios`, or because the iOS asset script is missing.

- [ ] **Step 3: Add deterministic iOS asset generation**

Create `scripts/generate-ios-assets.mjs`:

```js
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const logoPath = join(projectRoot, 'assets', 'logo.svg')
const assetRoot = join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets')
const iconPath = join(assetRoot, 'AppIcon.appiconset', 'AppIcon-512@2x.png')
const splashRoot = join(assetRoot, 'Splash.imageset')
const splashPaths = [
  join(splashRoot, 'splash-2732x2732.png'),
  join(splashRoot, 'splash-2732x2732-1.png'),
  join(splashRoot, 'splash-2732x2732-2.png'),
]

if (!existsSync(logoPath)) throw new Error('缺少 assets/logo.svg')
if (!existsSync(assetRoot)) throw new Error('未找到 iOS Assets.xcassets，请先执行 npx cap add ios')

await sharp(logoPath)
  .resize(1024, 1024, { fit: 'contain' })
  .flatten({ background: '#0C6FFF' })
  .png()
  .toFile(iconPath)

const splashLogo = await sharp(logoPath)
  .resize(520, 520, { fit: 'contain' })
  .png()
  .toBuffer()

const splash = await sharp({
  create: {
    width: 2732,
    height: 2732,
    channels: 4,
    background: '#0E0F12',
  },
})
  .composite([{ input: splashLogo, gravity: 'centre' }])
  .png()
  .toBuffer()

for (const path of splashPaths) writeFileSync(path, splash)

console.log('[ios-assets] 已生成 1024x1024 图标与 2732x2732 启动画面')
```

Add or update the iOS scripts in `package.json`:

```json
"ios:assets": "node scripts/generate-ios-assets.mjs",
"ios:sync": "npm run ios:assets && npm run build && npx cap sync ios"
```

- [ ] **Step 4: Set the bundle ID and app version**

In both Debug and Release build settings in `ios/App/App.xcodeproj/project.pbxproj`, make these exact replacements:

```text
MARKETING_VERSION = 1.3.6;
PRODUCT_BUNDLE_IDENTIFIER = com.aizeek.newsnook.ios;
```

Keep `CURRENT_PROJECT_VERSION = 1`, `IPHONEOS_DEPLOYMENT_TARGET = 15.0`, and `SWIFT_VERSION = 5.0` unchanged.

- [ ] **Step 5: Add photo descriptions and domain-scoped ATS exceptions**

Insert the following keys inside the root dictionary in `ios/App/App/Info.plist`:

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>用于读取相册信息并确认图片保存位置。</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>用于将新闻正文中的图片保存到系统相册。</string>
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>163.com</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
        <key>126.net</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
        <key>126.com</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
        <key>netease.com</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
    </dict>
</dict>
```

Do not add `NSAllowsArbitraryLoads`. Keep cloud translation endpoints under the existing Web-layer HTTPS-only validation.

- [ ] **Step 6: Apply the dark launch background and generate images**

In `ios/App/App/Base.lproj/LaunchScreen.storyboard`, replace the image view's system background color with:

```xml
<color key="backgroundColor" red="0.0549" green="0.0588" blue="0.0706" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
```

Remove the now-unused `systemColor` entry from the storyboard resources, then run:

```bash
npm run ios:assets
```

Expected: the command reports a 1024 icon and 2732 launch image.

- [ ] **Step 7: Validate the plist, images, and project configuration**

Run:

```bash
plutil -lint ios/App/App/Info.plist
xmllint --noout ios/App/App/Base.lproj/LaunchScreen.storyboard
xcrun ibtool --errors --warnings --notices ios/App/App/Base.lproj/LaunchScreen.storyboard
sips -g pixelWidth -g pixelHeight ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
sips -g pixelWidth -g pixelHeight ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
npm run test:ios-project
```

Expected: the plist reports `OK`; `xmllint` and `ibtool` report no errors; `sips` reports `1024 x 1024` and `2732 x 2732`; the test prints `ios-project: ok`.

- [ ] **Step 8: Commit target configuration and assets**

```bash
git add package.json scripts/ios-project.test.mjs scripts/generate-ios-assets.mjs ios/App
git commit -m "feat: configure NewsNook iOS target"
```

### Task 4: Implement and register native media controls

**Files:**
- Create: `scripts/ios-native-plugin.test.mjs`
- Create: `ios/App/App/DeviceMediaControlsPlugin.swift`
- Create: `ios/App/App/MainViewController.swift`
- Modify: `ios/App/App/Base.lproj/Main.storyboard`
- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Modify: `package.json`

- [ ] **Step 1: Write the failing native-bridge contract test**

Create `scripts/ios-native-plugin.test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const plugin = readFileSync('ios/App/App/DeviceMediaControlsPlugin.swift', 'utf8')
const controller = readFileSync('ios/App/App/MainViewController.swift', 'utf8')
const storyboard = readFileSync('ios/App/App/Base.lproj/Main.storyboard', 'utf8')
const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')

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

console.log('ios-native-plugin: ok')
```

Add this script to `package.json`:

```json
"test:ios-native-plugin": "node scripts/ios-native-plugin.test.mjs"
```

- [ ] **Step 2: Run the bridge test and confirm the red state**

Run:

```bash
npm run test:ios-native-plugin
```

Expected: FAIL because `ios/App/App/DeviceMediaControlsPlugin.swift` does not exist.

- [ ] **Step 3: Implement the Swift Capacitor plugin**

Create `ios/App/App/DeviceMediaControlsPlugin.swift`:

```swift
import AVFAudio
import Capacitor
import MediaPlayer
import UIKit

@objc(DeviceMediaControlsPlugin)
public final class DeviceMediaControlsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceMediaControlsPlugin"
    public let jsName = "DeviceMediaControls"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
    ]

    private let volumeView = MPVolumeView(frame: .zero)
    private var originalBrightness: CGFloat?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.restoreBrightness()
            }
        )
        DispatchQueue.main.async { [weak self] in
            self?.attachVolumeViewIfNeeded()
        }
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    @objc func getBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["value": Double(UIScreen.main.brightness)])
        }
    }

    @objc func setBrightness(_ call: CAPPluginCall) {
        guard let requested = call.getDouble("value") else {
            call.reject("缺少亮度值")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("亮度控制不可用")
                return
            }
            if self.originalBrightness == nil {
                self.originalBrightness = UIScreen.main.brightness
            }
            let target = CGFloat(Self.clamp01(requested))
            UIScreen.main.brightness = target
            call.resolve(["value": Double(UIScreen.main.brightness)])
        }
    }

    @objc func clearBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.restoreBrightness()
            call.resolve()
        }
    }

    @objc func getVolume(_ call: CAPPluginCall) {
        call.resolve(["value": Double(AVAudioSession.sharedInstance().outputVolume)])
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        guard let requested = call.getDouble("value") else {
            call.reject("缺少音量值")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("音量控制不可用")
                return
            }
            self.attachVolumeViewIfNeeded()
            guard let slider = self.volumeSlider else {
                call.reject("系统音量控件不可用")
                return
            }
            slider.value = Float(Self.clamp01(requested))
            slider.sendActions(for: .valueChanged)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                call.resolve(["value": Double(AVAudioSession.sharedInstance().outputVolume)])
            }
        }
    }

    private var volumeSlider: UISlider? {
        volumeView.subviews.compactMap { $0 as? UISlider }.first
    }

    private func attachVolumeViewIfNeeded() {
        guard volumeView.superview == nil, let host = bridge?.viewController?.view else { return }
        volumeView.frame = CGRect(x: -100, y: -100, width: 1, height: 1)
        volumeView.alpha = 0.001
        host.addSubview(volumeView)
    }

    private func restoreBrightness() {
        guard let originalBrightness else { return }
        UIScreen.main.brightness = originalBrightness
        self.originalBrightness = nil
    }

    private static func clamp01(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(1, max(0, value))
    }
}
```

- [ ] **Step 4: Register the plugin from a focused bridge controller**

Create `ios/App/App/MainViewController.swift`:

```swift
import Capacitor
import UIKit

public final class MainViewController: CAPBridgeViewController {
    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 14 / 255, green: 15 / 255, blue: 18 / 255, alpha: 1)
        bridge?.webView?.isOpaque = false
        bridge?.webView?.backgroundColor = view.backgroundColor
    }

    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceMediaControlsPlugin())
    }
}
```

In `ios/App/App/Base.lproj/Main.storyboard`, replace the generated controller declaration with:

```xml
<viewController id="BYZ-38-t0r" customClass="MainViewController" customModule="App" customModuleProvider="target" sceneMemberID="viewController"/>
```

- [ ] **Step 5: Add both Swift files to the Xcode target**

Update `ios/App/App.xcodeproj/project.pbxproj` with unique stable IDs in all four required sections:

```text
/* PBXBuildFile section */
A11000000000000000000002 /* DeviceMediaControlsPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = A11000000000000000000001 /* DeviceMediaControlsPlugin.swift */; };
A11000000000000000000004 /* MainViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = A11000000000000000000003 /* MainViewController.swift */; };

/* PBXFileReference section */
A11000000000000000000001 /* DeviceMediaControlsPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DeviceMediaControlsPlugin.swift; sourceTree = "<group>"; };
A11000000000000000000003 /* MainViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = MainViewController.swift; sourceTree = "<group>"; };

/* App PBXGroup children */
A11000000000000000000001 /* DeviceMediaControlsPlugin.swift */,
A11000000000000000000003 /* MainViewController.swift */,

/* PBXSourcesBuildPhase files */
A11000000000000000000002 /* DeviceMediaControlsPlugin.swift in Sources */,
A11000000000000000000004 /* MainViewController.swift in Sources */,
```

- [ ] **Step 6: Run static bridge verification and sync**

Run:

```bash
npm run test:ios-native-plugin
npm run ios:sync
```

Expected: `ios-native-plugin: ok`; Capacitor sync completes and keeps the custom Swift files and storyboard controller intact.

- [ ] **Step 7: Compile the iOS simulator target without signing**

Run:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: `** BUILD SUCCEEDED **`. If Xcode 16.4 cannot consume the Capacitor 8 binary built for the officially required newer Xcode, preserve the exact failure output and repeat this command under Xcode 26+ before claiming the native build passes.

- [ ] **Step 8: Commit the native plugin**

```bash
git add package.json scripts/ios-native-plugin.test.mjs ios/App/App/DeviceMediaControlsPlugin.swift ios/App/App/MainViewController.swift ios/App/App/Base.lproj/Main.storyboard ios/App/App.xcodeproj/project.pbxproj ios/App/CapApp-SPM/Package.swift
git commit -m "feat: add iOS media controls bridge"
```

### Task 5: Add build documentation and run full verification

**Files:**
- Create: `docs/ios-build.md`
- Modify: `README.md`
- Verify: all Web, Android-preserving, and iOS files from Tasks 1-4

- [ ] **Step 1: Write the Chinese iOS build guide**

Create `docs/ios-build.md` with this content:

```markdown
# NewsNook iOS 编译说明

## 环境

- macOS
- Node.js 22 或更高版本
- Xcode 26 或更高版本（Capacitor 8 当前官方要求）
- Apple ID；真机安装需要在 Xcode 中选择自己的开发团队

## 安装与同步

在项目根目录执行：

\`\`\`bash
npm ci --registry=https://registry.npmjs.org
npm run ios:sync
\`\`\`

`ios:sync` 会重新生成 iOS 图标和启动画面、构建 React 页面，并将 Web 产物与 Capacitor 插件同步到 iOS 工程。

## 打开 Xcode

执行：

\`\`\`bash
npm run ios:open
\`\`\`

也可以直接打开 `ios/App/App.xcodeproj`。本项目使用 Swift Package Manager，不需要执行 `pod install`。

## 模拟器运行

1. 在 Xcode 顶部 Scheme 中选择 `App`。
2. 选择任一 iOS 15 或更高版本的 iPhone Simulator。
3. 按 `Command + R`。

命令行无签名编译：

\`\`\`bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
\`\`\`

## 真机签名

1. 在 Xcode 左侧选择 `App` 工程，再选择 `App` target。
2. 打开 `Signing & Capabilities`。
3. 勾选 `Automatically manage signing`。
4. 在 `Team` 中选择自己的 Apple Developer Team。
5. 保持 Bundle Identifier 为 `com.aizeek.newsnook.ios`；如果该标识在你的团队中不可用，改成你自己的唯一标识。
6. 连接 iPhone，选择设备后按 `Command + R`。

## 首版功能边界

- 支持 Google、Azure、DeepL、DeepLX 云翻译。
- 不包含 ML Kit 离线翻译与语言模型下载。
- 新闻源、偏好、历史、稍后读和缓存仍保存在本机。
- Apple Developer 证书、发布描述文件和 App Store Connect 记录不保存在仓库。

## 真机检查清单

- 冷启动时系统启动页和 React 启动画面之间无白屏。
- 首页能刷新信源，文章正文、图片和视频能够打开。
- 云翻译配置能保存，HTTPS 翻译请求能够完成。
- 图片保存首次请求相册权限；拒绝权限不会导致页面退出。
- 图片分享能够调起系统分享面板。
- 全屏视频左侧竖滑调整亮度，退出全屏或切到后台后恢复原亮度。
- 全屏视频右侧竖滑调整系统媒体音量。
- 深浅色状态栏、安全区和横竖屏布局正常。
```

- [ ] **Step 2: Link the iOS guide from the README**

Append this subsection under the installation section in `README.md`:

```markdown
### 自行编译 iOS

iOS 使用 Capacitor 与现有 React 前端共用代码，首版保留云端翻译，不包含 ML Kit 离线翻译。环境、同步、Xcode 签名和真机检查步骤见 [`docs/ios-build.md`](./docs/ios-build.md)。
```

- [ ] **Step 3: Run every package test script**

Run:

```bash
node -e "const { scripts = {} } = require('./package.json'); const { spawnSync } = require('node:child_process'); for (const name of Object.keys(scripts).filter((name) => name.startsWith('test:')).sort()) { console.log('>>>', name); const result = spawnSync('npm', ['run', name], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1) }"
```

Expected: every `test:*` script exits 0, including `ios-platform`, `native-platform`, `ios-project`, and `ios-native-plugin`.

- [ ] **Step 4: Run lint, Web build, iOS sync, and plist checks**

Run:

```bash
npm run lint
npm run build
npm run ios:sync
plutil -lint ios/App/App/Info.plist
xmllint --noout ios/App/App/Base.lproj/Main.storyboard
xmllint --noout ios/App/App/Base.lproj/LaunchScreen.storyboard
xcrun ibtool --errors --warnings --notices ios/App/App/Base.lproj/Main.storyboard
xcrun ibtool --errors --warnings --notices ios/App/App/Base.lproj/LaunchScreen.storyboard
git diff --check
```

Expected: lint and build exit 0; Capacitor sync completes; the plist reports `OK`; both storyboards pass `xmllint` and `ibtool`; `git diff --check` prints nothing.

- [ ] **Step 5: Run the final unsigned simulator build**

Run:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: `** BUILD SUCCEEDED **` with zero compile errors. Simulator validation does not prove photo authorization, physical screen brightness, or system media volume; keep those items explicitly marked for real-device checking.

- [ ] **Step 6: Inspect the final scope and dependency graph**

Run:

```bash
git status --short
git diff --stat f2bb767..HEAD
rg -n "MlKitTranslation|GoogleMLKit|MLKit" ios package.json
rg -n "NSAllowsArbitraryLoads" ios/App/App/Info.plist
```

Expected: only planned iOS, test, Web splash, package, and documentation files are changed; both ripgrep commands return no matches for iOS ML Kit or global ATS allowance.

- [ ] **Step 7: Commit documentation and final verification changes**

```bash
git add README.md docs/ios-build.md docs/superpowers/specs/2026-08-04-ios-cloud-port-design.md docs/superpowers/plans/2026-08-04-ios-cloud-port.md
git commit -m "docs: add iOS build guide"
```

## Manual handoff checks

After all automated verification passes, report these separately rather than implying they were simulated:

- Apple signing remains unconfigured until the user selects their Team.
- Photo-library authorization must be checked on a physical iPhone.
- `UIScreen.main.brightness` restoration must be checked on a physical iPhone.
- `MPVolumeView` media-volume adjustment must be checked on a physical iPhone.
- App Store submission and review are outside this implementation scope.
