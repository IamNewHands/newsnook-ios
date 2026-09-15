import assert from 'node:assert/strict'

import { loadZhihuPublicFeedCache, saveZhihuPublicFeedCache, type ZhihuPublicCacheStorage } from '../src/features/zhihu/storage/cache'

function memoryStorage(): ZhihuPublicCacheStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const storage = memoryStorage()
const page = {
  items: [{
    ref: { kind: 'answer' as const, id: '1' },
    title: '公开回答',
    excerpt: '公开摘要',
    url: 'https://www.zhihu.com/question/1/answer/1',
  }],
  nextCursor: 'https://api.zhihu.com/topstory/recommend?after_id=next',
  hasMore: true,
}

saveZhihuPublicFeedCache('recommended', page, storage, 1_000)
assert.deepEqual(loadZhihuPublicFeedCache('recommended', storage, 2_000), page)

saveZhihuPublicFeedCache('following', page, storage, 1_000)
assert.equal([...storage.values.keys()].some((key) => key.endsWith(':following')), false, '账号关注流不得进入公共 localStorage 缓存')
assert.equal(loadZhihuPublicFeedCache('following', storage, 2_000), null)

assert.equal(loadZhihuPublicFeedCache('recommended', storage, 9 * 24 * 60 * 60 * 1000), null, '过期公开缓存必须丢弃')

console.log('zhihu public cache boundary ok')
