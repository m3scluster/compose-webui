import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { request, requestText } from './api.js'
import { buildComposeYaml, formFromYaml, initialDeployForm, scaleComposeYaml } from './deployYaml.js'
import { deriveNames, formatMemory, formatTaskName, groupProjects, groupTasks, isFailed, isRunning, parseTaskName, taskAgentHostname, taskCpu, taskHealth, taskId, taskMemory, taskNetworkMode, taskNetworkName, taskState, taskVolumes, validateTaskSegment } from './taskUtils.js'

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

test('reads health status from API field variants', () => {
  assert.equal(taskHealth({ health: 'healthy' }), 'HEALTHY')
  assert.equal(taskHealth({ Health: { status: 'unhealthy' } }), 'UNHEALTHY')
  assert.equal(taskHealth({ healthStatus: 'starting' }), 'STARTING')
  assert.equal(taskHealth({}), '—')
})

test('reads network and volume details from task payloads', () => {
  const task = { network_mode: 'weave', networkinfo: [{ name: 'frontend' }], Volumes: [{ source: 'data', target: '/var/lib/data', mode: 'ro' }] }
  assert.equal(taskNetworkName(task), 'frontend')
  assert.equal(taskNetworkMode(task), 'weave')
  assert.equal(taskVolumes(task), 'data:/var/lib/data:ro')
})

test('reads task IDs from the API field variants', () => {
  assert.equal(taskId({ task_id: 'snake-case' }), 'snake-case')
  assert.equal(taskId({ TaskID: 'protobuf-json' }), 'protobuf-json')
  assert.equal(taskId({ id: 'generic-id' }), 'generic-id')
})

test('prefers the agent hostname over the agent ID', () => {
  assert.equal(taskAgentHostname({ agent: 'agent-id', agent_hostname: 'agent.example.test' }), 'agent.example.test')
  assert.equal(taskAgentHostname({ Agent: { hostname: 'agent.example.test' } }), 'agent.example.test')
  assert.equal(taskAgentHostname({ MesosAgent: { hostname: 'agent.example.test' }, hostname: 'agent-id' }), 'agent.example.test')
  assert.equal(taskAgentHostname({ agent: 'agent-id', hostname: 'agent-id' }), '—')
  assert.equal(taskAgentHostname({ agent: 'agent-id' }), '—')
})

test('targets one task instance with the encoded task ID endpoint', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => '' } }
  try {
    await request(`/api/compose/v0/tasks/${encodeURIComponent('task/id with spaces')}`, { method: 'DELETE' }, 'u:p', 'https://compose.example.test')
    assert.equal(calls[0].url, 'https://compose.example.test/api/compose/v0/tasks/task%2Fid%20with%20spaces')
    assert.equal(calls[0].options.method, 'DELETE')
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('groups tasks by project and service while retaining task records and totals', () => {
  const groups = groupTasks([
    { task_name: 'framework:alpha:web', cpu: 0.5, memory: 128, state: 'TASK_RUNNING' },
    { task_name: 'framework:beta:web', cpu: 1, memory: 256, state: 'TASK_FAILED' },
    { task_name: 'framework:alpha:web', cpu: 0.25, memory: 64, state: 'TASK_RUNNING' }
  ])
  assert.deepEqual(groups.map(({ project, service, taskCount }) => ({ project, service, taskCount })), [
    { project: 'alpha', service: 'web', taskCount: 2 },
    { project: 'beta', service: 'web', taskCount: 1 }
  ])
  assert.equal(groups[0].tasks.length, 2)
  assert.equal(groups[0].cpu, 0.75)
  assert.equal(groups[0].memory, 192)
  assert.equal(groups[0].state, 'TASK_RUNNING')
})

test('groups service groups into project rows with aggregated totals', () => {
  const projects = groupProjects([
    { task_name: 'framework:alpha:web', cpu: 0.5, memory: 128, state: 'TASK_RUNNING' },
    { task_name: 'framework:alpha:web', cpu: 0.25, memory: 64, state: 'TASK_RUNNING' },
    { task_name: 'framework:alpha:worker', cpu: 1, memory: 256, state: 'TASK_FAILED' },
    { task_name: 'framework:beta:web', cpu: 2, memory: 512, state: 'TASK_STOPPED' },
  ])
  assert.deepEqual(projects.map(({ project, services, taskCount, running, failed, cpu, memory, state }) => ({ project, services: services.map(({ service }) => service), taskCount, running, failed, cpu, memory, state })), [
    { project: 'alpha', services: ['web', 'worker'], taskCount: 3, running: 2, failed: 1, cpu: 1.75, memory: 448, state: 'TASK_RUNNING' },
    { project: 'beta', services: ['web'], taskCount: 1, running: 0, failed: 0, cpu: 2, memory: 512, state: 'TASK_STOPPED' },
  ])
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

test('updates deploy replicas in the existing Compose YAML', () => {
  const source = 'version: "3.9"\nservices:\n  web:\n    image: nginx\n    deploy:\n      replicas: 1\n      restart_policy:\n        condition: on-failure\n'
  const scaled = scaleComposeYaml(source, 'web', 3)
  const parsed = formFromYaml(scaled, initialDeployForm)
  assert.equal(parsed.instances, '3')
  assert.match(scaled, /condition: on-failure/)
  assert.throws(() => scaleComposeYaml(source, 'missing', 3), /was not found/)
})

test('reads YAML as text for scaling before submitting the updated project', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => options.method === 'UPDATE' ? '' : 'services:\n  web:\n    image: nginx\n' } }
  try {
    const source = await requestText('/api/compose/v0/demo', { headers: { Accept: 'application/x-yaml' } }, 'u:p', 'https://compose.example.test')
    const yaml = scaleComposeYaml(source, 'web', 4)
    await request('/api/compose/v0/demo', { method: 'UPDATE', headers: { 'Content-Type': 'application/x-yaml' }, body: yaml }, 'u:p', 'https://compose.example.test')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, 'https://compose.example.test/api/compose/v0/demo')
    assert.equal(calls[1].options.method, 'UPDATE')
    assert.match(calls[1].options.body, /replicas: 4/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps form values visible in YAML and maps YAML edits back to the form', () => {
  const form = { ...initialDeployForm, project: 'demo', application: 'web', image: 'nginx:latest', command: 'nginx', args: '-g daemon off;', port: '8080:80/tcp', volumes: 'data:/var/lib/data' }
  const yaml = buildComposeYaml(form)
  assert.equal(yaml.includes('name:'), false)
  const parsed = formFromYaml(yaml, initialDeployForm)
  assert.equal(parsed.project, '')
  assert.equal(parsed.application, 'web')
  assert.equal(parsed.command, 'nginx')
  assert.equal(parsed.args, '-g daemon off;')
  assert.equal(parsed.port, '8080:80/tcp')
  assert.deepEqual(parsed.volumes, [{ source: 'data', target: '/var/lib/data', permission: 'rw', driver: 'local' }])

  const edited = formFromYaml('services:\n  api:\n    image: busybox:latest\n    command: [sh, -c, echo, ready]\n    ports:\n      - 9000:80/tcp\n', { ...initialDeployForm, project: 'demo' })
  assert.deepEqual({ project: edited.project, application: edited.application, image: edited.image, command: edited.command, args: edited.args, port: edited.port }, { project: 'demo', application: 'api', image: 'busybox:latest', command: 'sh', args: '-c echo ready', port: '9000:80/tcp' })
})

test('serializes editable volumes with permissions and drivers', () => {
  const yaml = buildComposeYaml({ ...initialDeployForm, application: 'app', image: 'busybox', volumes: [
    { source: 'cache', target: '/var/cache', permission: 'ro', driver: 'local' },
    { source: 'data', target: '/var/lib/data', permission: 'rw', driver: 'nfs' },
  ] })
  assert.match(yaml, /- cache:\/var\/cache:ro/)
  assert.match(yaml, /- data:\/var\/lib\/data:rw/)
  assert.match(yaml, /cache:\n    driver: local/)
  assert.match(yaml, /data:\n    driver: nfs/)
})

test('serializes multiple ports with dynamic sources and mesos-compose protocols', () => {
  const yaml = buildComposeYaml({ ...initialDeployForm, application: 'web', image: 'nginx', ports: [
    { source: '', target: '80', protocol: 'http' },
    { source: '8443', target: '443', protocol: 'https' },
  ] })
  assert.match(yaml, /- 80\/http/)
  assert.match(yaml, /- 8443:443\/https/)
})

test('reads every compose port into editable source, target and protocol fields', () => {
  const form = formFromYaml('services:\n  web:\n    image: nginx\n    ports:\n      - 80/http\n      - 8443:443/https\n', initialDeployForm)
  assert.deepEqual(form.ports, [
    { source: '', target: '80', protocol: 'http' },
    { source: '8443', target: '443', protocol: 'https' },
  ])
})

test('prefills the network field with default and serializes it into the YAML', () => {
  assert.equal(initialDeployForm.network, 'default')
  const yaml = buildComposeYaml({ ...initialDeployForm, application: 'web', image: 'nginx' })
  assert.match(yaml, /\n    network: default/)
  assert.match(yaml, /\nnetworks:\n  default:/)
})

test('serializes deploy replicas and repeatable placement constraints', () => {
  const yaml = buildComposeYaml({ ...initialDeployForm, application: 'web', image: 'nginx', instances: '3', constraints: ['node.hostname==localhost', 'node.platform.os==linux', ''] })
  assert.deepEqual(YAML.parse(yaml).services.web.deploy, {
    placement: { constraints: ['node.hostname==localhost', 'node.platform.os==linux'] },
    replicas: 3,
    resources: { limits: { cpus: 0.5, memory: 128, disk: 0 } },
  })
})

test('reads deploy replicas and placement constraints into the form', () => {
  const form = formFromYaml('services:\n  web:\n    image: nginx\n    deploy:\n      placement:\n        constraints:\n          - node.hostname==localhost\n          - unique\n      replicas: 4\n', initialDeployForm)
  assert.equal(form.instances, '4')
  assert.deepEqual(form.constraints, ['node.hostname==localhost', 'unique'])
})

test('adds top-level networks for service network aliases and preserves their configuration', () => {
  const yaml = buildComposeYaml({
    ...initialDeployForm,
    application: 'app',
    image: 'alpine:latest',
    networks: JSON.stringify({ default: { aliases: ['test'] } }),
    topNetworks: JSON.stringify({ default: { external: true, name: 'mesos-net', driver: 'mesos-net' } }),
  })
  assert.match(yaml, /    networks:\n      default:\n        aliases:\n          - test/)
  assert.match(yaml, /\nnetworks:\n  default:\n    external: true\n    name: mesos-net\n    driver: mesos-net/)
})

test('adds each named service network to the top-level networks map', () => {
  const yaml = buildComposeYaml({ ...initialDeployForm, application: 'web', image: 'nginx', network: 'frontend', networks: JSON.stringify({ backend: {} }) })
  assert.deepEqual(YAML.parse(yaml).networks, { frontend: null, backend: null })
})

test('serializes user network mode as an external default network with its driver', () => {
  const yaml = buildComposeYaml({ ...initialDeployForm, application: 'web', image: 'nginx', networkMode: 'user', networkDriver: 'weave' })
  assert.doesNotMatch(yaml, /network_mode:/)
  assert.match(yaml, /default:\n    external: true\n    driver: weave/)
})

test('reads an external default network driver as user network mode', () => {
  const form = formFromYaml('services:\n  web:\n    image: nginx\nnetworks:\n  default:\n    external: true\n    driver: weave\n', initialDeployForm)
  assert.equal(form.networkMode, 'user')
  assert.equal(form.networkDriver, 'weave')
})

test('round-trips restart policy, environment and labels through Compose YAML', () => {
  const form = {
    ...initialDeployForm,
    application: 'web',
    image: 'nginx:latest',
    restart: 'on-failure',
    environment: JSON.stringify({ NODE_ENV: 'production', PORT: 8080 }),
    labels: JSON.stringify({ team: 'platform', tier: 'frontend' }),
  }
  const yaml = buildComposeYaml(form)
  const parsed = YAML.parse(yaml).services.web
  assert.equal(parsed.restart, 'on-failure')
  assert.deepEqual(parsed.environment, { NODE_ENV: 'production', PORT: 8080 })
  assert.deepEqual(parsed.labels, { team: 'platform', tier: 'frontend' })
  const roundTripped = formFromYaml(yaml, initialDeployForm)
  assert.equal(roundTripped.restart, 'on-failure')
  assert.deepEqual(JSON.parse(roundTripped.environment), parsed.environment)
  assert.deepEqual(JSON.parse(roundTripped.labels), parsed.labels)
})

test('omits empty environment and labels while preserving the restart default', () => {
  const form = { ...initialDeployForm, application: 'web', image: 'nginx:latest', environment: '', labels: '' }
  const service = YAML.parse(buildComposeYaml(form)).services.web
  assert.equal(service.restart, 'always')
  assert.equal('environment' in service, false)
  assert.equal('labels' in service, false)
  const roundTripped = formFromYaml(buildComposeYaml(form), initialDeployForm)
  assert.equal(roundTripped.restart, 'always')
  assert.equal(roundTripped.environment, '')
  assert.equal(roundTripped.labels, '')
})

test('keeps deploy form controls and YAML documentation guidance visible', () => {
  const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /(?:legend|className)=['"][^'"]*advanced/i)
  assert.match(source, /field\('Restart policy', 'restart'/)
  for (const removed of ['networks', 'topNetworks', 'Named volume definitions', 'Environment variables', 'Labels', 'Mesos options', 'Ulimits', 'Healthcheck', 'Placement']) assert.doesNotMatch(source, new RegExp(removed))
  for (const removed of ["field('Hostname'", "field('Container name'", "field('Runtime'"]) assert.equal(source.includes(removed), false)
  assert.match(source, /YAML editor/i)
  assert.match(source, /https:\/\/aventer-ug\.github\.io\/mesos-compose\//)
})

test('hides the task YAML editor until the Edit button is clicked', () => {
  const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.match(source, /showYamlEditor.*useState\(false\)/)
  assert.match(source, /showYamlEditor && <section className="yaml-task-editor">/)
  assert.match(source, /setShowYamlEditor\(\(visible\) => !visible\).*Edit/)
})

test('keeps network name beside network mode in the deploy form', () => {
  const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.match(source, /network-controls.*Mode<select[\s\S]*?field\('Network name', 'network'\)/)
  assert.doesNotMatch(source, /<legend>Network configuration<\/legend>/)
})
