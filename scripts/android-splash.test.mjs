import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/logo-dark.svg', import.meta.url), 'utf8')
const drawableUrl = new URL('../android/app/src/main/res/drawable/splash_logo.xml', import.meta.url)
assert.ok(existsSync(drawableUrl), 'Android splash must be generated from public/logo-dark.svg')
const drawable = readFileSync(drawableUrl, 'utf8')
const pathData = svg.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1]
assert.ok(pathData, 'Source logo must define a vector path')
assert.ok(drawable.includes(`android:pathData="${pathData}"`), 'Android splash path must match source SVG exactly')
assert.match(drawable, /android:fillType="evenOdd"/)
assert.match(drawable, /android:scaleX="0\.78"/)
for (const color of ['#004BFA', '#05C8FB']) {
  assert.ok(svg.includes(color) && drawable.includes(color), `${color}: preserve original SVG gradient`)
}
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
assert.match(manifest, /android:theme="@style\/AppTheme\.NoActionBarLaunch"/)
for (const location of ['values', 'values-night']) {
  const styles = readFileSync(new URL(`../android/app/src/main/res/${location}/styles.xml`, import.meta.url), 'utf8')
  const launchTheme = styles.match(/<style name="AppTheme\.NoActionBarLaunch"[^>]*>([\s\S]*?)<\/style>/)?.[1]
  assert.ok(launchTheme, `${location} needs a launch theme`)
  for (const item of ['android:background', 'android:windowBackground', 'android:colorBackground', 'windowSplashScreenBackground', 'windowSplashScreenIconBackgroundColor']) {
    assert.ok(launchTheme.includes(`<item name="${item}">@android:color/white</item>`), `${location}: ${item} must be pure white`)
  }
  assert.match(launchTheme, /<item name="windowSplashScreenAnimatedIcon">@drawable\/splash_logo<\/item>/)
  assert.match(launchTheme, /<item name="android:windowLightStatusBar">true<\/item>/)
  assert.match(launchTheme, /<item name="android:windowLightNavigationBar">true<\/item>/)
}
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const shell = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]
assert.ok(shell, 'The WebView document must have a boot placeholder')
assert.match(shell, /#boot-splash\s*\{[^}]*background: #fff;/s, 'The WebView placeholder should stay white until the real UI paints')
assert.match(shell, /html\[data-boot='splash'\],[\s\S]*?background: #fff;/)
assert.match(html, /<meta name="theme-color" content="#FFFFFF" \/>/, 'Initial theme color should match white native splash')
console.log('Android splash: exact source logo gradient and uniform white launch background: OK')
