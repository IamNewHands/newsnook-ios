import assert from 'node:assert/strict'
import { haptics } from '../src/lib/haptics'

async function run() {
  // Web / Node 环境测试降级保护无异常抛出
  await haptics.tick()
  await haptics.selection()
  await haptics.snap()
  await haptics.toggle()
  await haptics.success()
  await haptics.warning()
  assert.ok(true, 'haptics must safely no-op in non-native environment')
  console.log('haptics: ok')
}

void run()
