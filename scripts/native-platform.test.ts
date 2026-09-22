import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { shouldUseStartupSplash } from '../src/lib/nativePlatform'

assert.equal(shouldUseStartupSplash('android', false), true)
assert.equal(shouldUseStartupSplash('ios', false), true)
assert.equal(shouldUseStartupSplash('web', false), false)
assert.equal(shouldUseStartupSplash('web', true), true)

const bootstrapRoot = readFileSync('src/BootstrapRoot.tsx', 'utf8')
assert.match(bootstrapRoot, /shouldUseStartupSplash\(/)
assert.match(bootstrapRoot, /Capacitor\.getPlatform\(\)/)

console.log('native-platform: ok')
