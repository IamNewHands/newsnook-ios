import assert from 'node:assert/strict'
import { readStartupMetrics, summarizeTimes } from './android-startup-metrics.mjs'

const pkg = 'com.aizeek.newsnook.debug'
const output = `10-21 13:00:00.111 123 I NewsNookStartup: application-attachBaseContext elapsed=800000ms
10-21 13:00:01.222 123 I NewsNookStartup: __NNSTART first-app-commit web=930ms elapsed=801111ms
10-21 13:00:01.333 123 I NewsNookStartup: __NNSTART first-ui-frame web=1100ms elapsed=801222ms
10-21 13:00:01.345 400 I ActivityTaskManager: Displayed ${pkg}/com.aizeek.newsnook.MainActivity for user 0: +2s345ms
10-21 13:00:01.346 400 I ActivityTaskManager: Fully drawn ${pkg}/com.aizeek.newsnook.MainActivity: +2s350ms`
assert.deepEqual(readStartupMetrics(output, pkg), {ttidMs:2345,ttfdMs:2350,appCommitFromAttachMs:1111,frameFromAttachMs:1222})
const releasePkg = 'com.aizeek.newsnook'
const releaseLog = `I/NewsNookStartup(20919): application-attachBaseContext elapsed=12968392ms
I/NewsNookStartup(20919): __NNSTART first-app-commit web=643ms elapsed=12969220ms
I/NewsNookStartup(20919): __NNSTART first-ui-frame web=760ms elapsed=12969689ms
I/ActivityTaskManager(362): Displayed ${releasePkg}/.MainActivity for user 0: +987ms
I/ActivityTaskManager(362): Fully drawn ${releasePkg}/.MainActivity: +1s297ms`
assert.deepEqual(readStartupMetrics(releaseLog, releasePkg), {ttidMs:987,ttfdMs:1297,appCommitFromAttachMs:828,frameFromAttachMs:1297})
assert.deepEqual(readStartupMetrics('', pkg), {ttidMs:null,ttfdMs:null,appCommitFromAttachMs:null,frameFromAttachMs:null})
const directBridgeLog = output.replaceAll('__NNSTART ', 'js:')
assert.deepEqual(readStartupMetrics(directBridgeLog, pkg), {ttidMs:2345,ttfdMs:2350,appCommitFromAttachMs:1111,frameFromAttachMs:1222},
  'The early JavaScript bridge must expose the same milestones as the console fallback')
const duplicateFrameLog = directBridgeLog + '\nI NewsNookStartup: __NNSTART first-ui-frame web=1105ms elapsed=801227ms'
assert.equal(readStartupMetrics(duplicateFrameLog, pkg).frameFromAttachMs, 1222,
  'A later console fallback must not replace the first observed frame milestone')
assert.deepEqual(summarizeTimes([1800,2300,3000,1900,2000]), {n:5,median:2000,p90:3000})
assert.deepEqual(summarizeTimes([1800,2300,1900,2000]), {n:4,median:1950,p90:2300},
  'Even sample counts use the average of the two middle observations')
assert.equal(summarizeTimes([]), null)
console.log('Android TTID/TTFD log parsing and summary: ok')
