import { nextRepeatDueDate } from '../taskRecurrence.js'
import { dateText } from '../../utils/formatters.js'

export const DUTY_WEEKDAYS = Object.freeze([
  { value: 0, label: '星期日' },
  { value: 1, label: '星期一' },
  { value: 2, label: '星期二' },
  { value: 3, label: '星期三' },
  { value: 4, label: '星期四' },
  { value: 5, label: '星期五' },
  { value: 6, label: '星期六' },
])

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 名单保存在现有清单里；逗号、顿号和换行都可用来分隔手填成员。
 * 姓名只做去空白与去重，避免把联系人资料或第二套成员实体带进来。
 * @param {string | string[] | null | undefined} value
 */
export function normalizeDutyMembers(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[，,、;；\n\r]+/)
  const seen = new Set()
  const members = []
  for (const entry of source) {
    const name = String(entry ?? '').trim().slice(0, 80)
    const key = name.normalize('NFKC').toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    members.push(name)
    if (members.length >= 100) break
  }
  return members
}

/** 从已有值日清单和已填写事项中汇集可选择的名字。 @param {Partial<import('../../types/checklists').Checklist>[]} lists */
export function dutyMemberChoices(lists = []) {
  return normalizeDutyMembers(lists.flatMap((list) => [
    ...(Array.isArray(list?.dutyMembers) ? list.dutyMembers : []),
    ...(Array.isArray(list?.items) ? list.items.flatMap((item) => [item?.assignedTo || '', item?.substitutedBy || '']) : []),
  ])).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/** 当前学期的保守默认起点；清单可自行改为校历中的实际开学日期。 */
export function currentSemesterStartDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  if (month >= 9) return `${year}-09-01`
  if (month <= 2) return `${year - 1}-09-01`
  return `${year}-03-01`
}

/** 首次排期可落在今天；后续日期一律由共同的 weekly 规则严格向后推进。 */
export function firstDutyDateOnOrAfter(value, weekday) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  const target = Number(weekday)
  if (Number.isNaN(date.getTime()) || !Number.isInteger(target) || target < 0 || target > 6) return ''
  const today = dateText(date)
  if (date.getDay() === target) return today
  return nextRepeatDueDate(today, 'weekly', { weekday: target })
}

/**
 * 汇总本学期的排班和代班次数。一个人同一值日系列同一天负责多项，也只算一次值班。
 * 代班后按实际到班人计入值班总数，并单独计入代班次数。
 * @param {Partial<import('../../types/checklists').Checklist>[]} lists
 * @param {{semesterStartDate?: string, throughDate?: string}} options
 */
export function summarizeDutyCounts(lists = [], { semesterStartDate = '', throughDate = '' } = {}) {
  const start = DATE_KEY.test(String(semesterStartDate)) ? String(semesterStartDate) : ''
  const end = DATE_KEY.test(String(throughDate)) ? String(throughDate) : '9999-12-31'
  const shifts = new Map()
  const substitutions = new Map()

  for (const list of lists) {
    if (!list?.dutyEnabled) continue
    const seriesId = String(list.dutySeriesId || list.id || '')
    const fallbackDate = String(list.occurrenceDate || '')
    for (const item of Array.isArray(list.items) ? list.items : []) {
      if (!item || typeof item !== 'object') continue
      const date = String(item.dueDate || fallbackDate)
      if (!DATE_KEY.test(date) || (start && date < start) || date > end) continue
      const scheduled = String(item.assignedTo || '').trim()
      const substitute = String(item.substitutedBy || '').trim()
      const actual = substitute || scheduled
      if (!actual) continue
      const normalized = actual.normalize('NFKC').toLocaleLowerCase()
      const shiftKey = `${seriesId}\u0000${date}\u0000${normalized}`
      shifts.set(shiftKey, { name: actual, count: (shifts.get(shiftKey)?.count || 0) + 1 })
      if (substitute) substitutions.set(shiftKey, { name: substitute, count: (substitutions.get(shiftKey)?.count || 0) + 1 })
    }
  }

  const aggregate = (entries) => {
    const counts = new Map()
    for (const entry of entries.values()) {
      const key = entry.name.normalize('NFKC').toLocaleLowerCase()
      const current = counts.get(key) || { name: entry.name, count: 0 }
      current.count += 1
      counts.set(key, current)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
  }

  const byMember = aggregate(shifts)
  const substitutedBy = aggregate(substitutions)
  return {
    byMember,
    substitutedBy,
    totalShifts: byMember.reduce((sum, entry) => sum + entry.count, 0),
    totalSubstitutions: substitutedBy.reduce((sum, entry) => sum + entry.count, 0),
  }
}
