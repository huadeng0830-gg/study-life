import { validTimeClock, validTimeDate } from './tasks/taskTimeFields'

export function milestoneInputError(value, previous = null) {
  const has = (key) => Object.hasOwn(value, key)
  const next = { ...previous, ...value }
  if ((!previous || has('name') || has('title')) && !String(next.name ?? next.title ?? '').trim()) return { field: 'name', message: '请填写重要日期名称' }
  const external = next.kind === 'externalExam' || next.category === '校外考试'
  if (!previous || ['date', 'examDate', 'registerStart', 'registerDeadline', 'kind', 'category'].some(has)) {
    const target = external ? (next.examDate || next.registerDeadline || (!Object.hasOwn(next, 'examDate') ? next.date : '')) : next.date
    if (!validTimeDate(target)) return { field: external ? 'examDate' : 'date', message: external ? '请填写有效的考试日期或报名截止日期' : '请选择有效的目标日期' }
    if (external) {
      for (const field of ['registerStart', 'registerDeadline', 'examDate']) {
        if (next[field] && !validTimeDate(next[field])) return { field, message: '请选择有效的日期' }
      }
      if (next.registerStart && next.registerDeadline && next.registerDeadline < next.registerStart) return { field: 'registerDeadline', message: '报名截止日期不能早于报名开始日期' }
    }
  }
  const timeField = external ? 'examTime' : 'time'
  if ((!previous || has(timeField)) && next[timeField] && !validTimeClock(next[timeField])) return { field: timeField, message: '请填写有效时间（HH:mm）' }
  if (has('reminderMinutes') && value.reminderMinutes !== '' && value.reminderMinutes != null
    && (!Number.isFinite(Number(value.reminderMinutes)) || Number(value.reminderMinutes) < 0)) return { field: 'reminder', message: '提醒提前量需要是大于或等于 0 的分钟数' }
  return null
}
