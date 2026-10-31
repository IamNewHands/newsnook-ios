import { memo, useEffect } from 'react'
import { Check, Columns2, FileText, Languages, RefreshCw, Settings, Undo2, X } from 'lucide-react'

import { haptics } from '../lib/haptics'
import {
  translationLanguageLabel,
  translationProviderLabel,
} from '../features/translation/config'
import type { TranslationPrefs } from '../features/translation/types'

export type ReaderTranslationMode = 'original' | 'compare' | 'replace'

interface Props {
  open: boolean
  onClose: () => void
  currentMode: ReaderTranslationMode
  onSelectMode: (mode: ReaderTranslationMode) => void
  translationPrefs: TranslationPrefs
  resolvedSourceLanguage?: string
  hasError?: boolean
  errorMessage?: string
  onRetry?: () => void
  onOpenSettings?: () => void
}

/**
 * 译文呈现方式底部抽屉面板（Bottom Sheet）：
 * 全面适配移动端真机屏幕宽度与单手触达，带有实体不透明背景与毛玻璃遮罩，
 * 彻底杜绝文字重叠穿透与屏幕左侧溢出裁切问题。
 */
export const ReaderTranslationMenu = memo(function ReaderTranslationMenu({
  open,
  onClose,
  currentMode,
  onSelectMode,
  translationPrefs,
  resolvedSourceLanguage,
  hasError,
  errorMessage,
  onRetry,
  onOpenSettings,
}: Props) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const handleModeChange = (mode: ReaderTranslationMode) => {
    if (mode !== currentMode) {
      void haptics.selection()
      onSelectMode(mode)
    }
    onClose()
  }

  const sourceLang =
    resolvedSourceLanguage ||
    (translationPrefs.sourceLanguage === 'auto'
      ? '自动识别'
      : translationLanguageLabel(translationPrefs.sourceLanguage))
  const targetLang = translationLanguageLabel(translationPrefs.targetLanguage)
  const providerName = translationProviderLabel(translationPrefs.provider)

  const MODES: Array<{
    id: ReaderTranslationMode
    title: string
    caption: string
    Icon: typeof Columns2
  }> = [
    {
      id: 'compare',
      title: '双语对照',
      caption: '原文与译文逐段并列，对照研读',
      Icon: Columns2,
    },
    {
      id: 'replace',
      title: '仅显示译文',
      caption: '全文纯译文，沉浸流畅阅读',
      Icon: FileText,
    },
    {
      id: 'original',
      title: '查看原文',
      caption: '保留原始外文完整排版',
      Icon: Undo2,
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      data-no-page-tap
      role="dialog"
      aria-modal="true"
      aria-label="译文显示方式"
    >
      {/* 遮罩背景：半透明毛玻璃，点击任意空白区域关闭菜单 */}
      <button
        type="button"
        aria-label="关闭翻译菜单"
        className="min-h-0 flex-1 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 底部面板：实体不透明背景，杜绝正文文字穿透；圆角与内边距贴合系统安全区 */}
      <div
        className="w-full shrink-0 border-t border-haze bg-ink shadow-2xl transition-transform animate-in slide-in-from-bottom-6 duration-200"
        style={{ paddingBottom: 'calc(var(--sab) + 16px)' }}
      >
        <div className="page-x mx-auto w-full max-w-lg pt-4 pb-2 space-y-3">
          {/* 顶栏：标题与关闭按钮 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-paper">
              <span className="flex size-7 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                <Languages size={16} strokeWidth={2} />
              </span>
              <div>
                <h3 className="font-display text-[15px] font-semibold text-paper">
                  译文呈现方式
                </h3>
                <p className="font-mono text-[10.5px] text-paper-faint">
                  {sourceLang} → {targetLang} · {providerName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭菜单"
              className="flex size-8 items-center justify-center rounded-full text-paper-muted hover:bg-paper/10 hover:text-paper transition"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
          </div>

          {/* 模式选择列表 */}
          <div className="space-y-2" role="radiogroup" aria-label="阅读呈现模式">
            {MODES.map(({ id, title, caption, Icon }) => {
              const selected = currentMode === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => handleModeChange(id)}
                  className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition-all active:scale-[0.99] ${
                    selected
                      ? 'border-cinnabar bg-cinnabar/10 shadow-xs ring-1 ring-cinnabar/40'
                      : 'border-haze bg-paper/5 hover:border-paper/20 hover:bg-paper/10'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                        selected
                          ? 'bg-cinnabar text-white shadow-xs'
                          : 'bg-haze text-paper-muted'
                      }`}
                    >
                      <Icon size={17} strokeWidth={selected ? 2.2 : 1.7} />
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`font-display text-[14px] leading-tight ${
                          selected ? 'font-semibold text-paper' : 'font-medium text-paper'
                        }`}
                      >
                        {title}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-paper-faint">
                        {caption}
                      </div>
                    </div>
                  </div>
                  {selected && (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 text-cinnabar">
                      <Check size={14} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 报错重试条 */}
          {hasError && onRetry && (
            <div className="rounded-xl border border-cinnabar/40 bg-cinnabar/10 p-3 text-[12px] text-cinnabar-soft flex items-center justify-between gap-2">
              <span className="truncate">{errorMessage || '部分内容翻译失败'}</span>
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 font-medium underline hover:text-cinnabar flex items-center gap-1.5"
              >
                <RefreshCw size={12} strokeWidth={2} /> 重试
              </button>
            </div>
          )}

          {/* 底部设置入口 */}
          {onOpenSettings && (
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenSettings()
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-haze text-paper-muted hover:text-paper hover:border-paper/30 font-mono text-[11px] transition"
              >
                <Settings size={13} strokeWidth={1.8} />
                <span>翻译引擎与偏好设置</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
