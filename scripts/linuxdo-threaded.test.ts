import assert from 'node:assert/strict'
import { buildLinuxDoThreads, computeConversationChain, extractQuoteSnippet } from '../src/features/linuxdo/ui/threadModel'
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

// 222.html transformation: conversation chain & quote snippet tests
const chainPosts = [post(1), post(2), post(4, 2), post(5, 2), post(7, 4), post(8, 7), post(3, 1), post(6, 3)]
const chain7 = computeConversationChain(7, chainPosts)
assert.deepEqual(Array.from(chain7).sort((a, b) => a - b), [2, 4, 7, 8], 'chain on post 7 must include ancestors 2, 4 and descendant 8')
const chain2 = computeConversationChain(2, chainPosts)
assert.deepEqual(Array.from(chain2).sort((a, b) => a - b), [2, 4, 5, 7, 8], 'chain on root 2 must include all descendants in subtree')
console.log('PASS computeConversationChain correctly connects ancestor and descendant threads')

const snippet = extractQuoteSnippet('<p>哪有什么程序员，AI才是程序员，人类不都是prompt工程师吗？🫠</p>')
assert.equal(snippet, '哪有什么程序员，AI才是程序员，人类不都是prompt工程师吗？🫠')
const snippetWithCode = extractQuoteSnippet('<p>看看这段代码：<pre><code>console.log(123)</code></pre> 是不是很简单？</p>')
assert.match(snippetWithCode, /\[代码\]/)
console.log('PASS extractQuoteSnippet strips markup and normalizes code previews')

