import assert from 'node:assert/strict'
import { staticRuntimeImports } from './helpers/staticRuntimeImports'

const graph = staticRuntimeImports('src/lib/bodyCache.ts')
assert.equal(graph.has('dompurify'), false,
  `Restoring body-cache metadata must not initialize the article sanitizer: ${graph.get('dompurify')?.join(' -> ')}`)
assert.equal(graph.has('src/lib/resolveBody/shared.ts'), false,
  'The feed teaser guard only needs text stripping, not image hydration and article preparation')
console.log('Body cache startup boundary: metadata guards do not import article sanitization')
