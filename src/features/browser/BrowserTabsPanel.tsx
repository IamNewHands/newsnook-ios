import { AlertCircle, Globe2, Home, LoaderCircle, Plus, X } from 'lucide-react'
import { BrowserPageHeader } from './BrowserPrimitives'

export interface BrowserTabItem {
  index: number
  id: number
  title: string
  url: string
  active: boolean
  loading: boolean
  error?: string
}

interface BrowserTabsPanelProps {
  tabs: BrowserTabItem[]
  pending: boolean
  onBack: () => void
  onSelect: (tab: BrowserTabItem) => void
  onRemove: (tab: BrowserTabItem) => void
  onNew: () => void
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || '主页'
  } catch {
    return url || '主页'
  }
}

export function BrowserTabsPanel({
  tabs,
  pending,
  onBack,
  onSelect,
  onRemove,
  onNew,
}: BrowserTabsPanelProps) {
  const atLimit = tabs.length >= 6

  return (
    <section
      aria-label="标签页"
      aria-busy={pending}
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-ink text-paper"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      <BrowserPageHeader title="标签页" onBack={onBack}>
        <span className="px-3 text-sm tabular-nums text-paper-muted" aria-label={'已打开 ' + (tabs.length || 1) + ' 个标签页'}>
          {tabs.length || 1}
        </span>
      </BrowserPageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="grid grid-cols-2 items-stretch gap-3">
          {tabs.length === 0 ? (
            <button
              type="button"
              aria-label="返回主页"
              aria-current="page"
              onClick={onBack}
              className="flex min-h-44 min-w-0 flex-col rounded-2xl border border-cinnabar bg-cinnabar/5 p-3 text-left transition-colors hover:bg-haze active:bg-haze focus-visible:outline-2 focus-visible:outline-cinnabar"
            >
              <span className="flex h-8 items-center gap-2 text-cinnabar">
                <Home size={20} aria-hidden="true" />
                <span className="text-sm font-medium">当前</span>
              </span>
              <span className="mt-5 text-base font-medium text-paper">主页</span>
            </button>
          ) : tabs.map(tab => {
            const tabTitle = tab.title || hostname(tab.url)
            return (
              <article
                key={tab.id}
                className={'relative min-w-0 overflow-hidden rounded-2xl border transition-colors '
                  + (tab.active ? 'border-cinnabar bg-cinnabar/5' : 'border-haze bg-ink-raised')}
              >
                <button
                  type="button"
                  aria-label={'打开标签页：' + tabTitle}
                  aria-current={tab.active ? 'page' : undefined}
                  disabled={pending}
                  onClick={() => onSelect(tab)}
                  className="flex h-full min-h-44 w-full min-w-0 flex-col p-3 text-left transition-colors hover:bg-haze active:bg-haze disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cinnabar"
                >
                  <span className={'flex h-8 items-center gap-2 pr-8 ' + (tab.active ? 'text-cinnabar' : 'text-paper-faint')}>
                    <Globe2 size={20} className="shrink-0" aria-hidden="true" />
                    {tab.active && <span className="text-sm font-medium">当前</span>}
                  </span>
                  <span className="mt-4 line-clamp-2 break-words text-[15px] font-medium leading-6 text-paper">
                    {tabTitle}
                  </span>
                  <span className="mt-1 block max-w-full truncate text-sm text-paper-muted">
                    {hostname(tab.url)}
                  </span>
                  {(tab.loading || tab.error) && (
                    <span className="mt-auto flex items-center gap-1.5 pt-3 text-sm text-paper-muted">
                      {tab.loading ? (
                        <LoaderCircle size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : <AlertCircle size={14} className="shrink-0" aria-hidden="true" />}
                      {tab.loading ? '正在加载' : '加载失败'}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={'关闭标签页：' + tabTitle}
                  disabled={pending}
                  onClick={() => onRemove(tab)}
                  className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-xl text-paper-muted transition-colors hover:bg-ink hover:text-paper active:bg-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cinnabar"
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </article>
            )
          })}
        </div>
      </div>

      <footer className="shrink-0 border-t border-haze px-4 pt-3 pb-4">
        {(atLimit || pending) && (
          <p id="browser-tabs-status" role="status" className="mb-3 text-center text-sm text-paper-muted">
            {pending ? '正在更新标签页…' : '最多同时打开 6 个标签页'}
          </p>
        )}
        <button
          type="button"
          aria-label="新建标签页"
          aria-describedby={atLimit || pending ? 'browser-tabs-status' : undefined}
          disabled={atLimit || pending}
          onClick={onNew}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-4 py-3 text-base font-semibold text-cinnabar transition-colors hover:bg-cinnabar/15 active:bg-cinnabar/20 disabled:border-haze disabled:bg-ink-raised disabled:text-paper-faint focus-visible:outline-2 focus-visible:outline-cinnabar"
        >
          <Plus size={20} aria-hidden="true" />
          新建标签页
        </button>
      </footer>
    </section>
  )
}
