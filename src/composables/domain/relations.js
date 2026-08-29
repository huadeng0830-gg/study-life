// 关联仅以稳定 ID 为准；名称只是旧数据和已解除关联内容的可读回退。
export function detachCourseRelations(course, { tasks = [], milestones = [], events = [], notes = [] } = {}) {
  if (!course?.id) return { tasks: 0, milestones: 0, events: 0, notes: 0 }
  const result = { tasks: 0, milestones: 0, events: 0, notes: 0 }
  for (const item of tasks) { if (item.courseId === course.id) { item.courseId = ''; item.course = item.course || course.name || ''; result.tasks++ } }
  for (const item of milestones) { if (item.courseId === course.id) { item.courseId = ''; item.courseName = item.courseName || course.name || ''; result.milestones++ } }
  for (const item of events) { if (item.courseId === course.id) { item.courseId = ''; item.courseName = item.courseName || course.name || ''; result.events++ } }
  for (const item of notes) { if (item.courseId === course.id) { item.courseId = ''; item.courseName = item.courseName || course.name || ''; result.notes++ } }
  return result
}

export function entityRef(sourceType, sourceId) { return `${sourceType}:${sourceId}` }
