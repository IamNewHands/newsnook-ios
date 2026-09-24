import { Check, Loader2, RotateCw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { LinuxDoSessionSnapshot } from '../types'
import { linuxDoConnect } from './service'
import { LinuxDoConnectError, type LinuxDoTrustLevelData, type LinuxDoTrustMetric, type LinuxDoTrustVeto } from './types'

function ratio(metric: Pick<LinuxDoTrustMetric, 'current' | 'target'>): number {
  if (metric.target <= 0) return 1
  return Math.max(0, Math.min(1, metric.current / metric.target))
}

function displayNumber(value: number, fallback: string): string {
  if (fallback.trim()) return fallback.trim()
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function ProgressRing({ metric }: { metric: LinuxDoTrustMetric }) {
  const radius = 31
  const circumference = 2 * Math.PI * radius
  const progress = ratio(metric)
  const offset = circumference * (1 - progress)
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="relative h-[82px] w-[82px] sm:h-[92px] sm:w-[92px]" role="img" aria-label={metric.label + ' ' + metric.current + '/' + metric.target}>
        <svg className="h-full w-full -rotate-90" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r={radius} fill="none" stroke="currentColor" strokeWidth="7" className="text-paper/[0.07]" />
          <circle
            cx="38"
            cy="38"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={metric.met ? 'text-[#20c36b]' : 'text-cinnabar'}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="leading-none">
            <div className={'font-mono text-[12px] font-bold ' + (metric.met ? 'text-[#20c36b]' : 'text-cinnabar')}>
              {displayNumber(metric.current, metric.currentText)}
            </div>
            <div className="mt-1 font-mono text-[8.5px] text-paper-faint">/ {displayNumber(metric.target, metric.targetText)}</div>
          </div>
        </div>
      </div>
      <div className="mt-1.5 truncate text-[10.5px] font-medium text-paper-muted sm:text-[11px]">{metric.label}</div>
    </div>
  )
}

function ProgressRow({ metric }: { metric: LinuxDoTrustMetric }) {
  const progress = ratio(metric) * 100
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[10.5px] sm:text-[11px]">
        <span className="font-medium text-paper-muted">{metric.label}</span>
        <span className={'shrink-0 font-mono font-semibold ' + (metric.met ? 'text-[#20c36b]' : 'text-cinnabar')}>
          {displayNumber(metric.current, metric.currentText)}/{displayNumber(metric.target, metric.targetText)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-paper/[0.06]">
        <div
          className={'h-full rounded-full transition-[width] duration-500 ' + (metric.met ? 'bg-[#20c36b]' : 'bg-cinnabar')}
          style={{ width: String(progress) + '%' }}
        />
      </div>
    </div>
  )
}

function QuotaCard({ metric }: { metric: LinuxDoTrustMetric }) {
  const segmentCount = Math.max(1, Math.min(10, Math.round(metric.target || 5)))
  return (
    <div className="rounded-2xl border border-haze/65 bg-ink-raised/55 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-medium text-paper-muted">{metric.label}</span>
        <span className={'font-mono text-[10px] font-semibold ' + (metric.met ? 'text-paper-faint' : 'text-cinnabar')}>
          {displayNumber(metric.current, metric.currentText)} / {displayNumber(metric.target, metric.targetText)}
        </span>
      </div>
      <div className="mt-2.5 grid gap-1" style={{ gridTemplateColumns: 'repeat(' + segmentCount + ', minmax(0, 1fr))' }}>
        {Array.from({ length: segmentCount }, (_, index) => (
          <span
            key={index}
            className={'h-1.5 rounded-full ' + (metric.met ? 'bg-[#20c36b]/25' : 'bg-cinnabar/20')}
          />
        ))}
      </div>
    </div>
  )
}

function VetoCard({ item }: { item: LinuxDoTrustVeto }) {
  return (
    <div className={'flex items-center gap-3 rounded-2xl border px-3.5 py-3 ' + (item.met ? 'border-[#20c36b]/25 bg-[#20c36b]/[0.07]' : 'border-cinnabar/25 bg-cinnabar/[0.07]')}>
      <span className={'grid h-7 w-7 shrink-0 place-items-center rounded-full ' + (item.met ? 'bg-[#20c36b]/12 text-[#20c36b]' : 'bg-cinnabar/12 text-cinnabar')}>
        <Check size={14} strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10.5px] font-semibold text-paper">{item.label}</span>
        {item.description ? <span className="mt-0.5 block truncate text-[9px] text-paper-faint">{item.description}</span> : null}
      </span>
      <span className={'shrink-0 font-mono text-[11px] font-bold ' + (item.met ? 'text-[#20c36b]' : 'text-cinnabar')}>{item.valueText}</span>
    </div>
  )
}

function TrustSkeleton() {
  return (
    <div className="page-x pb-6 pt-4" role="status" aria-label="正在加载信任等级">
      <div className="linuxdo-skeleton h-[520px] rounded-[24px] border border-haze/50" />
    </div>
  )
}

function TrustError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="page-x py-12">
      <div className="mx-auto max-w-md rounded-[22px] border border-haze/70 bg-ink-raised/60 px-5 py-7 text-center">
        <ShieldCheck size={28} strokeWidth={1.5} className="mx-auto text-paper-faint" />
        <p className="mt-3 text-[12px] font-medium text-paper">暂时无法获取信任等级数据</p>
        <p className="mt-1.5 text-[10.5px] leading-5 text-paper-faint">{message}</p>
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="linuxdo-control mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-haze bg-paper/[0.04] px-4 text-[10.5px] font-medium text-paper-muted disabled:opacity-45"
        >
          {retrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
          {retrying ? '正在重试' : '重新加载'}
        </button>
      </div>
    </div>
  )
}

export function TrustLevelView({ session }: { session: LinuxDoSessionSnapshot }) {
  const [data, setData] = useState<LinuxDoTrustLevelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const generationRef = useRef(0)
  const dataRef = useRef<LinuxDoTrustLevelData | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const load = useCallback(async (force = false) => {
    const generation = ++generationRef.current
    if (force) setRetrying(true)
    else setLoading(true)
    setError('')
    try {
      const next = await linuxDoConnect.trustLevel(session.currentUser?.username, force)
      if (generation !== generationRef.current) return
      setData(next)
    } catch (nextError) {
      if (generation !== generationRef.current) return
      const message = nextError instanceof LinuxDoConnectError || nextError instanceof Error
        ? nextError.message
        : '未知错误'
      setError(message)
      if (!dataRef.current) setData(null)
    } finally {
      if (generation === generationRef.current) {
        setLoading(false)
        setRetrying(false)
      }
    }
  }, [session.currentUser?.username])

  useEffect(() => {
    dataRef.current = null
    setData(null)
    void load(false)
    return () => { generationRef.current += 1 }
  }, [load])

  const subtitle = useMemo(() => {
    const account = data?.username ? '@' + data.username : session.currentUser?.username ? '@' + session.currentUser.username : ''
    return [account, data?.periodLabel].filter(Boolean).join(' · ')
  }, [data?.periodLabel, data?.username, session.currentUser?.username])

  if (loading && !data) return <TrustSkeleton />
  if (!data) return <TrustError message={error || '未读取到 Connect 数据'} onRetry={() => void load(true)} retrying={retrying} />

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-6 pt-3">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-[24px] border border-haze/65 bg-ink-raised/50 shadow-[0_12px_35px_-30px_rgba(0,0,0,0.55)]">
        <header className="flex items-start justify-between gap-4 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold tracking-[-0.02em] text-paper sm:text-[17px]">{data.title}</h2>
            <p className="mt-1 truncate text-[9.5px] text-paper-faint sm:text-[10px]">{subtitle}</p>
          </div>
          <span className={'shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold ' + (data.achieved ? 'bg-[#20c36b]/10 text-[#20c36b]' : 'bg-cinnabar/10 text-cinnabar')}>
            {data.statusLabel}
          </span>
        </header>

        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <section>
            <h3 className="mb-3 text-[10px] font-semibold text-paper-muted">活跃程度</h3>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-paper/[0.018] px-1 py-2 sm:px-4 sm:py-3">
              {data.activity.map((metric) => <ProgressRing key={metric.label} metric={metric} />)}
            </div>
          </section>

          <section className="mt-4">
            <h3 className="mb-3 text-[10px] font-semibold text-paper-muted">互动参与</h3>
            <div className="space-y-3">
              {data.participation.map((metric) => <ProgressRow key={metric.label} metric={metric} />)}
            </div>
          </section>

          <section className="mt-4">
            <h3 className="mb-3 text-[10px] font-semibold text-paper-muted">合规记录</h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {data.compliance.map((metric) => <QuotaCard key={metric.label} metric={metric} />)}
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {data.vetoes.map((item) => <VetoCard key={item.label} item={item} />)}
            </div>
          </section>

          <footer className="mt-4 border-t border-haze/55 pt-3">
            {data.footnote ? <p className="text-[9px] leading-5 text-paper-faint">{data.footnote}</p> : null}
            <p className={'mt-1 text-[10px] font-semibold ' + (data.achieved ? 'text-[#20c36b]' : 'text-cinnabar')}>{data.resultText}</p>
          </footer>

          {error ? (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void load(true)}
              className="linuxdo-control mt-3 inline-flex items-center gap-1.5 text-[9px] text-paper-faint"
              aria-label="数据刷新失败，点击重试"
            >
              <RotateCw size={10} className={retrying ? 'animate-spin' : ''} />
              刷新失败，保留上次数据
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
