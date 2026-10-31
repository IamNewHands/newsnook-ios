import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const app = source('src/App.tsx')
const usePrestore = source('src/features/prestore/usePrestore.ts')
const bodyCache = source('src/lib/bodyCache.ts')
const useFeeds = source('src/hooks/useFeeds.ts')

// These modules are required only for actual network parsing / opening articles,
// not the UI's cached first render. Keep the expensive parser transitive graph lazy.
assert.doesNotMatch(app, /import\s+\{\s*resolveArticleBody\s*\}\s+from\s+['"]\.\/lib\/resolveBody['"]/, 'App must not parse article bodies at startup')
assert.match(app, /import\(['"]\.\/lib\/resolveBody['"]\)/, 'Opening/prefetching a body must still load the real resolver')
assert.doesNotMatch(app, /import\s+\{\s*WikiSelectionLayer\s*\}\s+from\s+['"]\.\/features\/wiki\/WikiSelectionLayer['"]/, 'Wiki HTML parser must not load as part of the home screen')
assert.match(app, /const WikiSelectionLayer = lazy\(/, 'Load wiki only after first frame')
assert.match(app, /wikiReady && \(\s*<Suspense fallback=\{null\}>\s*<WikiSelectionLayer \/>/, 'Wiki must still mount after the first frame')
assert.doesNotMatch(usePrestore, /import\s+\{\s*syncPrestore/, 'Prestore syncing must not load the crawler before it starts')
assert.match(usePrestore, /import\(['"]\.\/service['"]\)/, 'Active prestore sync must still load the real service')
assert.doesNotMatch(bodyCache, /from\s+['"]\.\/resolveBody['"]/, 'Cached-body display must not pull in every crawler at cold startup')
assert.match(bodyCache, /from\s+['"]\.\/resolveBody\/guards['"]/, 'Keep partial feed teaser detection')
assert.doesNotMatch(bodyCache, /from\s+['"]\.\/sanitize['"]/, 'Indexing body cache must not initialize the DOM sanitizer')
assert.match(bodyCache, /from\s+['"]\.\/embedNoise['"]/, 'Preserve embed-noise detection as a lightweight helper')
assert.doesNotMatch(useFeeds, /^import\s+\{[^}]*parseSourcePayload[^}]*\}\s+from\s+['"]\.\.\/lib\/parseFeed['"]/ms, 'The feed parser is only needed after network fetching')
assert.match(useFeeds, /import\(['"]\.\.\/lib\/parseFeed['"]\)/, 'Network fetching must still load the actual parsers')
assert.doesNotMatch(useFeeds, /from\s+['"]\.\.\/lib\/parseFeed['"]/, 'Do not load the entire parseFeed barrel for date/page helpers')
console.log('Android cold-start import boundaries passed')
