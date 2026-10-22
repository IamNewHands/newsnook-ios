import assert from 'node:assert/strict'
import React, { act, createElement } from 'react'
import { parseHTML } from 'linkedom'
import { installUserScript, loadUserScripts, saveUserScripts } from '../src/features/browser/scripts'
import { dismissTopHardwareBackLayer } from '../src/lib/hardwareBackStack'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const values = new Map<string, string>()
let storageFails = false
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (storageFails) throw new Error('Storage unavailable')
    values.set(key, value)
  },
} })
const { createRoot } = await import('react-dom/client')
const { ScriptManager } = await import('../src/features/browser/ScriptManager')
const source = '// ==UserScript==\n// @name Manager specimen\n// @version 1.0\n// @match https://example.com/*\n// ==/UserScript==\nvoid 0'
const installed = { ...installUserScript(source), enabled: false }
saveUserScripts([installed])
let changed = 0
let closed = 0
let syncFails = false
const root = createRoot(window.document.getElementById('root')!)
const document = window.document
const click = async (button: Element | null | undefined) => {
  assert.ok(button, 'expected a visible action')
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })) })
}
const buttonText = (pattern: RegExp, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll('button')).find(button => pattern.test(button.textContent?.trim() ?? ''))
const review = () => document.querySelector('[aria-label="脚本权限确认"]')
const importFile = async (text: string) => {
  const input = document.querySelector('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'specimen.user.js')] })
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })) })
}
try {
  await act(async () => root.render(createElement(ScriptManager, {
    onClose: () => { closed++ },
    onChanged: () => {
      changed++
      if (syncFails) throw new Error('Native browser unavailable')
    },
  })))
  await click(buttonText(/^Manager specimen/))
  await click(buttonText(/^审核修改$/))
  assert.ok(review(), 'editing opens the permission review')
  storageFails = true
  await click(buttonText(/^确认(?:安装|更新)$/, review()!))
  assert.match(review()?.querySelector('[role="alert"]')?.textContent ?? '', /保存失败/, 'save failure must be visible inside the active permission review')
  assert.equal(loadUserScripts()[0].source, source, 'failed writes preserve the installed version')
  assert.equal(changed, 0, 'failed writes cannot signal success')

  storageFails = false
  await click(buttonText(/^确认(?:安装|更新)$/, review()!))
  assert.equal(review(), null, 'successful save closes permission review')
  assert.equal(loadUserScripts().length, 1)
  assert.equal(loadUserScripts()[0].enabled, false)
  assert.equal(changed, 1)

  await click(document.querySelector('[aria-label="删除 Manager specimen"]'))
  const deletion = document.querySelector('[aria-label="删除用户脚本"]')
  assert.ok(deletion, 'deletion uses an in-app confirmation')
  storageFails = true
  await click(buttonText(/^删除脚本$/, deletion))
  assert.ok(document.querySelector('[aria-label="删除用户脚本"]'), 'failed deletion keeps the confirmation open')
  assert.match(deletion.querySelector('[role="alert"]')?.textContent ?? '', /保存失败/)
  assert.equal(loadUserScripts().length, 1)
  storageFails = false
  await click(buttonText(/^删除脚本$/, deletion))
  assert.equal(loadUserScripts().length, 0)
  assert.equal(changed, 2)

  await importFile(source)
  await click(buttonText(/^检查并安装$/))
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.equal(review(), null, 'system back dismisses the permission review first')
  assert.equal(closed, 0, 'system back must keep the script editor open')
  assert.equal(document.querySelector('textarea')?.value, source, 'canceling review keeps the draft')

  await click(buttonText(/^检查并安装$/))
  await click(buttonText(/^确认安装$/, review()!))
  await click(document.querySelector('[role="switch"]'))
  const beforeUpdate = loadUserScripts()[0]
  assert.equal(beforeUpdate.enabled, false)
  await importFile(source.replace('@version 1.0', '@version 2.0'))
  await click(buttonText(/^检查并安装$/))
  assert.match(review()?.textContent ?? '', /更新/, 're-import explicitly describes the update')
  await click(buttonText(/^确认更新$/, review()!))
  assert.equal(loadUserScripts().length, 1, 're-import updates without creating a duplicate')
  assert.equal(loadUserScripts()[0].id, beforeUpdate.id)
  assert.equal(loadUserScripts()[0].enabled, false)
  assert.equal(loadUserScripts()[0].version, '2.0')

  syncFails = true
  await click(document.querySelector('[role="switch"]'))
  assert.equal(loadUserScripts()[0].enabled, true, 'a native sync failure must not roll back a successful local save')
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /已保存.*应用|已保存.*同步/, 'native sync failure distinguishes saved state from runtime state')
} finally {
  await act(async () => root.unmount())
}
console.log('Browser script manager: permission errors, deletion, system back, updates and runtime sync feedback OK')
