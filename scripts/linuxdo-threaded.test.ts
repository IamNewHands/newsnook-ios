import assert from 'node:assert/strict'
import { buildLinuxDoThreads } from '../src/features/linuxdo/ui/threadModel'
import type { LinuxDoPost } from '../src/features/linuxdo/types'

const post = (postNumber: number, replyToPostNumber?: number): LinuxDoPost => ({
  id: 1000 + postNumber, postNumber, replyToPostNumber, username: `user${postNumber}`,
  createdAt: '', cooked: '<p>Reply</p>', actions: [],
})
const input = [post(7, 4), post(4, 2), post(1), post(6, 3), post(3, 1), post(2), post(5, 2)]
const rows = buildLinuxDoThreads(input)
assert.deepEqual(rows.map(row => row.post.postNumber), [1, 2, 4, 7, 5, 3, 6])
assert.deepEqual(rows.map(row => row.depth), [0, 0, 1, 2, 1, 0, 1])
assert.equal(rows[1].replyCount, 3)
assert.equal(rows[2].rootPostNumber, 2)
assert.equal(rows[2].firstReply, true)
assert.equal(rows[4].lastReply, true)
assert.equal(rows[5].replyCount, 1)
assert.equal(input[0].postNumber, 7, 'projection must not mutate the chronological source')
console.log('PASS nested discussion order and branch boundaries')

const partial = buildLinuxDoThreads([post(9, 8), post(10, 9), post(12)])
assert.deepEqual(partial.map(row => row.post.postNumber), [9, 10, 12])
assert.equal(partial[0].missingParent, 8)
assert.equal(partial[1].rootPostNumber, 9)
const complete = buildLinuxDoThreads([post(8, 2), post(2), ...partial.map(row => row.post)])
assert.deepEqual(complete.map(row => row.post.postNumber), [2, 8, 9, 10, 12])
assert.equal(complete[0].replyCount, 3)
console.log('PASS missing parents remain readable and later join their discussion')

const malformed = buildLinuxDoThreads([post(2, 3), post(3, 2), post(4, 4), post(5, -1)])
assert.deepEqual(malformed.map(row => row.post.postNumber), [2, 3, 4, 5])
assert.equal(new Set(malformed.map(row => row.post.id)).size, 4)
assert.equal(malformed[1].rootPostNumber, 2)
const deep = buildLinuxDoThreads(Array.from({ length: 12000 }, (_, i) => post(i + 1, i > 1 ? i : undefined)))
assert.equal(deep.length, 12000)
assert.equal(deep.at(-1)?.depth, 11998, 'deep threads must not overflow the call stack')
console.log('PASS malformed relations and deep chains cannot lose posts or recurse indefinitely')
