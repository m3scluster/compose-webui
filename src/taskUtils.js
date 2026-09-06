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

export const taskState = (task) => {
  const status = valueFrom(task, 'state', 'State', 'status', 'Status')
  return String(status?.state || status?.State || status || '').toUpperCase()
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
