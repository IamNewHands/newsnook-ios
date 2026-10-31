import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = file => readFileSync(join(root, file), 'utf8')
const settings = source('android/settings.gradle')
const build = source('android/build.gradle')
const app = source('android/app/build.gradle')
const gradleProperties = source('android/gradle.properties')
const projectRules = source('android/app/proguard-rules.pro')
const manifest = source('android/app/src/main/AndroidManifest.xml')

assert.match(settings, /include\s+['"]:baselineprofile['"]/, 'Profile generator must be a separate module')
assert.match(build, /androidx\.baselineprofile\.gradle\.plugin/, 'AndroidX Baseline Profile Gradle plugin must be resolved')
assert.match(app, /apply plugin:\s*['"]androidx.baselineprofile['"]/, 'App must package generated Baseline/Startup Profiles')
assert.match(app, /androidx.profileinstaller:profileinstaller:/, 'Sideloaded APKs need ProfileInstaller')
assert.doesNotMatch(manifest, /<profileable\b/, 'Production release must not expose shell profiling')
for (const variant of ['benchmarkRelease', 'nonMinifiedRelease']) {
  const variantManifest = source(`android/app/src/${variant}/AndroidManifest.xml`)
  assert.match(variantManifest, /<profileable\s+android:shell=['"]true['"]\s*\/>/, `${variant} must remain profileable by shell`)
}
assert.match(app, /automaticGenerationDuringBuild\s+false/, 'Normal release CI cannot depend on a connected emulator')
assert.match(app, /mergeIntoMain\s+true/, 'Shared startup paths should cover cloud and local releases')
assert.match(app, /benchmarkRelease\s*\{[^}]*signingConfig\s+signingConfigs.debug/s, 'Benchmark variant must not require a production signing key')
assert.match(app, /nonMinifiedRelease\s*\{[^}]*signingConfig\s+signingConfigs.debug/s, 'Profile producer must be installable without a production signing key')
for (const variant of ['benchmarkRelease', 'nonMinifiedRelease']) {
  assert.match(app, new RegExp(`${variant}\\s*\\{\\s*initWith\\s+release`, 's'), `${variant} must explicitly inherit the production release configuration`)
  assert.match(app, new RegExp(`${variant}\\s*\\{[^}]*applicationIdSuffix\\s+['"]\\.benchmark['"]`, 's'), `${variant} must not overwrite the installed production APK`)
}
assert.match(app, /throw new GradleException\(\s*['"]Release signing is not configured/, 'Production release signing must remain required')
assert.match(app, /proguardFiles\s+getDefaultProguardFile\(['"]proguard-android-optimize\.txt['"]\)/, 'Release must enable the R8 optimizer, not only DEX shrinking and obfuscation')
assert.match(gradleProperties, /^android\.r8\.optimizedResourceShrinking\s*=\s*true\s*$/m, 'AGP 8.13 must integrate resource and code optimization')
assert.doesNotMatch(gradleProperties, /^\s*android\.enableR8\.fullMode\s*=\s*false\s*$/m, 'Release must not disable R8 full mode')
assert.doesNotMatch(projectRules, /^\s*-dont(?:optimize|shrink|obfuscate)\b/m, 'Project keep rules must not globally disable release optimization')
assert.match(projectRules, /^-keep\s+@interface\s+com\.getcapacitor\.annotation\.\*\*\s*\{\s*\*;\s*\}/m, 'R8 must preserve Capacitor permission annotation interfaces and members used through reflection')
assert.match(projectRules, /^-keep\s+@interface\s+com\.getcapacitor\.PluginMethod\s*\{\s*\*;\s*\}/m, 'R8 must preserve the reflected PluginMethod annotation contract')
assert.match(projectRules, /^-keep\s+@interface\s+com\.getcapacitor\.NativePlugin\s*\{\s*\*;\s*\}/m, 'R8 must preserve the legacy NativePlugin annotation contract')

const mod = 'android/baselineprofile'
assert.ok(existsSync(join(root, mod, 'build.gradle')), 'Baseline Profile module needs its own Gradle file')
const moduleBuild = source(`${mod}/build.gradle`)
assert.match(moduleBuild, /namespace ['"]com\.aizeek\.newsnook\.profiletests['"]/, 'Test APK namespace must differ from the isolated target package')
const generator = source(`${mod}/src/main/java/com/aizeek/newsnook/benchmark/BaselineProfileGenerator.kt`)
const bench = source(`${mod}/src/main/java/com/aizeek/newsnook/benchmark/StartupBenchmark.kt`)
assert.match(generator, /BaselineProfileRule/)
assert.match(generator, /includeInStartupProfile\s*=\s*true/, 'Profile must capture startup profile for DEX layout')
assert.match(generator, /startActivityAndWait\(\)/)
assert.match(generator, /awaitAppFirstFrame\(\)/, 'Profile generation must wait for the real application frame')
assert.match(generator, /com\.aizeek\.newsnook\.benchmark/, 'Profile capture must target isolated app ID')
assert.match(bench, /StartupTimingMetric/)
assert.match(bench, /StartupMode.COLD/)
assert.match(bench, /CompilationMode.None/)
assert.match(bench, /CompilationMode.Partial/)
assert.match(bench, /BaselineProfileMode.Require/, 'Ensure profile mode actually applies the generated rules')
assert.match(bench, /awaitAppFirstFrame\(\)/, 'Benchmark must wait for the same real-frame signal as TTFD')
assert.match(bench, /com\.aizeek\.newsnook\.benchmark/, 'Benchmark must target isolated app ID')
const marker = source(`${mod}/src/main/java/com/aizeek/newsnook/benchmark/StartupReady.kt`)
assert.match(marker, /newsnook-first-frame-ready/, 'Container existence must not count as application readiness')
assert.doesNotMatch(marker, /waitForIdle/, 'Accessibility idleness must not substitute for actual rendering')
assert.match(app, /buildConfigField ['"]boolean['"], ['"]STARTUP_BENCHMARK['"], ['"]false['"]/, 'Production builds must not expose a technical accessibility marker')
for (const variant of ['benchmarkRelease', 'nonMinifiedRelease']) {
  assert.match(app, new RegExp(`${variant}\\s*\\{[^}]*buildConfigField ['"]boolean['"], ['"]STARTUP_BENCHMARK['"], ['"]true['"]`, 's'), `${variant} must expose only the test readiness marker`)
}
const activity = source('android/app/src/main/java/com/aizeek/newsnook/MainActivity.java')
assert.match(activity, /postVisualStateCallback/, 'Full display must follow the real WebView visual state')
assert.match(activity, /reportFullyDrawn\(\)/, 'Full display must be reported to Android for Macrobenchmark')
console.log('Macrobenchmark + Baseline Profiles wiring checks passed')
