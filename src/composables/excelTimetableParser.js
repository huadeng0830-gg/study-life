// 解析语义已收口到 timetable facade。这里的本地名 text 是历史词汇（文件内约 15 处调用），
// 直接别名到 facade 的 Excel 归一化，避免为改名制造无关 diff。
import {
  normalizeCellText as text,
  normalizePeriodText,
  normalizeWeekText,
  weekTypeChineseLabel,
  weekdayIndexFromCell,
} from './timetable/index.js'

const HEADERS = {
  name: ['课程名称', '课程名', '课程', '科目', '名称', 'course', 'name'],
  day: ['星期', '星期几', '周几', '上课星期', '上课日', 'weekday', 'day'],
  period: ['节次', '上课节次', '上课时间', '时间段', '课次', '节数', 'period', 'section'],
  week: ['周次', '上课周次', '教学周', 'week'],
  weekType: ['单双周', '周类型', '上课周类型', 'weektype'],
  room: ['地点', '上课地点', '教室', '上课教室', '位置', 'room', 'location'],
  teacher: ['教师', '任课教师', '老师', 'teacher', 'instructor'],
}

function normalizedHeader(value) {
  return text(value).toLowerCase().replace(/[\s_\-:：()（）]/g, '')
}

// 保留原函数名：调用点只声明「需要哪种失败约定」，实现（正则/字符类/归一化）全在 facade。
// 这里选 weekdayIndexFromCell（失败约定 null，额外接受纯数字 1-7 的表头）。
function dayFromText(value) {
  return weekdayIndexFromCell(value)
}

// 选 normalizePeriodText：Excel 的「透传」约定——认不出来时原样返回文本，
// 调用点用 `!period` 只过滤空单元格（详见 facade/period.js 文件头）。
function normalizePeriod(value) {
  return normalizePeriodText(value)
}

// 选 normalizeWeekText：Excel 周次列的「透传 + 全学期」约定；单/双周在这里编码成
// 批量文本字面量（'\t单周'），不是课程对象的 'odd'。
function normalizeWeek(value) {
  return normalizeWeekText(value)
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
    const weekType = weekTypeChineseLabel(row[selected.fields.weekType])
    const room = text(row[selected.fields.room])
    const teacher = text(row[selected.fields.teacher])
    lines.push([
      name,
      `周${'一二三四五六日'[day]}`,
      period,
      week || '全学期',
      weekType,
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
