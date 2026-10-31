import { Capacitor } from '@capacitor/core'
import {
  BadgeCheck,
  Bookmark,
  FileText,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useState } from 'react'

import { linuxDoCapabilities } from '../capabilities'
import { linuxDoApi as api } from '../runtime'
import {
  authenticateLinuxDo,
  cancelLinuxDoAuthentication,
  clearLinuxDoBrowserSession,
  clearLinuxDoSession,
  verifyLinuxDoBrowserSession,
} from '../session/native'
import { loginLinuxDoWithPassword } from '../session/password'
import type { LinuxDoSessionSnapshot, LinuxDoTopicSummary } from '../types'
import { readableError } from './utils'
import { UserProfileView, type UserProfileTab } from './UserProfileView'
import type { LinuxDoProfileDraft } from '../people/sections'
import type { LinuxDoVerify } from './VerificationAction'

export function AccountView({
  session,
  onSession,
  onBookmarks,
  onProfile,
  onTrustLevel,
  onPrivateMessages,
  onOpenTopic,
  onOpenUser,
  onResumeDraft,
  onVerify,
}: {
  session: LinuxDoSessionSnapshot
  onSession: (next: LinuxDoSessionSnapshot) => void
  onBookmarks: () => void
  onProfile: (username: string, tab?: UserProfileTab) => void
  onTrustLevel: () => void
  onPrivateMessages?: () => void
  onOpenTopic?: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser?: (username: string) => void
  onResumeDraft?: (draft: LinuxDoProfileDraft) => Promise<void>
  onVerify?: LinuxDoVerify
}) {
  const caps = linuxDoCapabilities()
  const native = Capacitor.isNativePlatform()
  const [accountError, setAccountError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [thirdPartySigningIn, setThirdPartySigningIn] = useState(false)

  const applySession = (next: LinuxDoSessionSnapshot) => {
    api.setSession(next)
    onSession(next)
  }

  const passwordLogin = async () => {
    if (!native || signingIn) return
    setAccountError('')
    setSigningIn(true)
    try {
      applySession(await loginLinuxDoWithPassword())
    } catch (error) {
      setAccountError(readableError(error))
    } finally {
      setSigningIn(false)
    }
  }

  const openThirdPartyLogin = async () => {
    if (!native || thirdPartySigningIn) return
    setAccountError('')
    setThirdPartySigningIn(true)
    try {
      applySession(await authenticateLinuxDo())
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
      if (code !== 'LINUXDO_USER_API_CANCELLED') setAccountError(readableError(error))
    } finally {
      setThirdPartySigningIn(false)
    }
  }

  const cancelThirdPartyLogin = async () => {
    try {
      await cancelLinuxDoAuthentication()
    } finally {
      setThirdPartySigningIn(false)
      setAccountError('')
    }
  }

  const verifyBrowser = async () => {
    setAccountError('')
    try {
      const next = await verifyLinuxDoBrowserSession('https://linux.do/')
      applySession(next)
      setAccountError(next.authenticated ? '浏览器会话已登录；阅读记录是否同步成功仍以提交结果为准。' : '浏览器会话尚未登录，请先登录 Linux.do。')
    } catch (error) {
      setAccountError(readableError(error))
    }
  }

  const logout = async () => {
    await Promise.all([clearLinuxDoSession(), clearLinuxDoBrowserSession()])
    applySession({ authenticated: false, authMode: 'none' })
  }

  // 已登录状态：直接呈现融合了快捷工具与安全运维的完整个人社区中心
  if (session.authenticated && session.currentUser?.username) {
    return (
      <UserProfileView
        username={session.currentUser.username}
        session={session}
        accountControls={{
          onPrivateMessages: onPrivateMessages || (() => {}),
          onBookmarks,
          onTrustLevel,
          onLogout: logout,
          onVerifyBrowser: verifyBrowser,
          onClearBrowserSession: async () => {
            await clearLinuxDoBrowserSession()
            setAccountError('')
          },
          accountError,
          onClearAccountError: () => setAccountError(''),
          capabilities: caps,
        }}
        onOpenTopic={onOpenTopic || (() => {})}
        onOpenUser={onOpenUser || ((u) => onProfile(u))}
        onResumeDraft={onResumeDraft}
        onVerify={onVerify}
      />
    )
  }

  // 未登录状态：极客数字工坊专属迎新通行证与安全网关 (Direction A)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-6 pt-4">
      {/* 极客通行证迎新网关 (Integrated Cyber Terminal Gateway) */}
      <section className="linuxdo-terminal-canvas linuxdo-terminal-grid mb-4 overflow-hidden rounded-[26px] p-5 sm:p-6 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-cinnabar/25 bg-cinnabar/10 px-3 py-1 text-[10.5px] font-semibold text-cinnabar">
              <ShieldCheck size={13} />
              <span>第一方安全登录</span>
              <span className="h-1 w-1 rounded-full bg-cinnabar" />
              <span className="font-mono text-[9px] text-cinnabar-soft">端侧隔离</span>
            </div>
            <h2 className="mt-3 text-[22px] font-bold tracking-tight text-paper sm:text-[24px]">探索 Linux.do 极客社区</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-paper-muted">
              连接技术真知，沉淀极客声誉。登录后畅享私信互动、信任等级追踪、草稿多端续写与深度书签。
            </p>
          </div>
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-cinnabar/20 bg-cinnabar/10 text-cinnabar shadow-xs">
            <LockKeyhole size={26} />
          </div>
        </div>

        {/* 访客身份槽 */}
        <div className="mt-5 flex items-center gap-3.5 rounded-2xl border border-haze/50 bg-paper/[0.025] p-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-haze bg-ink-deep">
            <UserRound size={26} strokeWidth={1.5} className="text-paper-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-paper">Linux.do 访客通行证</div>
            <div className="mt-0.5 text-[10.5px] text-paper-faint">登录以解锁完整社区特权与专属声誉成长</div>
          </div>
        </div>

        {/* 登录操作中枢 */}
        <div className="mt-5 space-y-3">
          <button
            type="button"
            disabled={!native || signingIn}
            onClick={() => void passwordLogin()}
            className="linuxdo-control inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cinnabar px-4 py-3 text-[13px] font-bold text-white shadow-md transition-all hover:bg-cinnabar/90 active:scale-[0.985] disabled:opacity-45"
          >
            {signingIn ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            <span>{signingIn ? '等待官方页面登录完成…' : native ? '账号密码登录（Linux.do 官方页面）' : '请在 App 中登录'}</span>
          </button>
          <p className="text-[10px] leading-relaxed text-paper-faint">
            官方原生页面承接：支持 Cloudflare 人机验证、动态二次验证码、备用码与 Passkey。登录成功后点官方页面上方的“完成”。
          </p>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-haze/60" />
            <span className="font-mono text-[9.5px] font-medium tracking-wider text-paper-faint">第三方授权</span>
            <span className="h-px flex-1 bg-haze/60" />
          </div>

          <button
            type="button"
            disabled={!native || thirdPartySigningIn}
            onClick={() => void openThirdPartyLogin()}
            className="linuxdo-control linuxdo-key-card min-h-11 w-full rounded-xl px-4 text-[12px] font-medium text-paper-muted transition-colors hover:text-paper disabled:opacity-45"
          >
            {thirdPartySigningIn ? '等待 Linux.do 授权完成…' : 'GitHub / Google 等第三方登录（系统浏览器）'}
          </button>
          <p className="text-[10px] leading-relaxed text-paper-faint">
            系统浏览器完成 Linux.do 官方授权后自动返回，用一次性安全凭据建立第一方会话；浏览器 Cookie 不会被读取。
          </p>

          {thirdPartySigningIn ? (
            <div className="mt-2.5 rounded-xl border border-cinnabar/25 bg-cinnabar/5 p-3">
              <p className="text-[10px] leading-relaxed text-paper-muted">登录后请继续确认“授权 NewsNook”。返回 App 后将自动完成安全会话兑换。</p>
              <button
                type="button"
                onClick={() => void cancelThirdPartyLogin()}
                className="linuxdo-control mt-2 text-[10px] font-semibold text-cinnabar hover:underline"
              >
                取消第三方登录
              </button>
            </div>
          ) : null}
        </div>

        {/* 辅助维护命令 */}
        <div className="mt-5 flex items-center justify-between border-t border-haze/50 pt-3.5 text-[10.5px]">
          <button
            type="button"
            onClick={() => void verifyBrowser()}
            className="linuxdo-control text-paper-faint hover:text-paper underline decoration-haze underline-offset-4"
          >
            打开 Linux.do 登录页面
          </button>
          <span className="text-haze">·</span>
          <button
            type="button"
            onClick={async () => {
              await clearLinuxDoBrowserSession()
              setAccountError('')
            }}
            className="linuxdo-control text-paper-faint hover:text-paper underline decoration-haze underline-offset-4"
          >
            清除验证数据
          </button>
        </div>

        {accountError ? (
          <button
            type="button"
            onClick={() => setAccountError('')}
            className="mt-3.5 w-full rounded-xl border border-cinnabar/25 bg-cinnabar/[0.08] p-3 text-left text-[11px] leading-5 text-cinnabar"
          >
            {accountError} · 点击关闭
          </button>
        ) : null}
      </section>

      {/* 极客特权矩阵 (Cyber Privilege Matrix) */}
      <section className="grid grid-cols-2 gap-2.5">
        <div className="linuxdo-key-card rounded-2xl p-3.5">
          <Mail size={16} className="mb-2 text-cinnabar" />
          <div className="text-[12px] font-bold text-paper">个人私信</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">登录后即可收发社区私信与归档会话</div>
        </div>
        <button
          type="button"
          onClick={onTrustLevel}
          className="linuxdo-control linuxdo-key-card rounded-2xl border-[#20c36b]/25 bg-[#20c36b]/[0.05] p-3.5 text-left transition-all hover:border-[#20c36b]/40 hover:bg-[#20c36b]/[0.09]"
        >
          <BadgeCheck size={16} className="mb-2 text-[#20c36b]" />
          <div className="text-[12px] font-bold text-paper">信任等级</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">实时追踪 TL 等级升级要求与达成进度</div>
        </button>
        <button
          type="button"
          onClick={onBookmarks}
          className="linuxdo-control linuxdo-key-card rounded-2xl p-3.5 text-left transition-all hover:border-[#f5b326]/35"
        >
          <Bookmark size={16} className="mb-2 text-[#f5b326]" />
          <div className="text-[12px] font-bold text-paper">书签收藏</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">收藏精选楼层与深度主题，随时温故</div>
        </button>
        <div className="linuxdo-key-card rounded-2xl p-3.5">
          <FileText size={16} className="mb-2 text-[#7b61ff]" />
          <div className="text-[12px] font-bold text-paper">草稿续写</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">未完成的灵感自动留存，随时恢复编辑</div>
        </div>
      </section>
    </div>
  )
}
