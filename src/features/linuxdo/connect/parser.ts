import { LinuxDoConnectError, type LinuxDoTrustLevelData, type LinuxDoTrustMetric, type LinuxDoTrustVeto } from './types'

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function numberFrom(value: string): number {
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function numericPair(value: string): { current: number; target: number; currentText: string; targetText: string } {
  const [left = '', right = ''] = value.split('/', 2)
  const currentText = left.trim()
  const targetText = right.trim()
  return {
    current: numberFrom(currentText),
    target: numberFrom(targetText),
    currentText,
    targetText,
  }
}

function ringTarget(circle: Element | null, targetNode: Element | null): number {
  const explicit = numberFrom(text(targetNode))
  if (explicit > 0) return explicit
  const style = circle?.getAttribute('style') ?? ''
  const match = style.match(/--max:\s*(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function ringCurrent(circle: Element | null, currentNode: Element | null): number {
  const explicit = numberFrom(text(currentNode))
  const style = circle?.getAttribute('style') ?? ''
  const match = style.match(/--val:\s*(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : explicit
}

function metricFromRing(ring: Element): LinuxDoTrustMetric | null {
  const label = text(ring.querySelector('.tl3-ring-label'))
  if (!label) return null
  const circle = ring.querySelector('.tl3-ring-circle')
  const currentNode = ring.querySelector('.tl3-ring-current')
  const targetNode = ring.querySelector('.tl3-ring-target')
  const currentText = text(currentNode)
  const targetText = text(targetNode).replace(/^\s*\/\s*/, '')
  const current = ringCurrent(circle, currentNode)
  const target = ringTarget(circle, targetNode)
  const met = circle?.classList.contains('met') === true || ring.classList.contains('met')
  return { label, current, target, currentText: currentText || String(current), targetText: targetText || String(target), met }
}

function metricFromPair(root: Element, labelSelector: string, numsSelector: string): LinuxDoTrustMetric | null {
  const label = text(root.querySelector(labelSelector))
  const numsNode = root.querySelector(numsSelector)
  const nums = text(numsNode)
  if (!label || !nums) return null
  const pair = numericPair(nums)
  const met = root.classList.contains('met')
    || numsNode?.classList.contains('met') === true
    || root.querySelector('.tl3-bar-fill')?.classList.contains('met') === true
  return { label, ...pair, met }
}

function vetoFromElement(root: Element): LinuxDoTrustVeto | null {
  const met = root.classList.contains('met')
  // Connect currently renders a front/back face. Pick the visible semantic face
  // instead of taking the first hidden value, which can incorrectly turn a veto
  // count such as 1 into 0.
  const face = root.querySelector(met ? '.tl3-veto-front' : '.tl3-veto-back') ?? root
  const label = text(face.querySelector('.tl3-veto-label')) || text(root.querySelector('.tl3-veto-label'))
  if (!label) return null
  const description = text(face.querySelector('.tl3-veto-desc')) || text(root.querySelector('.tl3-veto-desc')) || undefined
  const valueText = text(face.querySelector('.tl3-veto-value')) || text(root.querySelector('.tl3-veto-value')) || '0'
  return {
    label,
    description,
    value: numberFrom(valueText),
    valueText,
    met,
  }
}

function findTrustCard(doc: Document): Element | null {
  return Array.from(doc.querySelectorAll('div.card')).find((card) => {
    const title = text(card.querySelector('h2.card-title'))
    return /信任级别\s*\d+\s*的要求/.test(title)
  }) ?? null
}

function detectAuthPage(doc: Document): boolean {
  const bodyText = text(doc.body).toLowerCase()
  if (doc.querySelector('form[action*="/login"], form[action*="/session"]')) return true
  if (/\b(sign in|log in|login)\b/.test(bodyText) && !/信任级别\s*\d+\s*的要求/.test(bodyText)) return true
  return /登录/.test(bodyText) && !/信任级别\s*\d+\s*的要求/.test(bodyText)
}

function findFootnote(card: Element): string | undefined {
  const candidates = Array.from(card.querySelectorAll('p, small, .text-muted, .card-footer'))
    .map((node) => text(node))
    .filter(Boolean)
  return candidates.find((value) => value.includes('“话题”') && value.includes('“帖子”'))
    ?? candidates.find((value) => value.includes('话题') && value.includes('帖子') && value.includes('回复'))
}

function findResultText(card: Element, achieved: boolean, targetLevel: number): string {
  const explicit = Array.from(card.querySelectorAll('.status-met, .status-unmet, .tl3-status, .card-footer'))
    .map((node) => text(node))
    .find((value) => /信任级别|要求|达标|达到/.test(value) && !value.includes('话题'))
  if (explicit) return explicit
  return achieved
    ? `已达到信任级别 ${targetLevel} 要求，请保持。`
    : `尚未达到信任级别 ${targetLevel} 要求。`
}

export function parseLinuxDoConnectTrustPage(html: string, fetchedAt = Date.now()): LinuxDoTrustLevelData {
  if (!html.trim()) throw new LinuxDoConnectError('parse', 'Connect 返回了空页面')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const card = findTrustCard(doc)
  if (!card) {
    if (detectAuthPage(doc)) throw new LinuxDoConnectError('auth-required', 'Connect 登录状态已失效')
    throw new LinuxDoConnectError('parse', '未找到信任等级数据')
  }

  const title = text(card.querySelector('h2.card-title'))
  const titleMatch = title.match(/信任级别\s*(\d+)\s*的要求/)
  if (!titleMatch) throw new LinuxDoConnectError('parse', '无法识别信任等级标题')
  const targetLevel = Number(titleMatch[1])

  const subtitle = text(card.querySelector('p.card-subtitle'))
  const username = subtitle.match(/@([^\s·]+)/)?.[1]?.trim() ?? ''
  const periodLabel = subtitle.split('·').slice(1).join('·').trim()

  const badge = card.querySelector('.card-header .badge, .badge')
  const badgeText = text(badge)
  const achieved = badge?.classList.contains('badge-success') === true || /已达到|已达标/.test(badgeText)
  const statusLabel = badgeText || (achieved ? '已达到' : '未达到')

  const activity = Array.from(card.querySelectorAll('.tl3-ring'))
    .map(metricFromRing)
    .filter((item): item is LinuxDoTrustMetric => Boolean(item))

  const participation = Array.from(card.querySelectorAll('.tl3-bar-item'))
    .map((item) => metricFromPair(item, '.tl3-bar-label', '.tl3-bar-nums'))
    .filter((item): item is LinuxDoTrustMetric => Boolean(item))

  const compliance = Array.from(card.querySelectorAll('.tl3-quota-card'))
    .map((item) => metricFromPair(item, '.tl3-quota-label', '.tl3-quota-nums'))
    .filter((item): item is LinuxDoTrustMetric => Boolean(item))

  const vetoes = Array.from(card.querySelectorAll('.tl3-veto-item'))
    .map(vetoFromElement)
    .filter((item): item is LinuxDoTrustVeto => Boolean(item))

  if (!activity.length || !participation.length || !compliance.length || !vetoes.length) {
    throw new LinuxDoConnectError('parse', 'Connect 页面结构发生变化，无法完整读取信任等级数据')
  }

  return {
    title,
    targetLevel,
    username,
    periodLabel,
    achieved,
    statusLabel,
    activity,
    participation,
    compliance,
    vetoes,
    footnote: findFootnote(card),
    resultText: findResultText(card, achieved, targetLevel),
    fetchedAt,
  }
}
