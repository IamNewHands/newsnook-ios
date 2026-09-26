import { Check, X } from 'lucide-react'

import type { TranslationProviderOption } from '../features/translation/config'
import type { TranslationProviderId } from '../features/translation/types'

interface Props {
  open: boolean
  active: TranslationProviderId
  providers: TranslationProviderOption[]
  onClose: () => void
  onSelect: (provider: TranslationProviderId) => void
}

/**
 * 正文界面的翻译通道切换：读到一半想换个引擎，不用退回「我的 → 翻译」。
 * 选项由调用方从 `availableTranslationProviders()` 传入，与设置页共用同一份判断。
 */
export function TranslationChannelSheet({ open, active, providers, onClose, onSelect }: Props) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-no-page-tap>
      <button
        type="button"
        aria-label="关闭翻译通道选择"
        className="min-h-0 flex-1 bg-ink/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="选择翻译通道"
        className="max-h-[70vh] shrink-0 overflow-y-auto border-t border-haze bg-ink pt-3"
        style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
      >
        <div className="page-x mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">
              翻译通道
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center text-paper-muted"
            >
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>

          <ul className="mt-2 divide-y divide-haze border-y border-haze">
            {providers.map((provider) => {
              const checked = provider.id === active
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => onSelect(provider.id)}
                    className="flex min-h-[64px] w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[14px] ${checked ? 'text-cinnabar-soft' : 'text-paper'}`}
                      >
                        {provider.label}
                      </span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-paper-faint">
                        {provider.caption}
                      </span>
                    </span>
                    {checked && (
                      <Check size={15} strokeWidth={2.2} className="shrink-0 text-cinnabar" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="mt-3 text-[10.5px] leading-relaxed text-paper-faint">
            这里只切换翻译通道；原文语言、目标语言与显示方式仍在「我的 → 翻译」里调整。
          </p>
        </div>
      </div>
    </div>
  )
}
