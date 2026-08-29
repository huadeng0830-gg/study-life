import { useDomainCommands } from '../domain/commands.js'

export function useQuickRecordAdapters() {
  const domain = useDomainCommands()
  const { courses } = domain

  function save(draft) {
    const base = { ...draft, createdFrom: 'quick-record', sourceType: 'quick-record', sourceId: draft.id }
    if (draft.type === 'todo' || draft.type === 'homework') {
      const task = domain.createTask({ ...base, kind: draft.type, dueDate: draft.date, dueTime: draft.time, sourceText: draft.raw })
      return `已添加「${task.title}」`
    }
    if (draft.type === 'expense' || draft.type === 'income') {
      domain.createTransaction({ ...base, name: draft.title, direction: draft.type, category: draft.category, source: 'quick-record' })
      return `已记录${draft.type === 'income' ? '收入' : '支出'}「${draft.title}」`
    }
    if (draft.type === 'bill') {
      domain.createBill({ ...base, name: draft.title, nextDate: draft.date })
      return `已添加固定账单「${draft.title}」`
    }
    if (draft.type === 'countdown') {
      domain.createMilestone({ ...base, name: draft.title, courseName: draft.course, kind: 'countdown' })
      return `已添加倒计时「${draft.title}」`
    }
    if (draft.type === 'event') {
      domain.createEvent({ ...base, courseName: draft.course })
      return `已添加日程「${draft.title}」`
    }
    domain.createNote({ ...base, content: draft.note || draft.title, courseName: draft.course })
    return '已保存快速笔记'
  }
  return { courses, save }
}
