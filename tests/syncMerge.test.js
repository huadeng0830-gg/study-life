import { describe, expect, it } from 'vitest'
import { buildEntityManifest, hashSyncValue } from '../src/composables/syncMetadata.js'
import { MERGE_STATUS, mergeSyncPayload } from '../src/composables/syncMerge.js'

function task(title, extra = {}) {
  return { id: 'task-1', title, updatedAt: '2026-09-01T00:00:00.000Z', ...extra }
}

function baseFor(values) {
  return buildEntityManifest(values)
}

describe('P2-B Local/Base/Remote 实体合并', () => {
  it('只改本机时保留本机，只有云端改动时采用云端', () => {
    const base = { sl_tasks: [task('基线')] }
    const local = { sl_tasks: [task('本机修改')] }
    const remote = base
    const localOnly = mergeSyncPayload({ baseManifest: baseFor(base), localValues: local, remoteValues: remote, keys: ['sl_tasks'] })
    expect(localOnly.values.sl_tasks[0].title).toBe('本机修改')
    expect(localOnly.statuses.some((item) => item.status === MERGE_STATUS.localOnly)).toBe(true)

    const remoteOnly = mergeSyncPayload({ baseManifest: baseFor(base), localValues: base, remoteValues: { sl_tasks: [task('云端修改')] }, keys: ['sl_tasks'] })
    expect(remoteOnly.values.sl_tasks[0].title).toBe('云端修改')
    expect(remoteOnly.statuses.some((item) => item.status === MERGE_STATUS.remoteOnly)).toBe(true)
  })

  it('双方都改同一实体时不做危险的字段级猜测，而是生成冲突', () => {
    const base = { sl_tasks: [task('基线', { dueDate: '2026-09-10' })] }
    const result = mergeSyncPayload({
      baseManifest: baseFor(base),
      localValues: { sl_tasks: [task('本机标题', { dueDate: '2026-09-11' })] },
      remoteValues: { sl_tasks: [task('云端标题', { dueDate: '2026-09-12' })] },
      keys: ['sl_tasks'],
    })
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].status).toBe(MERGE_STATUS.conflict)
  })

  it('删除与未修改旧版本自动接受删除，删除与更新交叉时必须确认', () => {
    const original = task('基线')
    const tombstone = { entityType: 'Task', entityId: original.id, baseHash: hashSyncValue(original), deletedAt: '2026-09-02T00:00:00.000Z' }
    const deleted = mergeSyncPayload({ baseManifest: baseFor({ sl_tasks: [original] }), localValues: { sl_tasks: [] }, remoteValues: { sl_tasks: [original] }, localTombstones: [tombstone], keys: ['sl_tasks'] })
    expect(deleted.values.sl_tasks).toEqual([])
    expect(deleted.summary.deleted).toBe(1)

    const changed = mergeSyncPayload({ baseManifest: baseFor({ sl_tasks: [original] }), localValues: { sl_tasks: [] }, remoteValues: { sl_tasks: [task('云端新内容')] }, localTombstones: [tombstone], keys: ['sl_tasks'] })
    expect(changed.conflicts[0].status).toBe(MERGE_STATUS.deleteUpdateConflict)
  })

  it('归档是普通实体更新，不等同于删除', () => {
    const base = { sl_tasks: [task('保留记录')] }
    const result = mergeSyncPayload({ baseManifest: baseFor(base), localValues: base, remoteValues: { sl_tasks: [task('保留记录', { archivedAt: '2026-09-02T00:00:00.000Z' })] }, keys: ['sl_tasks'] })
    expect(result.conflicts).toHaveLength(0)
    expect(result.values.sl_tasks[0].archivedAt).toBe('2026-09-02T00:00:00.000Z')
  })

  it('账单交易同一账期的等价重复只保留一个，事实不同则冲突', () => {
    const left = { id: 'ex-a', name: '订阅', amount: 20, direction: 'expense', billId: 'bill-1', billingPeriodKey: '2026-09' }
    const right = { id: 'ex-b', name: '订阅', amount: 20, direction: 'expense', billId: 'bill-1', billingPeriodKey: '2026-09' }
    const merged = mergeSyncPayload({ localValues: { sl_expenses: [left] }, remoteValues: { sl_expenses: [right] }, keys: ['sl_expenses'] })
    expect(merged.values.sl_expenses).toHaveLength(1)
    expect(merged.summary.conflicts).toBe(0)

    const different = mergeSyncPayload({ localValues: { sl_expenses: [left] }, remoteValues: { sl_expenses: [{ ...right, amount: 30 }] }, keys: ['sl_expenses'] })
    expect(different.conflicts.some((item) => item.reason === 'same-bill-period-different-fact')).toBe(true)
  })

  it('课程删除后会清理远端遗留任务关系，保留任务本身', () => {
    const result = mergeSyncPayload({
      localValues: { sl_courses: [] },
      remoteValues: { sl_courses: [], sl_tasks: [{ id: 'task-1', title: '复习', courseId: 'course-old', course: '高等数学' }] },
      keys: ['sl_courses', 'sl_tasks'],
    })
    expect(result.values.sl_tasks[0]).toMatchObject({ id: 'task-1', title: '复习', course: '高等数学', courseId: '' })
    expect(result.summary.repairedRelations).toBe(1)
  })

  it('设置对象在无基线时也不静默覆盖，显式 legacy 才采用旧版云端值', () => {
    const result = mergeSyncPayload({ localValues: { sl_timecfg: { mode: 'local' } }, remoteValues: { sl_timecfg: { mode: 'remote' } }, keys: ['sl_timecfg'] })
    expect(result.conflicts).toHaveLength(1)
    const legacy = mergeSyncPayload({ localValues: { sl_timecfg: { mode: 'local' } }, remoteValues: { sl_timecfg: { mode: 'remote' } }, keys: ['sl_timecfg'], legacy: true })
    expect(legacy.values.sl_timecfg.mode).toBe('remote')
  })
})
