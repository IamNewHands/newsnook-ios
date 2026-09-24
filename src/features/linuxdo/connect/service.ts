import { Capacitor } from '@capacitor/core'

import { fetchLinuxDoConnectTrustPage } from '../session/native'
import { parseLinuxDoConnectTrustPage } from './parser'
import { LinuxDoConnectError, type LinuxDoTrustLevelData } from './types'

const CACHE_TTL_MS = 5 * 60 * 1000

let cache: LinuxDoTrustLevelData | null = null

function normalizeUsername(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

export class LinuxDoConnectService {
  clearCache(): void {
    cache = null
  }

  async trustLevel(expectedUsername?: string, force = false): Promise<LinuxDoTrustLevelData> {
    if (!Capacitor.isNativePlatform()) {
      throw new LinuxDoConnectError('unsupported', '信任等级数据需要在 NewsNook App 中查看')
    }

    const expected = normalizeUsername(expectedUsername)
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      if (!expected || (cache.username && normalizeUsername(cache.username) === expected)) return cache
    }

    let response: Awaited<ReturnType<typeof fetchLinuxDoConnectTrustPage>>
    try {
      response = await fetchLinuxDoConnectTrustPage()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connect 网络请求失败'
      throw new LinuxDoConnectError('network', message)
    }

    if (response.status === 429) {
      throw new LinuxDoConnectError('rate-limited', 'Connect 请求过于频繁，请稍后再试', response.status)
    }
    if (response.status === 401 || response.status === 403) {
      throw new LinuxDoConnectError('auth-required', 'Connect 登录状态已失效，请重新登录 Linux.do', response.status)
    }
    if (response.status < 200 || response.status >= 300) {
      throw new LinuxDoConnectError('network', `Connect 返回 HTTP ${response.status}`, response.status)
    }

    const data = parseLinuxDoConnectTrustPage(response.data)
    if (expected && !data.username) {
      cache = null
      throw new LinuxDoConnectError('parse', 'Connect 页面未返回账号信息，无法安全确认当前账号')
    }
    if (expected && data.username && normalizeUsername(data.username) !== expected) {
      cache = null
      throw new LinuxDoConnectError(
        'account-mismatch',
        `Connect 当前账号 @${data.username} 与 NewsNook 登录账号不一致，请重新登录后再试`,
      )
    }

    cache = data
    return data
  }
}

export const linuxDoConnect = new LinuxDoConnectService()
