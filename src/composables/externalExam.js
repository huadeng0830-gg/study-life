import { parseDate } from '@internationalized/date'

function addExamDateDays(dateKey, days) {
  try { return parseDate(dateKey).add({ days }).toString() } catch { return '' }
}

export const DEFAULT_EXTERNAL_EXAM_ITEMS = Object.freeze([
  { name: '准考证', quantity: 1, unit: '张' },
  { name: '身份证', quantity: 1, unit: '张' },
  { name: '2B 铅笔', quantity: 2, unit: '支' },
  { name: '橡皮', quantity: 1, unit: '块' },
  { name: '直尺', quantity: 1, unit: '把' },
  { name: '计算器', quantity: 1, unit: '个' },
  { name: '黑色签字笔', quantity: 2, unit: '支' },
])

/** @typedef {{id?: string, name: string, quantity: number, unit: string, checked: boolean}} ExternalExamItem */

/** @returns {ExternalExamItem[]} */
export function defaultExternalExamItems() {
  return DEFAULT_EXTERNAL_EXAM_ITEMS.map((item) => ({ ...item, checked: false }))
}

/** @param {unknown} items @returns {ExternalExamItem[]} */
export function normalizeExternalExamItems(items) {
  if (!Array.isArray(items)) return defaultExternalExamItems()
  return items.map((item) => {
    const normalized = /** @type {Record<string, any>} */ (typeof item === 'string' ? { name: item } : item && typeof item === 'object' ? item : {})
    const name = String(normalized.name || '').trim()
    if (!name) return null
    const quantity = normalized.quantity === '' || normalized.quantity == null
      ? 1
      : Math.max(1, Math.floor(Number(normalized.quantity) || 1))
    return {
      ...(normalized.id ? { id: String(normalized.id) } : {}),
      name,
      quantity,
      unit: String(normalized.unit || ''),
      checked: Boolean(normalized.checked),
    }
  }).filter((item) => item !== null)
}

/** 兼容旧版重要日期字段，同时补齐校外考试信息。 */
/** @param {unknown} [item={}] @returns {any} */
export function normalizeExternalExam(item = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  const record = /** @type {Record<string, any>} */ (item)
  if (record.kind !== 'externalExam' && record.category !== '校外考试') return item
  const examDate = String(Object.hasOwn(record, 'examDate') ? record.examDate || '' : record.date || '').trim()
  const examTime = String(Object.hasOwn(record, 'examTime') ? record.examTime || '' : record.time || '').trim()
  const venue = String(record.venue || record.location || '').trim()
  return {
    ...record,
    kind: 'externalExam',
    category: '校外考试',
    registerStart: String(record.registerStart || '').trim(),
    registerDeadline: String(record.registerDeadline || '').trim(),
    examDate,
    examTime,
    date: examDate || String(record.date || record.registerDeadline || '').trim(),
    time: examTime,
    venue,
    location: venue,
    campus: String(record.campus || '').trim(),
    seatNo: String(record.seatNo || '').trim(),
    admissionNo: String(record.admissionNo || '').trim(),
    requiredItems: normalizeExternalExamItems(record.requiredItems),
  }
}

/** 时间轴优先指向下一件要办的事，报名结束后自动切到考试日期。 */
export function externalExamTimelineTarget(item, today) {
  const examDate = item.examDate === undefined ? item.date : item.examDate
  const targets = [
    { date: item.registerDeadline, stage: 'registration', time: '' },
    { date: examDate, stage: 'exam', time: item.examTime || item.time || '' },
  ].filter((target) => /^\d{4}-\d{2}-\d{2}$/.test(String(target.date || '')))
  const next = targets.filter((target) => target.date >= today).sort((left, right) => left.date.localeCompare(right.date))[0]
  return next || targets.find((entry) => entry.stage === 'exam') || targets[0] || null
}

/** 考试提醒按日历日计算，避免跨时区时日期偏移。 */
export function externalExamReminderSpecs(item) {
  const name = String(item?.name || '考试').trim()
  const examDate = Object.hasOwn(item || {}, 'examDate') ? item.examDate : item?.date
  const specs = []
  const append = (baseDate, offsets, phase) => {
    if (!baseDate) return
    for (const days of offsets) {
      const date = addExamDateDays(baseDate, -days)
      if (!date) continue
      specs.push({
        key: `externalExam:${phase}:${days}`,
        date,
        time: '09:00',
        body: `${name}${phase === 'registration' ? ' 报名截止' : ' 考试'}还有 ${days} 天`,
      })
    }
  }
  append(item?.registerDeadline, [14, 7, 3], 'registration')
  append(examDate, [30, 7, 1], 'exam')
  if (examDate) {
    specs.push({
      key: 'externalExam:carry-items:1',
      date: addExamDateDays(examDate, -1),
      time: '20:00',
      body: `明天是${name}考试，今晚检查准考证、身份证和考试用品`,
    })
  }
  return specs.filter((item) => item.date)
}
