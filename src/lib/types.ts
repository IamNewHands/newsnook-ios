import type { SourceGroup } from '../sources/registry'
import type { FeedBodyEvidence } from './feedBodyEvidence'

export type ArticleContentType = 'article' | 'video'

export interface Article {
  id: string
  title: string
  summary: string
  contentHtml?: string
  /** Small source-independent evidence, persisted when list HTML is compacted. */
  feedBodyEvidence?: FeedBodyEvidence
  image?: string
  /** 上游给出的发布时间，缺失时为抓取时间 */
  publishedAt: number
  /** 上游是否真的提供了时间，用于界面上区分「约」 */
  hasRealDate: boolean
  sourceId: string
  sourceName: string
  sourceLabel: string
  sourceGroup: SourceGroup
  originUrl: string
  contentType?: ArticleContentType
  /** 网易等视频条目的可播放地址 */
  videoUrl?: string
  /** RSS enclosure / 正文 <audio> 的可播放地址；图文稿仍走 article，不改 contentType */
  audioUrl?: string
  /** 网易正文接口用的稳定 docid / postid */
  neteaseDocId?: string
}

export type FetchState = 'idle' | 'loading' | 'ready' | 'error'

export interface SourceStatus {
  sourceId: string
  state: FetchState
  count: number
  error?: string
  fetchedAt?: number
}

export interface RefreshProgress {
  total: number
  completed: number
  synced: number
  pendingSourceIds: string[]
}
