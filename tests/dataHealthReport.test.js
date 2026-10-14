import { describe, expect, it } from 'vitest'
import { buildDataHealthReport, formatDataHealthReportText } from '../src/composables/dataHealthReport.js'

const NOW = '2026-10-14T12:00:00.000Z'

function fictionalSnapshot() {
  return {
    courses: [{ id: 'course-fiction-1', name: '虚构课程甲' }],
    tasks: [
      { id: 'task-fiction-duplicate-a', title: '整理 虚构实验记录', dueDate: '2026-10-20', done: false },
      { id: 'task-fiction-duplicate-b', title: ' 整理  虚构实验记录 ', dueDate: '2026-10-20', done: false },
      { id: 'task-fiction-orphan-course', title: '准备虚构课程展示', courseId: 'course-fiction-missing', dueDate: '2026-10-23' },
      { id: 'task-fiction-stale', title: '核对虚构旧资料', dueDate: '2026-06-01', done: false },
      { id: 'task-fiction-empty-title', title: '  ', dueDate: '2026-11-01' },
      { id: 'task-fiction-complete', title: '已完成的虚构事项', dueDate: '2026-01-01', done: true },
    ],
    events: [
      { id: 'event-fiction-orphan-course', title: '虚构讲座', courseId: 'course-fiction-missing' },
      { id: 'event-fiction-empty-title', title: '' },
    ],
    bills: [{ id: 'bill-fiction-empty-title', name: '  ' }],
    expenses: [
      { id: 'tx-fiction-orphan-category', name: '虚构饮品', amount: 8, cat: 'fiction-missing-category', date: '2026-10-01' },
      { id: 'tx-fiction-orphan-place', name: '虚构文具', amount: 12, cat: 'food', placeId: 'place-fiction-missing' },
      { id: 'tx-fiction-string-amount', name: '虚构异常收支甲', amount: '18', cat: 'food' },
      { id: 'tx-fiction-high-amount', name: '虚构异常收支乙', amount: 100001, cat: 'food' },
    ],
    ledgerCategories: [{ key: 'food', name: '虚构餐饮' }],
    places: [{ id: 'place-fiction-valid', name: '虚构地点' }],
    notices: [
      { id: 'notice-fiction-stale', status: 'new', createdAt: '2026-08-01T09:00:00.000Z', raw: '虚构通知正文' },
      { id: 'notice-fiction-handled', status: 'handled', createdAt: '2026-01-01T09:00:00.000Z', raw: '已处理的虚构通知' },
    ],
    scheduleExceptions: [
      { id: 'exception-fiction-a', date: '2026-10-17', periodStart: 2, periodEnd: 3, type: 'session_off' },
      { id: 'exception-fiction-b', date: '2026-10-17', periodStart: 2, periodEnd: 3, type: 'session_makeup' },
    ],
  }
}

describe('本机数据质量体检扫描器', () => {
  it('逐类报告重复、孤儿关联、异常值、陈旧记录、空标题、旧通知和重复调课', () => {
    const report = buildDataHealthReport(fictionalSnapshot(), { now: NOW })
    const byKind = Object.fromEntries(report.map((item) => [item.kind, item]))

    expect(Object.keys(byKind)).toEqual([
      'duplicate-tasks',
      'orphan-task-course',
      'orphan-event-course',
      'orphan-transaction-category',
      'orphan-transaction-place',
      'anomalous-transaction-amount',
      'stale-tasks',
      'empty-task-title',
      'empty-event-title',
      'empty-bill-title',
      'unhandled-notices',
      'duplicate-schedule-exceptions',
    ])
    expect(byKind['duplicate-tasks']).toMatchObject({ count: 1, sampleIds: ['task-fiction-duplicate-b'], fix: 'merge-or-archive' })
    expect(byKind['orphan-task-course'].sampleIds).toEqual(['task-fiction-orphan-course'])
    expect(byKind['orphan-event-course'].sampleIds).toEqual(['event-fiction-orphan-course'])
    expect(byKind['orphan-transaction-category'].sampleIds).toEqual(['tx-fiction-orphan-category'])
    expect(byKind['orphan-transaction-place'].sampleIds).toEqual(['tx-fiction-orphan-place'])
    expect(byKind['anomalous-transaction-amount']).toMatchObject({ count: 2, severity: 'warning', fix: 'archive' })
    expect(byKind['stale-tasks']).toMatchObject({ count: 1, severity: 'info', sampleIds: ['task-fiction-stale'] })
    expect(byKind['empty-task-title'].sampleIds).toEqual(['task-fiction-empty-title'])
    expect(byKind['empty-event-title'].sampleIds).toEqual(['event-fiction-empty-title'])
    expect(byKind['empty-bill-title'].sampleIds).toEqual(['bill-fiction-empty-title'])
    expect(byKind['unhandled-notices'].sampleIds).toEqual(['notice-fiction-stale'])
    expect(byKind['duplicate-schedule-exceptions'].sampleIds).toEqual(['exception-fiction-b'])
    expect(report.every((item) => Object.keys(item).sort().join(',') === 'count,detail,fix,id,kind,sampleIds,severity,title')).toBe(true)
  })

  it('扫描前后快照逐层相等，不会改写数组、对象或记录字段', () => {
    const snapshot = fictionalSnapshot()
    const before = structuredClone(snapshot)

    buildDataHealthReport(snapshot, { now: NOW })

    expect(snapshot).toEqual(before)
  })

  it('阈值由调用方配置，任务、通知与金额都使用同一组选项', () => {
    const report = buildDataHealthReport(fictionalSnapshot(), {
      now: NOW,
      thresholds: { staleTaskDays: 120, unhandledNoticeDays: 80, maxTransactionAmount: 10 },
    })
    const byKind = Object.fromEntries(report.map((item) => [item.kind, item]))

    expect(byKind['stale-tasks'].sampleIds).toEqual(['task-fiction-stale'])
    expect(byKind['unhandled-notices']).toBeUndefined()
    expect(byKind['anomalous-transaction-amount'].count).toBe(3)
    expect(byKind['anomalous-transaction-amount'].detail).toContain('¥10')
  })

  it('样本编号上限可配置，完整分类计数不受分页样本限制影响', () => {
    const snapshot = fictionalSnapshot()
    snapshot.tasks.push(
      { id: 'task-fiction-duplicate-c', title: '整理 虚构实验记录', dueDate: '2026-10-20', done: false },
      { id: 'task-fiction-duplicate-d', title: '整理 虚构实验记录', dueDate: '2026-10-20', done: false },
    )
    const report = buildDataHealthReport(snapshot, { now: NOW, sampleLimit: 1 })
    const duplicates = report.find((item) => item.kind === 'duplicate-tasks')

    expect(duplicates).toMatchObject({ count: 3, sampleIds: ['task-fiction-duplicate-b'] })
  })

  it('无异常时返回空列表，空或无效分区按空数组处理', () => {
    const report = buildDataHealthReport({ courses: null, tasks: [], expenses: [] }, { now: NOW })
    expect(report).toEqual([])
  })

  it('纯文本导出只含阈值、分类计数与样本编号，不泄露原始记录内容', () => {
    const report = buildDataHealthReport(fictionalSnapshot(), { now: NOW })
    const text = formatDataHealthReportText(report, {
      generatedAt: NOW,
      thresholds: { staleTaskDays: 90, unhandledNoticeDays: 30, maxTransactionAmount: 100000 },
    })

    expect(text).toContain('三两事 · 本机数据体检')
    expect(text).toContain('收支金额异常')
    expect(text).toContain('task-fiction-stale')
    expect(text).not.toContain('虚构通知正文')
    expect(text).not.toContain('虚构饮品')
  })

  it('缺少明确时间时拒绝扫描，避免用隐式系统时间改变结果', () => {
    expect(() => buildDataHealthReport({ tasks: [] })).toThrow('提供有效的 now 时间')
  })
})
