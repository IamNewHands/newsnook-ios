import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'

const script = readFileSync(new URL('../android/app/src/main/assets/wiki-baike-probe.js', import.meta.url), 'utf8')
function probe(html: string, readyState = 'complete') {
  const { document } = parseHTML(html)
  document.querySelectorAll('script[src]').forEach(script => Object.defineProperty(script, 'async', { value: script.hasAttribute('async') }))
  Object.defineProperty(document, 'readyState', { value: readyState })
  return JSON.parse(runInNewContext(script, { document, location: { href: 'https://baike.baidu.com/item/星星/5683398', hostname: 'baike.baidu.com' } }))
}
const page = '<html><head><title>星星_百度百科</title></head><body><main class="main-content"><h1>星星</h1><div class="lemma-summary"><div class="para">天体</div></div><script>private script</script><iframe src="https://example.test"></iframe></main></body></html>'
const result = probe(page)
const splitTitle = page.replace('<main class="main-content"><h1>星星</h1>', '<header><h1>星星</h1></header><main class="main-content">')
assert.equal(probe(splitTitle).state, 'ready', '标题与正文是相邻区域时仍应识别词条')
const closedArticle = page.replace('</main>', '</main><script src="https://example.test/slow-analytics.js"></script>')
assert.equal(probe(closedArticle, 'loading').state, 'ready', '已关闭的正文容器不能被后续阻塞脚本拖到网络超时')
assert.equal(probe(page.replace('</main>', '</main><aside>动态浮层</aside>'), 'loading').state, 'loading', '任意浮层 sibling 不能被当作正文解析结束')
const metadataTitle = page.replace('<title>星星_百度百科</title>', '<title>百度百科</title><meta property="og:title" content="星星_百度百科">').replace('<h1>星星</h1>', '<h1></h1>')
assert.ok(probe(metadataTitle).html.includes('<h1>星星</h1>'), '元数据标题必须写入原生快照，不能保留空标题占位符')
const intro = 'OpenAI 是一家人工智能研究机构，开展人工智能系统的研究与开发，研究方向包括自然语言处理、机器学习与通用人工智能，提供多种面向用户的智能工具。'
const changedLayout = `<html><head><title>OpenAI_百度百科</title></head><body><main class="main-content"><nav><p>${intro}导航广告</p></nav><h1>OpenAI</h1><section class="new-introduction"><p>${intro}</p></section><h2>发展历程</h2><p>真实章节正文</p></main></body></html>`
assert.equal(probe(changedLayout).state, 'ready', '已知正文根节点内的导言不应依赖摘要 CSS 类名')
assert.equal(probe(changedLayout.replace(`<p>${intro}</p>`, '')).state, 'unsupported', '目录或导航不能代替导言')
for (const className of ['basicInfo_hash', 'reference_hash']) {
  assert.equal(probe(changedLayout.replace(`<section class="new-introduction"><p>${intro}</p></section>`, `<div class="${className}"><p>${intro}</p></div>`)).state, 'unsupported', '信息卡和参考文献不能代替导言')
}
assert.equal(probe(page, 'loading').state, 'loading', '摘要先到达时不能销毁仍在接收正文的页面')
assert.equal(probe(page, 'interactive').state, 'ready', 'HTML 解析完即可提取，不必等待图片等资源全部加载')
assert.equal(result.state, 'ready')
assert.equal(probe(page.replace('星星_百度百科', '安全验证_百度百科')).state, 'ready', '百科词条标题包含安全验证不等于验证页面')
assert.ok(result.html.includes('天体'))
assert.ok(!result.html.includes('private script') && !result.html.includes('iframe'))
assert.equal(probe('<html><head><title>百度安全验证</title></head><body><div id="captcha">验证</div></body></html>').state, 'challenge')
assert.equal(probe('<html><head><title>页面不存在</title></head><body></body></html>').state, 'missing')
const unsupported = probe('<html><head><title>新布局</title></head><body></body></html>')
assert.equal(unsupported.state, 'unsupported', '已完成加载但无匹配结构不能永久伪装成网络加载中')
assert.equal(unsupported.diagnostics.root, false)
assert.equal(unsupported.diagnostics.summary, false)
console.log('baidu rendered page probe tests passed')
