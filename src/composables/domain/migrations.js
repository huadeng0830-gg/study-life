export const DOMAIN_SCHEMA_VERSION = 1

// 只补充缺失字段，永不删除或改写用户已有内容；可安全重复执行。
export function migrateDomainData({ tasks = [], milestones = [], transactions = [], events = [], notes = [] } = {}) {
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
  for (const item of notes) if (!item.updatedAt && item.createdAt) { item.updatedAt = item.createdAt; changed++ }
  return changed
}
