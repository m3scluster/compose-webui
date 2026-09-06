import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveNames, formatMemory, isFailed, isRunning, taskState } from './taskUtils.js'

test('derives project and service from colon task names', () => {
  assert.deepEqual(deriveNames('compose:billing:api.abc.0'), { project: 'billing', service: 'api.abc.0' })
})
test('handles underscore and malformed names safely', () => {
  assert.deepEqual(deriveNames('demo_web'), { project: 'demo', service: 'web' })
  assert.deepEqual(deriveNames(), { project: 'default', service: 'unknown' })
})
test('normalizes states and memory', () => {
  assert.equal(taskState({ state: 'TASK_RUNNING' }), 'TASK_RUNNING')
  assert.equal(isRunning({ state: 'TASK_RUNNING' }), true)
  assert.equal(isFailed({ state: 'TASK_FAILED' }), true)
  assert.equal(formatMemory(2048), '2.0 GB')
  assert.equal(formatMemory('bad'), '0 MB')
})
