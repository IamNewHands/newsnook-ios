import { asRecord } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type { ZhihuDraftSnapshot } from './schema'

function publishTraceId(): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`
  return `${Date.now()},${id}`
}

function answerSettings() {
  return {
    reshipment_settings: 'allowed',
    comment_permission: 'all',
    can_reward: false,
    tagline: '',
    disclaimer_status: 'close',
    disclaimer_type: 'none',
    commercial_report_info: { is_report: true },
    push_activity: false,
    table_of_contents_enabled: false,
    thank_inviter_status: 'close',
    thank_inviter: '',
  }
}

export function buildAnswerDraftPayload(snapshot: ZhihuDraftSnapshot): unknown {
  if (snapshot.kind !== 'answer' || !snapshot.targetId) throw new Error('回答草稿缺少 questionId')
  return {
    content: snapshot.document.html,
    draft_type: 'normal',
    delta_time: 30,
    settings: answerSettings(),
  }
}

export function buildAnswerPublishPayload(snapshot: ZhihuDraftSnapshot, existingAnswerId?: string): unknown {
  if (snapshot.kind !== 'answer' || !snapshot.targetId) throw new Error('回答发布缺少 questionId')
  const pcBusinessParams = JSON.stringify({
    reshipment_settings: 'allowed',
    comment_permission: 'all',
    reward_setting: { can_reward: false },
    disclaimer_status: 'close',
    disclaimer_type: 'none',
    commercial_report_info: { is_report: false },
    commercial_zhitask_bind_info: null,
    is_report: false,
    table_of_contents_enabled: false,
    thank_inviter_status: 'close',
    thank_inviter: '',
  })
  return {
    action: 'answer',
    data: {
      publish: { traceId: publishTraceId() },
      hybridInfo: {},
      draft: {
        disabled: 1,
        isPublished: Boolean(existingAnswerId),
        ...(existingAnswerId ? { contentId: existingAnswerId } : {}),
      },
      extra_info: {
        question_id: snapshot.targetId,
        publisher: 'pc',
        include: '',
        pc_business_params: pcBusinessParams,
      },
      hybrid: { html: snapshot.document.html },
      reprint: { reshipment_settings: 'allowed' },
      commentsPermission: { comment_permission: 'all' },
      appreciate: { can_reward: false },
      publishSwitch: { draft_type: 'normal' },
      creationStatement: { disclaimer_status: 'close', disclaimer_type: 'none' },
      commercialReportInfo: { isReport: 0 },
      toFollower: {},
      contentsTables: { table_of_contents_enabled: false },
      thanksInvitation: { thank_inviter_status: 'close', thank_inviter: '' },
    },
  }
}

export function buildPinPayload(snapshot: ZhihuDraftSnapshot): unknown {
  if (snapshot.kind !== 'pin') throw new Error('想法 payload 类型不匹配')
  const data: Record<string, unknown> = {
    publish: { traceId: publishTraceId() },
    commentsPermission: { comment_permission: 'all' },
    extra_info: { view_permission: 'all', publisher: 'pc' },
    draft: { disabled: 1 },
  }
  const title = snapshot.title?.trim()
  if (title) data.title = { title }
  if (snapshot.document.html.trim()) {
    data.hybrid = {
      html: snapshot.document.html,
      textLength: snapshot.document.text.length,
    }
  }
  const images = snapshot.assets.filter((asset) => asset.uploadState === 'ready' && asset.remoteUrl)
  if (images.length > 0) {
    data.media = {
      medias: images.map((asset) => ({
        image: {
          height: asset.height ?? 0,
          width: asset.width ?? 0,
          url: asset.remoteUrl,
          originalUrl: asset.remoteOriginalUrl ?? asset.remoteUrl,
          ...(asset.watermarkMode ? { watermark: asset.watermarkMode } : {}),
          ...(asset.remoteWatermarkUrl ? { watermarkUrl: asset.remoteWatermarkUrl } : {}),
        },
      })),
    }
  }
  return data
}

export function buildPinDraftPayload(snapshot: ZhihuDraftSnapshot): unknown {
  return { action: 'pin', data: buildPinPayload(snapshot) }
}

export function buildPinPublishPayload(snapshot: ZhihuDraftSnapshot): unknown {
  return { action: 'pin', data: buildPinPayload(snapshot) }
}

export function parseExistingAnswerId(value: unknown): string | undefined {
  const root = asRecord(value)
  const relationship = asRecord(root?.relationship)
  const myAnswer = asRecord(relationship?.my_answer)
  if (myAnswer?.is_deleted === true) return undefined
  const id = myAnswer?.answer_id
  if (typeof id === 'string' && id) return id
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return undefined
}

export function parsePublishedContentId(value: unknown): string {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎发布响应不是 JSON object')
  if (root.message !== 'success') {
    const message = typeof root.message === 'string' ? root.message : '知乎没有确认发布成功'
    throw new ZhihuApiError(root.code === 103003 ? 'conflict' : 'invalid-response', message)
  }
  const data = asRecord(root.data)
  const result = data?.result
  let parsed: Record<string, unknown> | null = null
  if (typeof result === 'string') {
    try {
      parsed = asRecord(JSON.parse(result))
    } catch {
      parsed = null
    }
  } else {
    parsed = asRecord(result)
  }
  const publish = asRecord(parsed?.publish)
  const id = publish?.id ?? parsed?.id
  if (typeof id === 'string' && id) return id
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  throw new ZhihuApiError('invalid-response', '知乎返回成功但缺少发布后的内容 id')
}
