import { useCallback, useEffect, useState } from 'react'
import { LogIn, RefreshCw, ShieldCheck, UserRound, UserRoundPlus } from 'lucide-react'

import type { ZhihuRuntime } from '../runtime'
import type { ZhihuSessionSnapshot, ZhihuStoredAccount } from '../session/types'

interface Props {
  runtime: ZhihuRuntime
  onOpenEditor: () => void
  onOpenProfile: (urlToken: string) => void
  onOpenCollections: (urlToken: string) => void
}

export function ZhihuAccountScreen({ runtime, onOpenEditor, onOpenProfile, onOpenCollections }: Props) {
  const [snapshot, setSnapshot] = useState<ZhihuSessionSnapshot>(() => runtime.session.getSnapshot())
  const [accounts, setAccounts] = useState<ZhihuStoredAccount[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadAccounts = useCallback(async () => {
    setAccounts(await runtime.account.listAccounts())
  }, [runtime])

  useEffect(() => runtime.session.subscribe(setSnapshot), [runtime])
  useEffect(() => {
    let alive = true
    void runtime.account.hydrate()
      .then(async () => {
        if (alive) await reloadAccounts()
      })
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : '知乎会话恢复失败'))
    return () => { alive = false }
  }, [reloadAccounts, runtime])

  const authenticate = async () => {
    setBusy(true)
    setError(null)
    try {
      await runtime.account.authenticate()
      await reloadAccounts()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!message.includes('ZH_AUTH_CANCELLED')) setError(message)
    } finally {
      setBusy(false)
    }
  }

  const addAccount = async () => {
    setBusy(true)
    setError(null)
    try {
      await runtime.account.addAccount()
      await reloadAccounts()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!message.includes('ZH_AUTH_CANCELLED')) setError(message)
    } finally {
      setBusy(false)
    }
  }

  const switchAccount = async (accountId: string) => {
    if (accountId === snapshot.account?.id) return
    setBusy(true)
    setError(null)
    try {
      await runtime.account.switchAccount(accountId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账号切换失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await runtime.account.removeCurrentAccount()
      await reloadAccounts()
    } finally {
      setBusy(false)
    }
  }

  const active = accounts.find((item) => item.account.id === snapshot.account?.id)
  const authenticated = snapshot.auth === 'authenticated' && Boolean(snapshot.account)
  const activeToken = active?.account.urlToken || snapshot.account?.urlToken || snapshot.account?.id

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-5 sm:px-6">
      <section className="rounded-2xl border border-haze/70 bg-ink-raised/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {active?.account.avatarUrl ? (
            <img src={active.account.avatarUrl} alt="" className="size-14 rounded-xl object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-xl bg-ink text-paper-muted"><UserRound size={24} /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-semibold text-paper">
              {authenticated ? active?.account.name || snapshot.account?.name || '知乎账号' : '知乎账号'}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-paper-muted">
              {authenticated
                ? active?.account.headline || '已登录知乎'
                : snapshot.auth === 'verification-required'
                  ? '知乎要求完成安全验证，点击下方按钮回到第一方页面继续。'
                  : snapshot.auth === 'expired'
                    ? '当前会话已失效，请重新认证。'
                    : '登录或注册均在知乎第一方页面完成，NewsNook 不读取密码。'}
            </p>
          </div>
          {authenticated && <ShieldCheck size={20} className="shrink-0 text-cinnabar" />}
        </div>

        {error && <div role="alert" className="mt-3 rounded-lg border border-cinnabar/35 bg-cinnabar/5 px-3 py-2 text-[12px] text-paper">{error}</div>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !runtime.account.isNativeAuthAvailable()}
            onClick={() => void authenticate()}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cinnabar px-4 text-[12px] font-medium text-white disabled:opacity-45"
          >
            {authenticated ? <RefreshCw size={15} /> : <LogIn size={15} />}
            {busy ? '处理中…' : authenticated ? '重新验证' : '登录 / 注册'}
          </button>
          {authenticated && (
            <>
              <button type="button" disabled={busy || !runtime.account.isNativeAuthAvailable()} onClick={() => void addAccount()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-haze px-4 text-[12px] text-paper hover:border-paper-faint/40 disabled:opacity-45">
                <UserRoundPlus size={15} />添加账号
              </button>
              <button type="button" disabled={busy} onClick={onOpenEditor} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-haze px-4 text-[12px] text-paper hover:border-paper-faint/40">
                <UserRoundPlus size={15} />创作与草稿
              </button>
              <button type="button" disabled={busy || !activeToken} onClick={() => activeToken && onOpenProfile(activeToken)} className="min-h-10 rounded-xl border border-haze px-4 text-[12px] text-paper hover:border-paper-faint/40 disabled:opacity-45">
                我的主页
              </button>
              <button type="button" disabled={busy || !activeToken} onClick={() => activeToken && onOpenCollections(activeToken)} className="min-h-10 rounded-xl border border-haze px-4 text-[12px] text-paper hover:border-paper-faint/40 disabled:opacity-45">
                我的收藏夹
              </button>
            </>
          )}
          {snapshot.account && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-10 rounded-xl border border-haze px-4 text-[12px] text-paper-muted hover:text-paper">
              从本机移除
            </button>
          )}
        </div>

        {!runtime.account.isNativeAuthAvailable() && (
          <p className="mt-3 font-mono text-[10px] leading-5 text-paper-faint">知乎账号登录请在 NewsNook Android 应用中使用。</p>
        )}
      </section>

      {accounts.length > 0 && (
        <section className="mt-4 rounded-2xl border border-haze/70 bg-ink-raised/50 p-4">
          <h3 className="font-display text-[15px] font-semibold text-paper">账号</h3>
          <div className="mt-3 space-y-2">
            {accounts.map((item) => (
              <button
                key={item.account.id}
                type="button"
                disabled={busy}
                onClick={() => void switchAccount(item.account.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${item.account.id === snapshot.account?.id ? 'border-cinnabar/45 bg-cinnabar/5' : 'border-haze/70 bg-ink/35'}`}
              >
                {item.account.avatarUrl ? <img src={item.account.avatarUrl} alt="" className="size-9 rounded-lg object-cover" /> : <UserRound size={18} className="text-paper-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-paper">{item.account.name || item.account.urlToken || item.account.id}</span>
                  <span className="block truncate font-mono text-[9.5px] text-paper-faint">{item.account.id}</span>
                </span>
                {item.account.id === snapshot.account?.id && <span className="font-mono text-[9px] text-cinnabar">当前</span>}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
