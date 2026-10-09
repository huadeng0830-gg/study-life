export function validEventDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

export function validEventTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))
}

// Shared by the editor and commands, so quick entry/import cannot persist invalid intervals.
export function eventInputError(value = {}) {
  if (!String(value.title || '').trim()) return { field: 'title', message: '请填写日程内容' }
  if (value.date && !validEventDate(value.date)) return { field: 'date', message: '请选择有效的日期' }
  if (value.time && !validEventTime(value.time)) return { field: 'time', message: '开始时间格式应为 HH:mm' }
  if (value.endTime && !validEventTime(value.endTime)) return { field: 'endTime', message: '结束时间格式应为 HH:mm' }
  if ((value.time || value.endTime) && !value.date) return { field: 'date', message: '安排时间前，请先选择日期' }
  if (value.endTime && !value.time) return { field: 'time', message: '请先选择开始时间' }
  if (value.endTime && value.endTime <= value.time) return { field: 'endTime', message: '结束时间须晚于开始时间；跨日安排请拆成两条日程' }
  if (value.reminderEnabled !== false && value.reminderMinutes !== undefined && value.reminderMinutes !== null && value.reminderMinutes !== '') {
    const minutes = Number(value.reminderMinutes)
    if (!Number.isSafeInteger(minutes) || minutes < 0) return { field: 'reminderMinutes', message: '提醒时间须为不小于 0 的整数分钟' }
  }
  return null
}
