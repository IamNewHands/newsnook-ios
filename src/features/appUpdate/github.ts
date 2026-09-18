import { CapacitorHttp } from '@capacitor/core'

import {
  fetchUpdateManifest,
  releaseFromUpdateManifest,
  updateCheckFromManifest,
} from './cdn'
import { isNewerVersion, normalizeTagVersion } from './semver'
import type {
  AppUpdateChannel,
  FetchReleaseApkResult,
  ReleaseNotesResult,
  UpdateCheckResult,
} from './types'

export function buildApkFileName(version: string, channel: AppUpdateChannel): string {
  return `newsnook-${version}-${channel}-release.apk`
}

type GitHubAsset = {
  name: string
  browser_download_url: string
  digest?: string | null
  size?: number
}

type PickedReleaseAsset = {
  url: string
  fileName: string
  sha256?: string
  size?: number
}

function githubSha256(digest: string | null | undefined): string | undefined {
  if (!digest) return undefined
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())
  return match?.[1]?.toLowerCase()
}

export function pickReleaseAsset(
  assets: GitHubAsset[],
  version: string,
  channel: AppUpdateChannel,
): PickedReleaseAsset | null {
  const fileName = buildApkFileName(version, channel)
  const hit = assets.find((a) => a.name === fileName)
  if (!hit?.browser_download_url) return null

  const picked: PickedReleaseAsset = { url: hit.browser_download_url, fileName }
  const sha256 = githubSha256(hit.digest)
  if (sha256) picked.sha256 = sha256
  if (typeof hit.size === 'number' && Number.isSafeInteger(hit.size) && hit.size > 0) {
    picked.size = hit.size
  }
  return picked
}

export function truncateReleaseNotes(body: string | null | undefined, maxLines = 8): string {
  const text = (body ?? '').trim()
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  if (lines.length <= maxLines) return text
  return `${lines.slice(0, maxLines).join('\n')}\n…`
}

const RELEASES_LATEST = 'https://api.github.com/repos/t59688/newsnook/releases/latest'
const RELEASES_TAG_PREFIX = 'https://api.github.com/repos/t59688/newsnook/releases/tags/'

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'NewsNook-AppUpdate',
}

export function releaseTagUrl(version: string): string {
  const normalized = normalizeTagVersion(version)
  return `https://github.com/t59688/newsnook/releases/tag/v${normalized}`
}

async function fetchReleaseNotesFromGitHub(version: string): Promise<ReleaseNotesResult> {
  try {
    const response = await CapacitorHttp.get({
      url: `${RELEASES_TAG_PREFIX}v${encodeURIComponent(version)}`,
      headers: GITHUB_HEADERS,
    })
    if (response.status === 404) {
      return { status: 'error', message: '未找到该版本的发布说明' }
    }
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `GitHub HTTP ${response.status}` }
    }
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const tagName = String(data.tag_name ?? `v${version}`)
    const body = typeof data.body === 'string' ? data.body.trim() : ''
    if (!body) return { status: 'empty', version, tagName }
    return { status: 'ok', version, tagName, body }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '加载更新日志失败',
    }
  }
}

/** 优先从 R2 最新清单读取当前版本说明；历史版本或 R2 不可用时回退 GitHub。 */
export async function fetchReleaseNotes(version: string): Promise<ReleaseNotesResult> {
  const normalized = normalizeTagVersion(version)
  if (!normalized || !/^\d+\.\d+\.\d+$/.test(normalized)) {
    return { status: 'error', message: '版本号无效' }
  }

  const cdn = await fetchUpdateManifest()
  if (cdn.status === 'ok' && cdn.manifest.version === normalized) {
    const body = cdn.manifest.notes.trim()
    if (!body) {
      return { status: 'empty', version: normalized, tagName: cdn.manifest.tagName }
    }
    return { status: 'ok', version: normalized, tagName: cdn.manifest.tagName, body }
  }

  return fetchReleaseNotesFromGitHub(normalized)
}

async function fetchLatestReleaseFromGitHub(
  localVersion: string,
  channel: AppUpdateChannel,
): Promise<UpdateCheckResult> {
  try {
    const response = await CapacitorHttp.get({
      url: RELEASES_LATEST,
      headers: GITHUB_HEADERS,
    })
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `GitHub HTTP ${response.status}` }
    }
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const remoteVersion = normalizeTagVersion(String(data.tag_name ?? ''))
    if (!remoteVersion || !/^\d+\.\d+\.\d+$/.test(remoteVersion)) {
      return { status: 'error', message: 'GitHub Release 版本号无效' }
    }
    if (!isNewerVersion(remoteVersion, localVersion)) {
      return { status: 'up-to-date', localVersion, remoteVersion }
    }
    const picked = pickReleaseAsset(data.assets ?? [], remoteVersion, channel)
    if (!picked) {
      return { status: 'no-asset', localVersion, remoteVersion, channel }
    }
    return {
      status: 'available',
      localVersion,
      release: {
        version: remoteVersion,
        tagName: String(data.tag_name ?? ''),
        notes: truncateReleaseNotes(data.body),
        apkUrl: picked.url,
        apkFileName: picked.fileName,
        ...(picked.sha256 ? { sha256: picked.sha256 } : {}),
        ...(picked.size ? { size: picked.size } : {}),
        channel,
      },
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '检查更新失败',
    }
  }
}

/** R2 是权威主源；只有主源连接/格式失败时才回退 GitHub。 */
export async function fetchLatestRelease(
  localVersion: string,
  channel: AppUpdateChannel,
): Promise<UpdateCheckResult> {
  const cdn = await fetchUpdateManifest()
  if (cdn.status === 'ok') {
    return updateCheckFromManifest(cdn.manifest, localVersion, channel)
  }
  return fetchLatestReleaseFromGitHub(localVersion, channel)
}

/** 从 tag Release JSON 解析指定渠道 APK（不发起网络请求） */
export function releaseApkFromTagPayload(
  data: {
    tag_name?: unknown
    body?: unknown
    assets?: {
      name?: string
      browser_download_url?: string
      digest?: string | null
      size?: number
    }[]
  },
  version: string,
  channel: AppUpdateChannel,
): FetchReleaseApkResult {
  const normalized = normalizeTagVersion(version)
  if (!normalized || !/^\d+\.\d+\.\d+$/.test(normalized)) {
    return { status: 'error', message: '版本号无效' }
  }
  const assets = (data.assets ?? [])
    .map((a) => ({
      name: String(a.name ?? ''),
      browser_download_url: String(a.browser_download_url ?? ''),
      digest: typeof a.digest === 'string' ? a.digest : undefined,
      size: typeof a.size === 'number' ? a.size : undefined,
    }))
    .filter((a) => a.name && a.browser_download_url)
  const picked = pickReleaseAsset(assets, normalized, channel)
  if (!picked) return { status: 'no-asset', version: normalized, channel }
  return {
    status: 'ok',
    release: {
      version: normalized,
      tagName: String(data.tag_name ?? `v${normalized}`),
      notes: truncateReleaseNotes(typeof data.body === 'string' ? data.body : ''),
      apkUrl: picked.url,
      apkFileName: picked.fileName,
      ...(picked.sha256 ? { sha256: picked.sha256 } : {}),
      ...(picked.size ? { size: picked.size } : {}),
      channel,
    },
  }
}

async function fetchReleaseApkForChannelFromGitHub(
  version: string,
  channel: AppUpdateChannel,
): Promise<FetchReleaseApkResult> {
  try {
    const response = await CapacitorHttp.get({
      url: `${RELEASES_TAG_PREFIX}v${encodeURIComponent(version)}`,
      headers: GITHUB_HEADERS,
    })
    if (response.status === 404) {
      return { status: 'error', message: '未找到该版本的发布' }
    }
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `GitHub HTTP ${response.status}` }
    }
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    return releaseApkFromTagPayload(data ?? {}, version, channel)
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '查找安装包失败',
    }
  }
}

/** 当前最新版本优先走 R2；R2 不保留历史，因此旧版本切换继续回退 GitHub。 */
export async function fetchReleaseApkForChannel(
  version: string,
  channel: AppUpdateChannel,
): Promise<FetchReleaseApkResult> {
  const normalized = normalizeTagVersion(version)
  if (!normalized || !/^\d+\.\d+\.\d+$/.test(normalized)) {
    return { status: 'error', message: '版本号无效' }
  }

  const cdn = await fetchUpdateManifest()
  if (cdn.status === 'ok' && cdn.manifest.version === normalized) {
    return { status: 'ok', release: releaseFromUpdateManifest(cdn.manifest, channel) }
  }

  return fetchReleaseApkForChannelFromGitHub(normalized, channel)
}
