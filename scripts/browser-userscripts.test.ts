import assert from 'node:assert/strict'
import { installUserScript, matchesUserScript } from '../src/features/browser/scripts'

function script(metadata: string) {
  return installUserScript(`// ==UserScript==\n// @name Integration specimen\n// @version 2.4\n${metadata}\n// ==/UserScript==\n(() => {})();`)
}

const linuxdo = script(`// @match https://linux.do/*\n// @run-at document-idle\n// @grant GM_getValue\n// @grant unsafeWindow`)
assert.equal(linuxdo.name, 'Integration specimen')
assert.equal(linuxdo.runAt, 'document-idle')
assert.deepEqual(linuxdo.grants, ['GM_getValue', 'unsafeWindow'])
assert.equal(matchesUserScript(linuxdo, 'https://linux.do/t/hello/2'), true)
assert.equal(matchesUserScript(linuxdo, 'https://attackerlinux.do/t/hello/2'), false)
assert.equal(matchesUserScript(linuxdo, 'http://linux.do/t/hello/2'), false)

const chat = script(`// @match https://chatgpt.com/*\n// @match https://chat.openai.com/*\n// @require https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js\n// @grant GM_download\n// @grant GM_xmlhttpRequest\n// @connect *`)
assert.equal(chat.requires.length, 1)
assert.equal(chat.connects[0], '*')
assert.equal(matchesUserScript(chat, 'https://chatgpt.com/c/abc'), true)
assert.equal(matchesUserScript(chat, 'https://chat.openai.com/c/abc'), true)
assert.equal(matchesUserScript(chat, 'https://example.com/'), false)

const mixed = script(`// @match *://*.example.com/*\n// @exclude-match https://secret.example.com/*\n// @exclude *://*.example.com/private/*`)
assert.equal(matchesUserScript(mixed, 'https://example.com/post/5'), true)
assert.equal(matchesUserScript(mixed, 'http://www.example.com/post/5'), true)
assert.equal(matchesUserScript(mixed, 'https://secret.example.com/post/5'), false)
assert.equal(matchesUserScript(mixed, 'https://x.example.com/private/5'), false)
assert.equal(matchesUserScript(mixed, 'https://example.com.evil.org/'), false)

assert.throws(() => installUserScript('// @match https://example.com/*'), /UserScript/)
assert.throws(() => script('// @grant GM_getValue'), /@match|@include/)
assert.throws(() => installUserScript('x'.repeat(400_001)), /400 KB/)
console.log('Userscript matching and metadata: OK')
