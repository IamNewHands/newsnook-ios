import { sanitizeArticleHtml } from '../../../lib/sanitize'

/** 展示层清洗；编辑原始正文不得调用此函数覆盖源数据。 */
export function normalizeZhihuContentHtml(rawHtml: string): string {
  if (!rawHtml.trim()) return ''
  return sanitizeArticleHtml(rawHtml)
}
