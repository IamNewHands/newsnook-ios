const suites = [
  './zhihu-protocol.test.ts',
  './zhihu-navigation.test.ts',
  './zhihu-session.test.ts',
  './zhihu-feed.test.ts',
  './zhihu-content.test.ts',
  './zhihu-public-entities.test.ts',
  './zhihu-comments.test.ts',
  './zhihu-cache.test.ts',
] as const

for (const suite of suites) {
  console.log(`\n[zhihu] ${suite}`)
  await import(suite)
}

console.log(`\nzhihu integration test suite ok (${suites.length} suites)`)
