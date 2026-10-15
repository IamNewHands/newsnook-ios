import assert from 'node:assert/strict'

// Run against the app's WebView after forwarding its devtools socket with adb.
// This intentionally uses a real layout engine: DOM-only tests cannot detect
// CSS cascade collisions or margins that shrink with logical reply depth.
const endpoint = process.env.NEWSNOOK_WEBVIEW_CDP_URL ?? 'http://localhost:9223'
const targets = await (await fetch(`${endpoint}/json`)).json()
const target = targets.find(item => item.type === 'page' && item.url === 'https://localhost/')
if (!target) throw new Error('Open the NewsNook debug WebView before running this test')
const socket = new WebSocket(target.webSocketDebuggerUrl)
let serial = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  pending.get(message.id)?.(message)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
async function send(method, params = {}) {
  const id = ++serial
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('WebView test timed out')) }, 10000)
    pending.set(id, response => { clearTimeout(timer); pending.delete(id); resolve(response) })
    socket.send(JSON.stringify({ id, method, params }))
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  return result.result
}

try {
  const results = []
  for (const width of [320, 390, 426, 768]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 952, deviceScaleFactor: 3, mobile: true })
    const response = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const host = document.createElement('div');
    host.dataset.linuxdoReadingLayout = 'threaded';
    host.className = 'page-x';
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden' });
    const stream = document.createElement('div');
    stream.className = 'linuxdo-post-stream space-y-2.5 sm:space-y-3';
    host.append(stream);
    const root = document.createElement('article');
    root.dataset.linuxdoThreadDepth = '0';
    root.dataset.linuxdoThreadRoot = '';
    root.className = 'rounded-xl border p-3';
    root.textContent = 'Root discussion';
    stream.append(root);
    const replies = Array.from({ length: 8 }, (_, i) => {
      const reply = root.cloneNode(false);
      reply.dataset.linuxdoThreadDepth = String(i + 1);
      if (i === 0) reply.dataset.linuxdoThreadFirst = '';
      if (i === 7) reply.dataset.linuxdoThreadLast = '';
      reply.innerHTML = '<header><button>头像</button><div>作者 回复 某人 #2</div></header><div class="reader-prose linuxdo-post-prose"><p>一条长回复应该始终保持足够的正文宽度，不能因为讨论有八层就被挤成一列。</p></div>';
      stream.append(reply);
      return reply;
    });
    const singleton = replies[0].cloneNode(true);
    singleton.dataset.linuxdoThreadLast = '';
    stream.append(root.cloneNode(true), singleton);
    document.body.append(host);
    try {
      return [innerWidth].map(width => {
        host.style.width = width + 'px';
        const geometry = replies.map(reply => {
          const r = reply.getBoundingClientRect(), s = getComputedStyle(reply), p = reply.querySelector('p').getBoundingClientRect();
          return { left: r.left, width: r.width, bodyWidth: p.width, margin: parseFloat(s.marginInlineStart) };
        });
        const first = getComputedStyle(replies[0]), last = getComputedStyle(replies[7]), single = getComputedStyle(singleton);
        const rootStyle = getComputedStyle(root);
        return { viewport: width, streamWidth: stream.getBoundingClientRect().width, geometry,
          gap: replies[0].getBoundingClientRect().top - root.getBoundingClientRect().bottom,
          root: { background: rootStyle.backgroundColor, bottomRadius: rootStyle.borderBottomLeftRadius, connector: getComputedStyle(root, '::after').content },
          first: { radius: first.borderTopLeftRadius, margin: first.marginTop, background: first.backgroundColor, railTop: getComputedStyle(replies[0], '::before').top },
          last: { radius: last.borderBottomLeftRadius, margin: last.marginBottom }, single: { top: single.borderTopLeftRadius, bottom: single.borderBottomLeftRadius },
          toolbarHeight: document.querySelector('[data-linuxdo-reading-toolbar]')?.getBoundingClientRect().height };
      });
    } finally { host.remove(); }
  })()` })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    results.push(...response.result.value)
  }
  for (const result of results) {
    const first = result.geometry[0]
    for (const reply of result.geometry) {
      assert.equal(reply.left, first.left, `${result.viewport}px: indentation must not accumulate across eight levels`)
      assert.equal(reply.width, first.width, `${result.viewport}px: reply widths must remain equal`)
      // The shared card adds its two 1px side borders to the 64px wide-screen
      // padding budget; the content must still never lose width with depth.
      const insetBudget = result.viewport >= 640 ? 66 : 64
      assert.ok(reply.bodyWidth >= result.streamWidth - insetBudget, `${result.viewport}px: body width must retain the bounded inset`)
    }
    assert.equal(result.first.radius, '0px', `${result.viewport}px: replies must continue the parent card without another top corner`)
    assert.equal(result.first.margin, '0px', `${result.viewport}px: parent and replies must not be separated by a gap`)
    assert.ok(Math.abs(result.gap) < 1, `${result.viewport}px: parent and child surfaces must touch`)
    assert.equal(result.root.bottomRadius, '0px')
    assert.equal(result.first.background, result.root.background, 'a discussion shares one surface')
    assert.equal(result.root.connector, 'none', 'no line may protrude into the gap between cards')
    assert.ok(parseFloat(result.first.railTop) >= 0, 'reply rail must stay inside the card')
    assert.ok(result.toolbarHeight > 0 && result.toolbarHeight <= 44, 'reading controls must fit a compact row')
    assert.equal(result.last.radius, '12px', `${result.viewport}px: last reply must retain the group bottom radius`)
    assert.equal(result.last.margin, '18px', `${result.viewport}px: discussion boundaries must remain distinct`)
    assert.equal(result.single.top, '0px')
    assert.equal(result.single.bottom, '12px')
    console.log(`PASS Android WebView ${result.viewport}px: eight depths retain ${first.width}px width; group corners and spacing are correct`)
  }
} finally {
  await send('Emulation.clearDeviceMetricsOverride')
  socket.close()
}
