import assert from 'node:assert/strict'
import {
  DEFAULT_WIKI_SETTINGS, WIKI_SETTINGS_KEY, loadWikiSettings, saveWikiSettings,
  encyclopediaProviders, registerEncyclopediaProvider, lookupEncyclopedia,
  type EncyclopediaProvider, type WikiEntry,
} from '../src/features/wiki/encyclopedia'
import { readWikiLibrary, rememberWikiEntry, removeWikiBookmark } from '../src/features/wiki/library'

const map = new Map<string,string>()
const initialStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key:string) => map.get(key) ?? null,
  setItem: (key:string, val:string) => { map.set(key,val) },
}})
try {
  assert.deepEqual(loadWikiSettings(), DEFAULT_WIKI_SETTINGS)
  const updated = { ...DEFAULT_WIKI_SETTINGS, providerId: 'wikipedia-en', fallbackEnglish: false }
  saveWikiSettings(updated)
  assert.deepEqual(loadWikiSettings(), updated)
  assert.equal(JSON.parse(map.get(WIKI_SETTINGS_KEY)!).providerId,'wikipedia-en')
  const entry: WikiEntry = {
    query: 'Bauhaus', title: 'Bauhaus', description: '', summary: 'Test',
    providerId: 'wikipedia-en', language: 'en', url: 'https://en.wikipedia.org/wiki/Bauhaus', related: [],
  }
  assert.equal(rememberWikiEntry(entry,'history').length,1)
  assert.equal(rememberWikiEntry(entry,'history').length,1,'history should deduplicate by provider and term')
  rememberWikiEntry(entry,'bookmarks')
  assert.equal(readWikiLibrary('bookmarks')[0].title,'Bauhaus')
  assert.equal(removeWikiBookmark(entry).length,0)
  const adapter: EncyclopediaProvider = {
    id:'test-encyclopedia-provider',
    name:'测试源', language:'zh',
    lookup: async (term) => ({ ...entry, query: term, title: term, providerId:'test-encyclopedia-provider' }),
  }
  registerEncyclopediaProvider(adapter)
  assert.ok(encyclopediaProviders().some(x=>x.id===adapter.id))
  const result=await lookupEncyclopedia('测试词条',{...updated,providerId:adapter.id},new AbortController().signal)
  assert.equal(result.title,'测试词条')
  assert.equal(result.providerId,adapter.id)
  assert.equal(result.query,'测试词条')
  console.log('wiki library and registry tests passed')
} finally {
  if(initialStorage)Object.defineProperty(globalThis,'localStorage',initialStorage)
  else delete (globalThis as {localStorage?:Storage}).localStorage
}
