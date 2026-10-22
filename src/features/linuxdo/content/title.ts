import { parseHTML } from 'linkedom'

export type LinuxDoTitlePart =
  | { kind: 'text'; text: string }
  | { kind: 'emoji'; src: string; alt: string }

function emojiUrl(value: string | null): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value.trim(), 'https://linux.do/')
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Discourse puts title emoji markup in fancy_title; title alone can say "face". */
export function linuxDoTitleParts(title: string, fancyTitle?: string): LinuxDoTitlePart[] {
  const plain: LinuxDoTitlePart[] = [{ kind: 'text', text: title }]
  if (!fancyTitle || !/<img\b/i.test(fancyTitle)) return plain

  try {
    const { document } = parseHTML('<!doctype html><html><body>' + fancyTitle + '</body></html>')
    const parts: LinuxDoTitlePart[] = []
    const appendText = (text: string) => {
      if (!text) return
      const last = parts[parts.length - 1]
      if (last?.kind === 'text') last.text += text
      else parts.push({ kind: 'text', text })
    }
    const visit = (node: Node): void => {
      if (node.nodeType === 3) {
        appendText(node.textContent ?? '')
        return
      }
      if (node.nodeType !== 1) return
      const element = node as Element
      if (element.tagName === 'IMG') {
        const alt = element.getAttribute('alt') || element.getAttribute('title') || '表情'
        const src = emojiUrl(element.getAttribute('src'))
        if (src && /\bemoji\b/i.test(element.getAttribute('class') || '')) {
          parts.push({ kind: 'emoji', src, alt })
        } else {
          appendText(alt)
        }
        return
      }
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'TEMPLATE'].includes(element.tagName)) return
      for (const child of [...element.childNodes]) visit(child)
    }
    for (const child of [...document.body.childNodes]) visit(child)
    return parts.some((part) => part.kind === 'emoji') ? parts : plain
  } catch {
    return plain
  }
}
