import assert from 'node:assert/strict'

import {
  buildZhihuZseHeaders,
  createZhihuZse96,
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
  createZhihuZse96(url, dc0, body),
  '2.0_Gv5qLm+nf4TCeOOI2JynjqBtIacynqy69Dgp5aVE/InoBe4atAQ4pZ6a+bW7LDxJ',
  'MIT signer browser adaptation must keep the pinned deterministic vector',
)

const headers = buildZhihuZseHeaders(url, dc0, body)
assert.equal(headers['x-zse-93'], '101_3_3.0')
assert.equal(headers['x-requested-with'], 'fetch')
assert.match(headers['x-zse-96'] ?? '', /^2\.0_/)

console.log('zhihu zse96 signing contract ok')
