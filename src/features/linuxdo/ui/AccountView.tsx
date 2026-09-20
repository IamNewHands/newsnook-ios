import { Capacitor } from '@capacitor/core'
import { Bookmark, Eye, EyeOff, FileText, History, KeyRound, Loader2, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
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
import {
  loginLinuxDoWithPassword,
  type LinuxDoSecondFactorMethod,
} from '../session/password'
import type { LinuxDoSessionSnapshot } from '../types'
import { avatar, readableError } from './utils'

export function AccountView({
  session,
  onSession,
  onBookmarks,
  onProfile,
}: {
  session: LinuxDoSessionSnapshot
  onSession: (next: LinuxDoSessionSnapshot) => void
  onBookmarks: () => void
  onProfile: (username: string) => void
}) {
  const caps = linuxDoCapabilities()
  const native = Capacitor.isNativePlatform()
  const [accountError, setAccountError] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [secondFactor, setSecondFactor] = useState<{
    totpEnabled: boolean
    backupEnabled: boolean
    securityKeyEnabled: boolean
  } | null>(null)
  const [secondFactorToken, setSecondFactorToken] = useState('')
  const [secondFactorMethod, setSecondFactorMethod] = useState<LinuxDoSecondFactorMethod>('totp')
  const [thirdPartySigningIn, setThirdPartySigningIn] = useState(false)

  const applySession = (next: LinuxDoSessionSnapshot) => {
    api.setSession(next)
    onSession(next)
  }

  const resetSecrets = () => {
    setPassword('')
    setSecondFactorToken('')
    setSecondFactor(null)
    setShowPassword(false)
  }

  const passwordLogin = async () => {
    if (!native || signingIn) return
    setAccountError('')
    setSigningIn(true)
    try {
      const result = await loginLinuxDoWithPassword({
        login,
        password,
        secondFactorToken: secondFactor ? secondFactorToken : undefined,
        secondFactorMethod: secondFactor ? secondFactorMethod : undefined,
      })
      if (result.kind === 'second-factor') {
        setSecondFactor({
          totpEnabled: result.totpEnabled,
          backupEnabled: result.backupEnabled,
          securityKeyEnabled: result.securityKeyEnabled,
        })
        setSecondFactorMethod(result.totpEnabled ? 'totp' : 'backup')
        setSecondFactorToken('')
        setAccountError(result.message)
        return
      }

      applySession(result.session)
      resetSecrets()
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
      const next = await authenticateLinuxDo()
      applySession(next)
      resetSecrets()
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
      await verifyLinuxDoBrowserSession('https://linux.do/')
      setAccountError('Cloudflare / 浏览器验证已完成。App 内登录请继续使用账号密码。')
    } catch (error) {
      setAccountError(readableError(error))
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-5">
      <section className="mb-4 overflow-hidden rounded-[28px] border border-haze/70 bg-ink-raised p-5 shadow-[0_14px_36px_rgb(47_86_143_/_0.09)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cinnabar/10 px-3 py-1 text-[10px] font-semibold text-cinnabar"><ShieldCheck size={12} />第一方安全登录</div>
            <h2 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-paper">{session.authenticated ? '欢迎回来' : '登录 Linux.do'}</h2>
            <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-paper-muted">{session.authenticated ? '当前会话只保存在设备的 Linux.do 第一方会话中。' : '账号密码直接提交给 Linux.do，不经过 NewsNook 服务器，也不会保存密码。'}</p>
          </div>
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cinnabar/10 text-cinnabar"><LockKeyhole size={25} /></div>
        </div>
      </section>

      <section className="rounded-[24px] border border-haze/70 bg-ink-raised p-5 shadow-[0_10px_30px_rgb(47_86_143_/_0.07)]">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 overflow-hidden rounded-full border border-haze bg-ink-deep">{avatar(session.currentUser?.avatarTemplate, session.currentUser?.username)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-paper">{session.authenticated ? session.currentUser?.name || session.currentUser?.username : '未登录'}</div>
            <div className="mt-1 text-[11px] text-paper-faint">{session.authenticated ? '@' + session.currentUser?.username + (session.authMode === 'user-api-key' ? ' · 安全授权' : ' · 第一方会话') : '使用 Linux.do 账号/邮箱登录 App'}</div>
          </div>
        </div>

        {!session.authenticated ? (
          <div className="mt-5">
            {!secondFactor ? (
              <>
                <label className="block text-[10px] font-medium text-paper-muted">用户名或邮箱</label>
                <input autoCapitalize="none" autoCorrect="off" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder="username@example.com" className="mt-1.5 min-h-12 w-full rounded-2xl border border-haze bg-ink px-3.5 text-[13px] text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/45" />
                <label className="mt-3 block text-[10px] font-medium text-paper-muted">密码</label>
                <div className="relative mt-1.5">
                  <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void passwordLogin() }} placeholder="Linux.do 密码" className="min-h-12 w-full rounded-2xl border border-haze bg-ink px-3.5 pr-12 text-[13px] text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/45" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="linuxdo-control absolute inset-y-0 right-1 grid w-11 place-items-center text-paper-faint" aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
                <button type="button" disabled={!native || signingIn || !login.trim() || !password} onClick={() => void passwordLogin()} className="linuxdo-control mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cinnabar px-4 py-3 text-[12.5px] font-semibold text-white shadow-[0_10px_26px_rgb(22_119_255_/_0.24)] disabled:opacity-45">{signingIn ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}{signingIn ? '正在登录…' : native ? '登录 Linux.do' : '请在 App 中登录'}</button>
              </>
            ) : (
              <div className="rounded-2xl border border-cinnabar/20 bg-cinnabar/[0.045] p-4">
                <div className="flex items-start gap-3"><KeyRound size={18} className="mt-0.5 shrink-0 text-cinnabar" /><div><div className="text-[12px] font-semibold text-paper">需要二次验证</div><div className="mt-1 text-[10px] leading-5 text-paper-muted">输入 Linux.do 的动态验证码或备用码。密码只暂存在当前登录表单内。</div></div></div>
                {secondFactor.totpEnabled && secondFactor.backupEnabled ? <div className="mt-3 grid grid-cols-2 rounded-xl bg-ink-deep p-1"><button type="button" onClick={() => { setSecondFactorMethod('totp'); setSecondFactorToken('') }} className={'linuxdo-control min-h-9 rounded-lg text-[10.5px] font-medium ' + (secondFactorMethod === 'totp' ? 'bg-ink-raised text-cinnabar shadow-sm' : 'text-paper-muted')}>动态验证码</button><button type="button" onClick={() => { setSecondFactorMethod('backup'); setSecondFactorToken('') }} className={'linuxdo-control min-h-9 rounded-lg text-[10.5px] font-medium ' + (secondFactorMethod === 'backup' ? 'bg-ink-raised text-cinnabar shadow-sm' : 'text-paper-muted')}>备用码</button></div> : null}
                <input inputMode={secondFactorMethod === 'totp' ? 'numeric' : 'text'} autoComplete="one-time-code" value={secondFactorToken} onChange={(event) => setSecondFactorToken(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void passwordLogin() }} placeholder={secondFactorMethod === 'totp' ? '6 位动态验证码' : '备用验证码'} className="mt-3 min-h-12 w-full rounded-2xl border border-haze bg-ink px-3.5 text-[14px] tracking-[0.08em] text-paper outline-none placeholder:tracking-normal placeholder:text-paper-faint focus:border-cinnabar/45" />
                {secondFactor.securityKeyEnabled ? <p className="mt-2 text-[9.5px] leading-4 text-paper-faint">账号还启用了安全密钥 / Passkey；NewsNook 当前仅处理 TOTP 与备用码，安全密钥请在浏览器完成。</p> : null}
                <div className="mt-3 flex gap-2"><button type="button" disabled={signingIn || !secondFactorToken.trim()} onClick={() => void passwordLogin()} className="linuxdo-control min-h-11 flex-1 rounded-xl bg-cinnabar px-3 text-[11.5px] font-semibold text-white disabled:opacity-45">{signingIn ? '验证中…' : '确认验证'}</button><button type="button" onClick={resetSecrets} className="linuxdo-control min-h-11 rounded-xl border border-haze px-4 text-[11px] text-paper-muted">取消</button></div>
              </div>
            )}

            <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-haze" /><span className="text-[9.5px] text-paper-faint">第三方账号</span><span className="h-px flex-1 bg-haze" /></div>
            <button type="button" disabled={!native || thirdPartySigningIn} onClick={() => void openThirdPartyLogin()} className="linuxdo-control min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-4 text-[11.5px] font-medium text-paper-muted disabled:opacity-45">{thirdPartySigningIn ? '等待 Linux.do 授权完成…' : 'GitHub / Google 等第三方登录（系统浏览器）'}</button>
            <p className="mt-2 text-[9.5px] leading-4 text-paper-faint">将在系统浏览器打开 Linux.do 的官方授权流程。你可以使用 Linux.do 当前启用的 GitHub、Google 等第三方账号登录；完成授权后会自动回到 NewsNook，并建立可用于发帖、回复、点赞与书签的安全会话。</p>
            {thirdPartySigningIn ? <div className="mt-2 rounded-xl bg-ink-deep px-3 py-2"><p className="text-[9.5px] leading-4 text-paper-muted">系统浏览器登录完成后请继续确认“授权 NewsNook”，随后会自动返回 App。NewsNook 不读取浏览器 Cookie，凭据由 Linux.do 使用 RSA 加密后回传。</p><button type="button" onClick={() => void cancelThirdPartyLogin()} className="linuxdo-control mt-2 text-[9.5px] font-medium text-cinnabar">取消第三方登录</button></div> : null}
          </div>
        ) : (
          <div className="mt-5">
            <button type="button" onClick={async () => { if (session.authMode === 'user-api-key') await clearLinuxDoSession(); else await clearLinuxDoBrowserSession(); applySession({ authenticated: false, authMode: 'none' }); resetSecrets() }} className="linuxdo-control min-h-11 w-full rounded-xl border border-haze px-4 text-[11.5px] text-paper-muted">退出账号</button>
          </div>
        )}

        <div className="mt-4 border-t border-haze/70 pt-3">
          <button type="button" onClick={() => void verifyBrowser()} className="linuxdo-control text-[9.5px] text-paper-faint underline decoration-haze underline-offset-4">Cloudflare / 浏览器验证辅助</button>
          <span className="mx-2 text-paper-faint">·</span>
          <button type="button" onClick={async () => { await clearLinuxDoBrowserSession(); setAccountError('') }} className="linuxdo-control text-[9.5px] text-paper-faint underline decoration-haze underline-offset-4">清除验证数据</button>
        </div>
        {accountError ? <button type="button" onClick={() => setAccountError('')} className="mt-3 w-full rounded-xl border border-cinnabar/20 bg-cinnabar/[0.06] px-3 py-2 text-left text-[10.5px] leading-5 text-cinnabar">{accountError} · 点击关闭</button> : null}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onBookmarks} className="linuxdo-control rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 text-left shadow-[0_8px_24px_rgb(47_86_143_/_0.06)]"><Bookmark size={18} className="mb-2 text-[#f5b326]" /><div className="text-[11.5px] font-semibold text-paper">书签</div><div className="mt-1 text-[9.5px] text-paper-faint">{caps.bookmarks ? '查看收藏的楼层与主题' : '不可用'}</div></button>
        <button type="button" disabled={!session.currentUser?.username} onClick={() => session.currentUser?.username && onProfile(session.currentUser.username)} className="linuxdo-control rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 text-left shadow-[0_8px_24px_rgb(47_86_143_/_0.06)] disabled:opacity-50"><UserRound size={18} className="mb-2 text-cinnabar" /><div className="text-[11.5px] font-semibold text-paper">个人主页</div><div className="mt-1 text-[9.5px] text-paper-faint">主题、活动、Boost 与统计</div></button>
        <div className="rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 shadow-[0_8px_24px_rgb(47_86_143_/_0.06)]"><FileText size={18} className="mb-2 text-[#7b61ff]" /><div className="text-[11.5px] font-semibold text-paper">草稿</div><div className="mt-1 text-[9.5px] text-paper-faint">{caps.drafts ? '自动保存与恢复已启用' : '不可用'}</div></div>
        <div className="rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 shadow-[0_8px_24px_rgb(47_86_143_/_0.06)]"><History size={18} className="mb-2 text-[#2ab66f]" /><div className="text-[11.5px] font-semibold text-paper">媒体与附件</div><div className="mt-1 text-[9.5px] text-paper-faint">{caps.uploads ? '原生上传与图片预览已启用' : '不可用'}</div></div>
      </div>
      {!caps.boost.available ? <p className="mt-4 rounded-[18px] border border-haze/50 bg-ink-raised px-4 py-3 text-[10.5px] leading-5 text-paper-faint">{caps.boost.reason}</p> : null}
    </div>
  )
}
