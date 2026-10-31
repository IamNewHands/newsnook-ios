#!/usr/bin/env node
/** Inspect what the Vite/Rolldown build actually puts on the initial HTML import path. */
import { build } from 'vite'
import { basename } from 'node:path'

await build({
  logLevel: 'error',
  build: { write: false, emptyOutDir: false },
  plugins: [{
    name: 'newsnook-startup-dependency-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const items = Object.values(bundle).filter(x => x.type === 'chunk')
      const byName = new Map(items.map(chunk => [chunk.fileName, chunk]))
      const entry = items.find(chunk => chunk.isEntry)
      if (!entry) throw new Error('Build has no entry chunk')
      const seen = new Set()
      const queue = [entry.fileName]
      while (queue.length) {
        const name = queue.shift()
        if (!name || seen.has(name)) continue
        seen.add(name)
        for (const dep of byName.get(name)?.imports ?? []) queue.push(dep)
      }
      const loaded = [...seen].map(name => byName.get(name)).filter(Boolean)
        .sort((a, b) => Buffer.byteLength(b.code) - Buffer.byteLength(a.code))
      console.log(`Initial static imports: ${loaded.length} chunks, ${loaded.reduce((sum, x) => sum + Buffer.byteLength(x.code), 0)} JS bytes`)
      for (const chunk of loaded.slice(0, 14)) {
        console.log(`\n${chunk.fileName}: ${Buffer.byteLength(chunk.code)} bytes`)
        const mods = Object.entries(chunk.modules)
          .sort((a, b) => (b[1].renderedLength ?? 0) - (a[1].renderedLength ?? 0))
        for (const [id, info] of mods.slice(0, 8)) {
          console.log('  ', String(info.renderedLength ?? '?').padStart(8), basename(id), id.replace(/\\/g, '/').split('/newsnook/').at(-1))
        }
      }
    },
  }],
})
