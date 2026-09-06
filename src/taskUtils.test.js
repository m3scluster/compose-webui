import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveNames, formatMemory, isFailed, isRunning, taskCpu, taskMemory, taskState } from './taskUtils.js'

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

test('reads Mesos Compose exported field names and resource objects', () => {
  const task = { State: 'TASK_RUNNING', CPU: 0.5, Memory: 128 }
  assert.equal(taskState(task), 'TASK_RUNNING')
  assert.equal(isRunning(task), true)
  assert.equal(taskCpu(task), 0.5)
  assert.equal(taskMemory(task), 128)
  assert.equal(taskCpu({ resources: { cpus: 1 } }), 1)
  assert.equal(taskMemory({ resources: { mem: 256 } }), 256)
})