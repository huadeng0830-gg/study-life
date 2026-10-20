import {
  removeScheduleException,
  saveScheduleException,
  scheduleExceptionReplacementIndex,
  scheduleExceptionsForDate,
  scheduleExceptions,
} from './store/schedule.js'
import { periodIndex, timeConfig } from './store/timeConfig.js'
import { deepClone } from '../utils/clone.js'

function isoDay(date) {
  const day = new Date(`${date}T00:00:00`).getDay()
  return day === 0 ? 6 : day - 1
}

function periodId(value) {
  const index = Number(value) - 1
  return Number.isInteger(index) && index >= 0 ? timeConfig.value.periods?.[index]?.id ?? '' : ''
}

/** @returns {{courseId: string, start?: string, end?: string, location?: string}|null} */
function slotFor(proposal, courseId, courses) {
  const course = (Array.isArray(courses) ? courses : []).find((item) => String(item?.id) === String(courseId))
  const start = proposal.periodStart ? periodId(proposal.periodStart) : course?.start || ''
  const end = proposal.periodEnd ? periodId(proposal.periodEnd) : proposal.periodStart ? periodId(proposal.periodStart) : course?.end || ''
  if (!start || !end) {
    return proposal.location ? { courseId, location: proposal.location } : null
  }
  return { courseId, start, end, ...(proposal.location ? { location: proposal.location } : {}) }
}

/** 把用户确认的说明转成现有课表例外；没有额外的存储实体。 */
export function buildScheduleExceptionInputs(proposal, courseId, courses = []) {
  const id = String(courseId || '').trim()
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(String(proposal?.date || ''))) return []
  const targetSlot = slotFor(proposal, id, courses)
  if ((proposal.periodStart || proposal.periodEnd) && !targetSlot?.start) return []
  const note = `来自通知：${String(proposal.raw || '').trim()}`.slice(0, 500)
  const target = {
    date: proposal.date,
    type: proposal.kind === 'cancel' ? 'session_off' : 'session_makeup',
    courseIds: [id],
    ...(proposal.kind !== 'cancel' && targetSlot ? { courseSlots: [targetSlot] } : {}),
    note,
  }
  if (proposal.kind === 'move' && proposal.sourceDate && proposal.sourceDate !== proposal.date) {
    return [
      { date: proposal.sourceDate, type: 'session_off', courseIds: [id], note },
      target,
    ]
  }
  return [target]
}

function hasPeriodOverlap(left, right) {
  const leftStart = periodIndex(left?.start)
  const leftEnd = periodIndex(left?.end)
  const rightStart = periodIndex(right?.start)
  const rightEnd = periodIndex(right?.end)
  if ([leftStart, leftEnd, rightStart, rightEnd].some((value) => value < 0)) return false
  return Math.min(leftEnd, rightEnd) >= Math.max(leftStart, rightStart)
}

function exceptionConflicts(existing, input) {
  if (!existing) return false
  if (scheduleExceptionReplacementIndex(input, [existing]) === 0) return true
  if (!String(existing.type || '').startsWith('session_')) return true

  const sameCourse = (existing.courseIds || []).some((id) => String(id) === String(input.courseIds?.[0]))
  const targetSlot = input.courseSlots?.[0]
  const existingSlots = Array.isArray(existing.courseSlots) ? existing.courseSlots : []
  if (!targetSlot || !targetSlot.start || !targetSlot.end) return sameCourse
  if (!existingSlots.length) return sameCourse
  return existingSlots.some((slot) => !slot?.start || !slot?.end
    ? sameCourse
    : hasPeriodOverlap(slot, targetSlot))
}

/** 用课表现有索引和日期查询找出需要用户复核的安排。 */
export function findScheduleProposalConflicts(inputs, exceptions = scheduleExceptions.value) {
  const matches = new Map()
  for (const input of Array.isArray(inputs) ? inputs : []) {
    if (!input?.date) continue
    const replacementIndex = scheduleExceptionReplacementIndex(input, exceptions)
    if (replacementIndex >= 0 && exceptions[replacementIndex]?.id) matches.set(exceptions[replacementIndex].id, exceptions[replacementIndex])
    for (const existing of scheduleExceptionsForDate(input.date, exceptions)) {
      if (exceptionConflicts(existing, input) && existing.id) matches.set(existing.id, existing)
    }
  }
  return [...matches.values()]
}

function copyRecord(value) {
  return deepClone(value)
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function splitDateRange(item, excludedDates) {
  const excluded = new Set(excludedDates)
  const segments = []
  let segmentStart = ''
  let segmentEnd = ''
  for (let date = item.date; date <= item.endDate; date = shiftDate(date, 1)) {
    if (excluded.has(date)) {
      if (segmentStart) segments.push({ date: segmentStart, endDate: segmentEnd })
      segmentStart = ''
      segmentEnd = ''
      continue
    }
    if (!segmentStart) segmentStart = date
    segmentEnd = date
  }
  if (segmentStart) segments.push({ date: segmentStart, endDate: segmentEnd })
  return segments.map((segment, index) => ({
    ...item,
    ...(index ? { id: undefined } : { id: item.id }),
    date: segment.date,
    endDate: segment.endDate > segment.date ? segment.endDate : null,
  }))
}

function replacementFragments(removed, inputs) {
  const dates = [...new Set(inputs.map((input) => input.date).filter(Boolean))]
  return removed.flatMap((item) => item.type === 'off' && item.endDate > item.date
    ? splitDateRange(item, dates)
    : [])
}

/** 保存安排并返回完整撤销；任一步失败都会回滚本次已写入的例外。 */
/**
 * @typedef {{ok: true, saved: Array<Record<string, any>>, replaced: Array<Record<string, any>>, conflicts: Array<Record<string, any>>, undo: () => boolean} | {ok: false, message: string, conflicts?: Array<Record<string, any>>}} ScheduleProposalApplyResult
 * @returns {ScheduleProposalApplyResult}
 */
export function applyScheduleProposal(proposal, courseId, { conflictChoice = '', exceptions = scheduleExceptions.value, courses = [] } = {}) {
  const inputs = buildScheduleExceptionInputs(proposal, courseId, courses)
  if (!inputs.length) return { ok: false, message: '课程、日期或节次不完整，课表没有更改。' }
  const conflicts = findScheduleProposalConflicts(inputs, exceptions)
  if (conflicts.length && !['replace', 'coexist'].includes(conflictChoice)) {
    return { ok: false, message: '请先选择替换已有安排或并存。', conflicts }
  }

  const removed = conflictChoice === 'replace' ? conflicts.map(copyRecord) : []
  const added = []
  const saved = []
  if (removed.length) for (const item of removed) removeScheduleException(item.id)

  const replacementValues = replacementFragments(removed, inputs)
  for (const input of [...replacementValues, ...inputs]) {
    const stored = saveScheduleException(input)
    if (!stored) {
      for (const item of added) removeScheduleException(item.id)
      for (const item of removed) saveScheduleException(item)
      return { ok: false, message: '课表写入失败，已回滚本次变更。' }
    }
    added.push(copyRecord(stored))
    if (inputs.includes(input)) saved.push(copyRecord(stored))
  }

  let undone = false
  return {
    ok: true,
    saved,
    replaced: removed,
    conflicts,
    undo() {
      if (undone) return false
      undone = true
      for (const item of added) removeScheduleException(item.id)
      for (const item of removed) saveScheduleException(item)
      return true
    },
  }
}

export function scheduleProposalSummary(proposal) {
  if (!proposal) return ''
  const kind = { move: '调课', cancel: '停课', makeup: '补课' }[proposal.kind] || '课表调整'
  const period = proposal.periodStart
    ? `第 ${proposal.periodStart}${proposal.periodEnd && proposal.periodEnd !== proposal.periodStart ? `–${proposal.periodEnd}` : ''} 节`
    : '节次待确认'
  return [kind, proposal.date, period, proposal.location].filter(Boolean).join(' · ')
}

export function scheduleProposalWeekDay(proposal) {
  return proposal?.date ? isoDay(proposal.date) : proposal?.weekDay ?? null
}
