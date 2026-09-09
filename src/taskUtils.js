export class TaskNameValidationError extends Error {
  constructor(code, message, field = '') {
    super(message)
    this.name = 'TaskNameValidationError'
    this.code = code
    this.field = field
  }
}

const TASK_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const validateTaskSegment = (value, field) => {
  if (typeof value !== 'string') throw new TaskNameValidationError('TASK_NAME_NOT_STRING', `${field} must be a string`, field)
  if (!value) throw new TaskNameValidationError('TASK_NAME_EMPTY_SEGMENT', `${field} must not be empty`, field)
  if (!/^[A-Za-z0-9]/.test(value)) throw new TaskNameValidationError('TASK_NAME_INVALID_SEGMENT_START', `${field} must start with a letter or digit`, field)
  if (!TASK_SEGMENT_PATTERN.test(value)) throw new TaskNameValidationError('TASK_NAME_INVALID_CHARACTERS', `${field} contains invalid characters`, field)
}

export const parseTaskName = (value, options = {}) => {
  if (typeof value !== 'string') throw new TaskNameValidationError('TASK_NAME_NOT_STRING', 'Task name must be a string', 'taskName')
  const bits = value.split(':')
  if (bits.length === 3) {
    validateTaskSegment(bits[0], 'framework')
    validateTaskSegment(bits[1], 'project')
    validateTaskSegment(bits[2], 'task')
    return { framework: bits[0], project: bits[1], task: bits[2] }
  }
  if (options.strict) throw new TaskNameValidationError('TASK_NAME_SEGMENT_COUNT', 'Task name must contain exactly three segments', 'taskName')
  return { legacy: true, raw: value, project: 'default', task: value }
}

export const formatTaskName = ({ framework, project, task } = {}) => {
  validateTaskSegment(framework, 'framework')
  validateTaskSegment(project, 'project')
  validateTaskSegment(task, 'task')
  return `${framework}:${project}:${task}`
}

export const deriveNames = (taskName = '') => {
  const raw = String(taskName)
  try {
    const parsed = parseTaskName(raw)
    return { project: parsed.project, service: parsed.task || 'unknown', ...(parsed.legacy ? { legacy: true, raw } : {}) }
  } catch {
    return { project: 'default', service: raw || 'unknown', invalid: true, raw }
  }
}

const valueFrom = (task, ...names) => names.map((name) => task?.[name]).find((value) => value !== undefined && value !== null && value !== '')

export const taskId = (task) => valueFrom(task, 'task_id', 'taskId', 'TaskID', 'TaskId', 'id', 'ID')

export const taskAgentHostname = (task) => {
  const agent = valueFrom(task, 'agent', 'Agent')
  const agentInfo = valueFrom(task, 'MesosAgent', 'mesos_agent', 'mesosAgent', 'agent_info', 'agentInfo', 'agent_data', 'agentData') || (typeof agent === 'object' ? valueFrom(agent, 'agent_info', 'agentInfo', 'info') : undefined)
  const hostname = valueFrom(agentInfo, 'hostname', 'Hostname', 'host') || valueFrom(task, 'agent_hostname', 'agentHostname', 'agent_host', 'agentHost') || (typeof agent === 'object' ? valueFrom(agent, 'hostname', 'Hostname', 'host') : undefined)
  return String(hostname || '—')
}

export const taskState = (task) => {
  const status = valueFrom(task, 'state', 'State', 'status', 'Status')
  return String(status?.state || status?.State || status || '').toUpperCase()
}
export const taskHealth = (task) => {
  const health = valueFrom(task, 'health', 'Health', 'health_status', 'healthStatus')
  return String(health?.status || health?.Status || health || '—').toUpperCase()
}
export const taskNetworkName = (task) => {
  const direct = valueFrom(task, 'network', 'network_name', 'networkName', 'Network')
  if (direct) return String(direct)
  const infos = valueFrom(task, 'networkinfo', 'networkInfo')
  return Array.isArray(infos) ? infos.map((info) => info?.name).filter(Boolean).join(', ') || '—' : '—'
}
export const taskNetworkMode = (task) => String(valueFrom(task, 'network_mode', 'networkMode', 'NetworkMode', 'mode') || '—')
export const taskVolumes = (task) => {
  const volumes = valueFrom(task, 'volumes', 'Volumes', 'volume')
  const formatVolume = (volume) => {
    if (typeof volume === 'string') return volume
    const formatValue = (value) => typeof value === 'object' && value !== null ? String(value.name ?? value.value ?? value.path ?? JSON.stringify(value)) : String(value ?? '')
    const source = volume?.source ?? volume?.Source ?? volume?.host_path ?? volume?.hostPath ?? volume
    const target = volume?.target ?? volume?.Target ?? volume?.container_path ?? volume?.containerPath ?? ''
    const mode = volume?.permission ?? volume?.mode ?? volume?.Mode ?? ''
    const dockerVolume = source?.docker_volume ?? volume?.docker_volume
    if (dockerVolume) {
      const modeLabel = mode === 1 || mode === '1' ? 'RW' : mode === 0 || mode === '0' ? 'RO' : formatValue(mode)
      return `driver: ${formatValue(dockerVolume.driver || '—')} · source: ${formatValue(dockerVolume.name || '—')} → target: ${formatValue(target || '—')} · ${modeLabel}`
    }
    return [source, target, mode].filter((value) => value !== '').map(formatValue).join(':') || JSON.stringify(volume)
  }
  if (Array.isArray(volumes)) return volumes.map(formatVolume).join(', ') || '—'
  if (volumes && typeof volumes === 'object') {
    const hasVolumeFields = ['source', 'Source', 'host_path', 'hostPath', 'target', 'Target', 'container_path', 'containerPath'].some((field) => volumes[field] !== undefined)
    return hasVolumeFields ? formatVolume(volumes) : Object.entries(volumes).map(([source, target]) => typeof target === 'object' && target !== null ? formatVolume({ ...target, source }) : `${source}:${String(target)}`).join(', ') || '—'
  }
  return volumes ? String(volumes) : '—'
}
export const isRunning = (task) => ['TASK_RUNNING', 'RUNNING', 'TASK_STARTING', 'STARTING'].includes(taskState(task))
export const isFailed = (task) => ['TASK_FAILED', 'FAILED', 'TASK_ERROR', 'ERROR', 'TASK_LOST'].includes(taskState(task))

export const taskCpu = (task) => Number(valueFrom(task, 'cpu', 'CPU', 'cpus', 'CPUs', 'resources')?.cpus ?? valueFrom(task, 'cpu', 'CPU', 'cpus', 'CPUs') ?? 0)
export const taskMemory = (task) => Number(valueFrom(task, 'memory', 'Memory', 'mem', 'Mem', 'resources')?.mem ?? valueFrom(task, 'memory', 'Memory', 'mem', 'Mem') ?? 0)


export const formatMemory = (value) => { const number = Number(value); if (!Number.isFinite(number) || number === 0) return '0 MB'; return number >= 1024 ? `${(number / 1024).toFixed(1)} GB` : `${number.toFixed(number % 1 ? 1 : 0)} MB` }

export const groupTasks = (tasks = []) => {
  const groups = new Map()
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const names = deriveNames(task?.task_name || task?.taskName)
    const key = `${names.project}\u0000${names.service}`
    let group = groups.get(key)
    if (!group) {
      group = { key, project: names.project, service: names.service, tasks: [], taskCount: 0, running: 0, failed: 0, cpu: 0, memory: 0 }
      groups.set(key, group)
    }
    group.tasks.push(task)
    group.taskCount += 1
    group.running += isRunning(task) ? 1 : 0
    group.failed += isFailed(task) ? 1 : 0
    group.cpu += taskCpu(task)
    group.memory += taskMemory(task)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    representative: group.tasks[0],
    state: group.running > 0 ? 'TASK_RUNNING' : group.failed > 0 ? 'TASK_FAILED' : taskState(group.tasks[0]),
  }))
}

export const groupProjects = (tasks = []) => {
  const projects = new Map()
  for (const service of groupTasks(tasks)) {
    let project = projects.get(service.project)
    if (!project) {
      project = { key: `project:${service.project}`, project: service.project, services: [], taskCount: 0, running: 0, failed: 0, cpu: 0, memory: 0 }
      projects.set(service.project, project)
    }
    project.services.push(service)
    project.taskCount += service.taskCount
    project.running += service.running
    project.failed += service.failed
    project.cpu += service.cpu
    project.memory += service.memory
  }
  return [...projects.values()].map((project) => ({
    ...project,
    state: project.running > 0 ? 'TASK_RUNNING' : project.failed > 0 ? 'TASK_FAILED' : project.services[0]?.state || '',
  }))
}
