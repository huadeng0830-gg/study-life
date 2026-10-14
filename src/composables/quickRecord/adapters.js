import { useDomainCommands } from '../domain/commands.js'
import { addPlaceVisit, places, removePlaceVisit, removePlaceVisitsForTransaction, updatePlace } from '../placeBook.js'

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
      const place = draft.type === 'expense' && draft.placeId
        ? places.value.find((item) => String(item.id) === String(draft.placeId) && !item.archivedAt)
        : null
      const previousScores = place ? { ...place.scores } : null
      const transaction = domain.createTransaction({ ...base, name: draft.title, direction: draft.type, category: draft.category, source: 'quick-record' })
      let visit = null
      let scoreStateAfterVisit = null
      if (place) {
        try {
          visit = addPlaceVisit(place.id, {
            visitedAt: transaction.date,
            price: transaction.amount,
            scores: { ...place.scores, value: draft.placeValue || place.scores?.value || 'mixed' },
            transactionId: transaction.id,
          })
          scoreStateAfterVisit = places.value.find((item) => String(item.id) === String(place.id))?.scores || null
        } catch (error) {
          const rollbackErrors = []
          try {
            if (removePlaceVisitsForTransaction(transaction.id).length) updatePlace(place.id, { scores: previousScores })
          } catch { rollbackErrors.push('地点到访没有撤回') }
          try {
            const deleted = domain.deleteTransaction(transaction.id)
            if (!deleted || deleted.blocked) rollbackErrors.push('账本记录没有撤回')
          } catch { rollbackErrors.push('账本记录没有撤回') }
          if (rollbackErrors.length) throw new Error(`${error?.message || '地点关联没有保存成功'}；${rollbackErrors.join('、')}，请检查本机地点和账本。`)
          throw error
        }
      }
      return savedResult(`${draft.type === 'income' ? '已记录并记入收入' : '已记录并记入账本'} · ¥${Number(transaction.amount).toFixed(2)}`, () => {
        const deleted = domain.deleteTransaction(transaction.id)
        if (deleted && !deleted.blocked && visit) {
          removePlaceVisit(visit.id)
          const latest = places.value.find((item) => String(item.id) === String(place.id))
          if (latest && latest.scores === scoreStateAfterVisit) updatePlace(latest.id, { scores: previousScores })
        }
        return deleted
      }, 'transaction', transaction.id)
    }
    if (draft.type === 'bill') {
      const bill = domain.createBill({ ...base, name: draft.title, nextDate: draft.date })
      return savedResult(`已添加固定账单「${draft.title}」`, () => domain.deleteBill(bill.id), 'bill', bill.id)
    }
    if (draft.type === 'countdown') {
      const milestone = domain.createMilestone({ ...base, name: draft.title, courseName: draft.course, kind: 'countdown' })
      return savedResult(`已添加重要日期「${draft.title}」`, () => domain.deleteMilestone(milestone.id), 'milestone', milestone.id)
    }
    if (draft.type === 'externalExam') {
      const registrationOnly = Boolean(draft.registerDeadline)
      const milestone = domain.createMilestone({
        ...base,
        name: draft.title,
        kind: 'externalExam',
        category: '校外考试',
        date: draft.date,
        time: draft.time,
        registerStart: draft.registerStart || '',
        registerDeadline: registrationOnly ? draft.date : draft.registerDeadline || '',
        examDate: registrationOnly ? '' : draft.date || draft.examDate || '',
        examTime: registrationOnly ? '' : draft.time || draft.examTime || '',
        venue: draft.venue || draft.location || '',
        campus: draft.campus || '',
        seatNo: draft.seatNo || '',
        admissionNo: draft.admissionNo || '',
        ...(Array.isArray(draft.requiredItems) ? { requiredItems: draft.requiredItems } : {}),
      })
      return savedResult(`已添加校外考试「${draft.title}」`, () => domain.deleteMilestone(milestone.id), 'milestone', milestone.id)
    }
    if (draft.type === 'event') {
      const event = domain.createEvent({ ...base, courseName: draft.course })
      return savedResult(`已添加日程「${draft.title}」`, () => domain.deleteEvent(event.id), 'event', event.id)
    }
    throw new Error('无法识别记录类型，请先选择待办、日程、账目或重要日期。')
  }

  return { courses, save }
}
