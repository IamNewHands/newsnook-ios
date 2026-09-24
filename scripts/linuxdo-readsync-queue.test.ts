import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { LinuxDoReadTracker, type LinuxDoTimingBatch } from '../src/features/linuxdo/topic/readTracker'
import { LinuxDoApiError } from '../src/features/linuxdo/types'

const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const advance = async (milliseconds: number) => { mock.timers.tick(milliseconds); await microtasks() }
const copy = (batch: LinuxDoTimingBatch) => ({ topicId: batch.topicId, topicTime: batch.topicTime, timings: { ...batch.timings } })
const tests: Array<[string, () => Promise<void>]> = []

tests.push(['continuous slow scrolling keeps accumulating visible unread posts and rushes them on the one-second screen-track cadence', async () => {
  const sent: LinuxDoTimingBatch[] = []
  const tracker = new LinuxDoReadTracker({ send: async batch => { sent.push(copy(batch)) } })
  try {
    tracker.start(100)
    tracker.setVisiblePosts([7, 8, 9])
    for (let elapsed = 0; elapsed < 2000; elapsed += 250) {
      tracker.scrolled()
      await advance(250)
    }
    assert.equal(sent.length, 1, 'normal slow scrolling must not wait for a five-second global scroll stop')
    assert.deepEqual(Object.keys(sent[0].timings).map(Number), [7, 8, 9])
    assert.ok(sent[0].topicTime >= 900 && sent[0].topicTime <= 2100)
  } finally { tracker.stop(false) }
}])

tests.push(['posts that are already read may accumulate timing but do not trigger a rush request by themselves', async () => {
  const sent: LinuxDoTimingBatch[] = []
  const tracker = new LinuxDoReadTracker({ send: async batch => { sent.push(copy(batch)) } })
  try {
    tracker.start(100)
    tracker.setVisiblePosts([1, 2], [1, 2])
    await advance(6000)
    assert.equal(sent.length, 0, 'read posts should not cause one-second write traffic without a new unread post')
  } finally { tracker.stop(false) }
}])

tests.push(['a fast fling across posts between screen-track ticks does not report posts that were never sampled onscreen', async () => {
  const sent: LinuxDoTimingBatch[] = []
  const tracker = new LinuxDoReadTracker({ send: async batch => { sent.push(copy(batch)) } })
  try {
    tracker.start(100)
    tracker.setVisiblePosts([1, 2]); tracker.scrolled(); await advance(200)
    tracker.setVisiblePosts([3, 4]); tracker.scrolled(); await advance(200)
    tracker.setVisiblePosts([5, 6]); tracker.scrolled(); await advance(200)
    tracker.setVisiblePosts([20, 21]); tracker.scrolled(); await advance(400)
    await advance(1000)
    assert.equal(sent.length, 1)
    assert.deepEqual(Object.keys(sent[0].timings).map(Number), [20, 21], 'only the posts present at the one-second visibility sample should become readable')
  } finally { tracker.stop(false) }
}])

tests.push(['CF 403 pauses without dropping the batch; verification resumes the exact batch', async () => {
  const sent: LinuxDoTimingBatch[] = []; const acknowledgements: number[][] = []
  let verified = false
  const tracker = new LinuxDoReadTracker({
    send: async batch => { sent.push(copy(batch)); if (!verified) throw new LinuxDoApiError('browser-verification', 'challenge', 403) },
    onSent: (_topic, _highest, posts) => acknowledgements.push(posts),
  })
  try {
    tracker.start(100); tracker.setVisiblePosts([2, 3]); await advance(5000)
    assert.equal(sent.length, 1); assert.equal(acknowledgements.length, 0)
    await advance(65000)
    assert.equal(sent.length, 1, 'never repeatedly POST a blocked challenge')
    verified = true; tracker.resume(); await microtasks()
    assert.deepEqual(sent[1], sent[0], 'resume must not discard already observed reading')
    assert.deepEqual(acknowledgements, [[2, 3]])
  } finally { tracker.stop(false) }
}])

tests.push(['network failures keep the pending batch until a bounded retry succeeds', async () => {
  let calls = 0; let acknowledgements = 0
  const tracker = new LinuxDoReadTracker({ send: async () => { if (++calls === 1) throw new LinuxDoApiError('network', 'offline') }, onSent: () => { acknowledgements++ } })
  try {
    tracker.start(100); tracker.setVisiblePosts([1]); await advance(5000)
    assert.equal(acknowledgements, 0); await advance(5000)
    assert.equal(calls, 2); assert.equal(acknowledgements, 1)
  } finally { tracker.stop(false) }
}])

tests.push(['Retry-After is respected and manual resume cannot bypass the server cooldown', async () => {
  let calls = 0
  const tracker = new LinuxDoReadTracker({ send: async () => { if (++calls === 1) throw new LinuxDoApiError('rate-limited', 'wait', 429, 120) } })
  try {
    tracker.start(100); tracker.setVisiblePosts([1]); await advance(5000)
    tracker.resume(); await advance(119000)
    assert.equal(calls, 1)
    await advance(1000); assert.equal(calls, 2)
  } finally { tracker.stop(false) }
}])

tests.push(['ending a topic cancels a scheduled retry', async () => {
  let calls = 0
  const tracker = new LinuxDoReadTracker({ send: async () => { calls++; throw new LinuxDoApiError('server', 'down', 503) } })
  tracker.start(100); tracker.setVisiblePosts([1]); await advance(5000)
  tracker.stop(false); await advance(120000)
  assert.equal(calls, 1)
}])

tests.push(['starting a different topic invalidates late callbacks from the previous topic', async () => {
  let resolve!: () => void; const ack: number[] = []
  const delayed = new Promise<void>(done => { resolve = done })
  const tracker = new LinuxDoReadTracker({ send: async () => delayed, onSent: topic => ack.push(topic) })
  try {
    tracker.start(100); tracker.setVisiblePosts([1]); await advance(5000)
    tracker.start(200); resolve(); await microtasks()
    assert.deepEqual(ack, [])
  } finally { tracker.stop(false) }
}])

tests.push(['transient errors stop retrying after four retries rather than looping forever', async () => {
  let calls = 0
  const tracker = new LinuxDoReadTracker({ send: async () => { calls++; throw new LinuxDoApiError('server', 'down', 503) } })
  try {
    tracker.start(100); tracker.setVisiblePosts([1]); await advance(5000)
    for (const wait of [5000, 10000, 20000, 40000, 40000, 40000]) await advance(wait)
    assert.equal(calls, 5)
  } finally { tracker.stop(false) }
}])

let failures = 0
for (const [name, run] of tests) {
  mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 })
  try { await run(); console.log('PASS', name) }
  catch (error) { failures++; console.error('FAIL', name, error instanceof Error ? error.message : error) }
  finally { mock.timers.reset() }
}
assert.equal(failures, 0, `${failures} queue regressions`)
console.log(`linuxdo-readsync-queue: ${tests.length} passed`)
