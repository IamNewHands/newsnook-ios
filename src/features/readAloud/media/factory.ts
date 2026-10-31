import { Capacitor } from '@capacitor/core'

import type { ReadAloudMediaControlAdapter } from '../types'
import { AndroidMediaSessionAdapter } from './androidMediaSession'
import { WebMediaSessionAdapter } from './webMediaSession'

export function createReadAloudMediaControlAdapter(): ReadAloudMediaControlAdapter {
  return Capacitor.getPlatform() === 'android'
    ? new AndroidMediaSessionAdapter()
    : new WebMediaSessionAdapter()
}
