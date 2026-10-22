import { taskDeadlineError, taskRepeatBase, validTimeDate } from './taskTimePlan'
import { normalizeTaskRepeat } from '../taskRecurrence.js'

// Partial edits validate the fields being changed. A legacy record can still be
// repaired one field at a time without first replacing unrelated old metadata.
export function taskInputError(value, previous = null) {
  const has = (key) => Object.hasOwn(value, key)
  const next = { ...previous, ...value }
  if ((!previous || has('title')) && !String(next.title ?? '').trim()) return { field: 'title', message: '请填写待办内容' }
  if (!previous || ['startDate', 'startTime', 'dueDate', 'dueTime'].some(has)) {
    const issue = taskDeadlineError(next)
    if (issue) return issue
  }
  for (const [field, label] of [['estimateMinutes', '预计时长'], ['actualMinutes', '实际用时'], ['reminderMinutes', '提醒提前量']]) {
    if (!has(field) || value[field] === '' || value[field] == null) continue
    if (!Number.isFinite(Number(value[field])) || Number(value[field]) < 0) return { field, message: `${label}需要是大于或等于 0 的分钟数。` }
  }
  if (!previous || ['repeat', 'repeatEndDate', 'startDate', 'dueDate', 'timeStages'].some(has)) {
    if (normalizeTaskRepeat(next.repeat) !== 'none') {
      const base = taskRepeatBase(next).date
      if (!base) return { field: 'dueDate', message: '重复待办需要设置截止日期、开始日期或阶段日期，完成后才能生成下一期。' }
      if (next.repeatEndDate && !validTimeDate(next.repeatEndDate)) return { field: 'repeatEndDate', message: '请选择有效的重复结束日期。' }
      if (next.repeatEndDate && next.repeatEndDate < base) return { field: 'repeatEndDate', message: '重复结束日期不能早于本期重复基准日期。' }
    }
  }
  return null
}
