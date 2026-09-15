import type { ZhihuApiClient } from '../api/client'
import { decodeZhihuContentDetail, type ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { zhihuEntityUrl } from '../api/endpoints'
import type { ZhihuEntityRef } from '../types'

function operationFor(ref: ZhihuEntityRef): string | null {
  switch (ref.kind) {
    case 'answer': return 'answer.read'
    case 'article': return 'article.read'
    case 'question': return 'question.read'
    case 'pin': return 'pin.read'
    case 'people': return 'people.read'
    default: return null
  }
}

export class ZhihuContentService {
  private readonly api: Pick<ZhihuApiClient, 'getJson'>

  constructor(api: Pick<ZhihuApiClient, 'getJson'>) {
    this.api = api
  }

  async read(ref: ZhihuEntityRef, signal?: AbortSignal): Promise<ZhihuContentDetail> {
    const operation = operationFor(ref)
    const url = zhihuEntityUrl(ref)
    if (!operation || !url) throw new ZhihuApiError('unsupported', `暂不支持读取 ${ref.kind}`)
    const raw = await this.api.getJson(operation, url, signal)
    return decodeZhihuContentDetail(raw)
  }
}
