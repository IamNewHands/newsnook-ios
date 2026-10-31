#!/usr/bin/env node
/** Generate the native Android 12+ launch mark from the canonical brand SVG.
 * Android SplashScreen cannot consume SVG directly; VectorDrawable preserves its
 * exact path, two-color linear gradient and transparent canvas without raster blur.
 * Run via `npm run android:splash` or automatically through `npm run android:sync`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const source = new URL('../public/logo-dark.svg', import.meta.url)
const output = new URL('../android/app/src/main/res/drawable/splash_logo.xml', import.meta.url)
const svg = readFileSync(source, 'utf8')
const attr = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`))?.[1]
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const path = svg.match(/<path\b[^>]*>/)?.[0]
const gradient = svg.match(/<linearGradient\b[^>]*>/)?.[0]
const stops = [...svg.matchAll(/<stop\b[^>]*>/g)].map(item => item[0])
const viewBox = attr(svg.match(/<svg\b[^>]*>/)?.[0] || '', 'viewBox')?.split(/\s+/).map(Number)
if (!path || !gradient || stops.length !== 2 || !viewBox || viewBox.length !== 4 ||
    viewBox.some(n => !Number.isFinite(n)) || attr(path, 'fill-rule') !== 'evenodd') {
  throw new Error('Unsupported logo-dark.svg structure: expected one evenodd path and two gradient stops')
}
const pathData = attr(path, 'd')
const startX = attr(gradient, 'x1')
const startY = attr(gradient, 'y1')
const endX = attr(gradient, 'x2')
const endY = attr(gradient, 'y2')
if (!pathData || !startX || !startY || !endX || !endY ||
    stops.some(stop => !attr(stop, 'stop-color'))) {
  throw new Error('Missing logo path or SVG gradient coordinates')
}
const [left, top, width, height] = viewBox
// The system masks the 288dp drawable to a 192dp safe circle. The SVG artwork
// has an off-center tip, so scale about the viewBox center to keep it intact.
// 0.78 yields a ~135dp blue mark and protects its farthest corner from clipping.
const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from public/logo-dark.svg by scripts/generate-android-splash.mjs. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="288dp"
    android:height="288dp"
    android:viewportWidth="${width}"
    android:viewportHeight="${height}">
    <group android:pivotX="${left + width / 2}" android:pivotY="${top + height / 2}"
        android:scaleX="0.78" android:scaleY="0.78">
        <path android:fillType="evenOdd" android:pathData="${escape(pathData)}">
            <aapt:attr name="android:fillColor">
                <gradient android:type="linear" android:startX="${startX}" android:startY="${startY}"
                    android:endX="${endX}" android:endY="${endY}">
${stops.map(stop => `                    <item android:offset="${attr(stop, 'offset') || '0'}" android:color="${attr(stop, 'stop-color')}" />`).join('\n')}
                </gradient>
            </aapt:attr>
        </path>
    </group>
</vector>
`
mkdirSync(dirname(fileURLToPath(output)), { recursive: true })
writeFileSync(output, xml)
console.log('Android splash generated from public/logo-dark.svg (blue gradient vector)')
