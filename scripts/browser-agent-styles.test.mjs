import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import postcss from 'postcss'
import {loadConfigFromFile} from 'vite'

// Exercise the actual production CSS compatibility hook: dev CSS alone cannot
// detect color-mix fallback declarations that hide icons behind solid fills.
const loaded=await loadConfigFromFile({command:'build',mode:'production'})
const plugin=loaded.config.plugins.flat(Infinity).find(item=>item?.name==='vite-plugin-unlayer-css')
assert.ok(plugin?.generateBundle,'production CSS compatibility plugin must be present')
const asset={type:'asset',fileName:'agent.css',source:await readFile(new URL('../src/features/browser/agent/agent.css',import.meta.url),'utf8')}
const hook=typeof plugin.generateBundle==='function'?plugin.generateBundle:plugin.generateBundle.handler
await hook.call({}, {}, {'agent.css':asset}, false)
const css=postcss.parse(asset.source)
function value(selector,property){
  let result
  css.walkRules(selector,rule=>{rule.walkDecls(property,decl=>{result=decl.value})})
  assert.ok(result,`${selector} must define ${property}`)
  return result
}
assert.match(value('.agent-sheet','--agent-chrome'),/^linear-gradient\(/)
assert.match(value('.agent-sheet','--agent-chrome'),/var\(--color-ink\)/)
assert.match(value('.agent-header-mark','background'),/rgb\(var\(--tone-cinnabar-rgb\)\s*\/\s*\.12\)/)
assert.equal(value('.agent-header-mark','color'),'var(--color-paper)')
assert.match(value('.agent-header .agent-close','background'),/rgb\(var\(--tone-paper-rgb\)\s*\/\s*\.07\)/)
assert.equal(value('.agent-header .agent-close','color'),'var(--color-paper)')
assert.doesNotMatch(asset.source,/transparent\s+[\d.]+%/,'production output must not contain broken color-mix fragments')
console.log('Agent production styles: translucent header surfaces and contrasting icons PASS')
