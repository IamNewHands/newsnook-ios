import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const perf = source('src/lib/startupPerf.ts')
const bootstrap = source('src/BootstrapRoot.tsx')
const activity = source('android/app/src/main/java/com/aizeek/newsnook/MainActivity.java')
const application = source('android/app/src/main/java/com/aizeek/newsnook/NewsNookApplication.java')
const chrome = source('android/app/src/main/java/com/aizeek/newsnook/NewsNookWebChromeClient.java')
const manifest = source('android/app/src/main/AndroidManifest.xml')

// Diagnostics must be absent from normal Vite production code, not merely hidden
// by the application's runtime log-level setting.
assert.match(perf, /export function bootMark\(name: string\): void \{\s*if \(!import\.meta\.env\.DEV\) return/)
assert.match(perf, /export function bootMeasure\(name: string, startMark: string, endMark: string\): void \{\s*if \(!import\.meta\.env\.DEV\) return/)

// Real startup readiness is delivered through the native interface first;
// retaining a one-off console fallback covers delayed/unavailable bridges.
assert.match(bootstrap, /native\.notifyFirstUiPaint\(\)/)
assert.match(bootstrap, /if \(Capacitor\.isNativePlatform\(\)\) emitFirstUiFallback\(\)/)
assert.match(perf, /export function emitFirstUiFallback\(\)/)
assert.match(chrome, /notifyFirstUiPaintFromConsole\(\)/)

// Normal production must not write routine startup logcat entries.
// Debug builds and isolated Macrobenchmark targets retain opt-in diagnostics.
assert.match(activity, /if \(!BuildConfig\.DEBUG && !BuildConfig\.STARTUP_BENCHMARK\) return;/)
assert.match(activity, /void reportStartupStage\(String stage, double webTimeMs\) \{\s*if \(!BuildConfig\.DEBUG && !BuildConfig\.STARTUP_BENCHMARK\) return;/)
assert.match(application, /if \(BuildConfig\.DEBUG \|\| BuildConfig\.STARTUP_BENCHMARK\)/)
assert.match(chrome, /if \(BuildConfig\.DEBUG \|\| BuildConfig\.STARTUP_BENCHMARK\)/)

// Shell profiling is a benchmark-only capability. The release APK must not
// expose the flag through the merged main manifest.
assert.doesNotMatch(manifest, /<profileable\b/)
for (const variant of ['benchmarkRelease', 'nonMinifiedRelease']) {
  assert.match(
    source(`android/app/src/${variant}/AndroidManifest.xml`),
    /<profileable android:shell="true"\s*\/>/,
    `${variant} still needs to produce traceable startup runs`,
  )
}

// Pre-existing informational cast/network logging is useful in Debug only.
// It must not expose local renderer identifiers or add cold-start logcat work in Release.
const dlna = source('android/app/src/main/java/com/aizeek/newsnook/DlnaCastPlugin.java')
const network = source('android/app/src/main/java/com/aizeek/newsnook/NewsNookNetworkPlugin.java')
const operationalLogs = [...dlna.matchAll(/Log\.(?:i|d)\(/g)].length
const guardedLogs = [...dlna.matchAll(/if \(BuildConfig\.DEBUG\) Log\.(?:i|d)\(/g)].length
assert.equal(guardedLogs, operationalLogs, 'DLNA information/debug logs must all be debug-only')
assert.match(network, /if \(BuildConfig\.DEBUG\) Log\.d\("NewsNookNetwork"/, 'Network plugin load must not log during release startup')

console.log('Production startup instrumentation isolation checks passed')
