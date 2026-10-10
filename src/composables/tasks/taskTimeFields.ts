import type { Task, TaskTimeStage } from '../../types/domain'

export type TaskTiming = Pick<Task, 'dueDate' | 'dueTime' | 'timeStages'> & Partial<Pick<Task, 'id' | 'title' | 'done' | 'status' | 'archivedAt' | 'active' | 'repeat' | 'repeatAnchorDay'>>

export function timePlanId(prefix = 'stage'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

export function validTimeDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '0100-01-01'
}

export function validTimeClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** 日历日移动不经过系统时区，也不把“1 天”变成夏令时当天的 24 小时。 */
export function moveTimeDate(date: string, days: number): string {
  if (!validTimeDate(date) || !Number.isSafeInteger(days)) return ''
  const moved = new Date(`${date}T12:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() + days)
  if (!Number.isFinite(moved.getTime())) return ''
  const result = moved.toISOString().slice(0, 10)
  return validTimeDate(result) ? result : ''
}

export function taskStages(task: TaskTiming): TaskTimeStage[] {
  return Array.isArray(task?.timeStages) ? task.timeStages.filter((stage) => stage && typeof stage === 'object') : []
}

export function newTimeStage(kind: TaskTimeStage['kind'] = 'window'): TaskTimeStage {
  return { id: timePlanId(), label: '', kind, start: { date: '' }, end: { date: '' }, completionRequired: true, reminders: [] }
}

export function stageLabel(stage: TaskTimeStage, index = 0): string {
  return String(stage.label || '').trim() || `阶段 ${index + 1}`
}

export function taskRepeatBase(task: TaskTiming): { date: string; label: string } {
  const scheduled = taskStages(task).find((stage) => stage.kind === 'scheduled' && stage.start?.date)
  if (scheduled?.start?.date) return { date: scheduled.start.date, label: `${stageLabel(scheduled)}开始` }
  if (task.dueDate) return { date: task.dueDate, label: '事项截止日期' }
  const entries = taskStages(task).flatMap((stage, index) => (['start', 'end'] as const).flatMap((anchor) => stage[anchor]?.date ? [{ date: stage[anchor]!.date, label: `${stageLabel(stage, index)}${anchor === 'start' ? '开始' : '结束'}` }] : []))
  const first = entries.sort((a, b) => a.date.localeCompare(b.date))[0]
  return { date: first?.date || '', label: first?.label || '日期待定' }
}
