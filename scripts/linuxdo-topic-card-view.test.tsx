import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { decodeTopics } from '../src/features/linuxdo/api/decode'
import { applyLinuxDoReadProgress } from '../src/features/linuxdo/topic/readState'
import { TopicCard } from '../src/features/linuxdo/ui/shared'

Object.assign(globalThis, { React })

const decode = (tracking: Record<string, unknown>) => decodeTopics({
  topic_list: { topics: [{ id: 1, title: 'Topic', posts_count: 4, ...tracking }] },
})[0]!

function assertMuted(topic: ReturnType<typeof decode>, expected: boolean, label: string) {
  const { document } = parseHTML(renderToStaticMarkup(<TopicCard topic={topic} onOpen={() => {}} />))
  assert.equal(document.querySelector('h3')!.className.includes('text-paper-muted/85'), expected, `${label}: title`)
  assert.equal(document.querySelector('article')!.className.includes('opacity-[0.92]'), expected, `${label}: card`)
}

const emojiTopic = decode({
  title: '问候 face 大家',
  fancy_title: '问候 <img width="20" height="20" src="/images/emoji/twitter/face.png?v=12" title="face" alt="face" class="emoji"> 大家',
})
const emojiMarkup = renderToStaticMarkup(<TopicCard topic={emojiTopic} onOpen={() => {}} />)
const { document: emojiDocument } = parseHTML(emojiMarkup)
const titleEmoji = emojiDocument.querySelector('h3 img')
assert.equal(titleEmoji?.getAttribute('src'), 'https://linux.do/images/emoji/twitter/face.png?v=12')
assert.equal(titleEmoji?.getAttribute('alt'), 'face')
assert.equal(emojiDocument.querySelector('h3')?.textContent?.trim(), '问候  大家')
assert.match(emojiDocument.querySelector('article')?.getAttribute('aria-label') ?? '', /问候 face 大家/)

const unsafeTopic = decode({ title: '安全标题', fancy_title: '<img class="emoji" src="javascript:alert(1)" alt="face"><script>oops</script>' })
const unsafeMarkup = renderToStaticMarkup(<TopicCard topic={unsafeTopic} onOpen={() => {}} />)
assert.doesNotMatch(unsafeMarkup, /javascript:|<script|oops/)
assert.doesNotMatch(unsafeMarkup, /<img/)
assert.match(unsafeMarkup, /安全标题/)

assertMuted(decode({}), false, 'missing tracking fields do not prove a topic was read')
assertMuted(decode({ unseen: false, last_read_post_number: null, notification_level: 1 }), false, 'regular unvisited topics stay legible without a new badge')
assertMuted(decode({ unseen: true, last_read_post_number: null, notification_level: 0 }), false, 'muting notifications does not mark a topic read')
assertMuted(decode({ is_seen: true, last_read_post_number: 0 }), false, 'a seen flag without a reading cursor does not prove reading')
assertMuted(decode({ last_read_post_number: 4, highest_post_number: 4 }), true, 'confirmed read topic remains muted')
assertMuted(decode({ last_read_post_number: 1, highest_post_number: 4, notification_level: 2 }), false, 'tracked unread replies keep the title prominent')
assertMuted(applyLinuxDoReadProgress(decode({ last_read_post_number: null, notification_level: 1 }), 1), true, 'accepted reading progress can mute a regular topic')

// Test onOpenUser in TopicCard
const aliceTopic = decodeTopics({
  users: [{ id: 42, username: 'alice', avatar_template: '/letter/a.png' }, { id: 99, username: 'bob', avatar_template: '/letter/b.png' }],
  topic_list: {
    topics: [{ id: 2, title: 'Alice Topic', posters: [{ user_id: 42, description: 'Original Poster' }, { user_id: 99, description: 'Most Recent Poster' }] }],
  },
})[0]!

const neoTopic = decodeTopics({
  users: [{ id: 1, username: 'neo', avatar_template: '/letter/n.png' }],
  topic_list: {
    topics: [{ id: 3, title: 'Neo Topic', posters: [{ user_id: 1, description: 'Original Poster' }] }],
  },
})[0]!

const openedUsers: string[] = []
const aliceDoc = parseHTML(renderToStaticMarkup(<TopicCard topic={aliceTopic} onOpen={() => {}} onOpenUser={(u) => openedUsers.push(u)} />)).document
const aliceAvatarBtn = aliceDoc.querySelector('button[aria-label="查看 alice 的个人主页"]')
assert.ok(aliceAvatarBtn, 'avatar button should exist with proper aria-label when onOpenUser is provided')
assert.equal(aliceAvatarBtn.hasAttribute('disabled'), false, 'avatar button should be enabled')
assert.equal(aliceDoc.querySelector('[data-linuxdo-site-admin-badge]'), null, 'normal user should not have site admin badge')

const neoDoc = parseHTML(renderToStaticMarkup(<TopicCard topic={neoTopic} onOpen={() => {}} onOpenUser={(u) => openedUsers.push(u)} />)).document
const neoAvatarBtn = neoDoc.querySelector('button[aria-label="查看 neo 的个人主页"]')
assert.ok(neoAvatarBtn, 'neo avatar button should exist with proper aria-label')
assert.ok(neoDoc.querySelector('[data-linuxdo-site-admin-badge]'), 'neo avatar should have site admin badge')
assert.match(neoAvatarBtn.querySelector('div')?.className ?? '', /rounded-\[7px\]/, 'neo avatar container should have square rounded-[7px] styling')

const noNavDoc = parseHTML(renderToStaticMarkup(<TopicCard topic={aliceTopic} onOpen={() => {}} />)).document
const disabledAvatarBtn = noNavDoc.querySelector('button[aria-label="查看 alice 的个人主页"]')
assert.ok(disabledAvatarBtn?.hasAttribute('disabled'), 'avatar button should be disabled when onOpenUser is not provided')

console.log('linuxdo-topic-card-view: ok')

