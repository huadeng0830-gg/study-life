import { createNextRepeatingTask, nextRepeatDueDate, normalizeTaskRepeat, repeatsTask } from '../taskRecurrence.js'
import { taskRepeatBase, taskTimePlanError, timeClockExists } from './taskTimePlan.ts'

function anchorDay(value) {
  const day = Number(value)
  return typeof value !== 'boolean' && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null
}

/** 旧月末记录沿来源链恢复原始日号；已改变基准的来源不再参与恢复。 */
function recoverMonthlyAnchor(item, tasks) {
  const seen = new Set([item.id])
  let cursor = item
  let recovered = null
  while (cursor?.sourceType === 'task-repeat' && cursor.sourceId && !seen.has(cursor.sourceId)) {
    seen.add(cursor.sourceId)
    const parent = tasks.find((task) => task.id === cursor.sourceId)
    if (!parent || normalizeTaskRepeat(parent.repeat) !== 'monthly' || !parent.dueDate) break
    const parentAnchor = anchorDay(parent.repeatAnchorDay)
    if (nextRepeatDueDate(parent.dueDate, 'monthly', parentAnchor ? { anchorDay: parentAnchor } : {}) !== cursor.dueDate) break
    if (parentAnchor) return parentAnchor
    const parentDay = new Date(`${parent.dueDate}T00:00:00`).getDate()
    const childDay = new Date(`${cursor.dueDate}T00:00:00`).getDate()
    if (!recovered && parentDay > childDay) recovered = parentDay
    cursor = parent
  }
  return recovered
}

/** 完成写入共用的生成步骤；只在下一期有效且已加入集合后记录生成事实。调用方提交存储。 */
export function spawnTaskRepeat(item, tasks, now) {
  if (!repeatsTask(item) || !taskRepeatBase(item).date || item.repeatGeneratedAt) return null
  const source = { ...item }
  if (normalizeTaskRepeat(item.repeat) === 'monthly' && !anchorDay(item.repeatAnchorDay)) {
    const recovered = recoverMonthlyAnchor(item, tasks)
    if (recovered) source.repeatAnchorDay = recovered
  }
  const next = createNextRepeatingTask(source, new Date(now))
  if (!next) {
    const nextDate = nextRepeatDueDate(taskRepeatBase(source).date, source.repeat, { anchorDay: source.repeatAnchorDay })
    if (source.repeatEndDate && nextDate && nextDate > source.repeatEndDate) delete item.repeatGenerationError
    return null
  }
  const error = taskTimePlanError(next.timeStages || [])?.message || (next.dueDate && next.dueTime && !timeClockExists(next.dueDate, next.dueTime) ? '截止时刻在当前时区不存在。' : '')
  if (error) {
    item.repeatGenerationError = `下一期未生成：${error}请编辑重复事项的时间后重新保存。`
    return null
  }
  delete item.repeatGenerationError
  const created = { ...next, status: 'pending', updatedAt: now, createdFrom: item.createdFrom || 'manual', sourceType: 'task-repeat', sourceId: item.id }
  tasks.push(created)
  item.repeatGeneratedAt = now
  return created
}
