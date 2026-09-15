import type { ZhihuEntityRef } from '../types'
import { assertZhihuUrl } from '../transport/safeRead'

const WWW = 'https://www.zhihu.com'
const API = 'https://api.zhihu.com'

export function zhihuRecommendedUrl(): string {
  return `${API}/topstory/recommend`
}

export function zhihuHotUrl(): string {
  return `${WWW}/api/v3/feed/topstory/hot-lists/total`
}

export function zhihuSearchUrl(query: string, offset = 0, limit = 20): string {
  const url = new URL(`${WWW}/api/v4/search_v3`)
  url.searchParams.set('t', 'general')
  url.searchParams.set('q', query)
  url.searchParams.set('offset', String(Math.max(0, offset)))
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
  return url.href
}

export function zhihuQuestionAnswersUrl(questionId: string, offset = 0, limit = 20): string {
  const url = new URL(`${WWW}/api/v4/questions/${encodeURIComponent(questionId)}/answers`)
  url.searchParams.set('offset', String(Math.max(0, offset)))
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
  url.searchParams.set('sort_by', 'default')
  return url.href
}

export function zhihuEntityUrl(ref: ZhihuEntityRef): string | null {
  const id = encodeURIComponent(ref.id)
  switch (ref.kind) {
    case 'answer': return `${WWW}/api/v4/answers/${id}`
    case 'article': return `${WWW}/api/v4/articles/${id}`
    case 'question': return `${WWW}/api/v4/questions/${id}`
    case 'pin': return `${WWW}/api/v4/pins/${id}`
    case 'people': return `${WWW}/api/v4/members/${id}`
    default: return null
  }
}

export function validateZhihuCursor(cursor: string): string {
  return assertZhihuUrl(cursor).href
}
