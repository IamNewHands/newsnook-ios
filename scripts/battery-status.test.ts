/**
 * Battery status helpers for the immersive video chrome.
 * Usage: npx tsx scripts/battery-status.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PlayerBatteryIcon } from '../src/components/inkVideoPlayer/PlayerBatteryIcon'

// Node tsx test runner uses the classic JSX runtime for imported TSX components.
Object.assign(globalThis, { React })

{
  const source = readFileSync(join(process.cwd(), 'src/lib/batteryStatus.ts'), 'utf8')
  assert.match(source, /subscribeBatteryStatus/)
  assert.match(source, /levelchange/)
  assert.match(source, /getNativeBattery/)
}

{
  const media = readFileSync(join(process.cwd(), 'src/lib/deviceMediaControls.ts'), 'utf8')
  assert.match(media, /getBattery\(\): Promise<\{ level: number; charging: boolean \}>/)
  assert.match(media, /export async function getNativeBattery/)
}

{
  const java = readFileSync(
    join(process.cwd(), 'android/app/src/main/java/com/aizeek/newsnook/DeviceMediaControlsPlugin.java'),
    'utf8',
  )
  assert.match(java, /public void getBattery\(PluginCall call\)/)
  assert.match(java, /ACTION_BATTERY_CHANGED/)
  assert.match(java, /EXTRA_LEVEL/)
  assert.match(java, /BATTERY_STATUS_CHARGING/)
}

{
  const player = readFileSync(join(process.cwd(), 'src/components/InkVideoPlayer.tsx'), 'utf8')
  assert.match(player, /subscribeBatteryStatus\(setBattery\)/)
  assert.match(player, /PlayerBatteryIcon/)
  assert.match(player, /status=\{battery\}/)
}

{
  const render = (level: number | null, charging: boolean) => renderToStaticMarkup(
    React.createElement(PlayerBatteryIcon, { status: level == null ? null : { level, charging } }),
  )
  const unknown = render(null, false)
  const low = render(0.12, false)
  const middle = render(0.55, false)
  const full = render(0.88, false)
  const charging = render(0.55, true)

  for (const markup of [unknown, low, middle, full, charging]) {
    assert.match(markup, /width="18" height="18"/, 'battery icon must match the adjacent Cast icon size')
    assert.match(markup, /stroke-width="1.8"/, 'battery icon must keep a light, consistent line weight')
  }
  assert.ok(unknown.includes('lucide-battery '), 'unknown battery state should not imply a known level')
  assert.ok(low.includes('lucide-battery-low'))
  assert.ok(middle.includes('lucide-battery-medium'))
  assert.ok(full.includes('lucide-battery-full'))
  for (const markup of [unknown, low, middle, full]) {
    assert.ok(markup.includes('text-paper/90'), 'unplugged battery must stay white at every level')
    assert.ok(!markup.includes('text-[#4ade80]'), 'unplugged battery must not be green')
  }
  assert.ok(charging.includes('lucide-battery-charging'))
  assert.ok(charging.includes('text-[#4ade80]'), 'charging battery must be green')
  assert.ok(charging.includes('aria-label="电量 55%，充电中"'))
  assert.ok(low.includes('aria-label="电量 12%"'))
}

console.log('battery-status: ok')
