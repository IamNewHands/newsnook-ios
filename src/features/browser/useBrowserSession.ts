import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { loadUserScripts } from './scripts'
import { reduceBrowserMedia, type BrowserMediaEvent, type BrowserMediaTab } from './browserMedia'

export interface BrowserState {
  url: string | null
  tabId?: number
  title?: string
  back: boolean
  forward: boolean
  desktop: boolean
  loading?: boolean
  progress?: number
  error?: string | null
}
export interface BrowserTab {
  index: number
  id: number
  title: string
  url: string
  active: boolean
  loading: boolean
  error?: string
}
export interface BrowserRecoverySession {
  tabs: {url: string; title: string; desktop: boolean}[]
  activeIndex: number
}
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'desktop' | 'new' | 'home' | 'scanMedia' | 'downloads' | 'scriptMenu'
interface NativeBrowser {
  open(args: {url: string; scripts: ReturnType<typeof loadUserScripts>; embedded: true; visible: boolean; top: number; bottom: number; palette: Record<string, string>; recoverySession?: BrowserRecoverySession}): Promise<void>
  takeRecoverySession(): Promise<{session: BrowserRecoverySession | null}>
  navigate(args: {action: BrowserCommand | 'url'; url?: string}): Promise<void>
  state(): Promise<BrowserState>
  tabs(): Promise<{tabs: BrowserTab[]}>
  activateTab(args: {index: number}): Promise<void>
  removeTab(args: {index: number}): Promise<void>
  setBounds(args: {top: number; bottom: number; visible: boolean}): Promise<void>
  updateScripts(args: {scripts: ReturnType<typeof loadUserScripts>}): Promise<void>
  close(): Promise<void>
  addListener(event: string, callback: (event: any) => void): Promise<PluginListenerHandle>
}
const nativeBrowser = registerPlugin<NativeBrowser>('NewsNookBrowser')
const EMPTY: BrowserState = {url: null, back: false, forward: false, desktop: false}

export async function takeBrowserRecoverySession(): Promise<BrowserRecoverySession | null> {
  if (Capacitor.getPlatform() !== 'android') return null
  const result = await nativeBrowser.takeRecoverySession()
  return result.session
}

function themePalette(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const tones: Record<string, string> = {ink: 'ink', surface: 'ink-raised', paper: 'paper', muted: 'paper-muted', accent: 'cinnabar', outline: 'paper-faint'}
  const palette: Record<string, string> = {}
  for (const [key, tone] of Object.entries(tones)) palette[key] = css.getPropertyValue('--tone-' + tone).trim()
  return palette
}

/** Owns the native session. UI overlays never recreate a website or its script context. */
export function useBrowserSession(
  viewport: RefObject<HTMLDivElement | null>,
  covered: boolean,
  onVisit: (url: string, title: string) => void,
  bottomAddress: boolean,
  recoverySession?: BrowserRecoverySession,
) {
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [mediaTabs, setMediaTabs] = useState<ReadonlyMap<number, BrowserMediaTab>>(() => new Map())
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false)
  const epoch = useRef(0)
  const opened = useRef(false)
  const recoveryStarted = useRef(false)
  const closing = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingCount = useRef(0)
  const refreshSequence = useRef(0)
  const visit = useRef(onVisit)
  visit.current = onVisit

  const getBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    return rect ? {top: Math.max(0, rect.top), bottom: Math.max(0, window.innerHeight - rect.bottom)} : {top: 0, bottom: 56}
  }, [viewport])

  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current
    const generation = epoch.current
    const [next, result] = await Promise.all([nativeBrowser.state(), nativeBrowser.tabs()])
    if (!live.current || generation !== epoch.current || request !== refreshSequence.current) return
    opened.current = result.tabs.length > 0
    setReady(opened.current)
    setState(next)
    setTabs(result.tabs)
    const ids = new Set(result.tabs.map(tab => tab.id))
    setMediaTabs(previous => {
      if ([...previous.keys()].every(id => ids.has(id))) return previous
      return new Map([...previous].filter(([id]) => ids.has(id)))
    })
  }, [])

  useEffect(() => {
    live.current = true
    closing.current = false
    ++epoch.current
    const handles: PluginListenerHandle[] = []
    let disposed = false
    const listen = (name: string, callback: (event: any) => void) => {
      void nativeBrowser.addListener(name, event => {
        if (!disposed && live.current) callback(event)
      }).then(handle => {
        if (disposed) void handle.remove()
        else handles.push(handle)
      }).catch(() => {
        if (!disposed) setError('浏览器连接失败，请返回后重试')
      })
    }
    if (Capacitor.getPlatform() === 'android') {
      listen('navigation', (event: BrowserState & {phase?: string}) => {
        ++refreshSequence.current
        setState(previous => ({...previous, ...event, loading: event.loading ?? event.phase === 'start'}))
        if (event.url && /^https?:\/\//i.test(event.url) && event.phase === 'end' && !event.error) {
          visit.current(event.url, event.title || event.url)
        }
        if (opened.current) void refresh().catch(() => undefined)
      })
      listen('mediaEvent', (event: BrowserMediaEvent) => setMediaTabs(previous => reduceBrowserMedia(previous, event)))
      listen('browserError', (event: {tabId?: number; message?: string; url?: string}) => {
        setState(previous => previous.tabId === event.tabId
          ? {...previous, loading: false, error: event.message || '网页加载失败，请刷新重试'} : previous)
        void refresh().catch(() => undefined)
      })
      listen('closed', () => {
        if (!opened.current) return
        opened.current = false
        setReady(false)
        setState(EMPTY)
        setTabs([])
        setMediaTabs(new Map())
      })
    }
    return () => {
      disposed = true
      live.current = false
      // Invalidate all work queued during this effect, including later user actions.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++epoch.current
      opened.current = false
      handles.forEach(handle => { void handle.remove().catch(() => undefined) })
      if (!closing.current) void nativeBrowser.close().catch(() => undefined)
    }
  }, [refresh])

  const visible = ready && /^https?:\/\//i.test(state.url || '') && !state.error && !covered
  useLayoutEffect(() => {
    if (!ready) return
    const sync = () => {
      void nativeBrowser.setBounds({...getBounds(), visible}).catch(() => undefined)
    }
    sync()
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    if (viewport.current) observer?.observe(viewport.current)
    return () => {
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      observer?.disconnect()
    }
  }, [ready, visible, getBounds, viewport, bottomAddress])

  const enqueue = useCallback((operation: () => Promise<void>): Promise<boolean> => {
    const generation = epoch.current
    pendingCount.current++
    setPending(true)
    const result = queue.current.catch(() => undefined).then(async () => {
      try {
        if (!live.current || closing.current || generation !== epoch.current) return false
        setError('')
        await operation()
        if (!live.current || generation !== epoch.current) return false
        await refresh()
        return true
      } catch (failure) {
        if (live.current && generation === epoch.current) {
          setError(failure instanceof Error ? failure.message : '操作失败，请重试')
        }
        return false
      } finally {
        pendingCount.current = Math.max(0, pendingCount.current - 1)
        if (live.current && generation === epoch.current) setPending(pendingCount.current > 0)
      }
    })
    queue.current = result
    return result
  }, [refresh])

  const ensureOpen = useCallback(async (url: string, snapshot?: BrowserRecoverySession) => {
    const generation = epoch.current
    if (Capacitor.getPlatform() !== 'android') throw new Error('请在 Android 应用中打开网页')
    if (opened.current && !snapshot) {
      await nativeBrowser.navigate({action: 'url', url})
    } else {
      await nativeBrowser.open({
        url, scripts: loadUserScripts().filter(script => script.enabled),
        embedded: true, visible: false, ...getBounds(), palette: themePalette(),
        ...(snapshot ? {recoverySession: snapshot} : {}),
      })
      if (live.current && !closing.current && generation === epoch.current) opened.current = true
    }
  }, [getBounds])

  useEffect(() => {
    if (!recoverySession || recoveryStarted.current) return
    void enqueue(async () => {
      if (recoveryStarted.current) return
      // Claim only when this generation executes: StrictMode cancels its trial queue.
      recoveryStarted.current = true
      const url = recoverySession.tabs[recoverySession.activeIndex]?.url || recoverySession.tabs[0]?.url || 'about:blank'
      await ensureOpen(url, recoverySession)
    })
  }, [enqueue, ensureOpen, recoverySession])

  const open = useCallback((url: string) => enqueue(() => ensureOpen(url)), [enqueue, ensureOpen])
  const command = useCallback((action: BrowserCommand): Promise<boolean> => {
    if (action === 'stop') {
      const generation = epoch.current
      if (!live.current || closing.current) return Promise.resolve(false)
      // Cancellation must bypass a pending open whose script dependencies are still loading.
      return nativeBrowser.navigate({action}).then(async () => {
        if (!live.current || generation !== epoch.current) return false
        await refresh()
        return true
      }).catch(failure => {
        if (live.current && generation === epoch.current) setError(failure instanceof Error ? failure.message : '停止加载失败，请重试')
        return false
      })
    }
    return enqueue(async () => {
      if (action === 'new' && !opened.current) {
        await ensureOpen('about:blank')
        return
      }
      if (action === 'downloads' || opened.current) await nativeBrowser.navigate({action})
    })
  }, [enqueue, ensureOpen, refresh])

  const activate = useCallback((tab: BrowserTab) => enqueue(() => nativeBrowser.activateTab({index: tab.index})), [enqueue])
  const remove = useCallback((tab: BrowserTab) => enqueue(() => nativeBrowser.removeTab({index: tab.index})), [enqueue])
  const updateScripts = useCallback(() => enqueue(async () => {
    if (opened.current) await nativeBrowser.updateScripts({scripts: loadUserScripts().filter(script => script.enabled)})
  }), [enqueue])
  const close = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    ++epoch.current
    opened.current = false
    await nativeBrowser.close().catch(() => undefined)
  }, [])

  return {state, tabs, mediaTabs, ready, pending, error, setError, open, command, activate, remove, updateScripts, close}
}
