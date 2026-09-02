import { useDomainCommands } from '../domain/commands.js'

export function useQuickRecordAdapters() {
  const domain = useDomainCommands()
  const { courses } = domain

  function savedResult(message, undo) {
    return {
      message,
      undo,
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
      return savedResult(`已添加「${task.title}」`, () => domain.deleteTask(task.id))
    }
    if (draft.type === 'expense' || draft.type === 'income') {
      const transaction = domain.createTransaction({ ...base, name: draft.title, direction: draft.type, category: draft.category, source: 'quick-record' })
      return savedResult(`已记录${draft.type === 'income' ? '收入' : '支出'}「${draft.title}」`, () => domain.deleteTransaction(transaction.id))
    }
    if (draft.type === 'bill') {
      const bill = domain.createBill({ ...base, name: draft.title, nextDate: draft.date })
      return savedResult(`已添加固定账单「${draft.title}」`, () => domain.deleteBill(bill.id))
    }
    if (draft.type === 'countdown') {
      const milestone = domain.createMilestone({ ...base, name: draft.title, courseName: draft.course, kind: 'countdown' })
      return savedResult(`已添加重要日期「${draft.title}」`, () => domain.deleteMilestone(milestone.id))
    }
    if (draft.type === 'event') {
      const event = domain.createEvent({ ...base, courseName: draft.course })
      return savedResult(`已添加日程「${draft.title}」`, () => domain.deleteEvent(event.id))
    }
    // 笔记与“识别不清”的输入都落到自由笔记，确保用户输入不丢失。
    const note = domain.createNote({ ...base, content: draft.note || draft.title || draft.raw || '', courseName: draft.course })
    return savedResult('已保存快速笔记', () => domain.deleteNote(note.id))
  }

  function convertNote(noteId, targetType) {
    const note = domain.notes.value.find((item) => item.id === noteId)
    if (!note) return { ok: false, error: '笔记不存在或已被删除' }
    const content = String(note.content || note.title || '').trim()
    const title = (note.title || content || '').replace(/\s+/g, ' ').slice(0, 60)
    if (!title) return { ok: false, error: '笔记内容为空，无法转换' }

    if (targetType === 'todo') {
      const task = domain.createTask({ title, note: content, sourceText: content, sourceId: noteId, sourceType: 'note', createdFrom: 'note-organize' })
      domain.updateNote(noteId, { inboxStatus: 'organized', organizedAt: new Date().toISOString() })
      return { ok: true, message: `已转为待办「${task.title}」` }
    }
    if (targetType === 'event') {
      const event = domain.createEvent({ title, note: content, sourceId: noteId, sourceType: 'note', createdFrom: 'note-organize' })
      domain.updateNote(noteId, { inboxStatus: 'organized', organizedAt: new Date().toISOString() })
      return { ok: true, message: `已转为日程「${event.title}」` }
    }
    return { ok: false, error: '暂不支持这个转换类型' }
  }

  return { courses, save, convertNote }
}
