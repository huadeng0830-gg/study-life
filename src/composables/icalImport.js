export const MAX_ICS_IMPORT_BYTES = 3 * 1024 * 1024
const MAX_ICS_EVENTS = 500

function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength
  return String(text).length * 2
}

function unfoldLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
}

function parseProperty(line) {
  const separator = line.indexOf(':')
  if (separator < 1) return null
  const head = line.slice(0, separator).split(';')
  const name = head.shift().split('.').at(-1).toUpperCase()
  const params = {}
  for (const entry of head) {
    const equals = entry.indexOf('=')
    if (equals < 1) continue
    params[entry.slice(0, equals).toUpperCase()] = entry.slice(equals + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value: line.slice(separator + 1) }
}

function eventBlocks(lines) {
  const blocks = []
  let current = null
  let insideAlarm = false
  for (const line of lines) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      current = {}
      insideAlarm = false
      continue
    }
    if (!current) continue
    if (upper === 'BEGIN:VALARM') {
      insideAlarm = true
      continue
    }
    if (upper === 'END:VALARM') {
      insideAlarm = false
      continue
    }
    if (upper === 'END:VEVENT') {
      blocks.push(current)
      current = null
      insideAlarm = false
      continue
    }
    if (insideAlarm) continue
    const property = parseProperty(line)
    if (property && !current[property.name]) current[property.name] = property
  }
  return blocks
}

function textValue(property) {
  return String(property?.value ?? '')
    .replace(/\\[nN]/g, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim()
}

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && hour >= 0 && hour <= 23
    && minute >= 0 && minute <= 59
    && second >= 0 && second <= 59
}

function dateKey(year, month, day) {
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}

function timeKey(hour, minute) {
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

function partsInZone(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch))
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

function epochForWallTime(year, month, day, hour, minute, second, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = partsInZone(guess, timeZone)
    const represented = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, second)
    const difference = target - represented
    if (!difference) return guess
    guess += difference
  }
  return guess
}

function formatEpoch(epoch, timeZone) {
  const zone = timeZone && timeZone !== 'local' ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    const parts = partsInZone(epoch, zone)
    return { date: dateKey(parts.year, parts.month, parts.day), time: timeKey(parts.hour, parts.minute) }
  } catch {
    const date = new Date(epoch)
    return {
      date: dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()),
      time: timeKey(date.getHours(), date.getMinutes()),
    }
  }
}

function parseDateProperty(property, displayTimeZone) {
  if (!property?.value) return null
  const value = String(property.value).trim()
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?)?$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const allDay = !match[4] || property.params?.VALUE?.toUpperCase() === 'DATE'
  if (!validDateParts(year, month, day)) return null
  if (allDay) return { date: dateKey(year, month, day), time: '', allDay: true }

  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] || 0)
  if (!validDateParts(year, month, day, hour, minute, second)) return null
  const suffix = match[7] || ''
  if (!suffix && !property.params?.TZID) return { date: dateKey(year, month, day), time: timeKey(hour, minute), allDay: false }

  let epoch = Date.UTC(year, month - 1, day, hour, minute, second)
  if (suffix === 'Z') {
    // RFC 5545 UTC timestamps identify an instant and must be converted for the app's time zone.
  } else if (/^[+-]\d{4}$/.test(suffix)) {
    const offset = (Number(suffix.slice(1, 3)) * 60 + Number(suffix.slice(3, 5))) * (suffix[0] === '+' ? 1 : -1)
    epoch -= offset * 60_000
  } else if (property.params?.TZID) {
    try {
      epoch = epochForWallTime(year, month, day, hour, minute, second, property.params.TZID)
    } catch {
      return { date: dateKey(year, month, day), time: timeKey(hour, minute), allDay: false }
    }
  }
  return { ...formatEpoch(epoch, displayTimeZone), allDay: false }
}

function addOneDay(date) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function convertEvent(raw, displayTimeZone) {
  const title = textValue(raw.SUMMARY)
  const start = parseDateProperty(raw.DTSTART, displayTimeZone)
  if (!title || !start) return { reason: 'invalid' }
  const end = raw.DTEND ? parseDateProperty(raw.DTEND, displayTimeZone) : null
  if (raw.DTEND && (!end || end.allDay !== start.allDay)) return { reason: 'invalid' }

  let endTime = ''
  if (start.allDay) {
    if (end && end.date !== addOneDay(start.date)) return { reason: 'multiDay' }
  } else if (end) {
    if (end.date !== start.date) return { reason: 'multiDay' }
    if (end.time <= start.time) return { reason: 'invalid' }
    endTime = end.time
  }

  const uid = textValue(raw.UID)
  const location = textValue(raw.LOCATION)
  const note = textValue(raw.DESCRIPTION)
  const identity = uid && uid.length <= 240
    ? 'uid:' + uid
    : 'event:' + hashText([start.date, start.time, title, location].join('|'))
  return {
    event: {
      title,
      date: start.date,
      time: start.time,
      endTime,
      location,
      courseName: textValue(raw['X-SANLIANGSHI-COURSE']),
      note,
      sourceText: 'ics:' + identity,
      ...(raw['X-SANLIANGSHI-REMINDER-ENABLED'] ? { reminderEnabled: textValue(raw['X-SANLIANGSHI-REMINDER-ENABLED']).toUpperCase() !== 'FALSE' } : {}),
      ...(/^\d+$/.test(textValue(raw['X-SANLIANGSHI-REMINDER-MINUTES'])) && Number.isSafeInteger(Number(textValue(raw['X-SANLIANGSHI-REMINDER-MINUTES'])))
        ? { reminderMinutes: Number(textValue(raw['X-SANLIANGSHI-REMINDER-MINUTES'])) } : {}),
    },
  }
}

export function eventImportFingerprint(event) {
  return JSON.stringify(['title', 'date', 'time', 'endTime', 'location', 'note'].map((field) => String(event?.[field] || '').trim().replace(/\r\n?/g, '\n')))
}

export function parseIcsCalendar(text, { existingEvents = [], timezone = 'local' } = {}) {
  const source = String(text ?? '')
  if (byteLength(source) > MAX_ICS_IMPORT_BYTES) throw new Error('文件超过 3 MB，请拆分后再导入。')
  const blocks = eventBlocks(unfoldLines(source))
  if (blocks.length > MAX_ICS_EVENTS) throw new Error('单个文件最多导入 500 条日程。')

  const current = (Array.isArray(existingEvents) ? existingEvents : []).filter((event) => event && !event.deletedAt && !event.tombstone)
  const existingContent = new Set(current.map(eventImportFingerprint))
  const existing = new Set(current
    .map((event) => String(event?.sourceText || ''))
    .filter((value) => value.startsWith('ics:')))
  const seen = new Set()
  const seenContent = new Set()
  const events = []
  let duplicates = 0
  let skippedRecurrence = 0
  let skippedMultiDay = 0
  let skippedInvalid = 0

  for (const block of blocks) {
    if (block.RRULE || block.RDATE || block.EXDATE || block['RECURRENCE-ID']) {
      skippedRecurrence += 1
      continue
    }
    const converted = convertEvent(block, timezone)
    if (!converted.event) {
      if (converted.reason === 'multiDay') skippedMultiDay += 1
      else skippedInvalid += 1
      continue
    }
    const key = converted.event.sourceText
    const contentKey = eventImportFingerprint(converted.event)
    if (existing.has(key) || seen.has(key) || existingContent.has(contentKey) || seenContent.has(contentKey)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    seenContent.add(contentKey)
    events.push(converted.event)
  }

  return { events, found: blocks.length, duplicates, skippedRecurrence, skippedMultiDay, skippedInvalid }
}
