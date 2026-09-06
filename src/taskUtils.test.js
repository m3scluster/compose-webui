import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveNames, formatMemory, formatTaskName, isFailed, isRunning, parseTaskName, taskCpu, taskMemory, taskState, validateTaskSegment } from './taskUtils.js'

test('derives project and service from colon task names', () => {
  assert.deepEqual(deriveNames('compose:billing:api.abc.0'), { project: 'billing', service: 'api.abc.0' })
})
test('handles underscore and malformed names safely', () => {
  assert.deepEqual(deriveNames('demo_web'), { project: 'default', service: 'demo_web', legacy: true, raw: 'demo_web' })
  assert.deepEqual(deriveNames(), { project: 'default', service: 'unknown', legacy: true, raw: '' })
})
test('parses and formats canonical task names without changing case', () => {
  const name = 'mesos-prod:project_1:web-v2'
  assert.deepEqual(parseTaskName(name), { framework: 'mesos-prod', project: 'project_1', task: 'web-v2' })
  assert.equal(formatTaskName(parseTaskName(name)), name)
})
test('keeps legacy names raw by default and rejects them in strict mode', () => {
  assert.deepEqual(parseTaskName('worker.123.0'), { legacy: true, raw: 'worker.123.0', project: 'default', task: 'worker.123.0' })
  assert.throws(() => parseTaskName('worker.123.0', { strict: true }), { code: 'TASK_NAME_SEGMENT_COUNT' })
})
test('returns stable validation errors for malformed canonical names', () => {
  for (const value of ['', 'compose:billing', 'billing:api', 'compose:billing:api:extra']) {
    assert.throws(() => parseTaskName(value, { strict: true }), { code: 'TASK_NAME_SEGMENT_COUNT' })
  }
  assert.throws(() => parseTaskName('compose::api', { strict: true }), { code: 'TASK_NAME_EMPTY_SEGMENT' })
  assert.throws(() => parseTaskName('compose:billing:.api', { strict: true }), { code: 'TASK_NAME_INVALID_SEGMENT_START' })
  assert.throws(() => parseTaskName('compose:billing:api name', { strict: true }), { code: 'TASK_NAME_INVALID_CHARACTERS' })
  assert.throws(() => formatTaskName({ framework: 'f', project: 'p:p', task: 't' }), { code: 'TASK_NAME_INVALID_CHARACTERS' })
  assert.throws(() => validateTaskSegment('', 'project'), { code: 'TASK_NAME_EMPTY_SEGMENT' })
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