import { md5Hex } from '../../../lib/hash'
import LAESUtils from './vendor/laes_utils.js'
import { encryptConf, encryptIv, encryptKey } from './vendor/zse96_config.js'

export const ZHIHU_WEB_ZSE93 = '101_3_3.0'

let encryptor: ((input: string) => string) | null = null

function utf8AsLatin1(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return out
}

function md5Utf8(value: string): string {
  // src/lib/hash 的 md5Hex 接受字节语义的 latin1 string；这里显式 UTF-8 编码，
  // 避免中文 JSON body 因 charCode 截断而产生错误签名。
  return md5Hex(utf8AsLatin1(value))
}

function getEncryptor(): (input: string) => string {
  if (encryptor) return encryptor
  const laes = new LAESUtils(encryptConf, null)
  encryptor = laes.createEncryptor(encryptKey, encryptIv)
  return encryptor
}

export function zhihuSigningPath(rawUrl: string): string {
  const url = new URL(rawUrl)
  return `${url.pathname}${url.search}`
}

/**
 * 当前 Web fetch 签名源：zse93 + pathname/query + d_c0 + optional body。
 * method 不参与这一版 Web 签名；body 必须与实际发送的 JSON 字符串逐字节一致。
 */
export function zhihuSignSource(
  rawUrl: string,
  dc0: string,
  body?: string,
  zse93 = ZHIHU_WEB_ZSE93,
): string {
  const parts = [zse93, zhihuSigningPath(rawUrl), dc0]
  if (body !== undefined) parts.push(body)
  return parts.join('+')
}

export function createZhihuZse96(
  rawUrl: string,
  dc0: string,
  body?: string,
  zse93 = ZHIHU_WEB_ZSE93,
): string {
  const digest = md5Utf8(zhihuSignSource(rawUrl, dc0, body, zse93))
  return `2.0_${getEncryptor()(digest)}`
}

export function buildZhihuZseHeaders(
  rawUrl: string,
  dc0: string,
  body?: string,
): Record<string, string> {
  return {
    'x-zse-93': ZHIHU_WEB_ZSE93,
    'x-zse-96': createZhihuZse96(rawUrl, dc0, body),
    'x-requested-with': 'fetch',
  }
}
