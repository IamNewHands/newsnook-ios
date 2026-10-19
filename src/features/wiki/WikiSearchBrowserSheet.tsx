import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Square,
  X,
} from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { registerHardwareBackLayer } from '../../lib/hardwareBackStack'
import {
  BROWSER_ENGINES,
  BROWSER_KEYS,
  loadBrowserPreferences,
  readBrowserList,
  readBrowserPreference,
  resolveBrowserAddress,
  writeBrowserPreference,
  type BrowserSearchChoice,
} from '../browser/browserPreferences'
import {
  normalizeBrowserVisits,
  saveBrowserVisit,
} from '../browser/browserHistory'
import { useBrowserSession } from '../browser/useBrowserSession'

export interface WikiSearchBrowserSheetProps {
  term: string
  expanded: boolean
  onToggleExpand: () => void
  onClose: () => void
  onOpenInFullBrowser?: (url: string) => void
}

export function WikiSearchBrowserSheet({
  term,
  expanded,
  onToggleExpand,
  onClose,
  onOpenInFullBrowser,
}: WikiSearchBrowserSheetProps) {
  const [preferences] = useState(loadBrowserPreferences)
  const viewport = useRef<HTMLDivElement>(null)

  const searchEngine = useMemo(() => {
    const saved = readBrowserPreference(BROWSER_KEYS.search)
    return saved && Object.prototype.hasOwnProperty.call(BROWSER_ENGINES, saved)
      ? (saved as BrowserSearchChoice)
      : 'bing'
  }, [])

  const engineInfo = BROWSER_ENGINES[searchEngine]
  const engineLabel = engineInfo?.name || '必应'

  const initialSearchUrl = useMemo(() => {
    return (
      resolveBrowserAddress(term, searchEngine) ||
      `https://cn.bing.com/search?q=${encodeURIComponent(term)}`
    )
  }, [term, searchEngine])

  const recordVisit = useCallback(
    (url: string, title: string) => {
      if (preferences.privateMode) return
      try {
        const current = normalizeBrowserVisits(readBrowserList(BROWSER_KEYS.history))
        const next = saveBrowserVisit(current, url, title)
        writeBrowserPreference(BROWSER_KEYS.history, next)
      } catch {
        // Ignore storage failure
      }
    },
    [preferences.privateMode],
  )

  const session = useBrowserSession(
    viewport,
    false,
    recordVisit,
    false,
    undefined,
    { settings: preferences },
  )

  const sessionRef = useRef(session)
  sessionRef.current = session

  const initialOpenedRef = useRef(false)
  useEffect(() => {
    if (initialOpenedRef.current) return
    initialOpenedRef.current = true
    void sessionRef.current.open(initialSearchUrl)
  }, [initialSearchUrl])

  useEffect(() => {
    return registerHardwareBackLayer(() => {
      if (sessionRef.current.state.back) {
        void sessionRef.current.command('back')
        return true
      }
      onClose()
      return true
    })
  }, [onClose])

  const isAndroid = Capacitor.getPlatform() === 'android'
  const displayTitle =
    session.state.title && session.state.title !== '网页'
      ? session.state.title
      : `搜索“${term}”`

  const handleOpenFullBrowser = () => {
    const currentUrl = session.state.url || initialSearchUrl
    onOpenInFullBrowser?.(currentUrl)
  }

  return (
    <section
      className={`wiki-sheet wiki-sheet-search ${expanded ? 'wiki-sheet-expanded' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`搜索“${term}”`}
    >
      <header className="wiki-sheet-header">
        <div
          className="wiki-sheet-grabber"
          onClick={onToggleExpand}
          title={expanded ? '点击收起为半窗' : '点击展开为全屏'}
        />
        <div className="wiki-sheet-header-row">
          <span className="shrink-0 rounded bg-cinnabar-soft/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-cinnabar-soft">
            {engineLabel}
          </span>
          <h2 className="truncate text-[15px] font-semibold" title={displayTitle}>
            {displayTitle}
          </h2>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              aria-label="后退"
              disabled={!session.state.back}
              onClick={() => void session.command('back')}
              className={session.state.back ? 'text-paper' : 'opacity-35 cursor-not-allowed'}
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="前进"
              disabled={!session.state.forward}
              onClick={() => void session.command('forward')}
              className={session.state.forward ? 'text-paper' : 'opacity-35 cursor-not-allowed'}
            >
              <ArrowRight size={18} />
            </button>
            <button
              type="button"
              aria-label={session.state.loading ? '停止加载' : '刷新'}
              onClick={() => void session.command(session.state.loading ? 'stop' : 'reload')}
            >
              {session.state.loading ? <Square size={16} /> : <RefreshCw size={17} />}
            </button>
            <button
              type="button"
              aria-label="在完整浏览器中打开"
              title="在完整浏览器中打开"
              onClick={handleOpenFullBrowser}
            >
              <ExternalLink size={18} />
            </button>
            <button
              type="button"
              aria-label={expanded ? '收起为半窗' : '展开为全屏'}
              title={expanded ? '收起为半窗' : '展开为全屏'}
              onClick={onToggleExpand}
            >
              {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              type="button"
              aria-label="关闭搜索返回阅读"
              title="关闭搜索返回阅读"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {session.state.loading && (
          <div
            role="progressbar"
            aria-label="网页加载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={session.state.progress ?? 0}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-haze/30"
          >
            <div
              className="h-full bg-cinnabar transition-[width] duration-150"
              style={{ width: `${Math.max(6, session.state.progress ?? 6)}%` }}
            />
          </div>
        )}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">
        {!isAndroid ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-paper">
            <div className="mb-3 rounded-full bg-haze/30 p-3 text-cinnabar-soft">
              <Search size={28} />
            </div>
            <h3 className="mb-1 text-[16px] font-semibold">Web 开发预览</h3>
            <p className="mb-4 max-w-xs text-[13px] text-paper-muted">
              内置浏览器依赖 Android 原生 WebView。在 Android 设备中将以原生浮层呈现。
            </p>
            <a
              href={initialSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-cinnabar px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:opacity-90 active:scale-95"
            >
              <span>在外部浏览器打开搜索</span>
              <ExternalLink size={14} />
            </a>
          </div>
        ) : (
          <div ref={viewport} data-browser-viewport className="h-full w-full overflow-hidden bg-ink" />
        )}

        {session.state.error && isAndroid && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-ink">
            <p className="mb-3 text-[14px] text-paper-muted">{session.state.error}</p>
            <button
              type="button"
              onClick={() => void session.command('reload')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-haze px-3 py-1.5 text-[13px]"
            >
              <RefreshCw size={14} />
              <span>重新加载</span>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
