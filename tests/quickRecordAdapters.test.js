// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { useQuickRecordAdapters } from '../src/composables/quickRecord/adapters.js'
import { selectDayAgenda, selectReminders } from '../src/composables/domain/selectors.js'
import { readSyncMetadata } from '../src/composables/syncMetadata.js'

const domain = useDomainCommands()
const quickRecord = useQuickRecordAdapters()

beforeEach(() => {
  domain.tasks.value = []
  domain.courses.value = [{ id: 'course-1', name: '高数' }]
  domain.milestones.value = []
  domain.bills.value = []
  domain.transactions.value = []
  domain.events.value = []
  domain.notes.value = []
})

describe('QuickRecord 业务适配与撤销', () => {
  it.each([
    ['待办', { id: 'qr-todo', type: 'todo', title: '明天拿快递', raw: '明天拿快递', date: '2026-09-03', time: '10:00' }, 'tasks', 'title'],
    ['作业', { id: 'qr-homework', type: 'homework', title: '交高数第三章作业', raw: '周五交高数第三章作业', course: '高数', date: '2026-09-04', time: '18:00' }, 'tasks', 'courseId'],
    ['支出', { id: 'qr-expense', type: 'expense', title: '午饭', raw: '午饭18元', amount: 18, category: 'food', date: '2026-09-02', time: '12:00' }, 'transactions', 'direction'],
    ['收入', { id: 'qr-income', type: 'income', title: '生活费', raw: '生活费到账500', amount: 500, category: 'other', date: '2026-09-02', time: '09:00' }, 'transactions', 'direction'],
    ['日程', { id: 'qr-event', type: 'event', title: '开组会', raw: '明天下午三点开组会', date: '2026-09-03', time: '15:00' }, 'events', 'title'],
    ['笔记', { id: 'qr-note', type: 'note', title: '', note: '下次实验降低浓度', raw: '记一下：下次实验降低浓度' }, 'notes', 'content'],
    ['倒计时', { id: 'qr-countdown', type: 'countdown', title: '六级考试', raw: '距离六级考试还有90天', date: '2026-12-01' }, 'milestones', 'kind'],
    ['固定账单', { id: 'qr-bill', type: 'bill', title: '话费', raw: '每月15号39元话费', amount: 39, date: '2026-09-15', cycle: 'monthly' }, 'bills', 'cycle'],
  ])('%s 写入真实业务集合并可撤销', (_label, draft, collectionName, field) => {
    const result = quickRecord.save(draft)
    const collection = domain[collectionName].value
    expect(collection).toHaveLength(1)
    const expected = field === 'direction' ? draft.type : field === 'courseId' ? 'course-1' : field === 'content' ? draft.note : field === 'kind' ? 'countdown' : draft[field]
    expect(collection[0][field]).toBe(expected)
    expect(collection[0].createdFrom).toBe('quick-record')
    expect(collection[0].sourceId).toBe('')
    expect(collection[0].sourceType).toBe('')
    expect(domain.notes.value.some((item) => item.id === 'quick-records')).toBe(false)

    result.undo()
    expect(domain[collectionName].value).toHaveLength(0)
  })

  it('作业写入任务后由课程、首页和近期提醒读取同一条数据', () => {
    const result = quickRecord.save({
      id: 'qr-course-task', type: 'homework', title: '交高数第三章作业', raw: '周五18点交高数第三章作业',
      course: '高数', date: '2026-09-04', time: '18:00', priority: 'normal', note: '',
    })
    const task = domain.tasks.value[0]
    expect(task.courseId).toBe('course-1')
    expect(selectDayAgenda({ courses: [], tasks: domain.tasks.value }, new Date('2026-09-04T10:00:00')).map((item) => item.sourceId)).toContain(task.id)
    expect(selectReminders({ tasks: domain.tasks.value }, new Date('2026-09-02T10:00:00')).map((item) => item.sourceId)).toContain(task.id)
    result.undo()
    expect(selectReminders({ tasks: domain.tasks.value }, new Date('2026-09-02T10:00:00'))).toHaveLength(0)
  })

  it('收入进入收入统计方向，不计入支出日统计', () => {
    const result = quickRecord.save({ id: 'qr-income-stat', type: 'income', title: '生活费', raw: '生活费到账500', amount: 500, category: 'other', date: '2026-09-02', time: '09:00' })
    expect(domain.transactions.value[0].direction).toBe('income')
    result.undo()
    expect(domain.transactions.value).toHaveLength(0)
  })

  it('固定账单保存本身不重复创建交易，支付一次只推进一个周期', () => {
    quickRecord.save({ id: 'qr-bill-flow', type: 'bill', title: '话费', raw: '每月15号39元话费', amount: 39, date: '2026-09-15', cycle: 'monthly' })
    const bill = domain.bills.value[0]
    expect(domain.transactions.value).toHaveLength(0)
    const first = domain.payBill(bill.id)
    const second = domain.payBill(bill.id)
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(false)
    expect(domain.transactions.value).toHaveLength(2)
    expect(domain.transactions.value.every((item) => item.billId === bill.id)).toBe(true)
  })

  it('同一账单计费周期的重复支付不会创建第二条交易，历史交易不随账单更新改变', () => {
    quickRecord.save({ id: 'qr-bill-idempotent', type: 'bill', title: '话费', raw: '每月15号39元话费', amount: 39, date: '2026-09-15', cycle: 'monthly' })
    const bill = domain.bills.value[0]
    const first = domain.payBill(bill.id)
    const originalAmount = domain.transactions.value[0].amount
    bill.nextDate = first.transaction.billingPeriodKey
    const second = domain.payBill(bill.id)

    expect(second.duplicate).toBe(true)
    expect(domain.transactions.value).toHaveLength(1)
    domain.updateBill(bill.id, { amount: 99, nextDate: '2026-10-15' })
    expect(domain.transactions.value[0].amount).toBe(originalAmount)
  })

  it('撤销已支付的快速账单时保留交易并解除对已删除 Bill 的引用', () => {
    const result = quickRecord.save({ id: 'qr-bill-undo', type: 'bill', title: '话费', raw: '每月15号39元话费', amount: 39, date: '2026-09-15', cycle: 'monthly' })
    const bill = domain.bills.value[0]
    const paid = domain.payBill(bill.id)

    expect(paid.transaction).toMatchObject({
      billId: bill.id,
      billingPeriodKey: '2026-09-15',
      sourceType: 'bill',
      sourceId: bill.id,
      source: 'bill',
      createdFrom: 'bill',
    })

    result.undo()

    expect(domain.bills.value).toHaveLength(0)
    expect(domain.transactions.value).toHaveLength(1)
    expect(domain.transactions.value[0]).toMatchObject({
      billId: '',
      billingPeriodKey: '',
      sourceType: '',
      sourceId: '',
      source: 'bill',
      createdFrom: 'bill',
    })
  })

  it('手动删除固定账单时同样不删除历史交易或留下账单引用', () => {
    quickRecord.save({ id: 'qr-bill-delete', type: 'bill', title: '话费', raw: '每月15号39元话费', amount: 39, date: '2026-09-15', cycle: 'monthly' })
    const bill = domain.bills.value[0]
    domain.payBill(bill.id)

    expect(domain.deleteBill(bill.id)).toEqual(expect.objectContaining({ id: bill.id }))
    expect(domain.transactions.value).toHaveLength(1)
    expect(domain.transactions.value[0].billId).toBe('')
    expect(domain.transactions.value[0].sourceId).toBe('')
  })

  it('同一批保存的多个结果可合并撤销', () => {
    const results = [
      quickRecord.save({ id: 'qr-batch-a', type: 'expense', title: '早餐', raw: '早餐6', amount: 6 }),
      quickRecord.save({ id: 'qr-batch-b', type: 'todo', title: '拿快递', raw: '拿快递' }),
    ]
    expect(domain.transactions.value).toHaveLength(1)
    expect(domain.tasks.value).toHaveLength(1)
    results.forEach((result) => result.undo())
    expect(domain.transactions.value).toHaveLength(0)
    expect(domain.tasks.value).toHaveLength(0)
  })

  it('删除任务和倒计时通过领域命令保持关联边界', () => {
    const task = domain.createTask({ id: 'task-delete', title: '交作业', courseId: 'course-1', sourceType: 'milestone-review', sourceId: 'exam-1' })
    domain.createMilestone({ id: 'exam-1', name: '期中考试', date: '2026-09-20', courseId: 'course-1' })
    expect(domain.deleteMilestone('exam-1')).toMatchObject({ id: 'exam-1' })
    expect(domain.tasks.value[0]).toMatchObject({ id: task.id, sourceType: '', sourceId: '', relationId: '' })
    expect(domain.deleteTask(task.id)).toMatchObject({ id: task.id })
    expect(domain.tasks.value).toHaveLength(0)
  })


  it('普通交易删除和撤销都通过领域命令并正确处理墓碑', () => {
    const transaction = domain.createTransaction({ id: 'tx-delete', name: '午饭', amount: 18 })
    const deleted = domain.deleteTransaction(transaction.id)
    expect(deleted).toMatchObject({ id: transaction.id })
    expect(domain.transactions.value).toHaveLength(0)
    expect(readSyncMetadata().tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'Transaction', entityId: transaction.id }),
    ]))

    const restored = domain.restoreDeletedTransaction(transaction)
    expect(restored).toMatchObject({ id: transaction.id, name: '午饭' })
    expect(domain.transactions.value).toHaveLength(1)
    expect(readSyncMetadata().tombstones.some((item) => item.entityType === 'Transaction' && item.entityId === transaction.id)).toBe(false)
    expect(restored.updatedAt).not.toBe(transaction.createdAt)
  })

  it('固定账单支付记录不能被普通删除，撤销支付会恢复账单周期', () => {
    const bill = domain.createBill({ id: 'bill-payment', name: '话费', amount: 39, nextDate: '2026-09-15' })
    const paid = domain.payBill(bill.id)
    expect(domain.deleteTransaction(paid.transaction.id)).toMatchObject({ blocked: true })
    expect(domain.transactions.value).toHaveLength(1)

    expect(domain.undoBillPayment(paid.transaction.id)).toMatchObject({ id: paid.transaction.id })
    expect(domain.transactions.value).toHaveLength(0)
    expect(domain.bills.value[0].nextDate).toBe('2026-09-15')
  })

  it('恢复 Milestone 会恢复即时删除前的复习任务关系', () => {
    const task = domain.createTask({ id: 'milestone-task', title: '复习', sourceType: 'milestone-review', sourceId: 'milestone-restore' })
    const milestone = domain.createMilestone({ id: 'milestone-restore', name: '期中考试', date: '2026-09-20' })
    domain.deleteMilestone(milestone.id)
    expect(domain.tasks.value[0].sourceId).toBe('')
    domain.restoreDeletedMilestone(milestone)
    expect(domain.tasks.value.find((item) => item.id === task.id)).toMatchObject({ sourceType: 'milestone-review', sourceId: milestone.id })
  })

  it('课程复制命令生成独立 ID 且不继承墓碑和同步元数据', () => {
    const original = { id: 'course-original', name: '高数', day: 1, start: 2, end: 3, revision: 9, tombstone: { deleted: true } }
    const copy = domain.createCourse({ ...original, createdFrom: 'course-duplicate' })
    expect(copy.id).not.toBe(original.id)
    expect(copy).toMatchObject({ name: original.name, day: original.day, start: original.start, createdFrom: 'course-duplicate' })
    expect(copy.revision).toBeUndefined()
    expect(copy.tombstone).toBeUndefined()
  })

  it('Focus 统计和完成状态通过统一任务命令更新 revision 时间', () => {
    const task = domain.createTask({ id: 'focus-task', title: '专注任务' })
    const before = task.updatedAt
    domain.recordTaskFocusSession(task.id, { actualFocusSeconds: 1500, endedAt: '2026-09-02T10:00:00.000Z' })
    expect(task).toMatchObject({ focusCount: 1, focusTotalSeconds: 1500, lastFocusedAt: '2026-09-02T10:00:00.000Z' })
    expect(task.updatedAt).not.toBe(before)
    domain.completeTask(task.id)
    expect(task).toMatchObject({ done: true, status: 'completed' })
  })

  it('删除课程只解除关联并保留其他实体', () => {
    const task = domain.createTask({ id: 'task-course-delete', title: '课程作业', courseId: 'course-1' })
    domain.createMilestone({ id: 'exam-course-delete', name: '考试', date: '2026-09-20', courseId: 'course-1' })
    domain.createEvent({ id: 'event-course-delete', title: '课程提醒', date: '2026-09-10', courseId: 'course-1' })
    domain.createNote({ id: 'note-course-delete', content: '课程笔记', courseId: 'course-1' })

    expect(domain.deleteCourse('course-1')).toMatchObject({ id: 'course-1' })
    expect(domain.tasks.value[0]).toMatchObject({ id: task.id, courseId: '', course: '高数' })
    expect(domain.milestones.value[0].courseName).toBe('高数')
    expect(domain.events.value[0].courseName).toBe('高数')
    expect(domain.notes.value[0].courseName).toBe('高数')
  })

  it('Note 转待办保留原文，删除 Note 后只解除来源关系', () => {
    const note = domain.createNote({ id: 'note-source', content: '老师说周五前交实验报告' })
    const result = quickRecord.convertNote(note.id, 'todo')
    const task = domain.tasks.value[0]

    expect(result.ok).toBe(true)
    expect(domain.notes.value[0]).toMatchObject({ id: note.id, inboxStatus: 'organized', content: note.content })
    expect(task).toMatchObject({ sourceType: 'note', sourceId: note.id })

    expect(domain.deleteNote(note.id)).toMatchObject({ id: note.id })
    expect(domain.tasks.value[0]).toMatchObject({ sourceType: '', sourceId: '', relationId: '' })
  })
})
