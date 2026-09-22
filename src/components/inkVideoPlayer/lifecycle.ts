import type { MediaResourceDescriptor } from '../../features/mediaSniffer/types'
import { playableFormatForUrl, type PlayableFormat } from './playback'

/** Observation IDs, ordering and display metadata are not a playback identity. */
export function playbackIdentity(url: string, format?: PlayableFormat): string {
  return JSON.stringify([url, playableFormatForUrl(url, format)])
}

/** HTTP field names are case-insensitive. Values (including credentials) are not. */
export function playbackHeadersKey(headers?: Record<string, string>): string {
  const normalized = new Map<string, string>()
  for (const [name, value] of Object.entries(headers ?? {})) {
    normalized.set(name.toLowerCase(), value)
  }
  return JSON.stringify([...normalized].sort(([a], [b]) => a.localeCompare(b)))
}

/** Update the picker without replacing/removing the user's active selection. */
export function liveResourceChoices(
  resources: MediaResourceDescriptor[],
  active?: MediaResourceDescriptor | null,
): MediaResourceDescriptor[] {
  if (!active || resources.some(item => playbackIdentity(item.url, item.type) === playbackIdentity(active.url, active.type))) {
    return resources
  }
  return [active, ...resources]
}

export interface PlaybackCheckpoint {
  position: number
  paused: boolean
}

export function playbackCheckpoint(video: HTMLVideoElement, playing = !video.paused): PlaybackCheckpoint {
  return {
    position: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
    paused: !playing || video.ended,
  }
}
