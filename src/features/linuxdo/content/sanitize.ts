import { sanitizeArticleHtml } from '../../../lib/sanitize'

export function sanitizeLinuxDoCooked(html: string): string {
  return sanitizeArticleHtml(html)
}
