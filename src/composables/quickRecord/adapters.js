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
    // 笔记与“识别不清”的输入都落到自由笔记，确保用户输入不丢失。
    domain.createNote({ ...base, content: draft.note || draft.title || draft.raw || '', courseName: draft.course })
    return '已保存快速笔记'
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
