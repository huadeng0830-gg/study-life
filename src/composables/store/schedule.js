import { clock, touchStoredRef, useStoredRef } from './core.js'
import { todayStr, MAX_WEEK, dateString } from './utils.js'
import { periodIndex } from './timeConfig.js'

export const semester = useStoredRef('sl_semester', {
  start: (function defaultSemesterStart() {
    const d = new Date(clock.value)
    const year = d.getFullYear()
    const month = d.getMonth()
    const p = (n) => String(n).padStart(2, '0')
    const isAfterSep = month >= 8
    return mondayOfDate(`${year + (isAfterSep ? 0 : -1)}-${p(isAfterSep ? 9 : 3)}-01`)
  })(),
})

export const scheduleExceptions = useStoredRef('sl_schedule_exceptions', [])

/**
 * 例外类型。
 *
 * - `off`        整天停课（可跨日期区间）
 * - `makeup`     整天按指定周次/星期的课表显示
 * - `session_off`    当天只停选中的课程，其余课程照常
 * - `session_makeup` 当天按 courseSlots 指定的节次补选中的课程；旧记录沿用原节次
 *
 * 后两种是**按课程 id** 定位到具体节次的，与前两种的「整天」粒度并存。
 */
export const EXCEPTION_TYPES = Object.freeze(['off', 'makeup', 'session_off', 'session_makeup'])

/** 是否是「精确到某几门课」的单节课例外。 */
export function isSessionException(item) {
  return item?.type === 'session_off' || item?.type === 'session_makeup'
}

/** 该类型是否把课程从当天移除（停上）。 */
export function exceptionHidesCourses(item) {
  return item?.type === 'off' || item?.type === 'session_off'
}

function normalizeExceptionType(value) {
  return EXCEPTION_TYPES.includes(value) ? value : 'off'
}

/**
 * 只保留 id 非空的课程列表，并去重。
 * 部分停课、补课靠 courseIds 定位；过滤空串、重复值和无效类型。
 */
function normalizeCourseIds(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const id of value) {
    if (typeof id !== 'string' && typeof id !== 'number') continue
    const key = String(id ?? '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

export function isScheduleDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** 表单和存储共用校验，避免非法日期被 Date 自动滚到下个月。 */
export function validateScheduleException(value) {
  if (!isScheduleDate(value?.date)) return { field: 'date', message: '请选择有效日期' }
  const type = value.type ?? 'off'
  if (!EXCEPTION_TYPES.includes(type)) return { field: 'type', message: '请选择有效的安排类型' }
  if (type === 'off' && value.endDate) {
    if (!isScheduleDate(value.endDate)) return { field: 'endDate', message: '请选择有效的结束日期' }
    if (value.endDate < value.date) return { field: 'endDate', message: '结束日期不能早于开始日期' }
  }
  if (isSessionException(value) && !normalizeCourseIds(value.courseIds).length) {
    return { field: 'courseIds', message: '请至少选择一门课程' }
  }
  if (type === 'session_makeup' && value.courseSlots != null) {
    const ids = normalizeCourseIds(value.courseIds)
    if (!Array.isArray(value.courseSlots) || value.courseSlots.length !== ids.length) {
      return { field: 'courseSlots', message: '请为每门补课课程选择开始和结束节次' }
    }
    const seen = new Set()
    for (const slot of value.courseSlots) {
      const id = String(slot?.courseId ?? '').trim()
      const start = periodIndex(slot?.start)
      const end = periodIndex(slot?.end)
      if (!ids.includes(id) || seen.has(id) || start < 0 || end < 0) {
        return { field: 'courseSlots', message: '请为每门补课课程选择有效的开始和结束节次', courseId: id }
      }
      if (end < start) return { field: 'courseSlots', message: '补课结束节次不能早于开始节次', courseId: id }
      seen.add(id)
    }
  }
  if (type === 'makeup') {
    const day = Number(value.sourceDay ?? 0)
    const week = Number(value.sourceWeek ?? 0)
    if (!Number.isInteger(day) || day < 0 || day > 6) return { field: 'sourceDay', message: '请选择有效的课表星期' }
    if (!Number.isInteger(week) || week < 0 || week > MAX_WEEK) return { field: 'sourceWeek', message: `课表周次应在第 1 至 ${MAX_WEEK} 周之间` }
  }
  return null
}

function isDateRange(item) {
  return item?.type === 'off' && isScheduleDate(item.endDate) && item.endDate > item.date
}

function newExceptionId() {
  return `exception-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

/** 修复旧版本同日同类型共用 ID 的记录，保留每条安排的日期、课程与备注。 */
export function repairScheduleExceptionIds() {
  const seen = new Set()
  let changed = false
  for (const item of scheduleExceptions.value) {
    if (!item || typeof item !== 'object') continue
    if (!item.id || seen.has(String(item.id))) {
      item.id = newExceptionId()
      changed = true
    }
    seen.add(String(item.id))
  }
  if (changed) touchStoredRef('sl_schedule_exceptions')
  return changed
}

/** 单日安排和假期范围分别保存，假期首日调课不会把整个假期覆盖掉。 */
export function scheduleExceptionReplacementIndex(value, exceptions = scheduleExceptions.value) {
  if (value.id) return exceptions.findIndex((item) => item?.id === value.id)
  if (isSessionException(value)) return -1
  return exceptions.findIndex((item) => item && !isSessionException(item)
    && item.date === value.date && isDateRange(item) === isDateRange(value))
}

export function upsertScheduleException(value) {
  if (validateScheduleException(value)) return null
  const type = normalizeExceptionType(value.type)
  const session = isSessionException({ type })
  const index = scheduleExceptionReplacementIndex({ ...value, type })
  const endDate = type === 'off' && value.endDate && value.endDate > value.date ? value.endDate : null
  const sourceWeek = type === 'makeup'
    && Number.isFinite(Number(value.sourceWeek)) && Number(value.sourceWeek) > 0
    ? Number(value.sourceWeek)
    : null
  const exception = {
    id: value.id || scheduleExceptions.value[index]?.id || newExceptionId(),
    date: value.date,
    type,
    sourceDay: type === 'makeup'
      ? Math.min(6, Math.max(0, Number(value.sourceDay) || 0))
      : null,
    sourceWeek,
    endDate,
    // 单节课例外才有 courseIds；其余类型显式写 null，避免导出里留下"曾经有过的"痕迹。
    courseIds: session ? normalizeCourseIds(value.courseIds) : null,
    courseSlots: type === 'session_makeup' && Array.isArray(value.courseSlots)
      ? value.courseSlots.map((slot) => ({ courseId: String(slot.courseId).trim(), start: slot.start, end: slot.end }))
      : null,
    note: String(value.note ?? '').trim(),
    updatedAt: value.updatedAt || new Date().toISOString(),
  }
  if (index >= 0) scheduleExceptions.value[index] = exception
  else scheduleExceptions.value.push(exception)
  touchStoredRef('sl_schedule_exceptions')
  return exception
}

export function removeScheduleException(id) {
  const index = scheduleExceptions.value.findIndex((item) => item.id === id)
  if (index < 0) return null
  const exception = scheduleExceptions.value.splice(index, 1)[0]
  touchStoredRef('sl_schedule_exceptions')
  return exception
}

export function weekOf(dateStr) {
  const weekStart = mondayOfDate(semester.value.start)
  const targetWeekStart = mondayOfDate(dateStr)
  if (!weekStart || !targetWeekStart) return NaN
  const start = Date.parse(`${weekStart}T00:00:00Z`)
  const d = Date.parse(`${targetWeekStart}T00:00:00Z`)
  return Math.floor((d - start) / (7 * 86400000)) + 1
}

export function currentWeek() {
  return weekOf(todayStr())
}

export function mondayOfDate(dateStr) {
  const date = new Date(`${String(dateStr ?? '')}T00:00:00`)
  if (!dateStr || Number.isNaN(date.getTime())) return ''
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return dateString(date)
}

export function courseInWeek(c, week) {
  if (!Number.isInteger(week) || week < 1) return false
  const sw = c.startWeek ?? 1
  const ew = c.endWeek ?? MAX_WEEK
  if (week < sw || week > ew) return false
  const t = c.weekType ?? 'all'
  if (t === 'odd') return week % 2 === 1
  if (t === 'even') return week % 2 === 0
  return true
}

/** 该例外是否作用于这一天。 */
export function exceptionAppliesOn(item, date) {
  if (!item || !isScheduleDate(item.date) || !isScheduleDate(date)) return false
  if (isDateRange(item) && item.date <= date && date <= item.endDate) return true
  return item.date === date
}

/**
 * 当天生效的全部例外，按「整天优先、单节课在后」排序。
 *
 * 【为什么从单条例外改成列表】
 * 原来是一天最多一条例外（find），这正是"不能只停一节课"的根因——停课是整天级的，
 * 想停某节课就只能整天停。单节课例外需要同一天能并存多条（停两节课、停一节补一节），
 * 所以这里返回列表；单条例外的语义由 scheduleExceptionForDate 保留。
 */
export function scheduleExceptionsForDate(date, exceptions = scheduleExceptions.value) {
  return exceptions
    .filter((item) => exceptionAppliesOn(item, date))
    .sort((left, right) => Number(isSessionException(left)) - Number(isSessionException(right))
      || Number(isDateRange(left)) - Number(isDateRange(right))
      || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
      || right.date.localeCompare(left.date)
      || String(left.id ?? '').localeCompare(String(right.id ?? '')))
}

/** 当天生效的「整天例外」（保持旧的单条语义，供网格标记与既有调用方使用）。 */
export function scheduleExceptionForDate(date, exceptions = scheduleExceptions.value) {
  // 单日安排优先于范围；历史重复安排取最近保存的一条，不依赖导入或同步后的数组顺序。
  return scheduleExceptionsForDate(date, exceptions).find((item) => !isSessionException(item)) ?? null
}

/** 单节课例外中被停上（或安排补课）的课程 id 集合。 */
export function sessionExceptionCourseIds(date, exceptions = scheduleExceptions.value) {
  const hidden = new Set()
  const makeup = new Set()
  for (const item of exceptions) {
    if (!isSessionException(item) || !exceptionAppliesOn(item, date)) continue
    const target = item.type === 'session_off' ? hidden : makeup
    for (const id of normalizeCourseIds(item.courseIds)) target.add(id)
  }
  return { hidden, makeup }
}

export function scheduleDateContext(date, exceptions = scheduleExceptions.value) {
  const target = new Date(date + 'T00:00:00')
  const actualDay = target.getDay() === 0 ? 6 : target.getDay() - 1
  const week = weekOf(date)
  const exception = scheduleExceptionForDate(date, exceptions)
  // sourceDay / sourceWeek 只由**整天** makeup 决定：它表达的是"当天整体按哪份课表显示"。
  // 单节课补课刻意**不**参与这里——它只补被点名的那几门课，若让它改写 sourceDay，
  // 整个视图就会变成那一周的课表（"补一节"变成"整天调课"）。被点名课程自己的星期
  // 由 coursesForDateFromIndex 按 id 从 byId 索引取出时保留。
  const sourceDay = exception?.type === 'makeup'
    ? Math.min(6, Math.max(0, Number(exception.sourceDay) || 0))
    : actualDay
  const sourceWeek = exception?.type === 'makeup' && Number.isFinite(Number(exception.sourceWeek)) && Number(exception.sourceWeek) > 0
    ? Number(exception.sourceWeek)
    : week
  return {
    actualDay,
    week,
    exception,
    sourceDay,
    sourceWeek,
  }
}

function courseDayIndex(courseList) {
  const index = new Map()
  // 单节课补课要从"任意星期"里按 id 把课程取回来，只靠按星期的索引做不到。
  const byId = new Map()
  for (const course of Array.isArray(courseList) ? courseList : []) {
    if (!course) continue
    const bucket = index.get(course.day) ?? []
    bucket.push(course)
    index.set(course.day, bucket)
    if (course.id != null) byId.set(String(course.id), course)
  }
  index.byId = byId
  return index
}

function coursesForDateFromIndex(index, date, exceptions) {
  if (!isScheduleDate(date)) return []
  const { actualDay, exception, sourceDay, sourceWeek } = scheduleDateContext(date, exceptions)
  const { hidden: sessionHidden, makeup: sessionMakeupIds } = sessionExceptionCourseIds(date, exceptions)

  // 放假停掉常规课表，仍可明确安排部分补课。
  const mapped = (exceptionHidesCourses(exception) ? [] : index.get(sourceDay) ?? [])
    .filter((course) => course.day === sourceDay && courseInWeek(course, sourceWeek))
    .map((course) => ({
      ...course,
      displayDay: actualDay,
      sourceDay,
      exceptionDate: exception ? date : '',
    }))

  // 停上的单节课直接移除——它在当天不该出现。
  const afterOff = sessionHidden.size
    ? mapped.filter((course) => !sessionHidden.has(String(course.id)))
    : mapped

  // 部分补课在指定节次显示；旧记录没有 courseSlots 时才沿用课程原节次。
  // 已有同 ID 的课不加；同一课程的停课安排优先，避免停课后又被补回来。
  if (!sessionMakeupIds.size) return afterOff
  const present = new Set(afterOff.map((course) => String(course.id)))
  const additions = []
  for (const item of scheduleExceptionsForDate(date, exceptions)) {
    if (item.type !== 'session_makeup') continue
    // 损坏或引用已删除节次的记录不能悄悄回落到另一时间。
    if (item.courseSlots != null && validateScheduleException(item)) continue
    for (const courseId of normalizeCourseIds(item.courseIds)) {
      if (present.has(courseId) || sessionHidden.has(courseId)) continue
      const course = index.byId?.get(courseId)
      if (!course) continue
      const slot = item.courseSlots?.find((entry) => String(entry.courseId).trim() === courseId)
      additions.push({
        ...course,
        ...(slot ? { start: slot.start, end: slot.end } : {}),
        displayDay: actualDay,
        sourceDay: course.day,
        sessionMakeup: true,
        exceptionId: item.id,
        exceptionDate: date,
      })
      present.add(courseId)
    }
  }
  return [...afterOff, ...additions]
}

export function coursesForDate(courseList, date, exceptions = scheduleExceptions.value) {
  return coursesForDateFromIndex(courseDayIndex(courseList), date, exceptions)
}

// 同一轮需要多个日期时只建立一次星期索引，避免首页/周回顾对整张课表重复扫描。
export function coursesForDates(courseList, dates, exceptions = scheduleExceptions.value) {
  const index = courseDayIndex(courseList)
  return (Array.isArray(dates) ? dates : []).map((date) => coursesForDateFromIndex(index, date, exceptions))
}

export function weekLabel(c) {
  const sw = c.startWeek ?? 1
  const ew = c.endWeek ?? MAX_WEEK
  let base = sw === ew ? `${sw}周` : sw === 1 && ew === MAX_WEEK ? '全学期' : `${sw}-${ew}周`
  const t = c.weekType ?? 'all'
  if (t === 'odd') base += ' 单'
  if (t === 'even') base += ' 双'
  return base
}

export function dateForWeekDay(week, day) {
  const start = mondayOfDate(semester.value.start) || semester.value.start
  const date = new Date(start + 'T00:00:00')
  date.setDate(date.getDate() + (Number(week) - 1) * 7 + Number(day))
  return dateString(date)
}
