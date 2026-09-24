import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Execute the exact asset injected by Android. No privileged JS bridge is exposed
// to the remote HTML page; only its bounded result is read by evaluateJavascript.
const script = readFileSync(new URL('../android/app/src/main/assets/linuxdo-session-probe.js', import.meta.url), 'utf8')
const microtasks = async () => { for (let n = 0; n < 30; n++) await Promise.resolve() }
async function probe(options: { origin?: string; discourse?: boolean; currentStatus?: number; csrfStatus?: number; username?: string; csrf?: string } = {}) {
  const requests: Array<{ url: string; options: any }> = []
  const sandbox: any = {
    window: {}, location: { origin: options.origin ?? 'https://linux.do' },
    document: { querySelector: () => options.discourse === false ? null : { content: 'Discourse' } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url: string, init: any) => {
      requests.push({ url, options: init })
      const current = url.includes('/current')
      const status = current ? options.currentStatus ?? 200 : options.csrfStatus ?? 200
      const body = current ? { current_user: options.username === '' ? null : { id: 9, username: options.username ?? 'test-reader' } } : { csrf: options.csrf ?? 'test-csrf' }
      return { status, ok: status >= 200 && status < 300, headers: { get: () => status === 403 ? 'challenge' : null }, json: async () => body }
    },
  }
  vm.runInNewContext(script, sandbox)
  await microtasks()
  return { result: sandbox.window.__newsnookSessionProbe, requests }
}
let tested = 0
for (const origin of ['https://linux.do.evil.example', 'https://example.com', 'null']) {
  const { requests, result } = await probe({ origin })
  assert.equal(requests.length, 0); assert.equal(result, undefined); tested++
}
{
  const { requests, result } = await probe({ discourse: false })
  assert.equal(requests.length, 0, 'blank HTML or challenge HTML is not a verified Discourse page')
  assert.equal(result, undefined); tested++
}
{
  const { requests, result } = await probe()
  assert.equal(result.ready, true)
  assert.equal(result.username, 'test-reader'); assert.equal(result.csrf, 'test-csrf')
  assert.equal(requests.length, 2)
  assert.ok(requests.every(r => r.options.credentials === 'include' && r.options.cache === 'no-store'))
  assert.ok(requests.every(r => r.options.headers['X-Requested-With'] === 'XMLHttpRequest'))
  tested++
}
for (const options of [{ currentStatus: 403 }, { csrfStatus: 403 }, { username: '' }, { csrf: '' }]) {
  const { result } = await probe(options)
  assert.notEqual(result.ready, true, 'HTML navigation alone cannot prove a usable authenticated write session')
  assert.equal(result.csrf, undefined, 'failed probes must not return a token')
  tested++
}
console.log(`linuxdo-browser-session-probe: ${tested} passed`)
