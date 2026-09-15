import { CapacitorHttp } from '@capacitor/core'

import { isNewerVersion, normalizeTagVersion } from './semver'
import type { AppUpdateChannel, LatestReleaseInfo, UpdateCheckResult } from './types'

export const UPDATE_BASE_URL = 'https://news-update.aizeek.com'
export const UPDATE_MANIFEST_URL = `${UPDATE_BASE_URL}/newsnook/latest.json`
const UPDATE_HOST = 'news-update.aizeek.com'
const SHA256_RE = /^[0-9a-f]{64}$/i

type ManifestAsset = {
  fileName: string
  url: string
  sha256: string
  size: number
}

export type UpdateManifest = {
  schemaVersion: 1
  version: string
  tagName: string
  publishedAt?: string
  notes: string
  channels: Record<AppUpdateChannel, ManifestAsset>
}

export type FetchUpdateManifestResult =
  | { status: 'ok'; manifest: UpdateManifest }
  | { status: 'error'; message: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseAsset(value: unknown, version: string, channel: AppUpdateChannel): ManifestAsset | null {
  const record = asRecord(value)
  if (!record) return null

  const expectedFileName = `newsnook-${version}-${channel}-release.apk`
  const fileName = typeof record.fileName === 'string' ? record.fileName.trim() : ''
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim().toLowerCase() : ''
  const size = record.size

  if (fileName !== expectedFileName || !SHA256_RE.test(sha256)) return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return null

  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname.toLowerCase() !== UPDATE_HOST) return null
    if (parsedUrl.pathname !== `/newsnook/${expectedFileName}`) return null
  } catch {
    return null
  }

  return { fileName, url, sha256, size }
}

export function parseUpdateManifest(payload: unknown): UpdateManifest | null {
  const record = asRecord(payload)
  if (!record || record.schemaVersion !== 1) return null

  const version = normalizeTagVersion(typeof record.version === 'string' ? record.version : '')
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null

  const tagName = typeof record.tagName === 'string' ? record.tagName.trim() : ''
  if (normalizeTagVersion(tagName) !== version) return null

  const channels = asRecord(record.channels)
  if (!channels) return null

  const cloud = parseAsset(channels.cloud, version, 'cloud')
  const local = parseAsset(channels.local, version, 'local')
  if (!cloud || !local) return null

  const publishedAt = typeof record.publishedAt === 'string' ? record.publishedAt.trim() : ''
  const notes = typeof record.notes === 'string' ? record.notes.trim() : ''

  return {
    schemaVersion: 1,
    version,
    tagName: tagName || `v${version}`,
    ...(publishedAt ? { publishedAt } : {}),
    notes,
    channels: { cloud, local },
  }
}

export function releaseFromUpdateManifest(
  manifest: UpdateManifest,
  channel: AppUpdateChannel,
): LatestReleaseInfo {
  const asset = manifest.channels[channel]
  return {
    version: manifest.version,
    tagName: manifest.tagName,
    notes: manifest.notes,
    apkUrl: asset.url,
    apkFileName: asset.fileName,
    sha256: asset.sha256,
    size: asset.size,
    channel,
  }
}

export function updateCheckFromManifest(
  manifest: UpdateManifest,
  localVersion: string,
  channel: AppUpdateChannel,
): UpdateCheckResult {
  if (!isNewerVersion(manifest.version, localVersion)) {
    return {
      status: 'up-to-date',
      localVersion,
      remoteVersion: manifest.version,
    }
  }
  return {
    status: 'available',
    localVersion,
    release: releaseFromUpdateManifest(manifest, channel),
  }
}

export async function fetchUpdateManifest(): Promise<FetchUpdateManifestResult> {
  try {
    const separator = UPDATE_MANIFEST_URL.includes('?') ? '&' : '?'
    const response = await CapacitorHttp.get({
      url: `${UPDATE_MANIFEST_URL}${separator}t=${Date.now()}`,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `更新源 HTTP ${response.status}` }
    }
    const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const manifest = parseUpdateManifest(payload)
    if (!manifest) return { status: 'error', message: '更新源数据格式无效' }
    return { status: 'ok', manifest }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '更新源连接失败',
    }
  }
}
