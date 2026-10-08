// Todoist / Notion / Reminders CSV import for tasks and events. This shares the bill importer’s
// encoding, RFC 4180 parser, and bounded header scan so UTF-8/GBK exports and
// preamble rows behave consistently across importers.
import { decodeBillText, findHeader, parseCsv, splitDateTime } from './ledgerBillImport.js'

const MAX_IMPORT_ROWS = 2000

const ALIASES = {
  id: ['id', 'task id', 'reminder id', 'event id', 'uuid', '标识', '编号'],
  title: ['task name', 'title', 'name', 'subject', 'event', 'event name', 'reminder', 'content', '事项', '待办', '任务', '标题', '名称', '日程', '活动'],
  body: ['description', 'notes', 'note', 'body', 'text', 'content', 'details', 'memo', '正文', '内容', '文本', '备注', '说明'],
  date: ['due date', 'deadline', 'target date', 'scheduled date', 'date', 'start date', '日期', '截止日期', '到期日', '提醒日期', '开始日期'],
  time: ['due time', 'start time', 'time', '时间', '提醒时间'],
  endTime: ['end time', '结束时间'],
  location: ['location', 'place', '地点', '位置'],
  course: ['course', 'course name', 'class', '课程', '课程名称'],
  priority: ['priority', 'importance', '优先级', '重要性'],
  status: ['status', 'state', 'completed', 'is completed', 'done', '完成状态', '状态', '是否完成'],
  completedAt: ['completed at', 'completion date', 'completed date', '完成时间', '完成日期'],
  tags: ['tags', 'labels', 'tag', '标签'],
}

const HEADER_ALIASES = Object.fromEntries(Object.entries(ALIASES).map(([key, values]) => [key, values.map(normalizeHeader)]))

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()[\]{}（）【】:：.]/g, '')
}

function normalizeKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

function cell(row, map, key) {
  for (const alias of HEADER_ALIASES[key] || []) {
    const index = map[alias]
    if (index !== undefined) {
      const value = String(row[index] ?? '').trim()
      if (value) return value
    }
  }
  return ''
}

function localDateTimeFromParsed(value) {
  const direct = splitDateTime(value)
  if (direct.date && validDateKey(direct.date)) return direct
  const timestamp = Date.parse(String(value ?? '').trim())
  if (!Number.isFinite(timestamp)) return { date: '', time: '' }
  const date = new Date(timestamp)
  const pad = (number) => String(number).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

function normalizeTime(value, dateBasis = '2000-01-01') {
  const text = String(value ?? '').normalize('NFKC').trim()
  if (!text) return ''
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(text)
  if (match) {
    let hour = Number(match[1])
    const minute = Number(match[2])
    const meridiem = match[3]?.toUpperCase()
    if (minute > 59 || hour > (meridiem ? 12 : 23) || (meridiem && hour < 1)) return ''
    if (meridiem) hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0)
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  const timestamp = Date.parse(`${dateBasis || '2000-01-01'} ${text}`)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function validDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function normalizePriority(value) {
  const text = normalizeKey(value)
  if (/^(?:1|p1|urgent|highest|高|最高|紧急)$/.test(text)) return 'high'
  if (/^(?:4|p4|low|lowest|低|最低)$/.test(text)) return 'low'
  if (/^(?:2|p2|3|p3|normal|medium|中|普通)$/.test(text)) return 'normal'
  if (/高|紧急|urgent|high/.test(text)) return 'high'
  if (/低|low/.test(text)) return 'low'
  return 'normal'
}

function isCompleted(status, completedAt) {
  const text = normalizeKey(status)
  if (completedAt) return true
  if (/^(?:true|yes|1|done|completed|complete|closed|已完成|完成|已勾选)$/.test(text)) return true
  if (/^(?:false|no|0|open|active|未完成|待办|进行中)$/.test(text)) return false
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text)) return true
  return /已完成|已勾选/.test(text)
}

function parseRecord(kind, row, map) {
  const titleValue = cell(row, map, 'title')
  const body = cell(row, map, 'body')
  const title = titleValue || body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
  const dateText = cell(row, map, 'date')
  const dateParts = localDateTimeFromParsed(dateText)
  const timeText = cell(row, map, 'time')
  const time = normalizeTime(timeText, dateParts.date) || dateParts.time
  const location = cell(row, map, 'location')
  const course = cell(row, map, 'course')
  const note = body && normalizeKey(body) !== normalizeKey(title) ? body : ''
  const externalId = cell(row, map, 'id')

  if (kind === 'tasks') {
    if (!title) return null
    return {
      title,
      dueDate: dateParts.date,
      dueTime: time,
      priority: normalizePriority(cell(row, map, 'priority')),
      note,
      sourceText: [title, body].filter(Boolean).join('\n'),
      course,
      kind: /作业|实验|论文/.test(cell(row, map, 'tags')) ? 'homework' : 'todo',
      completed: isCompleted(cell(row, map, 'status'), cell(row, map, 'completedAt')),
      externalId,
    }
  }

  if (kind === 'events') {
    if (!title) return null
    return {
      title,
      date: dateParts.date,
      time,
      endTime: normalizeTime(cell(row, map, 'endTime'), dateParts.date),
      location,
      courseName: course,
      note: body,
      sourceText: [title, body].filter(Boolean).join('\n'),
      externalId,
    }
  }

  throw new Error('未知的 CSV 导入类型')
}

function stableRowKey(kind, row) {
  const fields = kind === 'events'
    ? [row.title, row.date, row.time, row.location, row.note]
    : [row.title, row.dueDate, row.dueTime, row.note]
  return `${kind}|${fields.map(normalizeKey).join('|')}`
}

// Store only a compact fingerprint in sourceId; keeping the raw title/note in
// metadata would duplicate private user text in sync/export payloads.
function hashKey(value) {
  let first = 2166136261
  let second = 0x9e3779b9
  for (const char of String(value)) {
    const code = char.codePointAt(0)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 2246822519)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

function externalRowKey(kind, externalId) {
  return externalId ? `csv:${kind}:external:${hashKey(normalizeKey(externalId))}` : ''
}

function existingKeys(kind, records) {
  const keys = new Set()
  for (const record of records || []) {
    if (record?.sourceType === 'domain-csv-import' && record.sourceId) keys.add(record.sourceId)
    const row = kind === 'events'
      ? { title: record?.title, date: record?.date, time: record?.time, location: record?.location, note: record?.note }
      : { title: record?.title, dueDate: record?.dueDate, dueTime: record?.dueTime, note: record?.note }
    if (row.title) keys.add(stableRowKey(kind, row))
  }
  return keys
}

/**
 * Decode, scan for a header within the first 40 rows, map common task/event
 * exports, and suppress duplicates already in the app or repeated in the file.
 */
export function parseDomainCsvFile(arrayBuffer, { kind = 'tasks', records = [], maxRows = MAX_IMPORT_ROWS } = {}) {
  if (!['tasks', 'events'].includes(kind)) throw new Error('请选择待办或日程导入类型')
  const rowLimit = Math.max(1, Math.min(MAX_IMPORT_ROWS, Number(maxRows) || MAX_IMPORT_ROWS))
  // The header scanner accepts at most 40 preamble rows. Keep enough room for
  // that preamble, the header, and the full import limit, while the shared CSV
  // parser avoids constructing rows beyond this bound.
  const table = parseCsv(decodeBillText(arrayBuffer), { maxRows: 40 + rowLimit })
  const normalizedTable = table.map((row) => row.map(normalizeHeader))
  const titleAliases = HEADER_ALIASES.title
  const header = findHeader(normalizedTable, [titleAliases])
  if (!header) {
    return { rows: [], total: 0, headerRow: -1, truncated: false, skipped: { invalid: 0, duplicates: 0 }, error: '前 40 行中没有找到可识别的标题/内容表头。' }
  }

  const known = existingKeys(kind, records)
  const rows = []
  const seen = new Set(known)
  const skipped = { invalid: 0, duplicates: 0 }
  let nonEmptyRows = 0

  for (let index = header.index + 1; index < table.length; index += 1) {
    const raw = table[index]
    if (!raw.some((value) => String(value ?? '').trim())) continue
    nonEmptyRows += 1
    if (nonEmptyRows > rowLimit) continue
    const parsed = parseRecord(kind, raw, header.map)
    if (!parsed) { skipped.invalid += 1; continue }
    const contentKey = stableRowKey(kind, parsed)
    const sourceId = externalRowKey(kind, parsed.externalId) || `csv:${kind}:content:${hashKey(contentKey)}`
    const externalKey = externalRowKey(kind, parsed.externalId)
    if (seen.has(contentKey) || seen.has(sourceId) || (externalKey && seen.has(externalKey))) {
      skipped.duplicates += 1
      continue
    }
    seen.add(contentKey)
    seen.add(sourceId)
    if (externalKey) seen.add(externalKey)
    const { externalId: _externalId, ...data } = parsed
    rows.push({ ...data, createdFrom: 'csv-import', sourceType: 'domain-csv-import', sourceId })
  }

  return {
    rows,
    total: rows.length,
    headerRow: header.index,
    truncated: table.truncated || nonEmptyRows > rowLimit,
    skipped,
  }
}
