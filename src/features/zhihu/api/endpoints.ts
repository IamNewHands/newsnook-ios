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

export type ZhihuSearchTab = 'general' | 'people' | 'topic'
export type ZhihuSearchSort = 'default' | 'latest' | 'most-voted'
export type ZhihuSearchContentType = 'all' | 'answer' | 'article'
export type ZhihuSearchTimeRange = 'all' | 'day' | 'week' | 'month' | 'three-months' | 'half-year' | 'year'

export interface ZhihuSearchOptions {
  tab?: ZhihuSearchTab
  sort?: ZhihuSearchSort
  contentType?: ZhihuSearchContentType
  timeRange?: ZhihuSearchTimeRange
  restrictedMemberHashId?: string
}

const SEARCH_SORT: Record<ZhihuSearchSort, string> = {
  default: '',
  latest: 'created_time',
  'most-voted': 'upvoted_count',
}

const SEARCH_CONTENT: Record<ZhihuSearchContentType, string> = {
  all: '',
  answer: 'answer',
  article: 'article',
}

const SEARCH_TIME: Record<ZhihuSearchTimeRange, string> = {
  all: '',
  day: 'a_day',
  week: 'a_week',
  month: 'a_month',
  'three-months': 'three_months',
  'half-year': 'half_a_year',
  year: 'a_year',
}

export function zhihuSearchUrl(
  query: string,
  offset = 0,
  limit = 20,
  options: ZhihuSearchOptions = {},
): string {
  const tab = options.tab ?? 'general'
  const sort = tab === 'general' ? options.sort ?? 'default' : 'default'
  const contentType = tab === 'general' ? options.contentType ?? 'all' : 'all'
  const timeRange = tab === 'general' ? options.timeRange ?? 'all' : 'all'
  const filtered = sort !== 'default' || contentType !== 'all' || timeRange !== 'all'
  const url = new URL(`${WWW}/api/v4/search_v3`)
  url.searchParams.set('gk_version', 'gz-gaokao')
  url.searchParams.set('t', tab)
  url.searchParams.set('q', query)
  url.searchParams.set('correction', '1')
  url.searchParams.set('offset', String(Math.max(0, offset)))
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
  url.searchParams.set('search_source', filtered ? 'Filter' : 'Normal')
  url.searchParams.set('show_all_topics', tab === 'topic' ? '1' : '0')
  const restricted = options.restrictedMemberHashId?.trim()
  if (restricted) {
    url.searchParams.set('filter_fields', '')
    url.searchParams.set('lc_idx', '0')
    url.searchParams.set('restricted_scene', 'member')
    url.searchParams.set('restricted_field', 'member_hash_id')
    url.searchParams.set('restricted_value', restricted)
  }
  if (SEARCH_CONTENT[contentType]) {
    url.searchParams.set('vertical', SEARCH_CONTENT[contentType])
    url.searchParams.set('vertical_info', '0,0,0,0,0,0,0,0,0,0,0,0')
  }
  if (SEARCH_SORT[sort]) url.searchParams.set('sort', SEARCH_SORT[sort])
  if (SEARCH_TIME[timeRange]) url.searchParams.set('time_interval', SEARCH_TIME[timeRange])
  return url.href
}

export type ZhihuQuestionAnswerOrder = 'default' | 'updated'

export function zhihuQuestionAnswersUrl(
  questionId: string,
  order: ZhihuQuestionAnswerOrder = 'default',
  limit = 20,
): string {
  const url = new URL(`${WWW}/api/v4/questions/${encodeURIComponent(questionId)}/feeds`)
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
  url.searchParams.set('order', order)
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
