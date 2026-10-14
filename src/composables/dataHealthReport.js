/**
 * 本机数据体检的只读扫描器。
 *
 * 它只接收已经读取好的快照，不导入存储、领域命令或 Vue 状态；日期和阈值
 * 也由调用方明确传入，避免扫描过程悄悄读取系统时间或写入用户分区。
 */
export const DEFAULT_DATA_HEALTH_THRESHOLDS = Object.freeze({
  staleTaskDays: 90,
  unhandledNoticeDays: 30,
  maxTransactionAmount: 100000,
})

/** @typedef {{staleTaskDays: number, unhandledNoticeDays: number, maxTransactionAmount: number}} DataHealthThresholds */

const MAX_SAMPLE_IDS = 8

function finiteThreshold(value, fallback, min = 1, max = 3650) {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

/** @param {unknown} value @returns {DataHealthThresholds} */
export function normalizeDataHealthThresholds(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {}
  return {
    staleTaskDays: Math.round(finiteThreshold(source.staleTaskDays, DEFAULT_DATA_HEALTH_THRESHOLDS.staleTaskDays)),
    unhandledNoticeDays: Math.round(finiteThreshold(source.unhandledNoticeDays, DEFAULT_DATA_HEALTH_THRESHOLDS.unhandledNoticeDays)),
    maxTransactionAmount: finiteThreshold(source.maxTransactionAmount, DEFAULT_DATA_HEALTH_THRESHOLDS.maxTransactionAmount, 0.01, 1_000_000_000),
  }
}

function rows(value) { return Array.isArray(value) ? value : [] }
function idOf(value) { return value?.id === undefined || value?.id === null ? '' : String(value.id) }
function active(value) { return Boolean(value) && !value.archivedAt && value.status !== 'archived' && !value.deletedAt && !value.tombstone }
function incompleteTask(value) {
  return active(value) && value.done !== true && value.status !== 'completed' && value.status !== 'cancelled'
}
function timestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return Date.parse(String(value ?? ''))
}
function dateKey(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const parsed = Date.parse(`${text}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text ? text : ''
}
function normalizeText(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN') }
function recordKey(value) { return `${normalizeText(value?.title)}\u0000${dateKey(value?.dueDate)}` }
function issue({ kind, severity = 'warning', entries, count = entries.length, title, detail, fix = 'review' }, sampleLimit = MAX_SAMPLE_IDS) {
  if (!count) return null
  const sampleIds = [...new Set(entries.map(idOf).filter(Boolean))].slice(0, Math.max(0, sampleLimit))
  return { id: kind, kind, severity, count, sampleIds, title, detail, fix }
}

function exceptionPeriodKeys(item) {
  const date = dateKey(item?.date)
  if (!date) return []
  const slots = Array.isArray(item.courseSlots) ? item.courseSlots : []
  if (slots.length) {
    return slots.map((slot) => {
      const start = String(slot?.start ?? '').trim()
      const end = String(slot?.end ?? '').trim()
      return start && end ? `${date}\u0000${start}\u0000${end}` : ''
    }).filter(Boolean)
  }
  const start = String(item.periodStart ?? item.startPeriod ?? '').trim()
  const end = String(item.periodEnd ?? item.endPeriod ?? '').trim()
  const period = String(item.period ?? '').trim()
  if (period) return [`${date}\u0000${period}`]
  return start && end ? [`${date}\u0000${start}\u0000${end}`] : []
}

/**
 * @param {Record<string, any>} [snapshot={}] 已读取的完整本机数据快照
 * @param {{now?: Date|string|number, today?: string, thresholds?: Partial<DataHealthThresholds>, sampleLimit?: number}} [options={}]
 */
export function buildDataHealthReport(snapshot = {}, { now, today, thresholds: rawThresholds, sampleLimit = MAX_SAMPLE_IDS } = {}) {
  const nowAt = timestamp(now)
  if (!Number.isFinite(nowAt)) throw new TypeError('数据体检需要调用方提供有效的 now 时间。')
  const thresholds = normalizeDataHealthThresholds(rawThresholds)
  const resolvedSampleLimit = Number.isFinite(sampleLimit) ? Math.max(0, Math.floor(sampleLimit)) : MAX_SAMPLE_IDS
  const courses = rows(snapshot.courses)
  const tasks = rows(snapshot.tasks)
  const events = rows(snapshot.events)
  const bills = rows(snapshot.bills)
  const transactions = rows(snapshot.transactions ?? snapshot.expenses)
  const categories = rows(snapshot.ledgerCategories)
  const places = rows(snapshot.places)
  const notices = rows(snapshot.notices)
  const exceptions = rows(snapshot.scheduleExceptions)
  const courseIds = new Set(courses.map(idOf).filter(Boolean))
  const categoryIds = new Set(categories.map((item) => String(item?.key ?? item?.id ?? '').trim()).filter(Boolean))
  const placeIds = new Set(places.map(idOf).filter(Boolean))
  const results = []
  const append = (value) => { if (value) results.push(value) }

  const duplicateGroups = new Map()
  for (const task of tasks.filter(incompleteTask)) {
    const key = recordKey(task)
    if (!normalizeText(task?.title) || !dateKey(task?.dueDate)) continue
    const group = duplicateGroups.get(key) || []
    group.push(task)
    duplicateGroups.set(key, group)
  }
  const duplicateTasks = [...duplicateGroups.values()].filter((group) => group.length > 1)
  const duplicateTaskEntries = duplicateTasks.flatMap((group) => group.slice(1))
  append(issue({
    kind: 'duplicate-tasks', entries: duplicateTaskEntries, count: duplicateTaskEntries.length,
    title: '重复待办', detail: '标题和截止日期相同，且都还未完成。可合并备注或归档多余项。', fix: 'merge-or-archive',
  }, resolvedSampleLimit))

  append(issue({
    kind: 'orphan-task-course', entries: tasks.filter((item) => active(item) && item.courseId && !courseIds.has(String(item.courseId))),
    title: '待办关联的课程不存在', detail: '这些待办仍指向本机课程列表中没有的课程。可重新关联或归档。', fix: 'reassign-or-archive',
  }, resolvedSampleLimit))
  append(issue({
    kind: 'orphan-event-course', entries: events.filter((item) => active(item) && item.courseId && !courseIds.has(String(item.courseId))),
    title: '日程关联的课程不存在', detail: '这些日程仍指向本机课程列表中没有的课程。可重新关联或归档。', fix: 'reassign-or-archive',
  }, resolvedSampleLimit))
  append(issue({
    kind: 'orphan-transaction-category',
    entries: transactions.filter((item) => active(item) && !categoryIds.has(String(item.cat ?? item.category ?? '').trim())),
    title: '收支分类不存在', detail: '这些收支记录使用的分类不在当前分类清单中。可合并到一个现有分类或归档。', fix: 'merge-category-or-archive',
  }, resolvedSampleLimit))
  append(issue({
    kind: 'orphan-transaction-place',
    entries: transactions.filter((item) => active(item) && item.placeId && !placeIds.has(String(item.placeId))),
    title: '收支关联的地点不存在', detail: '这些收支记录引用了当前地点档案中不存在的地点。可重新关联或归档。', fix: 'reassign-or-archive',
  }, resolvedSampleLimit))

  const anomalousTransactions = transactions.filter((item) => {
    if (!active(item)) return false
    const amount = item.amount
    return typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > thresholds.maxTransactionAmount
  })
  append(issue({
    kind: 'anomalous-transaction-amount', entries: anomalousTransactions,
    title: '收支金额异常', detail: `金额不是有效正数，或超过当前上限 ¥${thresholds.maxTransactionAmount.toLocaleString('zh-CN')}。可归档并保留撤销入口。`, fix: 'archive',
  }, resolvedSampleLimit))

  const nowDate = dateKey(today) || new Date(nowAt).toISOString().slice(0, 10)
  const staleTaskCutoff = Date.parse(`${nowDate}T00:00:00Z`) - thresholds.staleTaskDays * 86400000
  const staleTasks = tasks.filter((item) => {
    if (!incompleteTask(item)) return false
    const dueAt = timestamp(dateKey(item.dueDate) ? `${item.dueDate}T00:00:00Z` : '')
    return Number.isFinite(dueAt) && dueAt < staleTaskCutoff
  })
  append(issue({
    kind: 'stale-tasks', entries: staleTasks, severity: 'info',
    title: '长期未完成的待办', detail: `截止日期早于 ${thresholds.staleTaskDays} 天；请先复核，再逐条归档。`, fix: 'archive',
  }, resolvedSampleLimit))

  append(issue({
    kind: 'empty-task-title', entries: tasks.filter((item) => active(item) && !normalizeText(item.title)),
    title: '待办标题为空', detail: '无法从列表中辨认这些待办；可归档不再需要的记录。', fix: 'archive',
  }, resolvedSampleLimit))
  append(issue({
    kind: 'empty-event-title', entries: events.filter((item) => active(item) && !normalizeText(item.title)),
    title: '日程标题为空', detail: '无法从列表中辨认这些日程；可归档不再需要的记录。', fix: 'archive',
  }, resolvedSampleLimit))
  append(issue({
    kind: 'empty-bill-title', entries: bills.filter((item) => active(item) && !normalizeText(item.name ?? item.title)),
    title: '账单名称为空', detail: '无法从固定账单列表中辨认这些记录；可暂停并归档。', fix: 'archive',
  }, resolvedSampleLimit))

  const noticeCutoff = nowAt - thresholds.unhandledNoticeDays * 86400000
  const staleNotices = notices.filter((item) => active(item) && item.status === 'new'
    && Number.isFinite(timestamp(item.createdAt)) && timestamp(item.createdAt) < noticeCutoff)
  append(issue({
    kind: 'unhandled-notices', entries: staleNotices, severity: 'info',
    title: '长期未处理的通知', detail: `状态仍为「待处理」且创建时间早于 ${thresholds.unhandledNoticeDays} 天；可归档并保留撤销入口。`, fix: 'archive-notice',
  }, resolvedSampleLimit))

  const exceptionGroups = new Map()
  for (const exception of exceptions.filter(active)) {
    for (const key of exceptionPeriodKeys(exception)) {
      const group = exceptionGroups.get(key) || []
      group.push(exception)
      exceptionGroups.set(key, group)
    }
  }
  const duplicateExceptionEntries = [...exceptionGroups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.slice(1))
  append(issue({
    kind: 'duplicate-schedule-exceptions', entries: duplicateExceptionEntries, count: duplicateExceptionEntries.length,
    title: '重复调课安排', detail: '同一日期和节次存在多条调课记录；请到课表核对后合并，避免自动覆盖。', fix: 'review-schedule',
  }, resolvedSampleLimit))

  return results
}

/** 导出只含检查结论、阈值和不透明记录 ID，不携带标题、通知正文或金额明细。 */
/** @param {Array<{severity: string, title: string, count: number, detail: string, sampleIds?: string[]}>} [report=[]] @param {{generatedAt?: string, thresholds?: Partial<DataHealthThresholds>}} [options={}] */
export function formatDataHealthReportText(report = [], { generatedAt = '', thresholds: rawThresholds = {} } = {}) {
  const thresholds = normalizeDataHealthThresholds(rawThresholds)
  const lines = [
    '三两事 · 本机数据体检',
    `生成时间：${generatedAt || '未提供'}`,
    `检查阈值：待办 ${thresholds.staleTaskDays} 天 · 通知 ${thresholds.unhandledNoticeDays} 天 · 金额上限 ¥${thresholds.maxTransactionAmount}`,
    '',
  ]
  if (!report.length) lines.push('没有发现需要复核的数据。')
  else for (const item of report) {
    lines.push(`${item.severity === 'warning' ? '需复核' : '提示'}｜${item.title}｜${item.count} 条`)
    lines.push(`说明：${item.detail}`)
    if (item.sampleIds?.length) lines.push(`样本编号：${item.sampleIds.join('、')}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
