import { cloneSyncValue, SYNC_ENTITY_COLLECTIONS } from './syncMetadata.js'

function hasId(index, id) { return id !== undefined && id !== null && index.has(String(id)) }
function hasBillRelationId(value) { return typeof value === 'string' && value.startsWith('bill:') }

export function validateAndRepairRelations(values = {}) {
  const next = cloneSyncValue(values) || {}
  const courses = new Set((next.sl_courses || []).map((item) => String(item?.id)).filter(Boolean))
  const bills = new Set((next.sl_bills || []).map((item) => String(item?.id)).filter(Boolean))
  const milestones = new Set((next.sl_exams || []).map((item) => String(item?.id)).filter(Boolean))
  const issues = []
  const repairCourse = (item, field, readableField) => {
    if (!item?.[field] || hasId(courses, item[field])) return item
    const fixed = { ...item, [field]: '' }
    if (readableField && !fixed[readableField]) fixed[readableField] = ''
    issues.push({ type: 'relation-cleared', entityType: 'Course', entityId: String(item.id), field })
    return fixed
  }
  for (const key of ['sl_tasks', 'sl_exams', 'sl_events']) {
    if (!Array.isArray(next[key])) continue
    next[key] = next[key].map((item) => repairCourse(item, 'courseId', key === 'sl_tasks' ? 'course' : 'courseName'))
  }
  if (Array.isArray(next.sl_expenses)) {
    next.sl_expenses = next.sl_expenses.map((item) => {
      const billReference = item?.billId || (item?.sourceType === 'bill' ? item.sourceId : '') || (hasBillRelationId(item?.relationId) ? item.relationId.slice(5) : '')
      if (!billReference || hasId(bills, billReference)) return item
      issues.push({ type: 'relation-cleared', entityType: 'Bill', entityId: String(item.id), field: 'billId' })
      return { ...item, billId: '', billingPeriodKey: '', sourceType: item.sourceType === 'bill' ? '' : item.sourceType, sourceId: item.sourceType === 'bill' ? '' : item.sourceId, relationId: hasBillRelationId(item.relationId) ? '' : item.relationId }
    })
  }
  if (Array.isArray(next.sl_focus_sessions)) {
    const taskIds = new Set((next.sl_tasks || []).map((item) => String(item?.id)).filter(Boolean))
    next.sl_focus_sessions = next.sl_focus_sessions.map((session) => {
      if (!session?.todoId || hasId(taskIds, session.todoId)) return session
      issues.push({ type: 'relation-cleared', entityType: 'FocusSession', entityId: String(session.id || session.sessionId || ''), field: 'todoId' })
      return { ...session, title: String(session.title || ''), todoId: null }
    })
  }
  for (const [key, sourceSet, sourceType] of [['sl_tasks', null, 'note'], ['sl_events', null, 'note'], ['sl_tasks', milestones, 'milestone-review']]) {
    if (!Array.isArray(next[key])) continue
    next[key] = next[key].map((item) => {
      if (item?.sourceType !== sourceType || (sourceSet && hasId(sourceSet, item.sourceId))) return item
      issues.push({ type: 'relation-cleared', entityType: sourceType, entityId: String(item.id), field: 'sourceId' })
      return { ...item, sourceType: '', sourceId: '', relationId: '' }
    })
  }
  return { values: next, issues }
}

export function validateSyncEntityShape(values = {}) {
  const issues = []
  for (const key of Object.keys(SYNC_ENTITY_COLLECTIONS)) {
    if (values[key] !== undefined && !Array.isArray(values[key])) issues.push({ type: 'invalid-collection', key })
  }
  return issues
}
