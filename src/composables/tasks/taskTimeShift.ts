import type { TaskStageBoundary } from '../../types/domain'
import { policyDateKey, policyDateTime, policyTimeKey } from '../settingsPolicy.js'
import { boundaryText, moveTimeDate, stageLabel, stageTimeState, taskRepeatBase, taskStages, taskTimePlanError, timeClockExists, validTimeClock, validTimeDate, type TaskTiming } from './taskTimePlan'

export interface TaskShiftDuration {
  direction: 'later' | 'earlier'
  days: number | string
  hours: number | string
  minutes: number | string
}
export interface ShiftChange { key: string; label: string; before: string; after: string }
export interface MissingShiftTime { key: string; label: string; date: string }

/** 天按日历移动，小时/分钟按经过的时长移动；日期精度从不自动补成午夜。 */
export function previewTaskTimeShift(task: TaskTiming, duration: TaskShiftDuration, { dateOnlyTimes = {} as Record<string, string>, nowMs = Date.now(), includeDeadline = true } = {}) {
  const plan: Required<Pick<TaskTiming, 'dueDate' | 'dueTime' | 'timeStages'>> = JSON.parse(JSON.stringify({ dueDate: task.dueDate || '', dueTime: task.dueTime || '', timeStages: taskStages(task) }))
  const changes: ShiftChange[] = []
  const missingTimes: MissingShiftTime[] = []
  const dateOnlyBoundaries: MissingShiftTime[] = []
  const values = [duration.days, duration.hours, duration.minutes].map((value) => Number(value || 0))
  let error = ''
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) error = '天、小时和分钟请填写大于或等于 0 的整数。'
  else if (!values.some(Boolean)) error = '请填写要移动的时长。'
  else if (!['later', 'earlier'].includes(duration.direction)) error = '请选择提前或顺延。'
  const sign = duration.direction === 'earlier' ? -1 : 1
  const dayOffset = (values[0] || 0) * sign
  const minuteOffset = ((values[1] || 0) * 60 + (values[2] || 0)) * sign
  if (!Number.isSafeInteger(minuteOffset)) error = '移动的时长过大，请缩短。'
  if (error) return { plan, changes, missingTimes, dateOnlyBoundaries, error }

  function move(boundary: TaskStageBoundary, key: string, label: string): TaskStageBoundary {
    if (!boundary.date) return boundary
    if (!validTimeDate(boundary.date)) { error = `${label}的原日期无效，请先修改。`; return boundary }
    const date = moveTimeDate(boundary.date, dayOffset)
    if (!date) { error = '移动后的日期超出了可支持的范围。'; return boundary }
    let next: TaskStageBoundary = { ...boundary, date }
    if (minuteOffset) {
      if (!boundary.time) dateOnlyBoundaries.push({ key, label, date: boundary.date })
      const time = boundary.time || dateOnlyTimes[key]
      if (!validTimeClock(time || '')) {
        missingTimes.push({ key, label, date: boundary.date })
        return boundary
      }
      const base = policyDateTime(date, time)
      // 夏令时不存在的时刻不能被原生 Date 默默滚到另一个小时。
      if (!Number.isFinite(base) || policyDateKey(new Date(base)) !== date || policyTimeKey(new Date(base)) !== time) {
        error = `${label}的时刻在当前时区不存在，请选择其他时刻。`
        return boundary
      }
      const moved = new Date(base + minuteOffset * 60_000)
      if (!Number.isFinite(moved.getTime())) { error = '移动后的日期超出了可支持的范围。'; return boundary }
      next = { date: policyDateKey(moved), time: policyTimeKey(moved) }
      if (!validTimeDate(next.date)) { error = '移动后的日期超出了可支持的范围。'; return boundary }
      if (policyDateTime(next.date, next.time) !== moved.getTime()) { error = `${label}的目标时刻在当前时区出现两次，无法准确保存本次改期。请调整移动时长。`; return boundary }
    }
    if (next.time && !timeClockExists(next.date, next.time)) { error = `${label}的时刻在当前时区不存在，请选择其他时刻。`; return boundary }
    changes.push({ key, label, before: boundaryText(boundary), after: boundaryText(next) })
    return next
  }

  if (includeDeadline && plan.dueDate) {
    const due = move({ date: plan.dueDate, ...(plan.dueTime ? { time: plan.dueTime } : {}) }, 'due', '事项截止')
    plan.dueDate = due.date
    plan.dueTime = due.time || ''
  }
  plan.timeStages = plan.timeStages.map((stage, index) => {
    const state = stageTimeState(stage, nowMs)
    if (state === 'completed' || (stage.completionRequired === false && state === 'ended')) return stage
    const next = { ...stage }
    for (const anchor of ['start', 'end'] as const) {
      if (stage[anchor]?.date) next[anchor] = move(stage[anchor], `${stage.id}:${anchor}`, `${stageLabel(stage, index)}${anchor === 'start' ? '开始' : '结束'}`)
    }
    if (stage.allDay && minuteOffset && !missingTimes.some((item) => item.key.startsWith(`${stage.id}:`))) next.allDay = false
    return next
  })
  if (!error && !missingTimes.length) error = taskTimePlanError(plan.timeStages)?.message || ''
  if (!error && !missingTimes.length && !changes.length) error = '没有可移动的日期。请先给未完成的安排填写日期。'
  return { plan, changes, missingTimes, dateOnlyBoundaries, error }
}

export function shiftDurationText(duration: TaskShiftDuration): string {
  return `${duration.direction === 'earlier' ? '提前' : '顺延'} ${[
    Number(duration.days) ? `${Number(duration.days)} 天` : '',
    Number(duration.hours) ? `${Number(duration.hours)} 小时` : '',
    Number(duration.minutes) ? `${Number(duration.minutes)} 分钟` : '',
  ].filter(Boolean).join(' ')}`.trim()
}

/** 撤销仅还原本次改过且之后未再修改的端点，保留新增阶段、名称、提醒和完成事实。 */
export function undoTaskTimeShift(current: TaskTiming, before: TaskTiming, after: TaskTiming): TaskTiming {
  const plan: TaskTiming = JSON.parse(JSON.stringify({ dueDate: current.dueDate || '', dueTime: current.dueTime || '', timeStages: taskStages(current) }))
  if (current.dueDate === after.dueDate && (current.dueTime || '') === (after.dueTime || '')) {
    plan.dueDate = before.dueDate || ''
    plan.dueTime = before.dueTime || ''
  }
  const original = new Map(taskStages(before).map((stage) => [stage.id, stage]))
  const moved = new Map(taskStages(after).map((stage) => [stage.id, stage]))
  plan.timeStages = taskStages(plan).map((stage) => {
    const previous = original.get(stage.id)
    const shifted = moved.get(stage.id)
    if (!previous || !shifted) return stage
    const next = { ...stage }
    for (const anchor of ['start', 'end'] as const) {
      if (JSON.stringify(stage[anchor]) !== JSON.stringify(shifted[anchor])) continue
      if (previous[anchor]) next[anchor] = { ...previous[anchor] }
      else delete next[anchor]
    }
    if (stage.kind === previous.kind && stage.allDay === shifted.allDay && !next.start?.time && !next.end?.time) next.allDay = previous.allDay
    return taskTimePlanError([next]) ? stage : next
  })
  // 重复日号属于重复基准；只有基准一起恢复时才恢复它，避免覆盖后来的改期。
  const beforeBase = taskRepeatBase(before).date
  const afterBase = taskRepeatBase(after).date
  if (current.repeat === 'monthly') plan.repeatAnchorDay = current.repeatAnchorDay ?? null
  if (current.repeat === 'monthly' && before.repeat === 'monthly' && after.repeat === 'monthly'
    && beforeBase !== afterBase && taskRepeatBase(current).date === afterBase && taskRepeatBase(plan).date === beforeBase
    && (current.repeatAnchorDay ?? null) === (after.repeatAnchorDay ?? null)) plan.repeatAnchorDay = before.repeatAnchorDay ?? null
  return plan
}
