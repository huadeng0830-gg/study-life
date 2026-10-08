// 导入通知或旧数据只能在课程名称唯一时补充 ID，重名时保留文字让用户确认。
export function findUniqueCourseByName(courseList, name) {
  const normalized = String(name ?? '').trim()
  if (!normalized) return null
  const matches = courseList.filter((course) => String(course?.name ?? '').trim() === normalized)
  return matches.length === 1 ? matches[0] : null
}
