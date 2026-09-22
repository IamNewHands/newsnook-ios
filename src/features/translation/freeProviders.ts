import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { mapConcurrent } from '../../lib/asyncPool'
import { fetchAbsoluteText } from '../../lib/http'

/**
 * 免费通道：**不填 API Key** 时走浏览器内置翻译所用的同一批端点。
 *
 * - Google：`translate_a/single`（Chrome / Edge 内置翻译调的就是它，无需密钥）。
 * - Microsoft：`edge.microsoft.com/translate/translatetext`（Edge 自己的无鉴权翻译接口，
 *   一次可送多段，无需令牌）。
 *
 * 两者都是厂商给自家浏览器用的端点，没有公开 SLA：可能限速（429）或随时变更。
 * 因此定位是「开箱可用」的兜底——在设置里填入自己的 Key 就会自动改走官方 API。
 * 另外 Google 通道在部分网络（例如中国大陆）不可达，那种情况下请用 Microsoft 通道。
 *
 * 历史：Microsoft 免密钥通道原先走 `edge.microsoft.com/translate/auth` 取短期令牌再调
 * `api-edge.cognitive.microsofttranslator.com`。该 auth 端点已被微软下线（实测 404），
 * 所以改成 Edge 136+ 在用的无鉴权 `translatetext`。
 *
 * 放在单独文件里而不是并进 providers.ts：iOS 补丁层要能被上游新版本干净地
 * cherry-pick，改动越集中越好。这里的少量重复（GET/POST 与 JSON 纠正）
 * 就是为了不让 providers.ts 反向依赖本文件形成循环引用。
 */

/** Chrome 系内置翻译使用的无密钥端点。 */
const GOOGLE_FREE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
/** Edge 内置翻译的无鉴权端点（Edge 136+ 在用；旧的 auth 令牌端点已下线）。 */
const EDGE_TRANSLATE_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'
/**
 * 该接口是 Edge 浏览器自用端点，带上 Edge 的 UA 才稳妥
 * （与 bing-translate-api 保持一致）。
 */
const EDGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0'

const CONNECT_TIMEOUT_MS = 15_000
const READ_TIMEOUT_MS = 45_000
/** 免费端点按 IP 限速，并发刻意低于官方 API 的批处理并发。 */
const GOOGLE_FREE_CONCURRENCY = 3

function statusFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error)
  const match = /HTTP (\d{3})/.exec(message)
  return match ? Number(match[1]) : null
}

function freeChannelError(label: string, error: unknown): Error {
  const status = statusFromError(error)
  if (status === 429) {
    return new Error(
      `${label} 免费通道被限速（429），请稍后重试，或在设置里填入自己的 API Key 走官方接口。`,
    )
  }
  if (status != null) {
    return new Error(`${label} 免费通道请求失败（HTTP ${status}），可填入 API Key 走官方接口。`)
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${label} 免费通道不可用：${detail}。可填入 API Key 走官方接口。`)
}

/**
 * 解析 gtx 端点的响应：
 * `[[["译文","原文",null,null,10],["续段","原文",...]],null,"en",...]`
 * 译文可能被切成多段，需要按顺序拼回；非数组项（音译 / 词典）跳过。
 */
export function parseGoogleFreeResponse(payload: string): string {
  let data: unknown
  try {
    data = JSON.parse(payload) as unknown
  } catch {
    throw new Error('Google Translate 免费通道返回了无法解析的内容')
  }
  const segments = Array.isArray(data) ? data[0] : null
  if (!Array.isArray(segments)) throw new Error('Google Translate 免费通道返回格式异常')
  let translated = ''
  for (const segment of segments) {
    if (!Array.isArray(segment)) continue
    const piece = segment[0]
    if (typeof piece === 'string') translated += piece
  }
  if (!translated) throw new Error('Google Translate 免费通道没有返回译文')
  return translated
}

/**
 * gtx 端点对同一请求里的多个 `q` 返回结构不稳定，所以一次只送一段，
 * 靠受控并发补吞吐。
 */
export async function translateGoogleFreeBatch(
  texts: string[],
  source: string | undefined,
  target: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return mapConcurrent(
    texts,
    GOOGLE_FREE_CONCURRENCY,
    async (text) => {
      const params = new URLSearchParams({
        client: 'gtx',
        sl: source ?? 'auto',
        tl: target,
        dt: 't',
        q: text,
      })
      try {
        const payload = await fetchAbsoluteText(`${GOOGLE_FREE_ENDPOINT}?${params.toString()}`, {
          signal,
          accept: 'application/json',
        })
        return parseGoogleFreeResponse(payload)
      } catch (error) {
        throw freeChannelError('Google Translate', error)
      }
    },
    signal,
  )
}

/** CapacitorHttp 在部分 Content-Type 下把 JSON 当字符串返回；Web fetch 则已 parse。 */
function coerceJsonData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const trimmed = data.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return data
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return data
  }
}

/**
 * 免费通道的 POST 直连（不走 lib/http 的页面代理）：Edge 的 `translatetext` 端点
 * 不接受自建域名/区域参数，所以这里不暴露 endpoint 配置。
 */
async function postJsonDirect(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; data: unknown }> {
  if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError')

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': EDGE_USER_AGENT,
        ...headers,
      },
      data: body,
      connectTimeout: CONNECT_TIMEOUT_MS,
      readTimeout: READ_TIMEOUT_MS,
    })
    return { status: response.status, data: coerceJsonData(response.data) }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': EDGE_USER_AGENT,
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  })
  const data = (await response.json().catch(() => null)) as unknown
  return { status: response.status, data }
}

/**
 * Edge 的 `translatetext` 接口：请求体是**字符串数组**，响应是逐条对应的对象数组
 * （`[{ detectedLanguage, translations: [{ text, to }] }]`）。不需要任何令牌。
 */
export async function translateAzureFreeBatch(
  texts: string[],
  source: string | undefined,
  target: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = new URL(EDGE_TRANSLATE_ENDPOINT)
  url.searchParams.set('to', target)
  if (source) url.searchParams.set('from', source)
  url.searchParams.set('isEnterpriseClient', 'false')

  let response: { status: number; data: unknown }
  try {
    response = await postJsonDirect(url.toString(), texts, {}, signal)
  } catch (error) {
    throw freeChannelError('Microsoft Translator', error)
  }

  if (response.status < 200 || response.status >= 300) {
    throw freeChannelError('Microsoft Translator', new Error(`HTTP ${response.status}`))
  }

  if (!Array.isArray(response.data)) {
    throw new Error('Microsoft Translator 免费通道返回格式异常')
  }
  return (response.data as { translations?: { text?: string }[] }[]).map(
    (item) => item.translations?.[0]?.text ?? '',
  )
}
