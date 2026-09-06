import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from './api.js'
import { buildComposeYaml, formFromYaml, initialDeployForm } from './deployYaml.js'
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

test('keeps projects distinct for multiple tasks in one framework', () => {
  const tasks = [
    { task_name: 'framework:alpha:web' },
    { task_name: 'framework:beta:web' },
    { task_name: 'framework:alpha:worker' },
    { task_name: 'framework:alpha:web' }
  ]
  assert.deepEqual(tasks.map(({ task_name }) => deriveNames(task_name)), [
    { project: 'alpha', service: 'web' },
    { project: 'beta', service: 'web' },
    { project: 'alpha', service: 'worker' },
    { project: 'alpha', service: 'web' }
  ])
})

test('preserves unprefixed tasks and rejects empty or special canonical segments', () => {
  assert.deepEqual(deriveNames('legacy.worker.0'), { project: 'default', service: 'legacy.worker.0', legacy: true, raw: 'legacy.worker.0' })
  for (const value of ['framework::service', 'framework:project:', 'framework:project:service:name', 'framework:project:service/name']) {
    assert.throws(() => parseTaskName(value, { strict: true }))
  }
  assert.throws(() => formatTaskName({ framework: 'framework', project: 'project:name', task: 'service' }), { code: 'TASK_NAME_INVALID_CHARACTERS' })
})

test('builds authenticated API requests and parses JSON responses', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, text: async () => JSON.stringify([{ task_name: 'framework:alpha:web' }]) }
  }
  try {
    const result = await request('/api/compose/v0/tasks', {}, 'mesos:secret', 'https://compose.example.test/')
    assert.deepEqual(result, [{ task_name: 'framework:alpha:web' }])
    assert.equal(calls[0].url, 'https://compose.example.test/api/compose/v0/tasks')
    assert.equal(calls[0].options.headers.get('Authorization'), `Basic ${btoa('mesos:secret')}`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sends encoded project deployment YAML and supports empty success bodies', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => '' } }
  try {
    const result = await request(`/api/compose/v0/${encodeURIComponent('project name')}`, { method: 'PUT', headers: { 'Content-Type': 'application/x-yaml' }, body: 'services: {}\n' }, 'u:p', 'https://compose.example.test')
    assert.equal(result, null)
    assert.equal(calls[0].url, 'https://compose.example.test/api/compose/v0/project%20name')
    assert.equal(calls[0].options.method, 'PUT')
    assert.equal(calls[0].options.headers.get('Content-Type'), 'application/x-yaml')
    assert.equal(calls[0].options.body, 'services: {}\n')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('propagates mesos-compose API errors with status and response text excluded', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 409, statusText: 'Conflict', text: async () => 'backend details' })
  try {
    await assert.rejects(request('/api/compose/v0/alpha/web/restart', { method: 'PUT' }, 'u:p', 'https://compose.example.test'), (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.message, '409 Conflict')
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps form values visible in YAML and maps YAML edits back to the form', () => {
  const form = { ...initialDeployForm, project: 'demo', application: 'web', image: 'nginx:latest', command: 'nginx', args: '-g daemon off;', port: '8080:80/tcp', volumes: 'data:/var/lib/data' }
  const yaml = buildComposeYaml(form)
  const parsed = formFromYaml(yaml, initialDeployForm)
  assert.equal(parsed.project, 'demo')
  assert.equal(parsed.application, 'web')
  assert.equal(parsed.command, 'nginx')
  assert.equal(parsed.args, '-g daemon off;')
  assert.equal(parsed.port, '8080:80/tcp')
  assert.equal(parsed.volumes, 'data:/var/lib/data')

  const edited = formFromYaml('name: edited\nservices:\n  api:\n    image: busybox:latest\n    command: [sh, -c, echo, ready]\n    ports:\n      - 9000:80/tcp\n', initialDeployForm)
  assert.deepEqual({ project: edited.project, application: edited.application, image: edited.image, command: edited.command, args: edited.args, port: edited.port }, { project: 'edited', application: 'api', image: 'busybox:latest', command: 'sh', args: '-c echo ready', port: '9000:80/tcp' })
})
