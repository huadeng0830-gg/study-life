import { policyDateKey, policyDateTime } from '../settingsPolicy.js'

export const TASK_STATUS = Object.freeze({ pending: 'pending', inProgress: 'in_progress', completed: 'completed', cancelled: 'cancelled', archived: 'archived' })
export const TASK_PLAN_STATE = Object.freeze({ unplanned: 'unplanned', scheduled: 'scheduled', completed: 'completed' })

// 归档是跨实体的生命周期标记；它不删除数据，也不改变历史字段。
export function isArchived(entity) {
  return Boolean(entity?.archivedAt) || entity?.status === 'archived'
}

export function isActiveEntity(entity) {
  return !isArchived(entity) && entity?.active !== false
}

export function taskStatus(task, now = new Date()) {
  if (!task || typeof task !== 'object') return TASK_STATUS.pending
  if (isArchived(task)) return TASK_STATUS.archived
  if (task.status === TASK_STATUS.cancelled) return task.status
  if (task.status === TASK_STATUS.completed || task.done) return TASK_STATUS.completed
  if (task.dueDate && policyDateTime(task.dueDate, task.dueTime || '23:59') < now.getTime()) return 'overdue'
  if (task.status === TASK_STATUS.inProgress) return TASK_STATUS.inProgress
  return TASK_STATUS.pending
}

export function isTaskActionable(task, now = new Date()) {
  const status = taskStatus(task, now)
  return status !== TASK_STATUS.completed && status !== TASK_STATUS.cancelled && status !== TASK_STATUS.archived
}

// 用户可见的三态：逾期仍属于“已安排”，只是 taskStatus 的派生紧急状态。
export function taskPlanningState(task, now = new Date()) {
  const status = taskStatus(task, now)
  if (status === TASK_STATUS.cancelled || status === TASK_STATUS.archived) return status
  if (status === TASK_STATUS.completed) return TASK_PLAN_STATE.completed
  if (isTaskActionable(task, now) && task?.dueDate) return TASK_PLAN_STATE.scheduled
  return TASK_PLAN_STATE.unplanned
}

export function billStatus(bill, now = new Date()) {
  if (!bill || isArchived(bill) || bill.active === false) return 'paused'
  if (!bill.nextDate) return 'upcoming'
  const today = policyDateKey(now)
  const days = Math.round((policyDateTime(bill.nextDate, '00:00') - policyDateTime(today, '00:00')) / 86400000)
  if (days < 0) return 'overdue'
  if (days === 0) return 'due'
  return 'upcoming'
}

// 首页“接下来”只展示当前到期或已进入提醒窗口的固定账单。
export function isBillDueSoon(bill, now = new Date()) {
  if (!bill || !isActiveEntity(bill) || !bill.nextDate) return false
  const status = billStatus(bill, now)
  if (status === 'due' || status === 'overdue') return true
  if (status !== 'upcoming') return false
  const today = policyDateKey(now)
  const dueAt = policyDateTime(bill.nextDate, '00:00')
  const todayAt = policyDateTime(today, '00:00')
  const remindDays = Math.max(0, Number(bill.remindDays ?? 3) || 0)
  return dueAt - todayAt <= remindDays * 86400000
}
