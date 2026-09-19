import type { UpdateTrack } from './types'

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/i
const MAX_ANDROID_VERSION_CODE = 2_100_000_000

export type ParsedVersion = {
  major: number
  minor: number
  patch: number
  beta?: number
}

export function parseVersion(raw: string): ParsedVersion | null {
  const match = VERSION_RE.exec(raw.trim())
  if (!match) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const beta = match[4] == null ? undefined : Number(match[4])

  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  if (major < 0 || minor < 0 || patch < 0 || minor > 99 || patch > 99) return null
  if (beta != null && (!Number.isSafeInteger(beta) || beta < 1 || beta > 998)) return null

  return beta == null ? { major, minor, patch } : { major, minor, patch, beta }
}

export function normalizeTagVersion(tag: string): string {
  return tag.trim().replace(/^[vV]/, '')
}

export function isValidVersion(raw: string): boolean {
  return parseVersion(raw) != null
}

export function releaseTrackForVersion(raw: string): UpdateTrack | null {
  const parsed = parseVersion(raw)
  if (!parsed) return null
  return parsed.beta == null ? 'stable' : 'beta'
}

export function compareSemver(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return Number.NaN

  for (const key of ['major', 'minor', 'patch'] as const) {
    const delta = left[key] - right[key]
    if (delta !== 0) return delta
  }

  // 同一 core 版本：正式版永远高于任意 beta；beta 再按序号比较。
  if (left.beta == null && right.beta == null) return 0
  if (left.beta == null) return 1
  if (right.beta == null) return -1
  return left.beta - right.beta
}

export function isNewerVersion(remote: string, local: string): boolean {
  const cmp = compareSemver(remote, local)
  return Number.isFinite(cmp) && cmp > 0
}

/**
 * Android versionCode 必须随 beta.1 -> beta.N -> stable -> 下一版 beta 单调递增。
 * 规则与 android/app/build.gradle 保持一致：
 *   core = major*10000 + minor*100 + patch
 *   beta.N = core*1000 + N
 *   stable = core*1000 + 999
 */
export function androidVersionCode(raw: string): number | null {
  const parsed = parseVersion(raw)
  if (!parsed) return null
  const core = parsed.major * 10_000 + parsed.minor * 100 + parsed.patch
  const code = core * 1_000 + (parsed.beta ?? 999)
  if (!Number.isSafeInteger(code) || code <= 0 || code > MAX_ANDROID_VERSION_CODE) return null
  return code
}
