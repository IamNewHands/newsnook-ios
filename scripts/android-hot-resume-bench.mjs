#!/usr/bin/env node
/** Verify root Back backgrounds NewsNook without recreating Capacitor on relaunch.
 * Usage: ADB=<adb.exe> node scripts/android-hot-resume-bench.mjs [packageId]
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const adb = process.env.ADB || 'adb'
const pkg = process.argv[2] || 'com.aizeek.newsnook.debug'
const component = `${pkg}/com.aizeek.newsnook.MainActivity`
function run(...args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', timeout: 60000 })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || args.join(' '))
  return result.stdout.trim()
}
run('shell', 'am', 'force-stop', pkg)
run('logcat', '-c')
const first = run('shell', 'am', 'start', '-W', '-n', component)
await sleep(1600)
const beforePid = run('shell', 'pidof', pkg)
if (!beforePid) throw new Error('App process did not start')
run('shell', 'input', 'keyevent', 'KEYCODE_BACK')
await sleep(450)
const backgroundPid = run('shell', 'pidof', pkg)
const resumedActivity = run('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity=([^\n]+)/)?.[1] ?? ''
if (beforePid !== backgroundPid || resumedActivity.includes(pkg)) {
  throw new Error(`Back did not preserve the background Activity: pid ${beforePid}->${backgroundPid}, resumed ${resumedActivity}`)
}
const reopen = run('shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', component)
const afterPid = run('shell', 'pidof', pkg)
const log = run('logcat', '-d', '-s', 'NewsNookStartup:I', '*:S')
const activityCreates = (log.match(/activity-onCreate-begin/g) || []).length
const reactStarts = (log.match(/__NNSTART react-bootstrap /g) || []).length
const launchState = reopen.match(/LaunchState: ([^\n\r]+)/)?.[1] ?? 'unknown'
const hotTime = Number(reopen.match(/(?:TotalTime|WaitTime):\s*(\d+)/)?.[1] ?? NaN)
const resumedAfter = run('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity=([^\n]+)/)?.[1] ?? ''
console.log(JSON.stringify({ beforePid, backgroundPid, afterPid, initialLaunch: first.match(/LaunchState: ([^\n\r]+)/)?.[1], launchState, hotTimeMs: hotTime, activityCreates, reactStarts, resumedAfter }, null, 2))
if (beforePid !== afterPid || !['HOT', 'UNKNOWN (0)'].includes(launchState) || !resumedAfter.includes(pkg) || activityCreates !== 1 || reactStarts !== 1 || !Number.isFinite(hotTime)) {
  throw new Error('Back-to-background / hot-relaunch regression detected')
}
console.log('Back-to-background hot resume: OK')
