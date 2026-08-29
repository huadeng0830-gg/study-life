export const TASK_STATUS = Object.freeze({ pending: 'pending', inProgress: 'in_progress', completed: 'completed', cancelled: 'cancelled', archived: 'archived' })

export function taskStatus(task, now = new Date()) {
  if (!task || typeof task !== 'object') return TASK_STATUS.pending
  if (task.status === TASK_STATUS.cancelled || task.status === TASK_STATUS.archived) return task.status
  if (task.status === TASK_STATUS.completed || task.done) return TASK_STATUS.completed
  if (task.status === TASK_STATUS.inProgress) return TASK_STATUS.inProgress
  if (task.dueDate && new Date(`${task.dueDate}T${task.dueTime || '23:59'}`).getTime() < now.getTime()) return 'overdue'
  return TASK_STATUS.pending
}

export function isTaskActionable(task, now = new Date()) {
  const status = taskStatus(task, now)
  return status !== TASK_STATUS.completed && status !== TASK_STATUS.cancelled && status !== TASK_STATUS.archived
}

export function billStatus(bill, now = new Date()) {
  if (!bill || bill.active === false) return 'paused'
  if (!bill.nextDate) return 'upcoming'
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(`${bill.nextDate}T00:00:00`).getTime() - today.getTime()) / 86400000)
  if (days < 0) return 'overdue'
  if (days === 0) return 'due'
  return 'upcoming'
}
