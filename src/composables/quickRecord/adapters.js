import { useDomainCommands } from '../domain/commands.js'

export function useQuickRecordAdapters() {
  const domain = useDomainCommands()
  const courses = /** @type {import('vue').Ref<Array<{id: string, name: string}>>} */ (domain.courses)

  function savedResult(message, undo, entityType = '', entityId = '') {
    return {
      message,
      undo,
      entityType,
      entityId,
    }
  }

  function save(draft) {
    // QuickRecord 是输入适配器，不是持久化实体；没有可供 sourceId 指向的记录。
    const base = { ...draft, createdFrom: 'quick-record' }
    const contextNote = [draft.note, draft.dateRange ? `时间范围：${draft.dateRange}` : '', draft.location ? `地点：${draft.location}` : '', draft.reminder ? `提醒：${draft.reminder}` : '']
      .filter(Boolean)
      .join('；')
    if (draft.type === 'todo' || draft.type === 'homework') {
      const task = domain.createTask({ ...base, kind: draft.type, dueDate: draft.date, dueTime: draft.time, note: contextNote, sourceText: draft.raw })
      return savedResult(`已添加「${task.title}」`, () => domain.deleteTask(task.id), 'task', task.id)
    }
    if (draft.type === 'expense' || draft.type === 'income') {
      const transaction = domain.createTransaction({ ...base, name: draft.title, direction: draft.type, category: draft.category, source: 'quick-record' })
      return savedResult(`${draft.type === 'income' ? '已记录并记入收入' : '已记录并记入账本'} · ¥${Number(transaction.amount).toFixed(2)}`, () => domain.deleteTransaction(transaction.id), 'transaction', transaction.id)
    }
    if (draft.type === 'bill') {
      const bill = domain.createBill({ ...base, name: draft.title, nextDate: draft.date })
      return savedResult(`已添加固定账单「${draft.title}」`, () => domain.deleteBill(bill.id), 'bill', bill.id)
    }
    if (draft.type === 'countdown') {
      const milestone = domain.createMilestone({ ...base, name: draft.title, courseName: draft.course, kind: 'countdown' })
      return savedResult(`已添加重要日期「${draft.title}」`, () => domain.deleteMilestone(milestone.id), 'milestone', milestone.id)
    }
    if (draft.type === 'event') {
      const event = domain.createEvent({ ...base, courseName: draft.course })
      return savedResult(`已添加日程「${draft.title}」`, () => domain.deleteEvent(event.id), 'event', event.id)
    }
    throw new Error('无法识别记录类型，请先选择待办、日程、账目或重要日期。')
  }

  return { courses, save }
}
