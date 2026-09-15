import { ZhihuApiError } from '../api/errors'
import type { ZhihuDraftStore } from './draftStore'
import {
  buildAnswerDraftPayload,
  buildAnswerPublishPayload,
  buildPinDraftPayload,
  buildPinPublishPayload,
  parseExistingAnswerId,
  parsePublishedContentId,
} from './codec'
import { createZhihuLocalId, type ZhihuDraftSnapshot } from './schema'

export type ZhihuPublishResult =
  | { status: 'confirmed'; operationId: string; contentId: string }
  | { status: 'failed'; operationId: string; error: string }
  | { status: 'unknown'; operationId: string; error: string }

export interface ZhihuEditorApi {
  getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown>
  requestRawJson(
    operation: string,
    url: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown>
}

function isUnknownWriteFailure(error: unknown): boolean {
  if (!(error instanceof ZhihuApiError)) return true
  return error.code === 'network' && (error.status === undefined || error.status >= 500)
}

export class ZhihuEditorService {
  private readonly api: ZhihuEditorApi
  private readonly drafts: ZhihuDraftStore

  constructor(api: ZhihuEditorApi, drafts: ZhihuDraftStore) {
    this.api = api
    this.drafts = drafts
  }

  async saveRemoteDraft(input: ZhihuDraftSnapshot): Promise<ZhihuDraftSnapshot> {
    const fixed = structuredClone(input)
    const locallySaved = await this.drafts.save(fixed)
    if (locallySaved.assets.some((asset) => asset.uploadState !== 'ready')) {
      throw new Error('仍有图片资源未完成上传，不能写入远端草稿')
    }
    if (locallySaved.kind === 'answer') {
      if (!locallySaved.targetId) throw new Error('回答草稿缺少 questionId')
      await this.api.requestRawJson(
        'draft.answer.save',
        `https://www.zhihu.com/api/v4/questions/${encodeURIComponent(locallySaved.targetId)}/draft`,
        'POST',
        JSON.stringify(buildAnswerDraftPayload(locallySaved)),
        {
          'Content-Type': 'application/json',
          Referer: `https://www.zhihu.com/question/${encodeURIComponent(locallySaved.targetId)}`,
        },
      )
    } else {
      await this.api.requestRawJson(
        'draft.pin.save',
        'https://api.zhihu.com/content/drafts',
        'POST',
        JSON.stringify(buildPinDraftPayload(locallySaved)),
        { 'Content-Type': 'application/json', Referer: 'https://www.zhihu.com/' },
      )
    }
    return this.mergePublishMetadata(locallySaved, { publishState: 'remote-draft' })
  }

  async publish(input: ZhihuDraftSnapshot): Promise<ZhihuPublishResult> {
    // 固定发布快照：调用方提交后即使继续编辑，新 revision 也不会被旧响应覆盖正文。
    const fixed = structuredClone(input)
    const locallySaved = await this.drafts.save(fixed)
    const operationId = createZhihuLocalId('publish')
    if (!locallySaved.document.text.trim() && !locallySaved.document.html.trim() && locallySaved.assets.length === 0) {
      return { status: 'failed', operationId, error: '内容为空' }
    }
    if (locallySaved.assets.some((asset) => asset.uploadState !== 'ready')) {
      return { status: 'failed', operationId, error: '仍有媒体资源未完成上传' }
    }
    await this.mergePublishMetadata(locallySaved, { publishState: 'publishing', publishOperationId: operationId })

    try {
      let raw: unknown
      if (locallySaved.kind === 'answer') {
        if (!locallySaved.targetId) throw new Error('回答缺少 questionId')
        const relationship = await this.api.getJson(
          'answer.relationship',
          `https://api.zhihu.com/questions/${encodeURIComponent(locallySaved.targetId)}?include=relationship,relationship.my_answer`,
        )
        const existingAnswerId = parseExistingAnswerId(relationship)
        // 发布前按计划先写远端草稿。这个写也只调用一次。
        await this.api.requestRawJson(
          'draft.answer.save',
          `https://www.zhihu.com/api/v4/questions/${encodeURIComponent(locallySaved.targetId)}/draft`,
          'POST',
          JSON.stringify(buildAnswerDraftPayload(locallySaved)),
          { 'Content-Type': 'application/json', Referer: `https://www.zhihu.com/question/${encodeURIComponent(locallySaved.targetId)}` },
        )
        raw = await this.api.requestRawJson(
          'answer.publish',
          'https://www.zhihu.com/api/v4/content/publish',
          'POST',
          JSON.stringify(buildAnswerPublishPayload(locallySaved, existingAnswerId)),
          { 'Content-Type': 'application/json', Referer: 'https://www.zhihu.com/' },
        )
      } else {
        await this.api.requestRawJson(
          'draft.pin.save',
          'https://api.zhihu.com/content/drafts',
          'POST',
          JSON.stringify(buildPinDraftPayload(locallySaved)),
          { 'Content-Type': 'application/json', Referer: 'https://www.zhihu.com/' },
        )
        raw = await this.api.requestRawJson(
          'pin.publish',
          'https://www.zhihu.com/api/v4/content/publish',
          'POST',
          JSON.stringify(buildPinPublishPayload(locallySaved)),
          { 'Content-Type': 'application/json', Referer: 'https://www.zhihu.com/' },
        )
      }
      const contentId = parsePublishedContentId(raw)
      await this.mergePublishMetadata(locallySaved, {
        publishState: 'published',
        publishOperationId: operationId,
        publishedContentId: contentId,
      })
      return { status: 'confirmed', operationId, contentId }
    } catch (error) {
      const message = error instanceof Error ? error.message : '知乎发布失败'
      const unknown = isUnknownWriteFailure(error)
      await this.mergePublishMetadata(locallySaved, {
        publishState: unknown ? 'unknown' : 'failed',
        publishOperationId: operationId,
      })
      return unknown
        ? { status: 'unknown', operationId, error: message }
        : { status: 'failed', operationId, error: message }
    }
  }

  private async mergePublishMetadata(
    submitted: ZhihuDraftSnapshot,
    metadata: Partial<Pick<ZhihuDraftSnapshot, 'publishState' | 'publishOperationId' | 'publishedContentId'>>,
  ): Promise<ZhihuDraftSnapshot> {
    const latest = await this.drafts.get(submitted.accountId, submitted.localDraftId) ?? submitted
    // 正文永远取 latest；这里只合并远端状态，避免旧 publish 响应覆盖用户提交期间的继续编辑。
    return this.drafts.save({ ...latest, ...metadata })
  }
}
