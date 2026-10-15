// Runs in the ordinary first-party document. No CAPTCHA automation or exposed native bridge.
JSON.stringify((() => {
  const result = (() => {
  const title = document.title || ''
  if (/百度安全验证|访问验证/.test(title) || title.trim() === '安全验证' || location.hostname === 'wappass.baidu.com' || document.querySelector('#captcha, #verify')) {
    return { state: 'challenge' }
  }
  if (/页面不存在|词条不存在|尚未收录/.test(title + (document.querySelector('h1')?.textContent || ''))) {
    return { state: 'missing' }
  }
  const root = document.querySelector('.main-content, [class^="mainContent_"], [class*=" mainContent_"], [class^="lemmaContent_"]')
  const summary = root?.querySelector('.lemma-summary, [class^="lemmaSummary_"], [class*=" lemmaSummary_"]')
  const heading = root?.querySelector('h1') || document.querySelector('h1')
  const articleTitle = [heading?.textContent, document.querySelector('meta[property="og:title"]')?.getAttribute('content'), title]
    .map(value => (value || '').trim().replace(/\s*[_|—–-]\s*百度百科.*$/u, ''))
    .find(value => value && value !== '百度百科')
  const excluded = 'nav, aside, footer, header, [role="navigation"], .basic-info, [class^="basicInfo_"], [class*=" basicInfo_"], .reference-list, .lemma-reference, [class^="reference_"], [class*=" reference_"], .lemmaWgt-promotion, [class*="catalog"], [class*="Catalog"], [class*="recommend"], [class*="Recommend"], [class*="promotion"], [class*="Promotion"]'
  const paragraph = '.para, [class^="para_"], [class*=" para_"]'
  const intro = []
  let afterTitle = !!root && !root.querySelector('h1')
  if (root && !summary?.textContent?.trim()) {
    for (const node of root.querySelectorAll(`h1, h2, h3, p, ${paragraph}`)) {
      if (node.closest(excluded)) continue
      if (node.localName === 'h1') { afterTitle = true; continue }
      if (!afterTitle) continue
      if (node.matches('h2, h3')) {
        if (node.previousElementSibling?.localName === 'h1') continue
        break
      }
      if (!node.querySelector(`p, ${paragraph}`) && node.textContent?.trim()) intro.push(node.textContent.trim())
      if (intro.length === 3) break
    }
  }
  const hasIntro = intro.join('').length >= 60
  // A parser-blocking script after the article marks its closing boundary.
  // An arbitrary floating sibling or an async script cannot serve as this marker.
  let articleClosed = false
  for (let node = root; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const next = node.nextElementSibling
    if (next?.localName === 'script' && next.hasAttribute('src') && next.async === false && !next.hasAttribute('defer') && next.getAttribute('type') !== 'module') { articleClosed = true; break }
  }
  const diagnostics = { readyState: document.readyState, root: !!root, heading: !!heading, title: !!articleTitle, summary: !!summary?.textContent?.trim(), intro: hasIntro, articleClosed }
  if (document.readyState === 'loading' && !articleClosed) return { state: 'loading', diagnostics }
  if (!root || !articleTitle || (!summary?.textContent?.trim() && !hasIntro)) {
    return { state: document.readyState === 'complete' ? 'unsupported' : 'loading', diagnostics }
  }
  const copy = root.cloneNode(true)
  if (!copy.querySelector('h1')?.textContent?.trim()) {
    const normalizedHeading = copy.querySelector('h1') || document.createElement('h1')
    normalizedHeading.textContent = articleTitle
    if (!normalizedHeading.parentElement) copy.insertBefore(normalizedHeading, copy.firstChild)
  }
  copy.querySelectorAll('script, style, iframe, form, svg, link').forEach(node => node.remove())
  const head = document.createElement('head')
  for (const node of document.querySelectorAll('title, link[rel="canonical"], meta[property="og:image"]')) head.appendChild(node.cloneNode(true))
  const html = '<html>' + head.outerHTML + '<body>' + copy.outerHTML + '</body></html>'
  if (html.length > 4 * 1024 * 1024) return { state: 'too-large' }
  return { state: 'ready', html, url: location.href, diagnostics }
  })()
  return { ...result, url: location.href }
})())
