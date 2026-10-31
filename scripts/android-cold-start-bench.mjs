#!/usr/bin/env node
/** Repeatable startup TTID/TTFD probe (Android logcat + in-app React frame mark).
 * Usage: ADB=<path-to-adb> node scripts/android-cold-start-bench.mjs [package] [runs]
 * Use a settled emulator, compare the same build type and alternate tested builds.
 * force-stop produces cold *process* starts; it does not reset OS caches.
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { readStartupMetrics, summarizeTimes } from './android-startup-metrics.mjs'

const adb = process.env.ADB || 'adb'
const pkg = process.argv[2] || 'com.aizeek.newsnook.debug'
const iterations = Number(process.argv[3] || 10)
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('runs must be an integer from 1 to 100')
}
function run(...args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', timeout: 60000 })
  if (result.error || result.status !== 0) {
    throw new Error(`${adb} ${args.join(' ')}: ${result.stderr || result.error?.message || `exit ${result.status}`}`)
  }
  return result.stdout
}
const results = []
for (let index = 0; index < iterations; index++) {
  run('shell', 'am', 'force-stop', pkg)
  run('logcat', '-c')
  const am = run('shell', 'am', 'start', '-W', '-n', `${pkg}/com.aizeek.newsnook.MainActivity`)
  let metrics
  for (let attempts = 0; attempts < 12; attempts++) {
    const output = run('logcat', '-d', '-s', 'ActivityTaskManager:I', 'NewsNookStartup:I', '*:S')
    metrics = readStartupMetrics(output, pkg)
    if (metrics.ttfdMs !== null) break
    await sleep(250)
  }
  const fallback = am.match(/TotalTime:\s*(\d+)/)
  if (!metrics) throw new Error('No Android startup metrics')
  const ttfd = metrics.ttfdMs ?? 'unreported'
  console.log(`${index + 1}/${iterations} TTID=${metrics.ttidMs ?? fallback?.[1] ?? 'missing'}ms TTFD=${ttfd}ms app-commit=${metrics.appCommitFromAttachMs ?? 'missing'}ms`)
  results.push({ ...metrics, fallbackTotalTime: fallback ? Number(fallback[1]) : null })
}
for (const [label, key] of [['TTID', 'ttidMs'], ['TTFD', 'ttfdMs'], ['JS app commit from Application attach', 'appCommitFromAttachMs']]) {
  const values = results.map(r => r[key]).filter(value => value !== null)
  console.log(`${label}: ${JSON.stringify(summarizeTimes(values))}`)
}
if (results.some(result => result.ttfdMs === null)) {
  console.warn('WARNING: TTFD missing from at least one run. Check for a startup failure or missing reportFullyDrawn().')
  process.exitCode = 1
}
