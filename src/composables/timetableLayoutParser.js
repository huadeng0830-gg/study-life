import { periodIdFromNumber } from './courseParser.js'

const DAY_DIGITS = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }
const CLASS_CODE = /^[\u4e00-\u9fff]{1,6}\d{4}(?:-\d+)?$/
const HEADER_NOISE = /^(?:星期[一二三四五六日天]?|周[一二三四五六日天]|备注|节次)$/

function cleanText(value) {
  return String(value || '')
    .replace(/[\u2013\u2014\u2212~～]/g, '-')
    .replace(/[【]/g, '[')
    .replace(/[】]/g, ']')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

function centerX(item) {
  return (Number(item?.bbox?.x0) + Number(item?.bbox?.x1)) / 2
}

function centerY(item) {
  return (Number(item?.bbox?.y0) + Number(item?.bbox?.y1)) / 2
}

function weekdayFromText(text) {
  const match = cleanText(text).match(/(?:星期|周)\s*([一二三四五六日天])/) 
  return match ? DAY_DIGITS[match[1]] : null
}

function fitDayColumns(layout) {
  const width = Math.max(1, Number(layout?.width) || 1)
  const headers = (layout?.words || [])
    .map((word) => ({ day: weekdayFromText(word.text), x: centerX(word), y: centerY(word) }))
    .filter((item) => item.day !== null && Number.isFinite(item.x))

  const unique = [...new Map(headers.map((item) => [item.day, item])).values()]
  let spacing = width * 0.122
  let firstCenter = width * 0.232

  if (unique.length >= 2) {
    const meanDay = unique.reduce((sum, item) => sum + item.day, 0) / unique.length
    const meanX = unique.reduce((sum, item) => sum + item.x, 0) / unique.length
    const numerator = unique.reduce((sum, item) => sum + (item.day - meanDay) * (item.x - meanX), 0)
    const denominator = unique.reduce((sum, item) => sum + (item.day - meanDay) ** 2, 0)
    if (denominator) spacing = numerator / denominator
    firstCenter = meanX - spacing * meanDay
  } else if (unique.length === 1) {
    firstCenter = unique[0].x - spacing * unique[0].day
  }

  const headerBottom = unique.length
    ? Math.max(...unique.map((item) => item.y))
    : (Number(layout?.height) || 1) * 0.22

  return {
    centers: Array.from({ length: 7 }, (_, day) => firstCenter + spacing * day),
    spacing: Math.abs(spacing),
    headerBottom,
    detectedHeaders: unique.length,
  }
}

function parsePeriod(text) {
  const normalized = cleanText(text)
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
  const bracket = normalized.match(/[[(]([\d\s,，、/\-]{2,24})[\])]?\s*节/)
  const list = normalized.match(/((?:0?[1-9]|1[0-2])(?:\s*-\s*(?:0?[1-9]|1[0-2])){1,5})[\])]?\s*节/)
  const simple = normalized.match(/第?\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*节/)
  let numbers = []

  const compact = normalized.match(/(?:^|\D)(0[1-9]|1[0-2])(0[1-9]|1[0-2])\s*节/)
  if (compact) return { start: Number(compact[1]), end: Number(compact[2]) }

  if (bracket) numbers = bracket[1].match(/\d{1,2}/g)?.map(Number) || []
  else if (list) numbers = list[1].match(/\d{1,2}/g)?.map(Number) || []
  else if (simple) numbers = [Number(simple[1]), Number(simple[2] || simple[1])]

  if (numbers.length === 1 && /^\d{4,8}$/.test(bracket?.[1]?.replace(/\D/g, '') || '')) {
    numbers = bracket[1].replace(/\D/g, '').match(/\d{2}/g).map(Number)
  }
  numbers = numbers.filter((number) => number >= 1 && number <= 12)
  if (!numbers.length) return null
  return { start: Math.min(...numbers), end: Math.max(...numbers) }
}

function groupWordsIntoLines(words) {
  const sorted = [...words].sort((a, b) => centerY(a) - centerY(b) || centerX(a) - centerX(b))
  const heights = sorted
    .map((word) => Number(word?.bbox?.y1) - Number(word?.bbox?.y0))
    .filter((height) => height > 0)
    .sort((a, b) => a - b)
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 14
  const tolerance = Math.max(5, medianHeight * 0.62)
  const rows = []

  for (const word of sorted) {
    const y = centerY(word)
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance)
    if (!row) {
      row = { y, words: [] }
      rows.push(row)
    }
    row.words.push(word)
    row.y = row.words.reduce((sum, item) => sum + centerY(item), 0) / row.words.length
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => {
      const items = row.words.sort((a, b) => centerX(a) - centerX(b))
      return {
        text: items.map((item) => cleanText(item.text)).filter(Boolean).join(' '),
        confidence: items.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / items.length,
        bbox: {
          x0: Math.min(...items.map((item) => item.bbox.x0)),
          y0: Math.min(...items.map((item) => item.bbox.y0)),
          x1: Math.max(...items.map((item) => item.bbox.x1)),
          y1: Math.max(...items.map((item) => item.bbox.y1)),
        },
      }
    })
}

function parseWeek(text, maxWeek) {
  const normalized = cleanText(text)
  const match = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:\((?:单|双)?周\)|(?:单|双)?周)/)
  if (!match) return null
  const startWeek = Number(match[1])
  const endWeek = Number(match[2])
  if (startWeek < 1 || endWeek < startWeek || endWeek > maxWeek) return null
  return {
    startWeek,
    endWeek,
    weekType: normalized.includes('单周') ? 'odd' : normalized.includes('双周') ? 'even' : 'all',
  }
}

function parseLoosePeriod(text) {
  const normalized = cleanText(text)
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
  const match = normalized.match(/(?:^|\D)((?:0?[1-9]|1[0-2])(?:\s*-\s*(?:0?[1-9]|1[0-2])){1,5})(?:\D|$)/)
  if (!match) return null
  const numbers = match[1].match(/\d{1,2}/g)?.map(Number)
    .filter((number) => number >= 1 && number <= 12) || []
  if (numbers.length < 2) return null
  return { start: Math.min(...numbers), end: Math.max(...numbers) }
}

function isTeacherCandidate(text) {
  return /^[\u4e00-\u9fff·]{2,4}$/.test(text)
    && !/(?:大学|学院|课程|实验|工程|技术|分析|基础|导论|原理|法学)/.test(text)
}

function stripNoise(lines) {
  return lines
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !HEADER_NOISE.test(line))
    .filter((line) => !CLASS_CODE.test(line.replace(/\s/g, '')))
    .filter((line) => !/^[-—_]{3,}$/.test(line))
}

function parseRecord(lines, day, timeConfig, maxWeek, confidence) {
  const cleaned = stripNoise(lines)
  const periodIndex = cleaned.findIndex((line) => parsePeriod(line))
  if (periodIndex < 0) return null
  const period = parsePeriod(cleaned[periodIndex])
  let weekIndex = -1
  for (let index = 0; index <= periodIndex; index++) {
    if (parseWeek(cleaned[index], maxWeek)) weekIndex = index
  }
  if (weekIndex < 1) return null
  const week = parseWeek(cleaned[weekIndex], maxWeek)

  const beforeWeek = cleaned.slice(0, weekIndex)
  let teacher = ''
  if (beforeWeek.length) {
    const last = beforeWeek[beforeWeek.length - 1]
    const tokens = last.split(/\s+/)
    if (tokens.length > 1 && isTeacherCandidate(tokens[tokens.length - 1])) {
      teacher = tokens.pop()
      beforeWeek[beforeWeek.length - 1] = tokens.join(' ')
    } else if (isTeacherCandidate(last)) {
      teacher = beforeWeek.pop()
    }
  }

  const name = beforeWeek
    .map((line) => line.replace(/[（(](?:北|南|本部|东校区|西校区)[）)]$/g, ''))
    .join('')
    .replace(/\s+/g, '')
    .trim()
  const room = stripNoise(cleaned.slice(weekIndex + 1, periodIndex))
    .join('')
    .replace(/^地点[:：]?/, '')

  const periods = timeConfig?.value?.periods || []
  const start = periodIdFromNumber(periods, period.start)
  const end = periodIdFromNumber(periods, period.end)
  if (!name || !start || !end) return null

  return {
    name,
    day,
    start,
    end,
    startPeriod: period.start,
    endPeriod: period.end,
    startWeek: week.startWeek,
    endWeek: week.endWeek,
    weekType: week.weekType,
    room: room || null,
    teacher: teacher || null,
    confidence,
  }
}

function recordsForDay(lines, day, timeConfig, maxWeek) {
  const records = []
  let pending = []
  let confidenceTotal = 0
  for (const [lineIndex, line] of lines.entries()) {
    pending.push(line.text)
    confidenceTotal += Number(line.confidence) || 0
    if (!parsePeriod(line.text)) continue
    const averageConfidence = pending.length ? confidenceTotal / pending.length : 0
    const parsed = parseRecord(pending, day, timeConfig, maxWeek, averageConfidence)
    if (parsed) records.push({ ...parsed, _sourceIndex: lineIndex })
    pending = []
    confidenceTotal = 0
  }

  // Table screenshots sometimes lose the first course's trailing “节”. Rebuild
  // a record around each week range so two vertically adjacent courses do not
  // get merged into one when that period marker is damaged by OCR.
  const texts = lines.map((line) => cleanText(line.text))
  for (let weekIndex = 0; weekIndex < texts.length; weekIndex++) {
    const week = parseWeek(texts[weekIndex], maxWeek)
    if (!week) continue

    const previousPeriodIndex = texts.slice(0, weekIndex)
      .map((text, index) => (parsePeriod(text) || parseLoosePeriod(text) ? index : -1))
      .filter((index) => index >= 0)
      .pop() ?? -1
    let nextWeekIndex = texts.findIndex((text, index) => index > weekIndex && parseWeek(text, maxWeek))
    if (nextWeekIndex < 0) nextWeekIndex = texts.length

    const before = texts.slice(previousPeriodIndex + 1, weekIndex)
    const after = texts.slice(weekIndex + 1, nextWeekIndex)
    const periodLineIndex = after.findIndex((text) => parsePeriod(text) || parseLoosePeriod(text))
    if (periodLineIndex < 0) continue
    const period = parsePeriod(after[periodLineIndex]) || parseLoosePeriod(after[periodLineIndex])

    const nameParts = stripNoise(before)
      .filter((text) => !parsePeriod(text) && !parseLoosePeriod(text))
    let teacher = ''
    if (nameParts.length && isTeacherCandidate(nameParts[nameParts.length - 1])) {
      teacher = nameParts.pop()
    }
    const name = nameParts
      .join('')
      .replace(/[（(](?:北|南|本部|东校区|西校区)[）)]/g, '')
      .replace(/\s+/g, '')
      .trim()
    if (!name) continue

    const room = stripNoise(after.slice(0, periodLineIndex))
      .filter((text) => !parseWeek(text, maxWeek))
      .join('')
      .replace(/^地点[:：]?/, '') || null
    const periods = timeConfig?.value?.periods || []
    const start = periodIdFromNumber(periods, period.start)
    const end = periodIdFromNumber(periods, period.end)
    if (!start || !end) continue

    const rebuilt = {
      name,
      day,
      start,
      end,
      startPeriod: period.start,
      endPeriod: period.end,
      startWeek: week.startWeek,
      endWeek: week.endWeek,
      weekType: week.weekType,
      room,
      teacher: teacher || null,
      confidence: Number(lines[weekIndex]?.confidence) || 0,
      _sourceIndex: weekIndex,
    }
    const existingIndex = records.findIndex((record) => (
      record.day === rebuilt.day
      && record.startPeriod === rebuilt.startPeriod
      && record.endPeriod === rebuilt.endPeriod
      && record.startWeek === rebuilt.startWeek
      && record.endWeek === rebuilt.endWeek
    ))
    if (existingIndex < 0) {
      records.push(rebuilt)
    } else {
      const existing = records[existingIndex]
      const sameName = existing.name === rebuilt.name
      const rebuiltIsCleaner = rebuilt.name.length < existing.name.length
      if (rebuiltIsCleaner) records.splice(existingIndex, 1, rebuilt)
      else if (sameName) {
        records[existingIndex] = {
          ...rebuilt,
          room: existing.room || rebuilt.room,
          teacher: existing.teacher || rebuilt.teacher,
          confidence: Math.max(existing.confidence || 0, rebuilt.confidence || 0),
        }
      }
    }
  }

  return records
    .sort((a, b) => a._sourceIndex - b._sourceIndex)
    .map(({ _sourceIndex, ...record }) => record)
}

function toBatchLine(course) {
  const weekType = course.weekType === 'odd' ? '\t单周' : course.weekType === 'even' ? '\t双周' : ''
  const room = course.room ? `\t地点:${course.room}` : ''
  const teacher = course.teacher ? `\t教师:${course.teacher}` : ''
  return `${course.name}\t周${'一二三四五六日'[course.day]}\t${course.startPeriod}-${course.endPeriod}节\t${course.startWeek}-${course.endWeek}周${weekType}${room}${teacher}`
}

function dedupeCourses(courses) {
  const result = []
  for (const course of courses) {
    const duplicateIndex = result.findIndex((existing) => (
      existing.day === course.day
      && existing.startPeriod === course.startPeriod
      && existing.endPeriod === course.endPeriod
      && existing.startWeek === course.startWeek
      && existing.endWeek === course.endWeek
      && (existing.name.includes(course.name) || course.name.includes(existing.name))
    ))
    if (duplicateIndex < 0) {
      result.push(course)
      continue
    }

    const existing = result[duplicateIndex]
    const cleaner = course.name.length < existing.name.length ? course : existing
    const other = cleaner === course ? existing : course
    result[duplicateIndex] = {
      ...cleaner,
      room: cleaner.room || other.room,
      teacher: cleaner.teacher || other.teacher,
      confidence: Math.max(cleaner.confidence || 0, other.confidence || 0),
    }
  }
  return result
}

function normalizeColumnLines(text) {
  const result = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = cleanText(raw)
    if (!line) continue
    if (/^(?:节|周|\)|\])$/.test(line) && result.length) {
      result[result.length - 1] += line
    } else {
      result.push(line)
    }
  }
  return result
}

export function parseTimetableColumns(columns, timeConfig, maxWeek) {
  const courses = (columns || []).flatMap((column) => {
    const lines = normalizeColumnLines(column.text).map((text, index) => ({
      text,
      confidence: Number(column.confidence) || 75,
      bbox: { x0: 0, x1: 1, y0: index * 20, y1: index * 20 + 12 },
    }))
    return recordsForDay(lines, column.day, timeConfig, maxWeek)
  })

  const unique = dedupeCourses(courses)
  return { courses: unique, batchText: unique.map(toBatchLine).join('\n') }
}

export function parseTimetableLayout(layout, timeConfig, maxWeek) {
  if (!layout?.lines?.length) return { courses: [], batchText: '', detectedHeaders: 0 }
  const columns = fitDayColumns(layout)
  const byDay = Array.from({ length: 7 }, () => [])

  const sourceItems = (layout.words || []).length >= 12 ? layout.words : layout.lines
  for (const rawItem of sourceItems) {
    const item = { ...rawItem, text: cleanText(rawItem.text) }
    if (!item.text || centerY(item) <= columns.headerBottom) continue
    const x = centerX(item)
    const distances = columns.centers.map((center) => Math.abs(center - x))
    const day = distances.indexOf(Math.min(...distances))
    if (distances[day] <= columns.spacing * 0.68) byDay[day].push(item)
  }

  const courses = byDay.flatMap((items, day) => recordsForDay(
    sourceItems === layout.words
      ? groupWordsIntoLines(items)
      : items.sort((a, b) => centerY(a) - centerY(b) || centerX(a) - centerX(b)),
    day,
    timeConfig,
    maxWeek,
  ))

  const unique = dedupeCourses(courses)

  return {
    courses: unique,
    batchText: unique.map(toBatchLine).join('\n'),
    detectedHeaders: columns.detectedHeaders,
  }
}

export function scoreTimetableExtraction(table) {
  const courses = table?.courses || []
  const invalid = courses.filter((course) => (
    !Number.isInteger(course.day)
    || course.day < 0
    || course.day > 6
    || !course.start
    || !course.end
    || !course.name
    || course.startWeek > course.endWeek
  )).length
  const slotKeys = courses.map((course) => `${course.day}:${course.start}:${course.end}:${course.startWeek}:${course.endWeek}`)
  const duplicateSlots = slotKeys.length - new Set(slotKeys).size
  const confidence = courses.length
    ? courses.reduce((sum, course) => sum + (Number(course.confidence) || 0), 0) / courses.length
    : 0
  const reviewCount = courses.filter((course) => (Number(course.confidence) || 0) < 70).length
  return {
    score: courses.length * 10 + (Number(table?.detectedHeaders) || 0) * 1.5 + confidence * 0.08 - invalid * 12 - duplicateSlots * 5,
    invalid,
    duplicateSlots,
    reviewCount,
    confidence,
  }
}

export function selectBestTimetableExtraction(...tables) {
  return tables
    .filter(Boolean)
    .map((table) => ({ ...table, diagnostics: scoreTimetableExtraction(table) }))
    .sort((left, right) => right.diagnostics.score - left.diagnostics.score)[0]
    || { courses: [], batchText: '', detectedHeaders: 0, diagnostics: scoreTimetableExtraction(null) }
}
