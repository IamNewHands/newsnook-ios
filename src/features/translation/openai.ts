import { Capacitor, CapacitorHttp } from '@capacitor/core'

import type { CloudTranslationConfig } from './types'

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Normalize OpenAI-compatible base URL; strip accidental `/chat/completions`. */
export function normalizeOpenAiBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed) return ''
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return stripTrailingSlashes(trimmed)
  }
  let path = parsed.pathname.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(path)) {
    path = path.replace(/\/chat\/completions$/i, '')
  }
  parsed.pathname = path || '/'
  return stripTrailingSlashes(parsed.toString())
}

export function assertOpenAiEndpointAndKey(config: CloudTranslationConfig): string {
  if (!config.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!config.endpoint.trim()) throw new Error('请先填写 API 地址')
  const base = normalizeOpenAiBaseUrl(config.endpoint)
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error('API 地址格式不正确')
  }
  if (parsed.protocol !== 'https:') throw new Error('为保护 API Key，API 地址必须使用 HTTPS')
  return base
}

export function assertOpenAiConfig(config: CloudTranslationConfig): string {
  const base = assertOpenAiEndpointAndKey(config)
  if (!config.model?.trim()) throw new Error('请先填写 Model')
  return base
}

const WRAP_TAG = 'source_text|translation|translated_text|target_text|target|result'
const TRAILING_HTML_TAG = /(?:\s*<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^>]*)?>)+\s*$/
/** Hunyuan EOS uses fullwidth ｜ and ▁; gateways may also emit ASCII | and underscores. */
const TRAILING_SPECIAL_TOKEN = /(?:\s*<\s*[|｜]\s*[^>]*?[|｜]\s*>)+\s*$/u
const LEADING_WRAP = new RegExp(`^<(?:${WRAP_TAG})>\\s*`, 'i')
const TRAILING_WRAP = new RegExp(`\\s*</(?:${WRAP_TAG})>\\s*$`, 'i')

export const OPENAI_TRANSLATION_STOP = [
  '</target_text>',
  '</target>',
  '<｜hy_end',
  '<|hy_end',
]

export function cleanOpenAiTranslation(content: string): string {
  let text = content.trim()

  for (let i = 0; i < 8; i++) {
    const before = text

    const tagMatch = text.match(
      new RegExp(`^<(?:${WRAP_TAG})>([\\s\\S]*?)</(?:${WRAP_TAG})>$`, 'i'),
    )
    if (tagMatch) text = tagMatch[1].trim()

    const fence = text.match(/^```(?:\w+)?\r?\n([\s\S]*?)\r?\n```$/)
    if (fence) text = fence[1].trim()

    text = text.replace(/^(?:Translation|Translated(?:\s+text)?|译文|翻译结果)\s*[:：]\s*/i, '').trim()

    if (
      (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
      (text.startsWith("'") && text.endsWith("'") && text.length >= 2) ||
      (text.startsWith('“') && text.endsWith('”') && text.length >= 2)
    ) {
      text = text.slice(1, -1).trim()
    }

    text = text.replace(LEADING_WRAP, '').trim()
    text = text.replace(TRAILING_WRAP, '').trim()
    text = text.replace(TRAILING_SPECIAL_TOKEN, '').trim()
    text = text.replace(TRAILING_HTML_TAG, '').trim()

    if (text === before) break
  }
  return text
}

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

/** CapacitorHttp 可能返回 JSON 字符串；也兼容 content 为 parts 数组。 */
export function extractOpenAiChatContent(data: unknown): string | null {
  const payload = coerceJsonData(data) as {
    choices?: {
      message?: { content?: unknown }
      text?: string
    }[]
  } | null
  if (!payload || typeof payload !== 'object') return null

  const choice = payload.choices?.[0]
  if (!choice) return null

  const content = choice.message?.content ?? choice.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return null
}

interface JsonResponse {
  status: number
  data: unknown
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<JsonResponse> {
  if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError')

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: 15000,
      readTimeout: 45000,
    })
    return { status: response.status, data: coerceJsonData(response.data) }
  }

  const response = await fetch(url, { method: 'GET', headers, signal })
  const data = (await response.json().catch(() => null)) as unknown
  return { status: response.status, data: coerceJsonData(data) }
}

function listErrorMessage(response: JsonResponse): Error {
  const data = response.data as {
    error?: { message?: string }
    message?: string
  } | null
  const detail = data?.error?.message ?? data?.message
  return new Error(detail ? `AI 翻译：${detail}` : `AI 翻译：请求失败（HTTP ${response.status}）`)
}

/** List model ids from `{base}/models`. Does not require `config.model`. */
export async function listOpenAiModels(
  config: CloudTranslationConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = assertOpenAiEndpointAndKey(config)
  const response = await getJson(
    `${base}/models`,
    { Authorization: `Bearer ${config.apiKey.trim()}` },
    signal,
  )
  if (response.status < 200 || response.status >= 300) throw listErrorMessage(response)
  const payload = response.data as { data?: { id?: string }[] }
  const ids = (payload.data ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
    .filter(Boolean)
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
