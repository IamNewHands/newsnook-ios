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
console.log('linuxdo-topic-card-view: ok')
