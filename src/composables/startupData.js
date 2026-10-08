import { DOMAIN_SCHEMA_VERSION, migrateDomainData } from './domain/migrations.js'
import { retireFoodData } from './foodRetirement.js'
import { migrateCoursePeriodIds, migrateTemplatePeriodIds } from './coursePeriodMigration.js'
import { migrateTaskCourseLinks, touchStoredRef, useStoredRef } from './store/index.js'

// 必须在 App mount 前完成，避免恢复快照与 migration 同时写入业务 store。
export async function prepareDomainData() {
  const retirement = await retireFoodData()
  if (retirement.aborted) throw new Error(retirement.error)
  const tasks = useStoredRef('sl_tasks', [])
  const courses = useStoredRef('sl_courses', [])
  const migratedCourses = migrateCoursePeriodIds(courses.value)
  if (migratedCourses.changed) {
    courses.value = migratedCourses.value
    touchStoredRef('sl_courses')
  }
  const courseTemplates = useStoredRef('sl_course_templates', [])
  const migratedTemplates = migrateTemplatePeriodIds(courseTemplates.value)
  if (migratedTemplates.changed) {
    courseTemplates.value = migratedTemplates.value
    touchStoredRef('sl_course_templates')
  }
  const courseLinksChanged = migrateTaskCourseLinks(tasks.value, courses.value)
  const domainSchema = useStoredRef('sl_domain_schema', 0)
  if (domainSchema.value < DOMAIN_SCHEMA_VERSION) {
    const migrationChanged = migrateDomainData({
      tasks: tasks.value,
      milestones: useStoredRef('sl_exams', []).value,
      transactions: useStoredRef('sl_expenses', [], { deep: false }).value,
      events: useStoredRef('sl_events', []).value,
    })
    if (migrationChanged) {
      touchStoredRef('sl_expenses')
      touchStoredRef('sl_tasks')
      touchStoredRef('sl_events')
      touchStoredRef('sl_exams')
    }
    domainSchema.value = DOMAIN_SCHEMA_VERSION
  }
  if (courseLinksChanged) touchStoredRef('sl_tasks')
  return { tasks, courses }
}
