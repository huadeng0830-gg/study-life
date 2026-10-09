import { normalizeAmount } from '../ledger.js'
import { RECORD_TYPES } from './types.js'

export const FINANCIAL_RECORD_TYPES = ['expense', 'income', 'bill']

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateQuickRecord(draft) {
  const issues = /** @type {Record<string, string>} */ ({})
  if (!RECORD_TYPES[draft.type] || ['unknown', 'refund'].includes(draft.type)) {
    issues.type = '请先选择记录类型'
  }
  if (!String(draft.title || '').trim()) issues.title = '请填写记录标题'
  if (FINANCIAL_RECORD_TYPES.includes(draft.type)) {
    if (normalizeAmount(draft.amount) === null) issues.amount = '金额需大于 0，且最多保留两位小数'
    if (draft.categoryUncertain && !draft.categoryConfirmed) issues.category = '请确认建议分类，或选择其它分类'
  }
  if (['event', 'countdown', 'bill', 'expense', 'income'].includes(draft.type) && !draft.date) {
    issues.date = '请补充日期'
  } else if (draft.date && !validDate(draft.date)) {
    issues.date = '请填写有效日期'
  }
  for (const field of ['time', 'endTime']) {
    if (draft[field] && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft[field])) issues[field] = '请填写有效时间'
  }
  if (draft.time && !draft.date) issues.date = '设置时间时也需要选择日期'
  if (draft.type === 'event' && draft.endTime) {
    if (!draft.time) issues.time = '请先填写开始时间'
    else if (draft.endTime <= draft.time) issues.endTime = '结束时间需晚于开始时间'
  }
  if (draft.type === 'bill' && !['weekly', 'monthly', 'quarterly', 'yearly', 'once'].includes(draft.cycle)) {
    issues.cycle = '请选择支持的重复周期'
  }
  return issues
}

// An unchanged source line keeps its edits, selection and identity when another
// line is added. Queues distinguish identical lines without merging two records.
/**
 * @param {import('./contracts').QuickRecordDraft[]} parsed
 * @param {import('./contracts').QuickRecordDraft[]} previous
 * @returns {import('./contracts').QuickRecordDraft[]}
 */
export function reconcileQuickRecordDrafts(parsed, previous) {
  const queues = new Map()
  for (const draft of previous) {
    const queue = queues.get(draft.raw) || []
    queue.push(draft)
    queues.set(draft.raw, queue)
  }
  return parsed.map((draft) => queues.get(draft.raw)?.shift() || { ...draft, selected: true })
}

/** @param {import('./contracts').QuickRecordDraft[]} drafts */
export function quickRecordDraftText(drafts) {
  return drafts.map((draft) => draft.raw).filter(Boolean).join('\n')
}
