/** Convert legacy numeric period indexes to the stable `pN` ids used by schedules. */
export function migrateCoursePeriodIds(courses) {
  if (!Array.isArray(courses)) return { value: courses, changed: false }
  let changed = false
  const value = courses.map((course) => {
    if (!course || typeof course !== 'object') return course
    const start = typeof course.start === 'number' ? `p${course.start}` : course.start
    const end = typeof course.end === 'number' ? `p${course.end}` : course.end
    if (start === course.start && end === course.end) return course
    changed = true
    return { ...course, start, end }
  })
  return { value, changed }
}

export function migrateTemplatePeriodIds(templates) {
  if (!Array.isArray(templates)) return { value: templates, changed: false }
  let changed = false
  const value = templates.map((template) => {
    const result = migrateCoursePeriodIds(template?.courses)
    if (!result.changed) return template
    changed = true
    return { ...template, courses: result.value }
  })
  return { value, changed }
}
