// 与云函数中的同名文件保持一致；跨端规范由测试校验。
const KINDS = ['task', 'course', 'event', 'milestone', 'transaction', 'bill', 'note', 'list', 'focus', 'settings', 'mood']
function invalid(message) { const error = new Error(message); error.code = 'invalid_input'; throw error }
function text(value, label, maximum = 100, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') invalid(`${label}格式不正确。`)
  const result = String(value ?? '').trim()
  if ((required && !result) || result.length > maximum) invalid(`${label}${required ? '不能为空，且' : ''}最多 ${maximum} 个字。`)
  return result
}
function number(value, label, minimum, maximum, integer = true) {
  const result = Number(value)
  if (value === '' || value === undefined || value === null || !Number.isFinite(result) || (integer && !Number.isSafeInteger(result)) || result < minimum || result > maximum) invalid(`${label}须为 ${minimum}–${maximum} 的${integer ? '整数' : '数字'}。`)
  return result
}
function date(value, label, required = false) {
  const result = text(value, label, 10, required)
  if (!result) return ''
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) invalid(`${label}须为有效日期。`)
  return result
}
function time(value, label, required = false) {
  const result = text(value, label, 5, required)
  if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) invalid(`${label}须为 HH:mm。`)
  return result
}
function choice(value, values, label) { if (!values.includes(value)) invalid(`${label}选项无效。`); return value }
function normalize(kind, input = {}) {
  if (!KINDS.includes(kind) || !input || typeof input !== 'object' || Array.isArray(input)) invalid('记录类型或内容无效。')
  const row = kind === 'settings' || kind === 'mood' ? {} : { title: text(input.title, '名称', 100, true) }
  if (!['settings', 'mood', 'focus'].includes(kind)) row.note = text(input.note, '备注', 5000)
  if (['task', 'event', 'milestone', 'focus'].includes(kind)) row.courseId = text(input.courseId, '关联课程', 64)
  if (kind === 'task') Object.assign(row, { dueDate: date(input.dueDate, '截止日期'), dueTime: time(input.dueTime, '截止时间'), priority: choice(input.priority || 'normal', ['high', 'normal', 'low'], '优先级'), duration: number(input.duration ?? 25, '预计分钟', 1, 1440), completed: input.completed === true, spentSeconds: number(input.spentSeconds ?? 0, '专注时长', 0, 31536000) })
  if (kind === 'course') {
    Object.assign(row, { teacher: text(input.teacher, '教师', 60), location: text(input.location, '地点', 120), weekday: number(input.weekday, '星期', 1, 7), startTime: time(input.startTime, '上课时间', true), endTime: time(input.endTime, '下课时间', true), startWeek: number(input.startWeek ?? 1, '开始周', 1, 52), endWeek: number(input.endWeek ?? 20, '结束周', 1, 52), parity: choice(input.parity || 'all', ['all', 'odd', 'even'], '周次') })
    if (row.startTime >= row.endTime || row.startWeek > row.endWeek) invalid('课程结束时间、结束周须晚于或等于开始范围。')
  }
  if (kind === 'event') {
    Object.assign(row, { date: date(input.date, '日期', true), time: time(input.time, '开始时间'), endTime: time(input.endTime, '结束时间'), location: text(input.location, '地点', 120) })
    if (row.endTime && (!row.time || row.endTime <= row.time)) invalid('日程结束时间须晚于开始时间。')
  }
  if (kind === 'milestone') Object.assign(row, { date: date(input.date, '日期', true), category: choice(input.category || 'exam', ['exam', 'deadline', 'birthday', 'anniversary', 'other'], '类型') })
  if (kind === 'transaction' || kind === 'bill') Object.assign(row, { amountMinor: number(input.amountMinor, '金额（分）', 1, 100000000000), date: date(input.date, '日期', true), category: text(input.category || '其他', '分类', 40), currency: choice(input.currency || 'CNY', ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD'], '币种'), account: text(input.account || '默认账户', '账户', 60) })
  if (kind === 'transaction') row.direction = choice(input.direction || 'expense', ['expense', 'income'], '收支类型')
  if (kind === 'bill') { row.cycle = choice(input.cycle || 'monthly', ['once', 'weekly', 'monthly', 'yearly'], '周期'); row.anchorDay = number(input.anchorDay ?? Number(row.date.slice(8)), '账单月内日期', 1, 31) }
  if (kind === 'note') row.body = text(input.body, '笔记内容', 12000, true)
  if (kind === 'list') {
    if (!Array.isArray(input.items) || input.items.length > 200) invalid('清单最多 200 项。')
    row.items = input.items.map(item => ({ id: text(item.id, '项目编号', 64, true), title: text(item.title, '清单项目', 200, true), done: item.done === true, quantity: number(item.quantity ?? 1, '数量', 0, 100000, false), unitPriceMinor: number(item.unitPriceMinor ?? 0, '单价（分）', 0, 10000000000) }))
    if (new Set(row.items.map(item => item.id)).size !== row.items.length) invalid('清单项目编号不能重复。')
  }
  if (kind === 'focus') {
    row.taskId = text(input.taskId, '关联待办', 64)
    row.durationSeconds = number(input.durationSeconds, '实际专注秒数', 1, 86400)
    row.date = date(input.date, '日期', true)
    row.note = text(input.note, '专注进展', 1000)
  }
  if (kind === 'settings') {
    Object.assign(row, { theme: choice(input.theme || 'blue', ['blue', 'purple', 'green', 'pink'], '主题'), termStart: date(input.termStart, '学期第一周周一'), campus: text(input.campus, '校区', 80), season: text(input.season || '默认作息', '作息', 60), budgetMinor: number(input.budgetMinor ?? 0, '月预算（分）', 0, 100000000000) })
    if (row.termStart && new Date(`${row.termStart}T00:00:00Z`).getUTCDay() !== 1) invalid('学期起始日请选择第一周的周一。')
  }
  if (kind === 'mood') Object.assign(row, { date: date(input.date, '日期', true), mood: choice(input.mood, ['开心', '平静', '疲惫', '低落', '充实'], '心情'), note: text(input.note, '心情备注', 200) })
  return row
}
module.exports = { KINDS, normalize }
