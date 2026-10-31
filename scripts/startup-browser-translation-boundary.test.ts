import assert from 'node:assert/strict'
import { test } from 'node:test'
import { staticRuntimeImports } from './helpers/staticRuntimeImports'

function assertExcluded(entry: string, excluded: (dependency: string) => boolean) {
  const violations = [...staticRuntimeImports(entry)]
    .filter(([dependency]) => excluded(dependency))
    .map(([, path]) => path.join(' -> '))
  assert.deepEqual(violations, [], 'Deferred work is reachable through static runtime imports')
}

test('browser startup recovery excludes workspace, media parsing and agent dependencies', () => {
  assertExcluded('src/features/browser/BrowserLauncher.tsx', dependency =>
    dependency === 'src/features/browser/useBrowserSession.ts'
    || dependency === 'src/features/browser/BrowserWorkspace.tsx'
    || dependency === 'src/features/browser/browserMedia.ts'
    || dependency.startsWith('src/features/browser/agent/')
    || dependency.startsWith('src/features/mediaSniffer/')
    || dependency === 'fast-xml-parser')
})

test('feed translation imports providers and phrase dictionaries only for needed jobs', () => {
  assertExcluded('src/features/translation/useFeedTranslation.ts', dependency =>
    dependency === 'src/features/translation/providers.ts'
    || dependency === 'src/features/translation/native.ts'
    || dependency === 'src/features/translation/chineseVariant.ts'
    || dependency.startsWith('opencc-js'))
})
