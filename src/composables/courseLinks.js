// 课程删除不会连带删除学习记录；只解除稳定 ID 关联，并留下可读名称。
export function detachCourseLinks(course, taskList, countdownList) {
  if (!course?.id) return { tasks: 0, countdowns: 0 }
  let tasks = 0
  let countdowns = 0
  for (const task of taskList) {
    if (task.courseId !== course.id) continue
    task.courseId = ''
    task.course = task.course || course.name || ''
    tasks++
  }
  for (const item of countdownList) {
    if (item.courseId !== course.id) continue
    item.courseId = ''
    item.courseName = item.courseName || course.name || ''
    countdowns++
  }
  return { tasks, countdowns }
}


// 导入通知或旧数据只能在课程名称唯一时补充 ID，重名时保留文字让用户确认。
export function findUniqueCourseByName(courseList, name) {
  const normalized = String(name ?? '').trim()
  if (!normalized) return null
  const matches = courseList.filter((course) => String(course?.name ?? '').trim() === normalized)
  return matches.length === 1 ? matches[0] : null
}
