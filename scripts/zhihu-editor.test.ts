import assert from 'node:assert/strict'

import { ZhihuDraftStore } from '../src/features/zhihu/editor/draftStore'
import { ZhihuEditorService, type ZhihuEditorApi } from '../src/features/zhihu/editor/service'
import { createMemoryZhihuEditorDatabase } from '../src/features/zhihu/storage/database'

class EditorApi implements ZhihuEditorApi {
  readonly requests: Array<{ operation: string }> = []
  failPublish = false

  async getJson(operation: string): Promise<unknown> {
    this.requests.push({ operation })
    if (operation === 'answer.relationship') {
      return { relationship: { my_answer: null } }
    }
    throw new Error(`unexpected GET operation: ${operation}`)
  }

  async requestRawJson(operation: string): Promise<unknown> {
    this.requests.push({ operation })
    if (operation === 'draft.answer.save' || operation === 'draft.pin.save') {
      return {}
    }
    if (operation === 'answer.publish' && this.failPublish) {
      throw new Error('socket closed after request bytes were sent')
    }
    if (operation === 'answer.publish') {
      return { message: 'success', data: { result: '{"publish":{"id":"answer-9"}}' } }
    }
    if (operation === 'pin.publish') {
      return { message: 'success', data: { result: '{"publish":{"id":"pin-7"}}' } }
    }
    throw new Error(`unexpected operation: ${operation}`)
  }
}

const unknownApi = new EditorApi()
unknownApi.failPublish = true
const unknownStore = new ZhihuDraftStore(createMemoryZhihuEditorDatabase())
let answerDraft = await unknownStore.create('account-a', 'answer', 'question-1')
answerDraft = await unknownStore.save({
  ...answerDraft,
  document: { version: 1, html: '<p>固定快照</p>', text: '固定快照' },
})
const unknownEditor = new ZhihuEditorService(unknownApi, unknownStore)
const unknownResult = await unknownEditor.publish(answerDraft)
assert.equal(unknownResult.status, 'unknown', '发布请求失联不能显示失败后自动补发，也不能伪装成功')
assert.equal(unknownApi.requests.filter((request) => request.operation === 'answer.publish').length, 1, '非幂等发布绝不自动重发')
assert.ok(await unknownStore.get('account-a', answerDraft.localDraftId), 'unknown 发布必须保留本地草稿')
assert.equal((await unknownStore.get('account-a', answerDraft.localDraftId))?.publishState, 'unknown')

const confirmedApi = new EditorApi()
const confirmedStore = new ZhihuDraftStore(createMemoryZhihuEditorDatabase())
let pinDraft = await confirmedStore.create('account-a', 'pin')
pinDraft = await confirmedStore.save({
  ...pinDraft,
  title: '想法标题',
  document: { version: 1, html: '<p>发布正文</p>', text: '发布正文' },
})
const editor = new ZhihuEditorService(confirmedApi, confirmedStore)
const confirmed = await editor.publish(pinDraft)
assert.deepEqual(confirmed, { status: 'confirmed', operationId: confirmed.operationId, contentId: 'pin-7' })
const persisted = await confirmedStore.get('account-a', pinDraft.localDraftId)
assert.equal(persisted?.publishState, 'published')
assert.equal(persisted?.publishedContentId, 'pin-7')
assert.equal(confirmedApi.requests.filter((request) => request.operation === 'pin.publish').length, 1)

console.log('zhihu editor publish contract ok')
