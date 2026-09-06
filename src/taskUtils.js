export const deriveNames = (taskName = '') => {
  const raw = String(taskName)
  const bits = raw.split(':').filter(Boolean)
  if (bits.length >= 3) return { project: bits[bits.length - 2], service: bits[bits.length - 1] }
  const unders = raw.split('_').filter(Boolean)
  return { project: unders.length > 1 ? unders[0] : 'default', service: unders.length > 1 ? unders.slice(1).join('_') : (raw || 'unknown') }
}

const valueFrom = (task, ...names) => names.map((name) => task?.[name]).find((value) => value !== undefined && value !== null && value !== '')

export const taskState = (task) => {
  const status = valueFrom(task, 'state', 'State', 'status', 'Status')
  return String(status?.state || status?.State || status || '').toUpperCase()
}
export const isRunning = (task) => ['TASK_RUNNING', 'RUNNING', 'TASK_STARTING', 'STARTING'].includes(taskState(task))
export const isFailed = (task) => ['TASK_FAILED', 'FAILED', 'TASK_ERROR', 'ERROR', 'TASK_LOST'].includes(taskState(task))

export const taskCpu = (task) => Number(valueFrom(task, 'cpu', 'CPU', 'cpus', 'CPUs', 'resources')?.cpus ?? valueFrom(task, 'cpu', 'CPU', 'cpus', 'CPUs') ?? 0)
export const taskMemory = (task) => Number(valueFrom(task, 'memory', 'Memory', 'mem', 'Mem', 'resources')?.mem ?? valueFrom(task, 'memory', 'Memory', 'mem', 'Mem') ?? 0)


export const formatMemory = (value) => { const number = Number(value); if (!Number.isFinite(number) || number === 0) return '0 MB'; return number >= 1024 ? `${(number / 1024).toFixed(1)} GB` : `${number.toFixed(number % 1 ? 1 : 0)} MB` }
