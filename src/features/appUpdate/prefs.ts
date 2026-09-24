import { loadAppUpdatePrefs, saveAppUpdatePrefs } from '../../lib/storage'

import { SNOOZE_MS } from './gate'
import { releaseTrackForVersion } from './semver'
import type { AppUpdatePrefs, UpdateTrack, UpdateTrackPrefs } from './types'

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asTrack(value: unknown): UpdateTrack {
  return value === 'beta' ? 'beta' : 'stable'
}

function versionForTrack(value: unknown, track: UpdateTrack): string | undefined {
  const version = asNonEmptyString(value)
  return version && releaseTrackForVersion(version) === track ? version : undefined
}

function parseTrackPrefs(value: unknown, track: UpdateTrack): UpdateTrackPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const prefs: UpdateTrackPrefs = {}

  const skippedVersion = versionForTrack(record.skippedVersion, track)
  if (skippedVersion) prefs.skippedVersion = skippedVersion

  const snoozeUntil = asFiniteNumber(record.snoozeUntil)
  if (snoozeUntil != null) prefs.snoozeUntil = snoozeUntil

  const lastCheckAt = asFiniteNumber(record.lastCheckAt)
  if (lastCheckAt != null) prefs.lastCheckAt = lastCheckAt

  const availableVersion = versionForTrack(record.availableVersion, track)
  if (availableVersion) prefs.availableVersion = availableVersion

  return prefs
}

function parseLegacyStablePrefs(record: Record<string, unknown>): UpdateTrackPrefs {
  return parseTrackPrefs(record, 'stable')
}

export function normalizeAppUpdatePrefs(raw: unknown): AppUpdatePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { track: 'stable', tracks: { stable: {}, beta: {} } }
  }

  const record = raw as Record<string, unknown>
  const track = asTrack(record.track)
  const tracksRecord =
    record.tracks && typeof record.tracks === 'object' && !Array.isArray(record.tracks)
      ? (record.tracks as Record<string, unknown>)
      : null

  // 兼容 1.8.6 及更早版本的扁平 appUpdate 数据：旧数据天然属于 stable。
  const stable = tracksRecord
    ? parseTrackPrefs(tracksRecord.stable, 'stable')
    : parseLegacyStablePrefs(record)
  const beta = tracksRecord ? parseTrackPrefs(tracksRecord.beta, 'beta') : {}

  return { track, tracks: { stable, beta } }
}

export function loadAppUpdatePrefsNormalized(): AppUpdatePrefs {
  return normalizeAppUpdatePrefs(loadAppUpdatePrefs())
}

export function getUpdateTrackPrefs(
  prefs: AppUpdatePrefs,
  track: UpdateTrack = prefs.track,
): UpdateTrackPrefs {
  return prefs.tracks[track]
}

function persist(next: AppUpdatePrefs): AppUpdatePrefs {
  saveAppUpdatePrefs(next)
  return next
}

function patchTrack(track: UpdateTrack, patch: Partial<UpdateTrackPrefs>): AppUpdatePrefs {
  const current = loadAppUpdatePrefsNormalized()
  return persist({
    ...current,
    tracks: {
      ...current.tracks,
      [track]: { ...current.tracks[track], ...patch },
    },
  })
}

export function saveUpdateTrack(track: UpdateTrack): AppUpdatePrefs {
  const current = loadAppUpdatePrefsNormalized()
  if (current.track === track) return current
  return persist({ ...current, track })
}

export function saveSkippedVersion(version: string, track?: UpdateTrack): AppUpdatePrefs {
  const current = loadAppUpdatePrefsNormalized()
  const targetTrack = track ?? current.track
  const safeVersion = releaseTrackForVersion(version) === targetTrack ? version : undefined
  return patchTrack(targetTrack, { skippedVersion: safeVersion })
}

export function saveSnooze(now: number, track?: UpdateTrack): AppUpdatePrefs {
  const current = loadAppUpdatePrefsNormalized()
  return patchTrack(track ?? current.track, { snoozeUntil: now + SNOOZE_MS })
}

export function touchLastCheck(now: number, track?: UpdateTrack): AppUpdatePrefs {
  const current = loadAppUpdatePrefsNormalized()
  return patchTrack(track ?? current.track, { lastCheckAt: now })
}

export function saveAvailableVersion(
  version: string | undefined,
  track?: UpdateTrack,
): AppUpdatePrefs {
  const current = loadAppUpdatePrefsNormalized()
  const targetTrack = track ?? current.track
  const safeVersion =
    version && releaseTrackForVersion(version) === targetTrack ? version : undefined
  return patchTrack(targetTrack, { availableVersion: safeVersion })
}
