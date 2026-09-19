import { Capacitor } from '@capacitor/core'

import { isLocalTranslationAvailable } from '../translation/native'
import { shouldAutoPrompt, shouldFetchForAutoCheck } from './gate'
import { fetchLatestRelease } from './github'
import { compareSemver, isNewerVersion } from './semver'
import { AppUpdateNative } from './native'
import {
  getUpdateTrackPrefs,
  loadAppUpdatePrefsNormalized,
  saveAvailableVersion,
  touchLastCheck,
} from './prefs'
import type {
  LatestReleaseInfo,
  PackageFlavor,
  UpdateCheckResult,
  UpdateTrack,
} from './types'

export type AppUpdateUiState = {
  downloading: boolean
  lastManualMessage?: string
}

export type AutoCheckOutcome = {
  result: UpdateCheckResult
  shouldPrompt: boolean
  subscriptionTrack: UpdateTrack
}

type BeginUpdateResult =
  | { downloadId: number }
  | { needInstallPermission: true }
  | { error: string }

let activeDownloadId: number | null = null
let uiState: AppUpdateUiState = { downloading: false }
const uiListeners = new Set<(state: AppUpdateUiState) => void>()
let nativeListenersBound = false

function setUi(patch: Partial<AppUpdateUiState>): void {
  uiState = { ...uiState, ...patch }
  for (const listener of uiListeners) listener(uiState)
}

export function subscribeAppUpdateUi(listener: (state: AppUpdateUiState) => void): () => void {
  uiListeners.add(listener)
  listener(uiState)
  return () => {
    uiListeners.delete(listener)
  }
}

export function getAppUpdateUiState(): AppUpdateUiState {
  return uiState
}

export function isAppUpdateSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AppUpdate')
}

export function resolvePackageFlavor(): PackageFlavor {
  return isLocalTranslationAvailable() ? 'local' : 'cloud'
}

export function resolveOppositeFlavor(
  flavor: PackageFlavor = resolvePackageFlavor(),
): PackageFlavor {
  return flavor === 'local' ? 'cloud' : 'local'
}

export function resolveUpdateTrack(): UpdateTrack {
  return loadAppUpdatePrefsNormalized().track
}

export function getActiveDownloadId(): number | null {
  return activeDownloadId
}

async function ensureNativeListeners(): Promise<void> {
  if (nativeListenersBound || !isAppUpdateSupported()) return
  nativeListenersBound = true
  await AppUpdateNative.addListener('downloadComplete', ({ downloadId }) => {
    if (activeDownloadId === downloadId) activeDownloadId = null
    setUi({ downloading: false, lastManualMessage: undefined })
  })
  await AppUpdateNative.addListener('downloadFailed', ({ downloadId, message, kind }) => {
    if (activeDownloadId === downloadId) activeDownloadId = null
    const fallback =
      kind === 'install' ? '安装失败，可稍后在关于页重试' : '下载失败，点按重试'
    setUi({
      downloading: false,
      lastManualMessage: message || fallback,
    })
  })
}

/**
 * Beta 订阅表示“Stable + Beta 都有资格”，选择当前可安装的最高版本。
 * Stable 订阅调用方只传 Stable 结果，因此不会意外看到 Beta。
 */
export function selectEligibleUpdateResult(
  localVersion: string,
  subscriptionTrack: UpdateTrack,
  results: UpdateCheckResult[],
): UpdateCheckResult {
  const eligibleResults = results.filter((result) => {
    if (result.status === 'error') return true
    const sourceTrack = result.status === 'available' ? result.release.track : result.track
    return subscriptionTrack === 'beta' || sourceTrack === 'stable'
  })

  const available = eligibleResults
    .filter((result): result is Extract<UpdateCheckResult, { status: 'available' }> =>
      result.status === 'available',
    )
    .sort((a, b) => compareSemver(b.release.version, a.release.version))

  if (available.length > 0) {
    const best = available[0]!
    return {
      ...best,
      release: { ...best.release, subscriptionTrack },
    }
  }

  const noAsset = eligibleResults
    .filter((result): result is Extract<UpdateCheckResult, { status: 'no-asset' }> =>
      result.status === 'no-asset' && isNewerVersion(result.remoteVersion, localVersion),
    )
    .sort((a, b) => compareSemver(b.remoteVersion, a.remoteVersion))
  if (noAsset.length > 0) return noAsset[0]!

  const upToDate = eligibleResults
    .filter((result): result is Extract<UpdateCheckResult, { status: 'up-to-date' }> =>
      result.status === 'up-to-date',
    )
    .sort((a, b) => compareSemver(b.remoteVersion, a.remoteVersion))
  if (upToDate.length > 0) return upToDate[0]!

  const errors = eligibleResults.filter(
    (result): result is Extract<UpdateCheckResult, { status: 'error' }> => result.status === 'error',
  )
  return {
    status: 'error',
    message: errors.map((result) => result.message).filter(Boolean).join('；') || '检查更新失败',
  }
}

async function fetchEligibleUpdate(
  localVersion: string,
  flavor: PackageFlavor,
  subscriptionTrack: UpdateTrack,
): Promise<UpdateCheckResult> {
  if (subscriptionTrack === 'stable') {
    const stable = await fetchLatestRelease(localVersion, flavor, 'stable')
    return selectEligibleUpdateResult(localVersion, subscriptionTrack, [stable])
  }

  const [stable, beta] = await Promise.all([
    fetchLatestRelease(localVersion, flavor, 'stable'),
    fetchLatestRelease(localVersion, flavor, 'beta'),
  ])
  return selectEligibleUpdateResult(localVersion, subscriptionTrack, [stable, beta])
}

export async function checkForUpdate(
  track: UpdateTrack = resolveUpdateTrack(),
): Promise<UpdateCheckResult> {
  if (!isAppUpdateSupported()) {
    return { status: 'error', message: '当前平台不支持应用内更新' }
  }
  await ensureNativeListeners()
  const result = await fetchEligibleUpdate(__APP_VERSION__, resolvePackageFlavor(), track)
  if (result.status !== 'error') {
    touchLastCheck(Date.now(), track)
    if (result.status === 'available') {
      saveAvailableVersion(result.release.version, track)
    } else if (result.status === 'up-to-date') {
      saveAvailableVersion(undefined, track)
    }
  }
  return result
}

export async function checkForAutoUpdate(options?: {
  isColdStart?: boolean
}): Promise<AutoCheckOutcome | null> {
  if (!isAppUpdateSupported()) return null
  if (activeDownloadId != null) return null

  const prefs = loadAppUpdatePrefsNormalized()
  const trackPrefs = getUpdateTrackPrefs(prefs)
  if (
    !shouldFetchForAutoCheck({
      prefs: trackPrefs,
      now: Date.now(),
      downloading: false,
      isColdStart: options?.isColdStart,
    })
  ) {
    return null
  }

  const result = await checkForUpdate(prefs.track)
  if (result.status !== 'available') {
    return { result, shouldPrompt: false, subscriptionTrack: prefs.track }
  }

  const refreshed = loadAppUpdatePrefsNormalized()
  const shouldPrompt = shouldAutoPrompt({
    remoteVersion: result.release.version,
    prefs: getUpdateTrackPrefs(refreshed, prefs.track),
    now: Date.now(),
    downloading: false,
  })
  return { result, shouldPrompt, subscriptionTrack: prefs.track }
}

export async function beginUpdate(release: LatestReleaseInfo): Promise<BeginUpdateResult> {
  if (!isAppUpdateSupported()) return { error: '当前平台不支持应用内更新' }
  await ensureNativeListeners()
  if (activeDownloadId != null) {
    setUi({ downloading: true })
    return { downloadId: activeDownloadId }
  }
  try {
    const { value } = await AppUpdateNative.canInstallPackages()
    if (!value) return { needInstallPermission: true }
    const { downloadId } = await AppUpdateNative.startDownload({
      url: release.apkUrl,
      fileName: release.apkFileName,
      sha256: release.sha256,
      size: release.size,
    })
    activeDownloadId = downloadId
    setUi({ downloading: true, lastManualMessage: undefined })
    return { downloadId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '开始下载失败' }
  }
}

export async function continueUpdateAfterPermission(
  release: LatestReleaseInfo,
): Promise<BeginUpdateResult> {
  if (!isAppUpdateSupported()) return { error: '当前平台不支持应用内更新' }
  try {
    const { value } = await AppUpdateNative.canInstallPackages()
    if (!value) {
      return { error: '仍未允许安装未知应用，无法继续更新' }
    }
    return beginUpdate(release)
  } catch (error) {
    return { error: error instanceof Error ? error.message : '权限检查失败' }
  }
}

export async function openInstallSettings(): Promise<void> {
  if (!isAppUpdateSupported()) return
  await AppUpdateNative.openInstallSettings()
}

export function setManualMessage(message: string | undefined): void {
  setUi({ lastManualMessage: message })
}
