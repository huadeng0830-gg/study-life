export function groupProjectSubtasks(tasks) {
  const grouped = new Map()
  for (const task of tasks) {
    if (!task?.parentTaskId) continue
    const children = grouped.get(task.parentTaskId) || []
    children.push(task)
    grouped.set(task.parentTaskId, children)
  }
  return grouped
}

export function projectTaskRisks({ project, tasks, deliverables, deliveryChecks, inbox, isDependencyBlocked, now = new Date() }) {
  if (!project) return []
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const soon = new Date(today)
  soon.setDate(soon.getDate() + 3)
  const dateKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const todayKey = dateKey(today)
  const soonKey = dateKey(soon)
  const risks = []
  for (const task of tasks) {
    if (task.status === 'completed' || !task.dueOn) continue
    if (task.dueOn < todayKey) risks.push(`任务「${task.title}」已超过截止日期`)
    else if (task.dueOn <= soonKey) risks.push(`任务「${task.title}」将在三天内截止`)
  }
  for (const task of tasks) if (task.status !== 'completed' && isDependencyBlocked(task)) risks.push(`任务「${task.title}」等待前置任务「${task.dependencyTaskTitle}」完成`)
  for (const item of deliverables) if (item.required && !item.versions?.length) risks.push(`必需成果「${item.title}」尚未提交`)
  for (const check of deliveryChecks) if (check.required && !check.checked) risks.push(`交付检查「${check.title}」尚未完成`)
  if (inbox.reviews.some((item) => item.projectId === project.id)) risks.push('有成果等待你验收')
  if (inbox.adjustments.some((item) => item.projectId === project.id)) risks.push('有任务调整申请等待你处理')
  if (inbox.meetings.some((item) => item.projectId === project.id)) risks.push('有小组讨论邀请或改期建议等待处理')
  return risks.slice(0, 5)
}

export function projectDeliveryCenter(tasks, deliverables) {
  return {
    completedTasks: tasks.filter((task) => task.status === 'completed'),
    missing: deliverables.filter((item) => item.required && (!item.versions?.length || (item.reviewRequired && item.versions[0]?.reviewStatus !== 'approved'))),
    awaitingReview: deliverables.filter((item) => item.versions?.[0]?.reviewStatus === 'pending'),
    approved: deliverables.filter((item) => item.versions?.[0]?.reviewStatus === 'approved'),
  }
}
