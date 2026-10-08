import { DOMAIN_SCHEMA_VERSION, migrateDomainData } from './domain/migrations.js'
import { retireFoodData } from './foodRetirement.js'

// 必须在 App mount 前完成，避免恢复快照与 migration 同时写入业务 store。
export async function prepareDomainData() {
  const { migrateTaskCourseLinks, touchStoredRef, useStoredRef } = await import('./store/index.js')
  const retirement = await retireFoodData()
  if (retirement.aborted) throw new Error(retirement.error)
  const tasks = useStoredRef('sl_tasks', [])
  const courses = useStoredRef('sl_courses', [])
  const courseLinksChanged = migrateTaskCourseLinks(tasks.value, courses.value)
  const domainSchema = useStoredRef('sl_domain_schema', 0)
  if (domainSchema.value < DOMAIN_SCHEMA_VERSION) {
    const migrationChanged = migrateDomainData({
      tasks: tasks.value,
      milestones: useStoredRef('sl_exams', []).value,
      transactions: useStoredRef('sl_expenses', [], { deep: false }).value,
      events: useStoredRef('sl_events', []).value,
      notes: useStoredRef('sl_quick_notes', []).value,
    })
    if (migrationChanged) {
      touchStoredRef('sl_expenses')
      touchStoredRef('sl_tasks')
      touchStoredRef('sl_quick_notes')
      touchStoredRef('sl_events')
      touchStoredRef('sl_exams')
    }
    domainSchema.value = DOMAIN_SCHEMA_VERSION
  }
  if (courseLinksChanged) touchStoredRef('sl_tasks')
  return { tasks, courses }
}
