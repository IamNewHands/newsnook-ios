import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./android-macrobenchmark-report.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'benchmark-'))
const none = 'startupNoProfile'
const partial = 'startupWithProfile'
const logPath = mode => join(dir, mode + '.log')
const jsonPath = mode => join(dir, mode + '.json')
const run = (...extra) => spawnSync(process.execPath, [script, logPath(none), logPath(partial), '--json', ...extra], { encoding: 'utf8' })
function fixture(mode, median) {
  const values = { min: median - 200, median, max: median + 200, stddev: 150 }
  const metrics = ['initial', 'full'].flatMap(type =>
    Object.entries(values).map(([stat, value]) => `INSTRUMENTATION_STATUS: time_to_${type}_display_millis_${stat}=${value}`))
  return mode + '\n' + metrics.join('\n') + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n'
}
function samples(mode, median, runs = [median - 200, median - 100, median + 100, median + 200]) {
  return JSON.stringify({ benchmarks: [{
    name: mode,
    repeatIterations: runs.length,
    metrics: Object.fromEntries(['timeToInitialDisplayMs', 'timeToFullDisplayMs'].map(name =>
      [name, { minimum: Math.min(...runs), maximum: Math.max(...runs), median, runs }]))
  }] })
}
try {
  writeFileSync(logPath(none), fixture(none, 2000))
  writeFileSync(logPath(partial), fixture(partial, 1900))
  let result = run()
  assert.equal(result.status, 0, result.stderr)
  let data = JSON.parse(result.stdout)
  assert.equal(data.none.TTID.median, 2000)
  assert.equal(data.partial.TTID.median, 1900)
  assert.equal(data.deltaTTID.percent, -5)
  assert.equal(data.none.TTID.p90, undefined, 'Do not invent percentiles without raw samples')

  writeFileSync(logPath(partial), fixture(partial, 1900).replace('OK (1 test)', 'FAILURES!!!\nTests run: 1, Failures: 1'))
  result = run()
  assert.notEqual(result.status, 0, 'Instrumentation code -1 does not prove the JUnit test passed')
  assert.match(result.stderr, /failed|incomplete/)

  writeFileSync(logPath(partial), partial + '\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n')
  result = run()
  assert.notEqual(result.status, 0, 'Missing TTFD must not produce a speed claim')
  assert.match(result.stderr, /missing metric/)

  writeFileSync(logPath(partial), fixture(partial, 1900))
  writeFileSync(jsonPath(none), samples(none, 2000))
  writeFileSync(jsonPath(partial), samples(partial, 1900))
  result = run('--samples', jsonPath(none), jsonPath(partial))
  assert.equal(result.status, 0, result.stderr)
  data = JSON.parse(result.stdout)
  assert.equal(data.none.TTID.n, 4)
  assert.equal(data.none.TTID.p90, 2200)
  assert.equal(data.partial.TTFD.p90, 2100)

  writeFileSync(jsonPath(partial), samples(partial, 1900, [1700, 1800, 9000, 10000]))
  result = run('--samples', jsonPath(none), jsonPath(partial))
  assert.notEqual(result.status, 0, 'Reject samples from a different run even when the test name matches')
  assert.match(result.stderr, /samples.*match|inconsistent/)

  console.log('Macrobenchmark reporting: completion status, missing metrics, sample percentiles, and run consistency passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
