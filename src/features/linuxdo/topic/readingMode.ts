import { readRaw, writeRawOrThrow } from '../../../lib/storage'

export type LinuxDoReadingMode = 'floors' | 'threaded'
const STORAGE_KEY = 'linuxdo-reading-mode:v1'

export function linuxDoReadingMode(): LinuxDoReadingMode {
  return readRaw(STORAGE_KEY) === 'threaded' ? 'threaded' : 'floors'
}

export function rememberLinuxDoReadingMode(mode: LinuxDoReadingMode): void {
  writeRawOrThrow(STORAGE_KEY, mode)
}
