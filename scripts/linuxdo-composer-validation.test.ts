import assert from 'node:assert/strict'
import { decodeTopic } from '../src/features/linuxdo/api/decode'
import { validateComposer } from '../src/features/linuxdo/editor/model'

for (const [mode, topicArchetype, minimum] of [
  ['create', undefined, 20],
  ['reply', undefined, 10],
  ['reply', 'regular', 10],
  ['reply', 'private_message', 3],
] as const) {
  const topic = decodeTopic({ id: 1, archetype: topicArchetype })
  assert.equal(topic.archetype, topicArchetype)
  const input = { mode, topicArchetype: topic.archetype, title: '这是合格标题', raw: '字'.repeat(minimum - 1) }
  const belowMinimum = validateComposer(input)
  assert.equal(belowMinimum.canSubmit, false, `${mode}/${topicArchetype}: reject below minimum`)
  assert.equal(belowMinimum.bodyRemaining, 1)
  assert.equal(validateComposer({ ...input, raw: '字'.repeat(minimum) }).canSubmit, true,
    `${mode}/${topicArchetype}: accept at minimum`)
  assert.equal(validateComposer({ ...input, raw: `  ${'字'.repeat(minimum - 1)}  ` }).canSubmit, false,
    'surrounding whitespace must not satisfy the minimum')
}
assert.equal(validateComposer({ mode: 'create', title: '短标题', raw: '字'.repeat(20) }).canSubmit, false)
console.log('linuxdo-composer-validation: ok')
