import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium } from 'lucide-react'

import type { BatteryStatus } from '../../lib/batteryStatus'

/** Match the neighbouring 18px Lucide chrome; only charging uses an accent colour. */
export function PlayerBatteryIcon({ status }: { status: BatteryStatus | null }) {
  const level = status?.level ?? null
  const charging = Boolean(status?.charging)
  const Icon = charging
    ? BatteryCharging
    : level == null ? Battery
      : level <= 0.2 ? BatteryLow
        : level < 0.7 ? BatteryMedium : BatteryFull
  const label = level == null
    ? '电量未知'
    : `电量 ${Math.round(level * 100)}%${charging ? '，充电中' : ''}`

  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon
        size={18}
        strokeWidth={1.8}
        className={charging ? 'text-[#4ade80]' : 'text-paper/90'}
        aria-hidden="true"
      />
    </span>
  )
}
