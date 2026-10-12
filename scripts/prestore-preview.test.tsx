import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import { mock } from 'node:test'
import type { Article } from '../src/lib/types'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const data = new Map<string, string>()
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index],
    get length() { return data.size },
  },
})
const article: Article = { id: 'old-prestore', title: 'News', summary: '', publishedAt: 1, hasRealDate: true, sourceId: 'test', sourceName: 'Test', sourceLabel: 'Test', sourceGroup: 'custom', originUrl: 'https://example.org/news' }
const manifest = {
  version: 1, revision: 1, presetId: 'test', planKey: 'test', perSourceLimit: 10, updatedAt: 1,
  sources: { test: { categoryId: 'mix', articleIds: [article.id] } },
  articles: { [article.id]: { article, sourceId: 'test', bytes: 100, savedAt: 1 } },
}
mock.module('@capacitor/filesystem', {
  namedExports: {
    Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' },
    Filesystem: { readFile: async (options: { path: string }) => {
      if (options.path.endsWith('manifest-a.json')) return { data: JSON.stringify(manifest) }
      throw new Error('File not found')
    } },
  },
})
const { createRoot } = await import('react-dom/client')
const { usePrestore } = await import('../src/features/prestore/usePrestore')
const { DEFAULT_PREFERENCES } = await import('../src/sources/preferences')
const { saveCachedBody } = await import('../src/lib/bodyCache')
const { withArticlePreviewImage } = await import('../src/lib/articlePreview')
const prefs = { ...DEFAULT_PREFERENCES, prestore: { enabled: false, perSourceLimit: 10 } }
const enabledIds: string[] = []
let result: ReturnType<typeof usePrestore>
function Harness() {
  result = usePrestore({ prefs, enabledIds, presetId: 'test' })
  return <ul>{result.snapshot.articles.map((item) => <li key={item.id}>{item.image && <img src={item.image} />}</li>)}</ul>
}
let root = createRoot(document.getElementById('root')!)
try {
  await act(async () => { root.render(<Harness />) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  assert.equal(result!.snapshot.articles[0]?.id, article.id, 'the old manifest must load without any feed list')
  const html = '<p>正文</p><img src="https://example.org/photo.jpg">'
  const preview = withArticlePreviewImage(article, html)
  assert.equal(saveCachedBody(preview, { html, bodySource: 'readability' }), true)
  await act(async () => { result!.updateArticlePreview?.(preview) })
  assert.equal(result!.snapshot.articles[0]?.image, 'https://example.org/photo.jpg', 'reading must backfill an article present only in the prestore snapshot')
  assert.equal(document.querySelector('img')?.getAttribute('src'), 'https://example.org/photo.jpg')
  assert.equal(result!.snapshot.stats.updatedAt, 1, 'cover enrichment must not freshen the prestore window')
  await act(async () => { root.unmount() })
  root = createRoot(document.getElementById('root')!)
  await act(async () => { root.render(<Harness />) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  assert.equal(result!.snapshot.articles[0]?.image, 'https://example.org/photo.jpg', 'a remount must reuse the durable reading cache with an old manifest')
} finally {
  await act(async () => { root.unmount() })
}
console.log('prestore-preview: ok')
