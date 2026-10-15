import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { InkImage } = await import('../src/components/InkImage')
const root = createRoot(document.getElementById('root')!)
try {
  await act(async () => { root.render(<InkImage src="https://example.org/photo.jpg" className="h-full w-full" collapseOnError />) })
  const shimmer = document.querySelector('.ink-shimmer')!
  assert.ok(shimmer, 'pending images must use the shared article loading animation')
  assert.ok(shimmer.classList.contains('h-full') && shimmer.classList.contains('w-full'), 'the shared relative shimmer must fill a separately positioned overlay')
  assert.ok(shimmer.parentElement?.classList.contains('absolute') && shimmer.parentElement.classList.contains('inset-0'), 'overlay positioning must not be overridden by the shared shimmer class')
  const image = document.querySelector('img')!
  assert.equal(image.getAttribute('loading'), 'lazy', 'a loading indicator must not make image requests eager')
  await act(async () => { image.dispatchEvent(new window.Event('load')) })
  assert.equal(document.querySelector('.ink-shimmer'), null, 'the loading animation must disappear when the image loads')
  await act(async () => { root.render(<InkImage src="https://example.org/next.jpg" className="h-full w-full" collapseOnError />) })
  assert.ok(document.querySelector('.ink-shimmer'), 'a new image must restore the loading animation')
  await act(async () => { document.querySelector('img')!.dispatchEvent(new window.Event('error')) })
  await act(async () => { document.querySelector('img')!.dispatchEvent(new window.Event('error')) })
  assert.equal(document.querySelector('.ink-shimmer'), null, 'failed images must not keep showing a loading animation')
  assert.equal(document.getElementById('root')!.children.length, 0, 'collapse-on-error behavior must remain intact')
} finally {
  await act(async () => { root.unmount() })
}
console.log('ink-image-loading: ok')
