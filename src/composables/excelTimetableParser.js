const DAY_TOKEN = /(?:星期|周)\s*([一二三四五六日天])/
const DAY_BY_DIGIT = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }

const HEADERS = {
  name: ['课程名称', '课程名', '课程', '科目', '名称', 'course', 'name'],
  day: ['星期', '星期几', '周几', '上课星期', '上课日', 'weekday', 'day'],
  period: ['节次', '上课节次', '上课时间', '时间段', '课次', '节数', 'period', 'section'],
  week: ['周次', '上课周次', '教学周', 'week'],
  weekType: ['单双周', '周类型', '上课周类型', 'weektype'],
  room: ['地点', '上课地点', '教室', '上课教室', '位置', 'room', 'location'],
  teacher: ['教师', '任课教师', '老师', 'teacher', 'instructor'],
}

function text(value) {
  return String(value ?? '')
    .replace(/[\u2013\u2014\u2212~～]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedHeader(value) {
  return text(value).toLowerCase().replace(/[\s_\-:：()（）]/g, '')
}

function dayFromText(value) {
  const normalized = text(value)
  const matched = normalized.match(DAY_TOKEN)
  if (matched) return DAY_BY_DIGIT[matched[1]]
  if (/^[1-7]$/.test(normalized)) return Number(normalized) - 1
  return null
}

function normalizePeriod(value) {
  const normalized = text(value)
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
  const compact = normalized.match(/(?:^|\D)(0[1-9]|1[0-2])(0[1-9]|1[0-2])(?:\D|$)/)
  if (compact) return `${Number(compact[1])}-${Number(compact[2])}节`
  const range = normalized.match(/(?:第?\s*)?(\d{1,2})(?:\s*[-至到]\s*(\d{1,2}))?\s*(?:节|课)?/)
  if (!range) return normalized
  const start = Number(range[1])
  const end = Number(range[2] || range[1])
  if (start < 1 || end < start || end > 12) return normalized
  return `${start}-${end}节`
}

function normalizeWeek(value) {
  const normalized = text(value)
  if (!normalized) return ''
  if (/全学期/.test(normalized)) return '全学期'
  const matched = normalized.match(/(\d{1,2})\s*[-至到]\s*(\d{1,2})/)
  if (matched) return `${matched[1]}-${matched[2]}周${/单周/.test(normalized) ? '\t单周' : /双周/.test(normalized) ? '\t双周' : ''}`
  const single = normalized.match(/^(\d{1,2})\s*周?$/)
  return single ? `${single[1]}周` : normalized
}

function headerMap(row) {
  const result = {}
  for (const [column, value] of row.entries()) {
    const header = normalizedHeader(value)
    if (!header) continue
    for (const [field, aliases] of Object.entries(HEADERS)) {
      if (result[field] === undefined && aliases.some((alias) => header === normalizedHeader(alias))) result[field] = column
    }
  }
  return result
}

function parseListSheet(rows, sheetName) {
  let selected = null
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 8); rowIndex++) {
    const fields = headerMap(rows[rowIndex] || [])
    const score = ['name', 'day', 'period'].filter((field) => fields[field] !== undefined).length
    if (!selected || score > selected.score) selected = { rowIndex, fields, score }
  }
  if (!selected || selected.score < 3) return { batchText: '', count: 0 }

  const lines = []
  for (const row of rows.slice(selected.rowIndex + 1)) {
    const name = text(row[selected.fields.name])
    const day = dayFromText(row[selected.fields.day])
    const period = normalizePeriod(row[selected.fields.period])
    if (!name && row.every((cell) => !text(cell))) continue
    if (!name || day === null || !period) continue
    const week = normalizeWeek(row[selected.fields.week])
    const weekType = text(row[selected.fields.weekType])
    const room = text(row[selected.fields.room])
    const teacher = text(row[selected.fields.teacher])
    lines.push([
      name,
      `周${'一二三四五六日'[day]}`,
      period,
      week || '全学期',
      /单周/.test(weekType) ? '单周' : /双周/.test(weekType) ? '双周' : '',
      room ? `地点:${room}` : '',
      teacher ? `教师:${teacher}` : '',
    ].filter(Boolean).join('\t'))
  }
  return { batchText: lines.join('\n'), count: lines.length, sheetName, mode: 'list' }
}

function parseGridSheet(rows, sheetName) {
  const headers = []
  for (const [rowIndex, row] of rows.entries()) {
    for (const [column, cell] of row.entries()) {
      const day = dayFromText(cell)
      if (day !== null) headers.push({ day, rowIndex, column })
    }
  }
  const byRow = new Map()
  for (const item of headers) byRow.set(item.rowIndex, [...(byRow.get(item.rowIndex) || []), item])
  const [headerRow, dayColumns = []] = [...byRow.entries()]
    .sort((left, right) => right[1].length - left[1].length)[0] || []
  if (!Number.isInteger(headerRow) || dayColumns.length < 2) return { columns: [], count: 0 }

  const columns = dayColumns
    .sort((left, right) => left.column - right.column)
    .map(({ day, column }) => ({
      day,
      confidence: 96,
      text: rows.slice(headerRow + 1)
        .map((row) => text(row[column]))
        .filter(Boolean)
        .join('\n'),
    }))
    .filter((column) => column.text)
  return { columns, count: columns.length, sheetName, mode: 'grid' }
}

// Returns normalized text lines for the existing preview and conflict engine.
// The caller still parses and validates every line before it can be imported.
export function extractExcelTimetable(sheets) {
  const candidates = []
  for (const sheet of sheets || []) {
    const rows = sheet.rows || []
    if (!rows.length) continue
    const list = parseListSheet(rows, sheet.name)
    const grid = parseGridSheet(rows, sheet.name)
    if (list.count) candidates.push({ ...list, score: list.count * 12 + 6 })
    if (grid.count) candidates.push({ ...grid, score: grid.count * 7 })
  }
  const selected = candidates.sort((left, right) => right.score - left.score)[0]
  return selected || { batchText: '', columns: [], count: 0, sheetName: '', mode: '' }
}
