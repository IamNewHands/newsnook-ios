import assert from 'node:assert/strict'
import { installUserScript, loadUserScripts, matchesUserScript, prepareUserScriptInstall, saveUserScripts } from '../src/features/browser/scripts'

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
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} })
const stored = { ...linuxdo, enabled: false, name: null, grants: null, excludes: undefined, excludeMatches: undefined }
storage.set('newsnook:userscripts:v1', JSON.stringify([null, stored, { ...linuxdo, id: 'broken', source: 'not a userscript' }]))
const restored = loadUserScripts()
assert.equal(restored.length, 1, 'bad entries do not hide other installed scripts')
assert.equal(restored[0].name, linuxdo.name, 'derived metadata is rebuilt from the saved source')
assert.deepEqual(restored[0].grants, linuxdo.grants, 'missing or damaged arrays cannot enter the native runtime')
assert.equal(restored[0].enabled, false, 'recovery preserves the user enable setting')
assert.equal(restored[0].id, linuxdo.id, 'recovery preserves the script storage identity')
assert.equal(matchesUserScript(restored[0], 'https://linux.do/t/hello/2'), true)

const exactCap = linuxdo.source.padEnd(400_000, ' ')
saveUserScripts([installUserScript(exactCap)])
assert.equal(loadUserScripts().length, 1, 'an accepted script must survive reload at the size limit')
assert.throws(() => installUserScript(linuxdo.source + '字'.repeat(140_000)), /400 KB/, 'source and file imports share a byte budget')
const disabled = { ...linuxdo, enabled: false }
const updated = prepareUserScriptInstall(linuxdo.source.replace('@version 2.4', '@version 2.5'), [disabled])
assert.equal(updated.id, disabled.id, 're-importing an existing script offers an update instead of creating a duplicate')
assert.equal(updated.createdAt, disabled.createdAt)
assert.equal(updated.enabled, false, 'updates do not silently enable a disabled script')
assert.equal(updated.version, '2.5')
const separateNamespace = prepareUserScriptInstall(linuxdo.source.replace('// @version', '// @namespace https://other.example/\n// @version'), [disabled])
assert.notEqual(separateNamespace.id, disabled.id, 'same-name scripts from another namespace are independent')
const renamed = prepareUserScriptInstall(linuxdo.source.replace('@name Integration specimen', '@name Renamed script'), [disabled], disabled)
assert.equal(renamed.id, disabled.id, 'an explicit edit keeps its identity even if metadata changes')
assert.throws(() => script('// @match    '), /@match|@include/, 'empty website rules are not installable')
const editingWithOldEnabledState = prepareUserScriptInstall(linuxdo.source, [disabled], linuxdo)
assert.equal(editingWithOldEnabledState.enabled, false, 'saving an open editor preserves a switch changed after editing began')
storage.set('newsnook:userscripts:v1', JSON.stringify([{ ...linuxdo, source: linuxdo.source + '字'.repeat(140_000) }]))
assert.equal(loadUserScripts().length, 1, 'previous versions accepted a character budget, so existing multibyte scripts remain readable')
const legacy = { ...loadUserScripts()[0], enabled: false }
const editedLegacySource = legacy.source.replace('@version 2.4', '@version 2.5')
const editedLegacy = prepareUserScriptInstall(editedLegacySource, [legacy], legacy)
saveUserScripts([editedLegacy])
const legacyRoundTrip = loadUserScripts()[0]
assert.equal(legacyRoundTrip.source, editedLegacySource, 'a previously installed large multibyte script remains editable and survives saving')
assert.equal(legacyRoundTrip.version, '2.5')
assert.equal(legacyRoundTrip.id, legacy.id)
assert.equal(legacyRoundTrip.createdAt, legacy.createdAt)
assert.equal(legacyRoundTrip.enabled, false)
const sameLegacyIdentity = prepareUserScriptInstall(editedLegacySource.replace('@version 2.5', '@version 2.6'), [legacyRoundTrip])
assert.equal(sameLegacyIdentity.id, legacy.id, 'a matched name and namespace may update the same legacy installation')
const renamedLegacy = prepareUserScriptInstall(editedLegacySource.replace('@name Integration specimen', '@name Legacy renamed'), [legacyRoundTrip], legacyRoundTrip)
assert.equal(renamedLegacy.id, legacy.id, 'an explicit installed editor retains the legacy allowance when renaming')
assert.throws(() => prepareUserScriptInstall(editedLegacySource, [], legacy), /400 KB/, 'a stale or forged editing object cannot grant the legacy budget to a new install')
assert.throws(() => prepareUserScriptInstall(editedLegacySource.replace('// @version', '// @namespace https://unmatched.example/\n// @version'), [legacyRoundTrip]), /400 KB/, 'an unrelated namespace cannot borrow another script\'s legacy budget')
assert.throws(() => prepareUserScriptInstall(editedLegacySource.padEnd(400_001, '字'), [legacyRoundTrip], legacyRoundTrip), /400000|400,000/, 'legacy edits remain bounded by the historical character limit')
assert.throws(() => installUserScript(editedLegacySource, legacy), /400 KB/, 'the new-install API remains byte-limited even when given an old identity')
console.log('Userscript matching, metadata, updates and storage recovery: OK')
