import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
} })
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { LinuxDoComposer } = await import('../src/features/linuxdo/ui/ThreadViews')
const { decodeTopic, decodePost } = await import('../src/features/linuxdo/api/decode')
const { linuxDoDrafts, linuxDoDiscovery, linuxDoTopics } = await import('../src/features/linuxdo/runtime')
const original = { get: linuxDoDrafts.get, clear: linuxDoDrafts.clear, categories: linuxDoDiscovery.categories,
  tags: linuxDoDiscovery.tags, reply: linuxDoTopics.reply, createTopic: linuxDoTopics.createTopic }
linuxDoDrafts.get = async () => ({ data: null, sequence: 0 })
linuxDoDrafts.clear = async () => {}
linuxDoDiscovery.categories = async () => []
linuxDoDiscovery.tags = async () => []
const submissions: Array<{ topicId?: number; raw: string; replyToPostNumber?: number }> = []
linuxDoTopics.reply = async (topicId, raw, replyToPostNumber) => {
  submissions.push({ topicId, raw, replyToPostNumber })
  return decodePost({ id: 9, post_number: 4, raw })
}
linuxDoTopics.createTopic = async (input) => {
  submissions.push({ raw: input.raw })
  return decodePost({ id: 10, post_number: 1, raw: input.raw })
}
const root = createRoot(document.getElementById('root')!)
const session = { authenticated: true, authMode: 'browser-session' as const, currentUser: { id: 1, username: 'reader' } }
try {
  for (const [archetype, minimum] of [['regular', 6], ['private_message', 3], [undefined, 20]] as const) {
    for (const count of [minimum - 1, minimum]) {
      const raw = '字'.repeat(count)
      const topic = archetype ? decodeTopic({ id: 11, title: '测试主题', archetype }) : undefined
      await act(async () => {
        root.render(<LinuxDoComposer key={`${archetype}:${count}`} open topic={topic} session={session}
          initialRaw={raw} replyToPostNumber={topic ? 3 : undefined}
          resumedDraft={!topic ? { key: 'new_topic', sequence: 0, data: { action: 'createTopic', title: '这是合格标题', reply: raw } } : undefined}
          onClose={() => {}} onSent={() => {}} />)
        for (let i = 0; i < 20; i++) await Promise.resolve()
      })
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === (topic ? '回复' : '发布'))!
      assert.ok(button, 'the real composer must expose a submit button')
      assert.equal(button.disabled, count < minimum, `${archetype}: submit availability must use ${minimum}, not the new-topic threshold`)
      assert.ok(document.body.textContent?.includes(`${count}/${minimum}`), `${archetype}: the displayed threshold must match submit validation`)
      const before = submissions.length
      await act(async () => { button.click(); for (let i = 0; i < 20; i++) await Promise.resolve() })
      assert.equal(submissions.length, before + (count === minimum ? 1 : 0), 'only a valid body reaches the write service')
      if (count === minimum) assert.deepEqual(submissions.at(-1), topic ? { topicId: 11, raw, replyToPostNumber: 3 } : { raw })
    }
  }
} finally {
  await act(async () => root.unmount())
  linuxDoDrafts.get = original.get
  linuxDoDrafts.clear = original.clear
  linuxDoDiscovery.categories = original.categories
  linuxDoDiscovery.tags = original.tags
  linuxDoTopics.reply = original.reply
  linuxDoTopics.createTopic = original.createTopic
}
console.log('linuxdo-composer-validation-view: ok')
