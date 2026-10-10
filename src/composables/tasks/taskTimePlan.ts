import type { TaskStageBoundary, TaskTimeStage } from '../../types/domain'
import { policyDateKey, policyDateTime, policyTimeKey } from '../settingsPolicy.js'

import { moveTimeDate, stageLabel, taskStages, timePlanId, validTimeClock, validTimeDate, type TaskTiming } from './taskTimeFields'
export { moveTimeDate, newTimeStage, stageLabel, taskRepeatBase, taskStages, timePlanId, validTimeClock, validTimeDate, type TaskTiming } from './taskTimeFields'
export type StageState = 'completed' | 'upcoming' | 'active' | 'ended' | 'undated'

export type TimePlanError = { message: string; field: string }
export function timeClockExists(date: string, time: string): boolean {
  if (!validTimeDate(date) || !validTimeClock(time)) return false
  const at = policyDateTime(date, time)
  return Number.isFinite(at) && policyDateKey(new Date(at)) === date && policyTimeKey(new Date(at)) === time
}

export function taskDeadlineError(task: TaskTiming): TimePlanError | null {
  if (task.dueDate && !validTimeDate(task.dueDate)) return { message: '请选择有效的截止日期。', field: 'dueDate' }
  if (task.dueTime && (!task.dueDate || !validTimeClock(task.dueTime))) return { message: '请检查截止日期与时刻。', field: 'dueTime' }
  if (task.dueDate && task.dueTime && !timeClockExists(task.dueDate, task.dueTime)) return { message: '截止时刻在当前时区不存在，请选择其他时刻。', field: 'dueTime' }
  return null
}
/** 表单和命令共用校验；错误指向阶段与端点，禁止写入日期溢出和隐式时刻。 */
export function taskTimePlanError(stages: TaskTimeStage[]): TimePlanError | null {
  if (!Array.isArray(stages)) return { message: '请检查时间安排。', field: 'timeStages' }
  const ids = new Set<string>()
  for (const [index, stage] of stages.entries()) {
    const field = `timeStages.${index}`
    const label = stage ? stageLabel(stage, index) : `阶段 ${index + 1}`
    if (!stage || !['window', 'scheduled'].includes(stage.kind)) return { message: `请检查${label}的安排方式。`, field }
    if (stage.id && ids.has(stage.id)) return { message: '时间阶段的标识重复，请重新添加该阶段。', field }
    if (stage.id) ids.add(stage.id)
    for (const anchor of ['start', 'end'] as const) {
      const boundary = stage[anchor]
      if (boundary?.date && !validTimeDate(boundary.date)) return { message: `${label}：请选择有效的${anchor === 'start' ? '开始' : '结束'}日期。`, field: `${field}.${anchor}.date` }
      if (boundary?.time && (!boundary.date || !validTimeClock(boundary.time))) return { message: `${label}：填写具体时刻前，请先选择日期并检查时刻。`, field: `${field}.${anchor}.time` }
      if (boundary?.date && boundary.time && !timeClockExists(boundary.date, boundary.time)) return { message: `${label}：此时刻在当前时区不存在，请选择其他时刻。`, field: `${field}.${anchor}.time` }
    }
    if (stage.allDay && (stage.kind !== 'scheduled' || stage.start?.time || stage.end?.time)) return { message: `${label}：全天安排请使用日期，取消全天后可填写具体时刻。`, field }
    if (stage.start?.date && stage.end?.date) {
      const start = stageBoundaryAt(stage.start, 'start')
      const end = stageBoundaryAt(stage.end, 'end')
      if (end <= start) return { message: `${label}：结束须晚于开始；跨夜请填写次日的结束日期。`, field: `${field}.end.date` }
    }
    const reminderIds = new Set<string>()
    for (const [reminderIndex, reminder] of (stage.reminders || []).entries()) {
      const reminderField = `${field}.reminders.${reminderIndex}`
      if (!['start', 'end'].includes(reminder.anchor) || !Number.isSafeInteger(Number(reminder.minutesBefore)) || Number(reminder.minutesBefore) < 0) return { message: `${label}：提醒提前量须为大于或等于 0 的整数分钟。`, field: reminderField }
      if (reminder.id && reminderIds.has(reminder.id)) return { message: `${label}：提醒标识重复，请重新添加提醒。`, field: reminderField }
      if (reminder.id) reminderIds.add(reminder.id)
      if (!reminder.enabled) continue
      const boundary = stage[reminder.anchor]
      if (!boundary?.date) return { message: `${label}：请先填写提醒所对应的日期，或关闭这条提醒。`, field: `${field}.${reminder.anchor}.date` }
      if (!boundary.time && !validTimeClock(reminder.dateOnlyTime || '')) return { message: `${label}：时刻待定时，请设置日期提醒的时刻。`, field: reminderField }
      if (!boundary.time && !timeClockExists(boundary.date, reminder.dateOnlyTime || '')) return { message: `${label}：提醒时刻在当前时区不存在，请选择其他时刻。`, field: reminderField }
    }
  }
  return null
}

export function normalizeTimeStages(stages: TaskTimeStage[]): TaskTimeStage[] {
  const error = taskTimePlanError(stages)
  if (error) throw new Error(error.message)
  return stages.map((stage, index) => ({
    id: stage.id || timePlanId(), label: stageLabel(stage, index), kind: stage.kind,
    ...(stage.start?.date ? { start: { date: stage.start.date, ...(stage.start.time ? { time: stage.start.time } : {}) } } : {}),
    ...(stage.end?.date ? { end: { date: stage.end.date, ...(stage.end.time ? { time: stage.end.time } : {}) } } : {}),
    completionRequired: stage.completionRequired !== false,
    ...(stage.allDay ? { allDay: true } : {}),
    ...(stage.completedAt ? { completedAt: stage.completedAt } : {}),
    reminders: (stage.reminders || []).map((reminder) => ({ ...reminder, id: reminder.id || timePlanId('reminder'), minutesBefore: Number(reminder.minutesBefore), enabled: Boolean(reminder.enabled) })),
  }))
}

/** 纯日期端点的结束包含当天；这仅用于日期状态，不把它写回具体时刻。 */
export function stageBoundaryAt(boundary: TaskStageBoundary | undefined, anchor: 'start' | 'end'): number {
  if (!boundary?.date || !validTimeDate(boundary.date)) return NaN
  if (boundary.time) return validTimeClock(boundary.time) ? policyDateTime(boundary.date, boundary.time) : NaN
  return anchor === 'end' ? policyDateTime(boundary.date, '23:59') + 60_000 : policyDateTime(boundary.date, '00:00')
}

export function stageTimeState(stage: TaskTimeStage, nowMs = Date.now()): StageState {
  if (stage.completionRequired !== false && stage.completedAt) return 'completed'
  const start = stageBoundaryAt(stage.start, 'start')
  const end = stageBoundaryAt(stage.end, 'end')
  if (Number.isFinite(end) && nowMs >= end) return 'ended'
  if (Number.isFinite(start) && nowMs < start) return 'upcoming'
  if (Number.isFinite(start)) return 'active'
  if (Number.isFinite(end)) return 'upcoming'
  return 'undated'
}

export function boundaryText(boundary?: TaskStageBoundary, allDay = false): string {
  if (!boundary?.date) return '日期待定'
  return `${boundary.date}${boundary.time ? ` ${boundary.time}` : allDay ? ' · 全天' : ' · 时刻待定'}`
}

export function stageRangeText(stage: TaskTimeStage): string {
  if (stage.allDay) return `${stage.start?.date || '开始待定'}${stage.end?.date && stage.end.date !== stage.start?.date ? ` 至 ${stage.end.date}` : ''} · 全天`
  if (stage.start?.date && stage.end?.date) return `${boundaryText(stage.start)} → ${boundaryText(stage.end)}`
  if (stage.start?.date) return `${boundaryText(stage.start)} 开始 · 结束待定`
  if (stage.end?.date) return `${boundaryText(stage.end)} 结束 · 开始待定`
  return '日期待定'
}

export function stageStatusText(stage: TaskTimeStage, nowMs = Date.now()): string {
  const state = stageTimeState(stage, nowMs)
  if (state === 'completed') return '已完成'
  if (state === 'ended') return stage.completionRequired === false ? '时间已结束' : '时间已结束 · 待确认'
  if (state === 'upcoming') return stage.start?.date ? '待开始' : '开始待定'
  if (state === 'undated') return '日期待定'
  if (stage.completionRequired === false) return '等待后续'
  return stage.kind === 'window' ? '可处理' : stage.start?.date ? '已开始' : '待确认'
}

export function taskHasTime(task: TaskTiming): boolean {
  return Boolean(task.dueDate || taskStages(task).some((stage) => stage.start?.date || stage.end?.date))
}

export function remainingTimeStages(task: TaskTiming, nowMs = Date.now()): TaskTimeStage[] {
  return taskStages(task).filter((stage) => {
    const state = stageTimeState(stage, nowMs)
    return state !== 'completed' && !(stage.completionRequired === false && state === 'ended')
  })
}

export interface TaskTimeEntry {
  key: string
  stageId?: string
  anchor: 'start' | 'end' | 'due' | 'occupied'
  date: string
  time: string
  at: number
  label: string
  endDate?: string
  rangeText?: string
  allDay?: boolean
  completed?: boolean
}

/** 只生成派生条目，始终回到同一事项，不存储第二份日程。 */
export function taskTimeEntries(task: TaskTiming): TaskTimeEntry[] {
  const entries: TaskTimeEntry[] = []
  if (task.dueDate) entries.push({ key: `${task.id}:due`, anchor: 'due', date: task.dueDate, time: task.dueTime || '', at: policyDateTime(task.dueDate, task.dueTime || '23:59'), label: '事项截止' })
  taskStages(task).forEach((stage, index) => {
    for (const anchor of ['start', 'end'] as const) {
      const boundary = stage[anchor]
      if (boundary?.date) entries.push({ key: `${task.id}:${stage.id}:${anchor}`, stageId: stage.id, anchor, date: boundary.date, time: boundary.time || '', allDay: Boolean(stage.allDay), completed: Boolean(stage.completedAt), at: stageBoundaryAt(boundary, anchor), label: `${stageLabel(stage, index)}${anchor === 'start' ? '开始' : '结束'}` })
    }
    if (stage.kind === 'scheduled' && stage.start?.date && stage.end?.date) entries.push({ key: `${task.id}:${stage.id}:occupied`, stageId: stage.id, anchor: 'occupied', date: stage.start.date, time: stage.start.time || '', completed: Boolean(stage.completedAt), at: stageBoundaryAt(stage.start, 'start'), endDate: stage.end.date, rangeText: stageRangeText(stage), label: `${stageLabel(stage, index)}安排` })
  })
  return entries
}

export function taskTimeOnDate(task: TaskTiming, date: string): TaskTimeEntry[] {
  return taskTimeEntries(task).filter((entry) => entry.anchor === 'occupied' ? date > entry.date && date < (entry.endDate || '') : entry.date === date).map((entry) => entry.anchor === 'occupied' ? { ...entry, time: '', label: `${entry.label} · 持续中` } : entry)
}

export function taskTimeSummary(task: TaskTiming, nowMs = Date.now()) {
  const stages = remainingTimeStages(task, nowMs)
  const candidates: Array<{ stage: TaskTimeStage | undefined; state: StageState; at: number; date: string; time: string; label: string; risk: boolean }> = stages.map((stage) => {
    const start = stageBoundaryAt(stage.start, 'start')
    const end = stageBoundaryAt(stage.end, 'end')
    const state = stageTimeState(stage, nowMs)
    const upcomingStart = state === 'upcoming' && Number.isFinite(start)
    const boundary = upcomingStart ? stage.start : stage.end || stage.start
    return { stage, state, at: upcomingStart ? start : Number.isFinite(end) ? end : Number.isFinite(start) ? start : Infinity, date: boundary?.date || '', time: boundary?.time || '', label: `${stageLabel(stage, taskStages(task).indexOf(stage))} · ${stageStatusText(stage, nowMs)}${boundary?.date ? ` · ${boundaryText(boundary, stage.allDay)}${upcomingStart ? ' 开始' : stage.end ? ' 结束' : ''}` : ''}`, risk: state === 'ended' && stage.completionRequired !== false }
  })
  if (task.dueDate) candidates.push({ stage: undefined as TaskTimeStage | undefined, state: 'active' as StageState, at: policyDateTime(task.dueDate, task.dueTime || '23:59'), date: task.dueDate, time: task.dueTime || '', label: `事项截止 · ${boundaryText({ date: task.dueDate, time: task.dueTime })}`, risk: policyDateTime(task.dueDate, task.dueTime || '23:59') < nowMs })
  candidates.sort((left, right) => Number(right.risk) - Number(left.risk) || left.at - right.at)
  const next = candidates[0]
  const following = candidates.find((entry) => entry !== next && !entry.risk && entry.at >= nowMs)
  return { next, following, risk: Boolean(next?.risk), remaining: stages.length, text: next?.label || (taskStages(task).length ? '阶段已完成 · 待确认事项完成' : '日期待定') }
}

/** 只有用户明确设定的完整占用区间参加冲突判断。 */
export function taskOccupiedRanges(task: TaskTiming): Array<{ start: number; end: number; stageId: string; label: string }> {
  return taskStages(task).filter((stage) => stage.kind === 'scheduled' && stage.completionRequired !== false && !stage.completedAt && stage.start?.date && stage.end?.date && (stage.allDay || (stage.start.time && stage.end.time))).map((stage) => ({ start: stageBoundaryAt(stage.start, 'start'), end: stageBoundaryAt(stage.end, 'end'), stageId: stage.id, label: stageLabel(stage) })).filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
}

export function taskCurrentDate(task: TaskTiming, nowMs = Date.now()): string {
  return taskTimeSummary(task, nowMs).next?.date || ''
}

export function isTaskPlanToday(task: TaskTiming, nowMs = Date.now()): boolean {
  const today = policyDateKey(new Date(nowMs))
  return taskCurrentDate(task, nowMs) === today || remainingTimeStages(task, nowMs).some((stage) => stageTimeState(stage, nowMs) === 'active')
}

export function taskPlanInPeriod(task: TaskTiming, period: 'today' | 'week', nowMs = Date.now()): boolean {
  if (isTaskPlanToday(task, nowMs)) return true
  const today = policyDateKey(new Date(nowMs))
  const end = period === 'today' ? today : moveTimeDate(today, 6)
  const dates = [task.dueDate, ...remainingTimeStages(task, nowMs).flatMap((stage) => [stage.start?.date, stage.end?.date])]
  return dates.some((date) => Boolean(date && date >= today && date <= end))
}
