import assert from 'node:assert/strict'

import { brightnessScrimForLevel } from '../src/lib/deviceMediaControls'

assert.equal(brightnessScrimForLevel(1), 0)
assert.equal(brightnessScrimForLevel(0), 0.82)
assert.equal(brightnessScrimForLevel(-1), 0.82)
assert.equal(brightnessScrimForLevel(2), 0)
assert.equal(brightnessScrimForLevel(0.5), 0.41)

console.log('device-media-controls: ok')
