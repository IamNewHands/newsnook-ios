import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/
const MAX_ANDROID_VERSION_CODE = 2_100_000_000

export function parseReleaseVersion(raw) {
  const value = String(raw ?? '').trim().replace(/^v/i, '')
  const match = VERSION_RE.exec(value)
  if (!match) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const beta = match[4] == null ? undefined : Number(match[4])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  if (minor > 99 || patch > 99) return null
  if (beta != null && (!Number.isSafeInteger(beta) || beta < 1 || beta > 998)) return null

  return {
    version: value,
    major,
    minor,
    patch,
    ...(beta == null ? {} : { beta }),
    track: beta == null ? 'stable' : 'beta',
    branch: beta == null ? 'main' : 'beta',
  }
}

export function compareReleaseVersions(a, b) {
  const left = parseReleaseVersion(a)
  const right = parseReleaseVersion(b)
  if (!left || !right) return Number.NaN

  for (const key of ['major', 'minor', 'patch']) {
    const delta = left[key] - right[key]
    if (delta !== 0) return delta
  }
  if (left.beta == null && right.beta == null) return 0
  if (left.beta == null) return 1
  if (right.beta == null) return -1
  return left.beta - right.beta
}

export function androidVersionCodeForRelease(raw) {
  const parsed = parseReleaseVersion(raw)
  if (!parsed) return null
  const core = parsed.major * 10_000 + parsed.minor * 100 + parsed.patch
  const code = core * 1_000 + (parsed.beta ?? 999)
  if (!Number.isSafeInteger(code) || code <= 0 || code > MAX_ANDROID_VERSION_CODE) return null
  return code
}

export function releaseContract(raw) {
  const parsed = parseReleaseVersion(raw)
  if (!parsed) return null
  const versionCode = androidVersionCodeForRelease(parsed.version)
  if (versionCode == null) return null
  return { ...parsed, versionCode }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const contract = releaseContract(process.argv[2])
  if (!contract) {
    process.stderr.write('Version must be X.Y.Z or X.Y.Z-beta.N with minor/patch <= 99 and beta 1..998.\n')
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(contract)}\n`)
}
