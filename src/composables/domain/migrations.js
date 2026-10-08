export const DOMAIN_SCHEMA_VERSION = 3

export function detachRetiredNoteRelations({ tasks = [], events = [] } = {}) {
  let changed = 0
  const now = new Date().toISOString()
  for (const item of [...tasks, ...events]) {
    if (item.sourceType !== 'note') continue
    item.sourceType = ''
    item.sourceId = ''
    item.relationId = ''
    item.updatedAt = now
    changed++
  }
  return changed
}

// 补充缺失字段，并在退役独立笔记后解除旧任务/日程到笔记的关系；原文和备注内容不变。
export function migrateDomainData({ tasks = [], milestones = [], transactions = [], events = [] } = {}) {
  let changed = 0
  for (const task of tasks) {
    if (task.done === undefined) { task.done = task.status === 'completed'; changed++ }
    if (!task.status) { task.status = task.done ? 'completed' : 'pending'; changed++ }
    if (!task.kind) { task.kind = /作业|实验|论文|复习|预习/.test(task.title || '') ? 'homework' : 'todo'; changed++ }
    if (!task.updatedAt && task.createdAt) { task.updatedAt = task.createdAt; changed++ }
  }
  for (const item of milestones) {
    if (!item.kind) { item.kind = item.category === '学习' ? 'exam' : 'countdown'; changed++ }
    if (!item.updatedAt && item.createdAt) { item.updatedAt = item.createdAt; changed++ }
  }
  for (const item of transactions) {
    if (!item.direction) { item.direction = 'expense'; changed++ }
    if (!item.updatedAt && item.createdAt) { item.updatedAt = item.createdAt; changed++ }
  }
  for (const item of events) if (!item.updatedAt && item.createdAt) { item.updatedAt = item.createdAt; changed++ }
  return changed + detachRetiredNoteRelations({ tasks, events })
}
