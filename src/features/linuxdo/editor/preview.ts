import { marked } from 'marked'

import { sanitizeLinuxDoCooked } from '../content/sanitize'

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function discourseExtensions(raw: string): string {
  return raw
    .replace(/<div\s+data-theme-toc="true"\s*><\/div>/gi, '<div data-linuxdo-preview-block="toc"><div data-linuxdo-role="preview-block-label">目录</div><p>发布后将根据正文标题生成目录</p></div>')
    .replace(/\[chart([^\]]*)\]\s*([\s\S]*?)\s*\[\/chart\]/gi, (_match, attrs, body) => {
      const type = /type="?([^\s"\]]+)/i.exec(attrs)?.[1] || 'bar'
      const rows = String(body).split('\n').map((line) => line.split('|').map((cell) => cell.trim())).filter((row) => row.some(Boolean))
      const [head = [], ...rest] = rows
      return `<div data-linuxdo-preview-block="chart"><div data-linuxdo-role="preview-block-label">chart · ${escapeAttribute(type)}</div><table><thead><tr>${head.map((cell) => `<th>${escapeAttribute(cell)}</th>`).join('')}</tr></thead><tbody>${rest.map((row) => `<tr>${row.map((cell) => `<td>${escapeAttribute(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    })
    .replace(/\[graphviz[^\]]*\]\s*([\s\S]*?)\s*\[\/graphviz\]/gi, (_match, source) => (
      `<div data-linuxdo-preview-block="graphviz"><div data-linuxdo-role="preview-block-label">graphviz</div><pre><code>${escapeAttribute(String(source).trim())}</code></pre></div>`
    ))
    .replace(/\[details(?:="([^"]*)")?\]\s*([\s\S]*?)\s*\[\/details\]/gi, (_match, summary, content) => (
      `<details><summary>${escapeAttribute(summary || '详细信息')}</summary>\n${content.trim()}\n</details>`
    ))
    .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="spoiler">$1</span>')
    .replace(/\[date=([^\s\]]+)(?:\s+time=([^\s\]]+))?(?:\s+timezone="([^"]+)")?[^\]]*\]/gi, (_match, date, time, timezone) => (
      `<time>${escapeAttribute(`${date}${time ? ` ${time}` : ''}${timezone ? ` · ${timezone}` : ''}`)}</time>`
    ))
    .replace(/\[poll([^\]]*)\]\s*([\s\S]*?)\s*\[\/poll\]/gi, (_match, attrs, body) => {
      const type = /type=([^\s\]]+)/i.exec(attrs)?.[1] || 'regular'
      const items = String(body).split('\n').map((line) => line.replace(/^\s*[*-]\s+/, '').trim()).filter(Boolean)
      return `<div class="poll" data-poll-type="${escapeAttribute(type)}"><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul></div>`
    })
}

function markDiagramBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-(mermaid|chart|graphviz)">([\s\S]*?)<\/code><\/pre>/gi,
    (_match, type, source) => `<div data-linuxdo-preview-block="${type}"><div data-linuxdo-role="preview-block-label">${type}</div><pre><code>${source}</code></pre></div>`,
  )
}

export function renderLinuxDoComposerPreview(raw: string): string {
  if (!raw.trim()) return ''
  const html = marked.parse(discourseExtensions(raw), { async: false, gfm: true, breaks: false }) as string
  return sanitizeLinuxDoCooked(markDiagramBlocks(html))
}
