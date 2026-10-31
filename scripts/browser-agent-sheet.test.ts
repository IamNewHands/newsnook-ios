import assert from 'node:assert/strict'
import {agentSheetLimits,agentKeyboardOffset,constrainAgentSheet,settleAgentSheet} from '../src/features/browser/agent/agentSheet'

const phone=agentSheetLimits(952,52)
assert.deepEqual(phone,{min:300,half:504,max:900})
assert.equal(constrainAgentSheet(-50,phone),300)
assert.equal(constrainAgentSheet(5000,phone),900)
assert.equal(constrainAgentSheet(649.4,phone),649)
assert.equal(settleAgentSheet(886,phone),900,'near fullscreen should snap to the top')
assert.equal(settleAgentSheet(510,phone),504,'near half should snap to its resting height')
assert.equal(settleAgentSheet(647,phone),647,'freeform drag must not jump to a preset')
assert.equal(agentKeyboardOffset(952,620),332,'on-screen keyboard must raise the sheet')
assert.equal(agentKeyboardOffset(952,952),0)
assert.equal(agentKeyboardOffset(800,900),0)
const small=agentSheetLimits(240,16)
assert(small.min<=small.half&&small.half<=small.max)
assert.equal(constrainAgentSheet(500,small),small.max)
console.log('Agent sheet dimensions, endpoints and freeform drag: PASS')
