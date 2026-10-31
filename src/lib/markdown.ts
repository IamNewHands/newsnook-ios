import createDOMPurify from 'dompurify'
import { parseHTML } from 'linkedom'
import { marked } from 'marked'

type PurifyLike = {
  isSupported?: boolean
  sanitize: (dirty: string, config?: object) => string
}

function createPurify(): PurifyLike {
  if (typeof globalThis.window !== 'undefined' && globalThis.window.document) {
    return createDOMPurify(globalThis.window as unknown as Parameters<typeof createDOMPurify>[0]) as unknown as PurifyLike
  }
  const { window } = parseHTML('<!doctype html><html><body></body></html>')
  return createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]) as unknown as PurifyLike
}

const DOMPurify = createPurify()

marked.setOptions({ gfm: true, breaks: false })

const ALLOWED_TAGS = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  'del',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'code',
  'pre',
  'br',
  'hr',
  'blockquote',
])

const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'img',
  'object',
  'embed',
  'link',
  'meta',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
])

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOWED_URI_REGEXP: /^(?:https?):/i,
}

/** linkedom 下 DOMPurify.isSupported 常为 false 且会原样返回脏 HTML，需自备白名单。 */
function sanitizeWithAllowlist(html: string): string {
  const { document } = parseHTML('<!doctype html><html><body></body></html>')
  document.body.innerHTML = html

  const elements = [...document.body.querySelectorAll('*')].sort(
    (a, b) => b.querySelectorAll('*').length - a.querySelectorAll('*').length,
  )

  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    if (DROP_TAGS.has(tag) || !ALLOWED_TAGS.has(tag)) {
      if (DROP_TAGS.has(tag)) {
        el.remove()
      } else {
        const parent = el.parentNode
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el)
        }
        el.remove()
      }
      continue
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name === 'href') {
        if (!/^(?:https?):/i.test(attr.value.trim())) el.removeAttribute(attr.name)
        continue
      }
      if (name === 'title') continue
      el.removeAttribute(attr.name)
    }
  }

  return document.body.innerHTML
}

function sanitizeMarkdownHtml(html: string): string {
  if (DOMPurify.isSupported) {
    return DOMPurify.sanitize(html, SANITIZE_OPTIONS)
  }
  return sanitizeWithAllowlist(html)
}

/** Release notes 等可信度有限的 Markdown → 消毒后的 HTML */
export function markdownToSafeHtml(markdown: string): string {
  const source = markdown.trim()
  if (!source) return ''
  const dirty = marked.parse(source, { async: false }) as string
  return sanitizeMarkdownHtml(dirty)
}
