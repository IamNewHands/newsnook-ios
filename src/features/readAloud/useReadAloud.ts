import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AiPrefs } from '../translation/types'
import { getReadAloudService } from './service'
import type {
  ReadAloudDocument,
  ReadAloudPrefs,
  ReadAloudSnapshot,
  ReadAloudVoice,
} from './types'

export function useReadAloud(
  document: ReadAloudDocument | null,
  prefs: ReadAloudPrefs,
  ai: AiPrefs,
) {
  const service = useMemo(() => getReadAloudService(), [])
  const [snapshot, setSnapshot] = useState<ReadAloudSnapshot>(
    service.getSnapshot(),
  )
  const [voices, setVoices] = useState<ReadAloudVoice[]>([])
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [voiceError, setVoiceError] = useState('')

  useEffect(() => service.subscribe(setSnapshot), [service])

  useEffect(() => {
    void service.updatePreferences(prefs, ai)
  }, [ai, prefs, service])

  const start = useCallback(
    async (resumeSaved = true) => {
      if (!document) return
      await service.start(document, prefs, ai, { resumeSaved })
    },
    [ai, document, prefs, service],
  )

  const loadSystemVoices = useCallback(async () => {
    setVoiceLoading(true)
    setVoiceError('')
    try {
      const list = await service.listVoices(
        { ...prefs, engine: 'system' },
        ai,
      )
      setVoices(list)
    } catch (error) {
      setVoices([])
      setVoiceError(
        error instanceof Error ? error.message : '无法读取系统语音列表',
      )
    } finally {
      setVoiceLoading(false)
    }
  }, [ai, prefs, service])

  return {
    snapshot,
    isCurrentArticle:
      Boolean(document) && snapshot.articleId === document?.articleId,
    start,
    pause: () => service.pause(),
    resume: () => service.resume(),
    stop: () => service.stop(),
    next: () => service.next(),
    previous: () => service.previous(),
    voices,
    voiceLoading,
    voiceError,
    loadSystemVoices,
  }
}
