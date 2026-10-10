import { dateInZone } from '../zonedTime.js'

export function isProjectTaskBlocked(task) {
  return Boolean(task?.dependsOnTaskId && task.dependencyStatus !== 'completed')
}

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

const PRIORITY_ORDER = { urgent: 3, high: 2, normal: 1, low: 0 }
const searchText = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().trim()

/** Filters every task, retaining a parent as context when one of its children matches. */
export function selectProjectTasks(tasks, { status = 'open', assignee = 'all', milestone = '', search = '', sort = 'default', userId = '', today = '' } = {}) {
  const query = searchText(search)
  const matching = tasks.filter((task) => {
    const open = task.status !== 'completed'
    if (status === 'open' && !open) return false
    if (status === 'done' && open) return false
    if (status === 'overdue' && (!open || !task.dueOn || task.dueOn >= today)) return false
    if (status === 'blocked' && (!open || !isProjectTaskBlocked(task))) return false
    if (['todo', 'in_progress', 'review'].includes(status) && task.status !== status) return false
    if (assignee === 'mine' && (!userId || task.assigneeId !== userId)) return false
    if (assignee === 'unassigned' && task.assigneeId) return false
    if (!['all', 'mine', 'unassigned'].includes(assignee) && task.assigneeId !== assignee) return false
    if (milestone && task.milestoneId !== milestone) return false
    return !query || searchText([task.title, task.description, task.assigneeName,
      task.workCheckpoint?.lastStep, task.workCheckpoint?.nextStep, task.workCheckpoint?.blocker].join(' ')).includes(query)
  })
  const matchingIds = new Set(matching.map((task) => task.id))
  const children = groupProjectSubtasks(matching)
  const taskIds = new Set(tasks.map((task) => task.id))
  const parents = tasks.filter((task) => (!task.parentTaskId || !taskIds.has(task.parentTaskId))
    && (matchingIds.has(task.id) || children.has(task.id)))
  const compare = sort === 'due' ? (a, b) => (a.dueOn || '9999').localeCompare(b.dueOn || '9999')
    : sort === 'priority' ? (a, b) => (PRIORITY_ORDER[b.priority] ?? 1) - (PRIORITY_ORDER[a.priority] ?? 1)
      : sort === 'updated' ? (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) : null
  if (compare) {
    for (const group of children.values()) group.sort(compare)
    const sortValue = (task) => matchingIds.has(task.id) ? task : children.get(task.id)?.[0] || task
    parents.sort((a, b) => compare(sortValue(a), sortValue(b)))
  }
  return { parents, children, matchingIds, count: matching.length }
}

export function projectTaskOverview(tasks, { userId = '', today = '' } = {}) {
  const completed = tasks.filter((task) => task.status === 'completed').length
  const open = tasks.filter((task) => task.status !== 'completed')
  return {
    total: tasks.length, completed, open: open.length,
    progress: tasks.length ? Math.round(completed / tasks.length * 100) : 0,
    inProgress: open.filter((task) => task.status === 'in_progress').length,
    review: open.filter((task) => task.status === 'review').length,
    overdue: open.filter((task) => task.dueOn && task.dueOn < today).length,
    blocked: open.filter(isProjectTaskBlocked).length,
    unassigned: open.filter((task) => !task.assigneeId).length,
    mine: open.filter((task) => userId && task.assigneeId === userId).length,
  }
}

export function projectTaskRisks({ project, tasks, deliverables, deliveryChecks, inbox, isDependencyBlocked, now = new Date(), timeZone }) {
  if (!project) return []
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const soon = new Date(today)
  soon.setDate(soon.getDate() + 3)
  const dateKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const todayKey = timeZone ? dateInZone(new Date(now).getTime(), timeZone) : dateKey(today)
  const soonInZone = new Date(`${todayKey}T00:00:00Z`)
  soonInZone.setUTCDate(soonInZone.getUTCDate() + 3)
  const soonKey = timeZone ? soonInZone.toISOString().slice(0, 10) : dateKey(soon)
  const risks = []
  for (const task of tasks) {
    if (task.status === 'completed' || !task.dueOn) continue
    if (task.dueOn < todayKey) risks.push(`任务「${task.title}」已超过截止日期`)
    else if (task.dueOn <= soonKey) risks.push(`任务「${task.title}」将在三天内截止`)
  }
  for (const task of tasks) if (task.status !== 'completed' && isDependencyBlocked(task)) {
    const dependencyTitle = task.dependencyTaskTitle || tasks.find((item) => item.id === task.dependsOnTaskId)?.title || '未命名任务'
    risks.push(`任务「${task.title}」等待前置任务「${dependencyTitle}」完成`)
  }
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
