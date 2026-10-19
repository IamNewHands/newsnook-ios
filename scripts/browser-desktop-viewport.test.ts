import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { parseHTML } from 'linkedom'

const path = new URL('../android/app/src/main/assets/browser-desktop-viewport.js', import.meta.url)
let source = ''
try { source = readFileSync(path, 'utf8') } catch { /* The pre-fix host only changes WebSettings. */ }

const { window } = parseHTML('<html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"></head><body></body></html>')
const document = window.document
Object.assign(window, { top: window })
const context = createContext({ window, document, MutationObserver: window.MutationObserver, location: { protocol: 'https:' } })
runInContext(source, context)
const viewport = document.querySelector('meta[name="viewport"]')!
assert.equal(viewport.getAttribute('content'), 'width=980, user-scalable=yes', 'desktop mode overrides an existing phone viewport')
viewport.setAttribute('content', 'width=device-width,initial-scale=1')
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(viewport.getAttribute('content'), 'width=980, user-scalable=yes', 'a website cannot accidentally reset the chosen desktop viewport')
runInContext(source, context)
assert.equal(document.querySelectorAll('meta[name="viewport"]').length, 1, 'repeated fallback injection does not duplicate the viewport')
;(window as any).__newsnookDesktopViewport.restore()
assert.equal(viewport.getAttribute('content'), 'width=device-width,initial-scale=1', 'leaving desktop mode restores the website latest viewport')
viewport.setAttribute('content', 'width=500')
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(viewport.getAttribute('content'), 'width=500', 'the observer is detached when desktop mode ends')

const other = parseHTML('<html><head></head><body></body></html>').window
Object.assign(other, { top: other })
runInContext(source, createContext({ window: other, document: other.document, MutationObserver: other.MutationObserver, location: { protocol: 'https:' } }))
assert.equal(other.document.querySelectorAll('meta[name="viewport"]').length, 1, 'pages without a viewport receive a desktop viewport')
;(other as any).__newsnookDesktopViewport.restore()
assert.equal(other.document.querySelectorAll('meta[name="viewport"]').length, 0, 'leaving desktop mode removes only the browser-owned viewport')
console.log('Browser desktop viewport: phone meta, dynamic updates, repeated injection and restoration OK')
