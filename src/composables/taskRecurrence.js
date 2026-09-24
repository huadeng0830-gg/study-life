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
    // 只用毫秒时间戳当 id 时，同一毫秒内完成的两个周重复任务会拿到同一个 id，
    // 在同步合并与 tombstone 里互相覆盖。补一段随机后缀消除碰撞。
    id: `t${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    done: false,
    completedAt: null,
    repeatGeneratedAt: null,
    dueDate: dateText(nextDate),
    createdAt: now.toISOString(),
  }
}
