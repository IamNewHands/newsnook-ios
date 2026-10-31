import React from "react"
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { GestureHudOverlay } from '../src/components/inkVideoPlayer/GestureHudOverlay'

const volume = renderToStaticMarkup(<GestureHudOverlay hud={{ kind: 'volume', value: .6 }} duration={300} />)
assert.match(volume, /data-ink-hud="volume"/)
assert.match(volume, /ink-gesture-level--volume/)
assert.match(volume, /60%/)
assert.doesNotMatch(volume, /absolute inset-0|bg-black\/|bg-ink-raised\/85/)

const brightness = renderToStaticMarkup(<GestureHudOverlay hud={{ kind: 'brightness', value: .25 }} duration={300} />)
assert.match(brightness, /ink-gesture-level--brightness/)
assert.match(brightness, /25%/)

const seek = renderToStaticMarkup(<GestureHudOverlay hud={{ kind: 'seek', offset: 15, target: 72 }} duration={300} />)
assert.match(seek, /ink-gesture-notice--top/)
assert.match(seek, /1:12/)
assert.match(seek, /\+15s/)

const zoom = renderToStaticMarkup(<GestureHudOverlay hud={{ kind: 'zoom', scale: 1.5, rotation: 90 }} duration={300} />)
assert.match(zoom, /150%/)
assert.match(zoom, /90°/)
console.log('ink-player-v2-hud: ok')
