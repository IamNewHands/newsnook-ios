import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UpdateDialog } from '../src/features/appUpdate/UpdateDialog'

// tsx executes the repository's classic JSX transform in Node tests.
Object.assign(globalThis, { React })

const release = { version: '9.1.0', notes: '**更新说明**：修复冷启动', url: 'https://example.com' }
const baseProps = {
  open: true, release, localVersion: '9.0.0',
  onUpdate: () => {}, onLater: () => {}, onSkip: () => {}, allowPermanentSkip: true,
}
const html = renderToStaticMarkup(<UpdateDialog {...baseProps} />)
assert.match(html, /发现新版本 v9\.1\.0/)
assert.match(html, /更新说明/)
assert.match(html, /<strong>更新说明<\/strong>/, 'Markdown text must still render when the lazy dialog opens')
assert.match(html, /立即更新/)
assert.match(html, /不再提醒此版本/)
assert.equal(renderToStaticMarkup(<UpdateDialog {...baseProps} open={false} />), '')
console.log('Lazy update dialog: release notes, actions, skip and hidden state verified')
