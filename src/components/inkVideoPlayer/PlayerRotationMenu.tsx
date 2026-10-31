import { Check, RotateCw } from 'lucide-react'
import { ROTATION_MODE_LABEL, type RotationMode } from './playback'

const modes: RotationMode[] = ['landscape', 'sensor', 'portrait']

export function PlayerRotationMenu({ value, onSelect, onClose }: {
  value: RotationMode | null
  onSelect: (mode: RotationMode) => void
  onClose: () => void
}) {
  return <div className="ink-player-rotation-menu" role="menu" aria-label="屏幕方向" onPointerDown={event => event.stopPropagation()}>
    <div className="ink-player-menu-label"><RotateCw size={14} /> 屏幕方向</div>
    {modes.map(mode => <button type="button" role="menuitemradio" aria-checked={value === mode} key={mode} onClick={() => {
      onSelect(mode)
      onClose()
    }}>
      <span>{ROTATION_MODE_LABEL[mode]}</span>
      {value === mode && <Check size={15} strokeWidth={2.1} />}
    </button>)}
  </div>
}
