import { parseHTML } from 'linkedom'
import { inferImageDisplayRole } from '../normalizeImages'

/** Convert loose syndication fragments (text + <br> + media) into semantic
 * reader blocks. Already-structured HTML keeps its nested markup and order.
 * This runs before the shared image normalizer and sanitizer; it does not
 * bypass any HTML security controls.
 */
export function normalizeFeedLayout(html: string): string {
  if (!html.trim()) return html
  const { document } = parseHTML('<html><body></body></html>')
  const source = document.createElement('div')
  source.innerHTML = html
  const output = document.createElement('div')
  let paragraph = document.createElement('p')
  let pendingBreaks = 0
  const blockTags = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'DL',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'FIGURE', 'HR',
  ])
  const mediaTags = new Set(['IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'IFRAME'])
  const flushParagraph = () => {
    if (paragraph.textContent?.trim() || paragraph.querySelector('img, video, audio, iframe, a[href]')) {
      output.appendChild(paragraph)
    }
    paragraph = document.createElement('p')
  }
  const flushBreaks = () => {
    if (pendingBreaks > 1) flushParagraph()
    else if (pendingBreaks === 1 && paragraph.childNodes.length) {
      paragraph.appendChild(document.createElement('br'))
    }
    pendingBreaks = 0
  }

  for (const node of [...source.childNodes]) {
    if (node.nodeType === 1 && (node as Element).tagName === 'BR') {
      pendingBreaks++
      continue
    }
    if (node.nodeType === 3 && !node.textContent?.trim()) {
      if (pendingBreaks > 0 || !paragraph.childNodes.length) continue
    }
    flushBreaks()
    if (node.nodeType === 1) {
      const element = node as Element
      if (blockTags.has(element.tagName)) {
        flushParagraph()
        output.appendChild(element.cloneNode(true))
        continue
      }
      const inlineImage = element.tagName === 'IMG' ? element : element.querySelector('img')
      if (mediaTags.has(element.tagName)) {
        // Small avatars, emoji and badges are phrasing content; wrapping them
        // in a figure would create an unwanted full-width block in short posts.
        if (inlineImage && inferImageDisplayRole(inlineImage) === 'badge') {
          paragraph.appendChild(element.cloneNode(true))
          continue
        }
        flushParagraph()
        const figure = document.createElement('figure')
        figure.appendChild(element.cloneNode(true))
        output.appendChild(figure)
        continue
      }
      if (element.tagName === 'A' && inlineImage && !element.textContent?.trim() &&
          inferImageDisplayRole(inlineImage) !== 'badge') {
        flushParagraph()
        const figure = document.createElement('figure')
        figure.appendChild(element.cloneNode(true))
        output.appendChild(figure)
        continue
      }
    }
    paragraph.appendChild(node.cloneNode(true))
  }
  flushParagraph()
  return output.innerHTML
}
