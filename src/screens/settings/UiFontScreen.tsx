import { SegmentedControl } from '../../components/SegmentedControl'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import {
  resolveUiFontOption,
  UI_FONT_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
  UI_SCALE_OPTIONS,
  type Preferences,
  type UiFontFamilyId,
  type UiFontWeightId,
  type UiPrefs,
} from '../../sources/preferences'

interface Props {
  prefs: Preferences
  onChange: (patch: Partial<UiPrefs>) => void
  onReset: () => void
  onBack: () => void
}

/**
 * 界面（应用外壳）字体、字号与字重。
 * 与「阅读字体」分开：那边管正文排版，这里管导航、设置项、按钮和说明文字。
 */
export function UiFontScreen({ prefs, onChange, onReset, onBack }: Props) {
  const { fontFamily, scale, weight } = prefs.ui
  const activeFont = resolveUiFontOption(fontFamily)
  const activeScale = UI_SCALE_OPTIONS.find((option) => option.value === scale)
  const activeWeight = UI_FONT_WEIGHT_OPTIONS.find((option) => option.id === weight)

  return (
    <SettingsShell
      title="界面字体"
      caption={`${activeFont.label} · 字号${activeScale?.label ?? '自定义'} · 字重${activeWeight?.label ?? '标准'}`}
      onBack={onBack}
      action={
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded-full border border-haze px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-paper-muted"
        >
          恢复默认
        </button>
      }
    >
      <div className="page-x pt-5">
        <div className="mx-auto max-w-3xl rounded-2xl border border-haze bg-ink-raised/60 px-5 py-5">
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">
            <span className="h-px w-5 bg-cinnabar" aria-hidden />
            预览
          </p>
          <h2 className="font-display mt-3 text-[22px] leading-snug text-paper">界面字体</h2>
          <p className="mt-2 text-[13px] leading-[1.85] text-paper-muted">
            导航、设置项、按钮与说明文字都用这一套字体和字号。
          </p>
          <div className="mt-4 flex items-center gap-3 border-t border-haze pt-4">
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] text-paper">设置项标题</span>
              <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                说明文字 · 最小一档
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-haze px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-paper-muted">
              按钮
            </span>
          </div>
        </div>
      </div>

      <SettingsSection title="界面字体">
        <div className="page-x">
          <SegmentedControl
            label="界面字体"
            options={UI_FONT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.id,
            }))}
            value={fontFamily}
            onChange={(value) => onChange({ fontFamily: value as UiFontFamilyId })}
          />
        </div>
        <p className="page-x mt-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
          全部用系统自带字体，不需要联网下载。阅读正文的字体在「阅读字体」里单独设置。
        </p>
      </SettingsSection>

      <SettingsSection title="界面字号">
        <div className="page-x">
          <SegmentedControl
            label="界面字号"
            options={UI_SCALE_OPTIONS}
            value={scale}
            onChange={(value) => onChange({ scale: value })}
          />
        </div>
        <p className="page-x mt-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
          只放大界面文字，不改正文排版。个别固定高度的小标签在最大档位下可能显示不全。
        </p>
      </SettingsSection>

      <SettingsSection title="界面字重">
        <div className="page-x">
          <SegmentedControl
            label="界面字重"
            options={UI_FONT_WEIGHT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.id,
            }))}
            value={weight}
            onChange={(value) => onChange({ weight: value as UiFontWeightId })}
          />
        </div>
        <p className="page-x mt-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
          汉字在 iOS 上默认偏细，调粗后界面更清楚。只影响界面文字，正文排版不受影响；
          「宋体 / 楷体」笔画本身更细，配「中粗」比配「标准」更耐看。
        </p>
      </SettingsSection>
    </SettingsShell>
  )
}
