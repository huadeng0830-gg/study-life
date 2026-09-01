import { periodIdFromNumber } from './courseParser.js'

const DAY_DIGITS = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }
const CLASS_CODE = /^[\u4e00-\u9fff]{1,6}\d{4}(?:-\d+)?$/
const HEADER_NOISE = /^(?:星期[一二三四五六日天]?|周[一二三四五六日天]|备注|节次)$/

// 教务系统常把班级编号（如“环工2504”）附在课程块末尾，但“追光楼3603”
// 这一类“楼名 + 房间号”外形相同，绝不能一概丢弃。
function isClassCode(value) {
  const compact = String(value || '').replace(/\s/g, '')
  return CLASS_CODE.test(compact) && !/(?:楼|馆|室|堂|中心|实验|基地|校区)/.test(compact)
}

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

// OCR 结果即使字段置信度较高，也可能留下括号/符号残片（例如“岭西10]”）。
// 这类结构性异常应进入确认列表，避免把明显损坏的教室或课程静默导入。
function fieldNeedsReview(value) {
  const text = cleanText(value)
  if (!text) return false
  const left = (text.match(/[[(]/g) || []).length
  const right = (text.match(/[\])]/g) || []).length
  if (left !== right) return true
  if (text.includes('(') !== text.includes(')') || text.includes('[') !== text.includes(']')) return true
  return /[^\u4e00-\u9fffA-Za-z0-9()[\].*#_\-/\s]/.test(text)
}

function markSuspiciousCourses(courses) {
  return courses.map((course) => {
    const reviewReasons = []
    if (fieldNeedsReview(course.name)) reviewReasons.push('课程名称包含残缺括号或异常符号')
    if (fieldNeedsReview(course.room)) reviewReasons.push('地点包含残缺括号或异常符号')
    if (fieldNeedsReview(course.teacher)) reviewReasons.push('教师姓名包含残缺括号或异常符号')
    return {
      ...course,
      needsReview: Boolean(course.needsReview || reviewReasons.length),
      reviewReasons,
    }
  })
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

// Weekday labels are semantic anchors, not a seven-column template. Build
// bands from their actual locations so uneven, partial and rotated tables do
// not inherit coordinates from an unrelated layout.
function detectDayBands(layout) {
  // Tesseract can split a short header such as “星期一” into words, while its
  // line result still keeps it intact. Read both levels: the line anchors the
  // column and the words continue to provide the fine-grained course layout.
  const headers = [...(layout?.words || []), ...(layout?.lines || [])]
    .map((word) => ({ day: weekdayFromText(word.text), x: centerX(word), y: centerY(word) }))
    .filter((item) => item.day !== null && Number.isFinite(item.x) && Number.isFinite(item.y))
  const pickClosest = (axis) => [...new Map(
    [...headers].sort((left, right) => left[axis] - right[axis]).map((item) => [item.day, item]),
  ).values()]
  const top = pickClosest('y')
  const left = pickClosest('x')
  const spread = (items, axis) => items.length > 1
    ? Math.max(...items.map((item) => item[axis])) - Math.min(...items.map((item) => item[axis]))
    : 0
  const orientation = spread(top, 'x') > spread(top, 'y') * 1.8
    ? 'columns'
    : spread(left, 'y') > spread(left, 'x') * 1.8 ? 'rows' : 'unknown'
  const anchors = orientation === 'columns' ? top : orientation === 'rows' ? left : []
  if (anchors.length < 2) return { orientation: 'unknown', bands: [], detectedHeaders: anchors.length }

  const axis = orientation === 'columns' ? 'x' : 'y'
  const crossAxis = orientation === 'columns' ? 'y' : 'x'
  const extent = Math.max(1, Number(layout?.[axis === 'x' ? 'width' : 'height']) || 1)
  const ordered = [...anchors].sort((leftAnchor, rightAnchor) => leftAnchor[axis] - rightAnchor[axis])
  return {
    orientation,
    detectedHeaders: anchors.length,
    boundary: Math.max(...anchors.map((item) => item[crossAxis])),
    bands: ordered.map((item, index) => ({
      day: item.day,
      start: index ? (ordered[index - 1][axis] + item[axis]) / 2 : 0,
      end: index < ordered.length - 1 ? (item[axis] + ordered[index + 1][axis]) / 2 : extent,
    })),
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

function groupWordsIntoColumns(words) {
  const sorted = [...words].sort((a, b) => centerX(a) - centerX(b) || centerY(a) - centerY(b))
  const widths = sorted
    .map((word) => Number(word?.bbox?.x1) - Number(word?.bbox?.x0))
    .filter((width) => width > 0)
    .sort((a, b) => a - b)
  const tolerance = Math.max(18, (widths[Math.floor(widths.length / 2)] || 20) * 2.2)
  const columns = []
  for (const word of sorted) {
    const x = centerX(word)
    let column = columns.find((candidate) => Math.abs(candidate.x - x) <= tolerance)
    if (!column) {
      column = { x, words: [] }
      columns.push(column)
    }
    column.words.push(word)
    column.x = column.words.reduce((sum, item) => sum + centerX(item), 0) / column.words.length
  }
  return columns.sort((a, b) => a.x - b.x).map((column) => groupWordsIntoLines(column.words))
}

function parseWeek(text, maxWeek) {
  const normalized = cleanText(text)
  const match = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:[\[(](?:单|双)?周[\])]|(?:单|双)?周)/)
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

function parseInlineRecord(text, day, timeConfig, maxWeek, confidence) {
  const normalized = cleanText(text)
    .replace(/[\u4e00-\u9fff]{1,6}\d{4}(?:-\d+)?/g, (match) => isClassCode(match) ? ' ' : match)
    .replace(/\s+/g, ' ')
    .trim()
  const periodPattern = /[[(]?\s*(?:(?:0?[1-9]|1[0-2])(?:\s*[-,，、/]\s*(?:0?[1-9]|1[0-2])){0,5})[\])]?\s*节/
  const periodMatch = normalized.match(periodPattern)
  if (!periodMatch || periodMatch.index === undefined) return null
  const period = parsePeriod(periodMatch[0])
  const weekMatch = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:[\[(](?:单|双)?周[\])]|(?:单|双)?周)/)
  if (!period || !weekMatch || weekMatch.index === undefined || weekMatch.index > periodMatch.index) return null
  const week = parseWeek(weekMatch[0], maxWeek)
  if (!week) return null

  const nameParts = normalized.slice(0, weekMatch.index).trim().split(/\s+/).filter(Boolean)
  let teacher = ''
  if (nameParts.length > 1 && isTeacherCandidate(nameParts[nameParts.length - 1])) teacher = nameParts.pop()
  const name = nameParts
    .join('')
    .replace(/[（(](?:北|南|本部|东校区|西校区)[）)]/g, '')
    .trim()
  const room = normalized.slice(weekMatch.index + weekMatch[0].length, periodMatch.index)
    .replace(/^地点[:：]?/, '')
    .trim() || null
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
    room,
    teacher: teacher || null,
    confidence,
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
    .filter((line) => !isClassCode(line))
    .filter((line) => !/^[-—_]{3,}$/.test(line))
}

function parseRecord(lines, day, timeConfig, maxWeek, confidence) {
  const cleaned = stripNoise(lines)
  if (cleaned.length === 1) {
    const inline = parseInlineRecord(cleaned[0], day, timeConfig, maxWeek, confidence)
    if (inline) return inline
  }
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
    if (beforeWeek.length > 1 && tokens.length > 1 && isTeacherCandidate(tokens[tokens.length - 1])) {
      teacher = tokens.pop()
      beforeWeek[beforeWeek.length - 1] = tokens.join(' ')
    } else if (beforeWeek.length > 1 && isTeacherCandidate(last)) {
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
    if (nameParts.length > 1 && isTeacherCandidate(nameParts[nameParts.length - 1])) {
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

export function toBatchLine(course) {
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
      && namesLikelySame(existing.name, course.name)
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

function namesLikelySame(left, right) {
  const one = cleanText(left).replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  const other = cleanText(right).replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  if (!one || !other || one.includes(other) || other.includes(one)) return Boolean(one && other)
  const limit = Math.min(one.length, other.length)
  let prefix = 0
  while (prefix < limit && one[prefix] === other[prefix]) prefix++
  // OCR may only damage a suffix accidentally joined to the course name.
  // Merge that artifact only when the timetable slot is otherwise identical.
  return prefix >= Math.max(6, Math.ceil(limit * 0.72))
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
  const marker = /[[(]?\s*(?:(?:0?[1-9]|1[0-2])(?:\s*[-,，、/]\s*(?:0?[1-9]|1[0-2])){0,5})[\])]?\s*节/g
  const records = []
  for (const line of result) {
    let cursor = 0
    let match
    let matched = false
    while ((match = marker.exec(line))) {
      matched = true
      records.push(line.slice(cursor, match.index + match[0].length))
      cursor = match.index + match[0].length
    }
    marker.lastIndex = 0
    if (!matched) records.push(line)
  }
  return records.map(cleanText).filter(Boolean)
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

  const unique = markSuspiciousCourses(dedupeCourses(courses))
  return {
    courses: unique,
    batchText: unique.map(toBatchLine).join('\n'),
    detectedHeaders: new Set((columns || []).map((column) => column.day)).size,
    needsReview: (columns || []).some((column) => column.inferred) || unique.some((course) => course.needsReview),
  }
}

export function parseTimetableLayout(layout, timeConfig, maxWeek) {
  if (!layout?.lines?.length) return { courses: [], batchText: '', detectedHeaders: 0 }
  const bands = detectDayBands(layout)
  if (bands.orientation === 'unknown') {
    return { courses: [], batchText: '', detectedHeaders: bands.detectedHeaders, orientation: bands.orientation, needsReview: true }
  }
  const byDay = Array.from({ length: 7 }, () => [])

  // A partial screenshot may contain only a few words. Once there are enough
  // positioned words to form headers plus one record, prefer geometry over
  // the OCR engine's plain-text reading order.
  const sourceItems = (layout.words || []).length >= 6 ? layout.words : layout.lines
  for (const rawItem of sourceItems) {
    const item = { ...rawItem, text: cleanText(rawItem.text) }
    const axisValue = bands.orientation === 'columns' ? centerX(item) : centerY(item)
    const crossValue = bands.orientation === 'columns' ? centerY(item) : centerX(item)
    if (!item.text || crossValue <= bands.boundary) continue
    const band = bands.bands.find((candidate) => axisValue >= candidate.start && axisValue < candidate.end)
    if (band) byDay[band.day].push(item)
  }

  const courses = byDay.flatMap((items, day) => {
    if (bands.orientation === 'rows' && sourceItems === layout.words) {
      return groupWordsIntoColumns(items).flatMap((lines) => recordsForDay(lines, day, timeConfig, maxWeek))
    }
    return recordsForDay(
      sourceItems === layout.words
        ? groupWordsIntoLines(items)
        : items.sort((a, b) => centerY(a) - centerY(b) || centerX(a) - centerX(b)),
      day,
      timeConfig,
      maxWeek,
    )
  })

  const unique = markSuspiciousCourses(dedupeCourses(courses))

  return {
    courses: unique,
    batchText: unique.map(toBatchLine).join('\n'),
    detectedHeaders: bands.detectedHeaders,
    orientation: bands.orientation,
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
  const reviewCount = courses.filter((course) => course.needsReview || (Number(course.confidence) || 0) < 70).length
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
