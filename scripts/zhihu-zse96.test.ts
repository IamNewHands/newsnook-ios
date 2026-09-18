import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildZhihuZseHeaders,
  createZhihuZse96,
  encryptZhihuZseV4,
  zhihuSignSource,
  zhihuSigningPath,
} from '../src/features/zhihu/crypto/zse96'

const url = 'https://www.zhihu.com/api/v4/questions/123/answers?limit=20&offset=0'
const dc0 = 'dc0-test'
const body = '{"content":"中文"}'

assert.equal(zhihuSigningPath(url), '/api/v4/questions/123/answers?limit=20&offset=0')
assert.equal(
  zhihuSignSource(url, dc0, body),
  '101_3_3.0+/api/v4/questions/123/answers?limit=20&offset=0+dc0-test+{"content":"中文"}',
  '签名源必须精确保留 query 与实际发送 body；method 不参与当前 Web 版本',
)
assert.equal(
  encryptZhihuZseV4('a3e97b6575b3958f436472e685d0acc5'),
  'gK+ZNhkFZsmGvqDIYrluZ6siNdjNUblScmWBXUB4Azsx5nGn+5sxtv3rPuFVGJfL',
  'current Zhihu++ ZSE v4 block signer must keep the pinned deterministic vector',
)
assert.equal(
  createZhihuZse96(url, dc0),
  '2.0_gK+ZNhkFZsmGvqDIYrluZ6siNdjNUblScmWBXUB4Azsx5nGn+5sxtv3rPuFVGJfL',
  'fetch signature must use the current Zhihu++ ZSE v4 signer rather than the retired LAES adaptation',
)

const headers = buildZhihuZseHeaders(url, dc0, body)
assert.equal(headers['x-zse-93'], '101_3_3.0')
assert.equal(headers['x-requested-with'], 'fetch')
assert.match(headers['x-zse-96'] ?? '', /^2\.0_/)

// Protocol-drift tripwire: the vendored reference client is our evidence source for this
// private Web signature. If it changes seed/alphabet/call chain, fail loudly instead of
// silently shipping a signer that starts returning code=10003 in production.
const referenceSigner = readFileSync(
  'third-party/zhihu-plus-plus-master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/util/ZseSigner.kt',
  'utf8',
)
const referenceFetchSignature = readFileSync(
  'third-party/zhihu-plus-plus-master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/util/ZhihuFetchSignature.kt',
  'utf8',
)
assert.match(referenceSigner, /plain \+= 210\.toByte\(\)/, 'vendored Zhihu++ changed the ZSE v4 leading byte; review our TS port')
assert.match(referenceSigner, /059053f7d15e01d7/, 'vendored Zhihu++ changed the ZSE v4 key; review our TS port')
assert.match(referenceSigner, /6fpLRqJO8M\/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl\+hN9rgE/, 'vendored Zhihu++ changed the ZSE v4 alphabet; review our TS port')
assert.match(referenceFetchSignature, /ZseSigner\.encryptZseV4\(md5Hex\(signSource\)\)/, 'vendored Zhihu++ changed the fetch-signing call chain')

console.log('zhihu zse96 signing contract ok')
