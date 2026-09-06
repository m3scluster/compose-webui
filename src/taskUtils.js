export const deriveNames = (taskName = '') => {
  const raw = String(taskName)
  const bits = raw.split(':').filter(Boolean)
  if (bits.length >= 3) return { project: bits[bits.length - 2], service: bits[bits.length - 1] }
  const unders = raw.split('_').filter(Boolean)
  return { project: unders.length > 1 ? unders[0] : 'default', service: unders.length > 1 ? unders.slice(1).join('_') : (raw || 'unknown') }
}

export const taskState = (task) => String(task?.state || '').toUpperCase()
export const isRunning = (task) => ['TASK_RUNNING', 'RUNNING', 'TASK_STARTING', 'STARTING'].includes(taskState(task))
export const isFailed = (task) => ['TASK_FAILED', 'FAILED', 'TASK_ERROR', 'ERROR', 'TASK_LOST'].includes(taskState(task))
export const formatMemory = (value) => { const number = Number(value); if (!Number.isFinite(number) || number === 0) return '0 MB'; return number >= 1024 ? `${(number / 1024).toFixed(1)} GB` : `${number.toFixed(number % 1 ? 1 : 0)} MB` }
