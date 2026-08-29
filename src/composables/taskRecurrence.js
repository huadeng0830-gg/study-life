function dateText(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function createNextWeeklyTask(task, now = new Date()) {
  if (!task || task.repeat !== 'weekly' || !task.dueDate) return null
  const nextDate = new Date(`${task.dueDate}T00:00:00`)
  if (Number.isNaN(nextDate.getTime())) return null
  nextDate.setDate(nextDate.getDate() + 7)
  return {
    ...task,
    id: `t${now.getTime()}`,
    done: false,
    completedAt: null,
    repeatGeneratedAt: null,
    dueDate: dateText(nextDate),
    createdAt: now.toISOString(),
  }
}
