// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreStoredValues } from '../src/composables/store/index.js'
import { mergeSyncPayload } from '../src/composables/syncMerge.js'
import { buildSyncManifest, validateStableEntityIds, validateSyncManifest } from '../src/composables/syncMetadata.js'
import { createSyncSandbox } from './helpers/syncSandbox.js'

function task(id, title = id, updatedAt = '2026-09-01T00:00:00.000Z', extra = {}) {
  return { id, title, status: 'pending', updatedAt, ...extra }
}

function baseValues() {
  return { sl_tasks: [task('t1', '基线任务')] }
}

describe('P2-B.5 isolated sync sandbox', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('uses a unique namespace and prevents tombstone resurrection across repeated A/B cycles', () => {
    const sandbox = createSyncSandbox({ initialValues: baseValues() })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')

    sandbox.deleteEntity(a, 'sl_tasks', 'Task', 't1')
    expect(sandbox.tryPush(a)).toMatchObject({ ok: true, revision: 2 })
    expect(b.local.sl_tasks).toHaveLength(1)

    expect(sandbox.pull(b)).toMatchObject({ ok: true, summary: { deleted: 1 } })
    expect(b.local.sl_tasks).toHaveLength(0)
    expect(b.tombstones).toHaveLength(1)
    expect(sandbox.tryPush(b)).toMatchObject({ ok: true, revision: 3 })

    for (let index = 0; index < 4; index++) {
      expect(sandbox.pull(a).ok).toBe(true)
      expect(sandbox.pull(b).ok).toBe(true)
      expect(a.local.sl_tasks).toHaveLength(0)
      expect(b.local.sl_tasks).toHaveLength(0)
    }
    expect(sandbox.namespace).toMatch(/^sync-test-/)
    expect(sandbox.remoteSnapshot().envelope.manifest.tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'Task', entityId: 't1' }),
    ]))
  })

  it('完成 A→B→A 往返后保留删除因果与后续修改，并隔离另一个空间', () => {
    const spaceA = createSyncSandbox({
      namespace: 'sync-test-roundtrip-a',
      initialValues: { sl_tasks: [task('t1', '待删除'), task('t2', '待修改')] },
    })
    const spaceB = createSyncSandbox({
      namespace: 'sync-test-roundtrip-b',
      initialValues: { sl_tasks: [task('t1', '另一空间任务')] },
    })
    spaceA.seed()
    spaceB.seed()
    const deviceA = spaceA.device('Device A')
    const deviceB = spaceA.device('Device B')

    spaceA.deleteEntity(deviceA, 'sl_tasks', 'Task', 't1')
    expect(spaceA.tryPush(deviceA)).toMatchObject({ ok: true, revision: 2 })
    expect(spaceA.pull(deviceB)).toMatchObject({ ok: true, summary: { deleted: 1 } })
    spaceA.edit(deviceB, 'sl_tasks', 't2', { title: 'B 修改后', updatedAt: '2026-09-03T00:00:00.000Z' })
    expect(spaceA.tryPush(deviceB)).toMatchObject({ ok: true, revision: 3 })

    expect(spaceA.pull(deviceA)).toMatchObject({ ok: true })
    expect(deviceA.local.sl_tasks).toEqual([expect.objectContaining({ id: 't2', title: 'B 修改后' })])
    expect(deviceA.tombstones).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'Task', entityId: 't1' })]))
    expect(spaceB.remote.revision).toBe(1)
    expect(spaceB.remoteSnapshot().envelope.values.sl_tasks[0]).toMatchObject({ id: 't1', title: '另一空间任务' })
  })

  it('综合 Phone/PC 流程：初始合并、双改、删除冲突恢复、撤销与重新配对均不丢数据', () => {
    const phoneTask = task('phone-task', 'Phone P')
    const pcTask = task('pc-task', 'PC R')
    const sandbox = createSyncSandbox({ initialValues: { sl_tasks: [pcTask] } })
    sandbox.seed()
    const phone = sandbox.device('Phone', { sl_tasks: [phoneTask] })
    const pc = sandbox.device('PC', { sl_tasks: [pcTask] })

    // Pair/Recovery 后没有可信 Base：首次 pull 必须做 Initial Merge。
    phone.baseManifest = null
    expect(sandbox.pull(phone).ok).toBe(true)
    expect(phone.local.sl_tasks.map((item) => item.id)).toEqual(expect.arrayContaining(['phone-task', 'pc-task']))

    sandbox.edit(phone, 'sl_tasks', 'phone-task', { title: 'Phone 修改 P' })
    expect(sandbox.tryPush(phone).ok).toBe(true)
    expect(sandbox.pull(pc).ok).toBe(true)
    sandbox.edit(pc, 'sl_tasks', 'pc-task', { title: 'PC 修改 R' })
    expect(sandbox.tryPush(pc).ok).toBe(true)
    expect(sandbox.pull(phone).ok).toBe(true)
    expect(phone.local.sl_tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'phone-task', title: 'Phone 修改 P' }),
      expect.objectContaining({ id: 'pc-task', title: 'PC 修改 R' }),
    ]))

    sandbox.deleteEntity(phone, 'sl_tasks', 'Task', 'phone-task')
    expect(sandbox.tryPush(phone).ok).toBe(true)
    sandbox.edit(pc, 'sl_tasks', 'phone-task', { title: 'PC 离线修改 P' })
    expect(sandbox.tryPush(pc).ok).toBe(false)
    const conflict = sandbox.pull(pc)
    expect(conflict.conflicts[0].status).toBe('delete-update-conflict')
    expect(sandbox.resolve(pc, conflict, { 'sl_tasks:phone-task': 'local' }).ok).toBe(true)
    expect(sandbox.tryPush(pc).ok).toBe(true)
    expect(sandbox.pull(phone).ok).toBe(true)
    expect(phone.local.sl_tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'phone-task', title: 'PC 离线修改 P' }),
      expect.objectContaining({ id: 'pc-task', title: 'PC 修改 R' }),
    ]))
    expect(phone.tombstones).toHaveLength(0)

    sandbox.revoke(phone)
    expect(sandbox.tryPush(phone)).toMatchObject({ ok: false, status: 401 })
    sandbox.rebind(phone)
    expect(sandbox.pull(phone).ok).toBe(true)
    expect(phone.local.sl_tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'phone-task', title: 'PC 离线修改 P' }),
      expect.objectContaining({ id: 'pc-task', title: 'PC 修改 R' }),
    ]))
  })

  it('requires a decision for delete-vs-update and supports both deletion and explicit restoration', () => {
    for (const [decision, expectedCount] of [['remote', 0], ['local', 1]]) {
      const sandbox = createSyncSandbox({ initialValues: baseValues() })
      sandbox.seed()
      const a = sandbox.device('Device A')
      const b = sandbox.device('Device B')
      sandbox.deleteEntity(a, 'sl_tasks', 'Task', 't1')
      sandbox.tryPush(a)
      sandbox.edit(b, 'sl_tasks', 't1', { title: '离线修改', updatedAt: '2026-09-03T00:00:00.000Z' })

      const preview = sandbox.pull(b)
      expect(preview.ok).toBe(false)
      expect(preview.conflicts[0].status).toBe('delete-update-conflict')
      expect(b.local.sl_tasks[0].title).toBe('离线修改')
      expect(sandbox.resolve(b, preview, { 'sl_tasks:t1': decision })).toMatchObject({ ok: true })
      expect(b.local.sl_tasks).toHaveLength(expectedCount)

      if (expectedCount === 1) {
        expect(b.tombstones).toHaveLength(0)
        expect(sandbox.tryPush(b).ok).toBe(true)
        expect(sandbox.pull(a).ok).toBe(true)
        expect(a.local.sl_tasks[0].title).toBe('离线修改')
      }
    }
  })

  it('lets a newer explicit restoration supersede an old tombstone without resurrecting stale data', () => {
    const sandbox = createSyncSandbox({ initialValues: baseValues() })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')
    sandbox.deleteEntity(a, 'sl_tasks', 'Task', 't1')
    sandbox.tryPush(a)
    sandbox.edit(b, 'sl_tasks', 't1', { title: '恢复后的任务', updatedAt: '2026-09-03T00:00:00.000Z' })
    const preview = sandbox.pull(b)
    sandbox.resolve(b, preview, { 'sl_tasks:t1': 'local' })
    sandbox.tryPush(b)

    expect(sandbox.pull(a)).toMatchObject({ ok: true })
    expect(a.local.sl_tasks).toEqual([expect.objectContaining({ id: 't1', title: '恢复后的任务' })])
    expect(a.tombstones).toHaveLength(0)
  })

  it('preserves related facts while clearing deleted Course, Note, Milestone, and Bill references', () => {
    const initial = {
      sl_courses: [{ id: 'c1', name: '课程', updatedAt: '2026-09-01T00:00:00.000Z' }],
      sl_quick_notes: [{ id: 'n1', title: '笔记', content: '内容', updatedAt: '2026-09-01T00:00:00.000Z' }],
      sl_exams: [{ id: 'm1', name: '复习', date: '2026-09-10', updatedAt: '2026-09-01T00:00:00.000Z' }],
      sl_bills: [{ id: 'b1', name: '账单', amount: 39, updatedAt: '2026-09-01T00:00:00.000Z' }],
      sl_tasks: [task('t-course', '课程任务', '2026-09-01T00:00:00.000Z', { courseId: 'c1', course: '课程' }), task('t-note', '笔记任务', '2026-09-01T00:00:00.000Z', { sourceType: 'note', sourceId: 'n1', relationId: 'note:n1' }), task('t-milestone', '复习任务', '2026-09-01T00:00:00.000Z', { sourceType: 'milestone-review', sourceId: 'm1', relationId: 'milestone:m1' })],
      sl_events: [{ id: 'e1', title: '课程提醒', courseId: 'c1', courseName: '课程', updatedAt: '2026-09-01T00:00:00.000Z' }],
      sl_expenses: [{ id: 'x1', name: '历史账单', amount: 39, billId: 'b1', billingPeriodKey: '2026-08', sourceType: 'bill', sourceId: 'b1', relationId: 'bill:b1', updatedAt: '2026-09-01T00:00:00.000Z' }],
    }
    const sandbox = createSyncSandbox({ initialValues: initial })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')
    sandbox.deleteEntity(a, 'sl_courses', 'Course', 'c1')
    sandbox.deleteEntity(a, 'sl_quick_notes', 'Note', 'n1')
    sandbox.deleteEntity(a, 'sl_exams', 'Milestone', 'm1')
    sandbox.deleteEntity(a, 'sl_bills', 'Bill', 'b1')
    expect(sandbox.tryPush(a).ok).toBe(true)
    const pull = sandbox.pull(b)
    expect(pull.ok).toBe(true)
    expect(b.local.sl_courses).toHaveLength(0)
    expect(b.local.sl_quick_notes).toHaveLength(0)
    expect(b.local.sl_exams).toHaveLength(0)
    expect(b.local.sl_bills).toHaveLength(0)
    expect(b.local.sl_tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 't-course', courseId: '' }),
      expect.objectContaining({ id: 't-note', sourceType: '', sourceId: '', relationId: '' }),
      expect.objectContaining({ id: 't-milestone', sourceType: '', sourceId: '', relationId: '' }),
    ]))
    expect(b.local.sl_events[0].courseId).toBe('')
    expect(b.local.sl_expenses[0]).toMatchObject({ billId: '', billingPeriodKey: '', sourceId: '', relationId: '' })
    expect(sandbox.integrity(b)).toEqual([])
  })

  it('keeps archive distinct from delete and reports the real conflict', () => {
    const sandbox = createSyncSandbox({ initialValues: { sl_courses: [{ id: 'c1', name: '课程', updatedAt: '2026-09-01T00:00:00.000Z' }] } })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')
    sandbox.edit(a, 'sl_courses', 'c1', { archivedAt: '2026-09-02T01:00:00.000Z', updatedAt: '2026-09-02T01:00:00.000Z' })
    sandbox.deleteEntity(b, 'sl_courses', 'Course', 'c1')
    sandbox.tryPush(b)
    const result = sandbox.pull(a)
    expect(result.ok).toBe(false)
    expect(result.conflicts[0].status).toBe('delete-update-conflict')
    expect(a.local.sl_courses[0].archivedAt).toBe('2026-09-02T01:00:00.000Z')
  })

  it('deduplicates only equivalent Bill-period payments and preserves ordinary equal-amount transactions', () => {
    const bill = { id: 'b1', name: '订阅', amount: 39, nextDate: '2026-09-15', updatedAt: '2026-09-01T00:00:00.000Z' }
    const sandbox = createSyncSandbox({ initialValues: { sl_bills: [bill], sl_expenses: [] } })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')
    a.local.sl_expenses = [{ id: 'tx-a', name: '订阅', amount: 39, direction: 'expense', billId: 'b1', billingPeriodKey: '2026-09', updatedAt: '2026-09-02T01:00:00.000Z' }, { id: 'lunch', name: '午饭', amount: 18, direction: 'expense', updatedAt: '2026-09-02T01:00:00.000Z' }]
    b.local.sl_expenses = [{ id: 'tx-b', name: '订阅', amount: 39, direction: 'expense', billId: 'b1', billingPeriodKey: '2026-09', updatedAt: '2026-09-02T02:00:00.000Z' }, { id: 'dinner', name: '晚饭', amount: 18, direction: 'expense', updatedAt: '2026-09-02T02:00:00.000Z' }]
    a.dirty = true
    b.dirty = true
    expect(sandbox.tryPush(a).ok).toBe(true)
    expect(sandbox.pull(b).ok).toBe(true)
    expect(b.local.sl_expenses.filter((item) => item.billId === 'b1' && item.billingPeriodKey === '2026-09')).toHaveLength(1)
    expect(b.local.sl_expenses.map((item) => item.id)).toEqual(expect.arrayContaining(['lunch', 'dinner']))
    const duplicate = b.local.sl_expenses.find((item) => item.billId === 'b1')
    expect(duplicate.id).toBe('tx-a')
    expect(sandbox.integrity(b)).toEqual([])

    const different = mergeSyncPayload({
      localValues: { sl_expenses: [{ id: 'p1', name: '订阅', amount: 39, direction: 'expense', billId: 'b1', billingPeriodKey: '2026-09' }] },
      remoteValues: { sl_expenses: [{ id: 'p2', name: '订阅', amount: 40, direction: 'expense', billId: 'b1', billingPeriodKey: '2026-09' }] },
      keys: ['sl_expenses'],
    })
    expect(different.conflicts.some((item) => item.reason === 'same-bill-period-different-fact')).toBe(true)
  })

  it('accepts exactly one concurrent CAS winner and keeps revisions monotonic under repeated contention', () => {
    const sandbox = createSyncSandbox({ initialValues: { sl_tasks: [task('t1'), task('t2')] } })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')
    for (let round = 0; round < 25; round++) {
      sandbox.edit(a, 'sl_tasks', 't1', { title: `A-${round}`, updatedAt: `2026-09-02T00:${String(round).padStart(2, '0')}:00.000Z` })
      sandbox.edit(b, 'sl_tasks', 't2', { title: `B-${round}`, updatedAt: `2026-09-02T00:${String(round).padStart(2, '0')}:30.000Z` })
      const first = sandbox.tryPush(a)
      const second = sandbox.tryPush(b)
      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
      const loser = first.ok ? b : a
      const winnerRevision = sandbox.remote.revision
      expect(sandbox.pull(loser).ok).toBe(true)
      expect(loser.baseRevision).toBe(winnerRevision)
      expect(sandbox.tryPush(loser).ok).toBe(true)
      expect(sandbox.remote.revision).toBeGreaterThan(winnerRevision)
    }
    expect(sandbox.remote.revision).toBe(51)
    expect(validateStableEntityIds(sandbox.remote.envelope.values)).toEqual([])
  })

  it('aborts interrupted, malformed, invalid, and manifest-inconsistent pulls without changing local/base', () => {
    const sandbox = createSyncSandbox({ initialValues: baseValues() })
    sandbox.seed()
    const b = sandbox.device('Device B')
    const before = JSON.stringify({ local: b.local, base: b.baseManifest, revision: b.baseRevision })
    expect(sandbox.pull(b, { networkError: true })).toMatchObject({ ok: false, unchanged: true })
    expect(JSON.stringify({ local: b.local, base: b.baseManifest, revision: b.baseRevision })).toBe(before)

    for (const envelope of [
      '{broken',
      { format: 'study-life-sync', version: 3, values: { sl_tasks: 'not-an-array' }, manifest: {} },
      { format: 'study-life-sync', version: 3, values: { sl_tasks: [{ title: 'missing-id' }] }, manifest: buildSyncManifest({ sl_tasks: [{ title: 'missing-id' }] }) },
      { format: 'study-life-sync', version: 3, values: { sl_tasks: [task('duplicate'), task('duplicate', 'again')] }, manifest: buildSyncManifest({ sl_tasks: [task('duplicate')] }) },
    ]) {
      sandbox.remote.envelope = envelope
      const result = sandbox.pull(b)
      expect(result.ok).toBe(false)
      expect(result.unchanged).toBe(true)
      expect(JSON.stringify({ local: b.local, base: b.baseManifest, revision: b.baseRevision })).toBe(before)
    }
  })

  it('rolls back an injected commit failure and leaves all collections at lastKnownGood', () => {
    const sandbox = createSyncSandbox({ initialValues: { sl_tasks: [task('t1')], sl_courses: [{ id: 'c1', name: '旧课程' }] } })
    sandbox.seed({ sl_tasks: [task('t1', '新任务')], sl_courses: [{ id: 'c1', name: '新课程' }] })
    const b = sandbox.device('Device B', { sl_tasks: [task('t1')], sl_courses: [{ id: 'c1', name: '旧课程' }] })
    const before = JSON.stringify(b.local)
    expect(sandbox.pull(b, { commitFailureAt: 1 })).toMatchObject({ ok: false, rollback: true, unchanged: true })
    expect(JSON.stringify(b.local)).toBe(before)
    expect(sandbox.pull(b).ok).toBe(true)
    expect(b.local.sl_tasks[0].title).toBe('新任务')
    expect(b.local.sl_courses[0].name).toBe('新课程')
  })

  it('keeps repeated pulls idempotent, validates preview counts, and maintains stable IDs at scale', () => {
    const values = {
      sl_tasks: Array.from({ length: 100 }, (_, index) => task(`task-${index}`, `任务 ${index}`)),
      sl_quick_notes: Array.from({ length: 20 }, (_, index) => ({ id: `note-${index}`, title: `笔记 ${index}`, content: '内容' })),
      sl_events: Array.from({ length: 20 }, (_, index) => ({ id: `event-${index}`, title: `日程 ${index}` })),
      sl_bills: Array.from({ length: 10 }, (_, index) => ({ id: `bill-${index}`, name: `账单 ${index}`, amount: index + 1, nextDate: '2026-09-15' })),
      sl_expenses: Array.from({ length: 100 }, (_, index) => ({ id: `tx-${index}`, name: `交易 ${index}`, amount: index + 1 })),
    }
    const sandbox = createSyncSandbox({ initialValues: values })
    sandbox.seed()
    const b = sandbox.device('Device B')
    for (let index = 0; index < 5; index++) {
      const result = sandbox.pull(b)
      expect(result.summary).toMatchObject({ added: 0, updated: 0, deleted: 0, conflicts: 0 })
    }
    expect(validateStableEntityIds(b.local)).toEqual([])
    expect(b.local.sl_tasks).toHaveLength(100)
    expect(new Set(b.local.sl_tasks.map((item) => item.id)).size).toBe(100)
    expect(validateSyncManifest(sandbox.remote.envelope.values, sandbox.remote.envelope.manifest)).toEqual([])
  })

  it('keeps 25 deleted entities deleted through pressure rounds and records zero dangling relations', () => {
    const sandbox = createSyncSandbox({ initialValues: { sl_tasks: Array.from({ length: 30 }, (_, index) => task(`t-${index}`)) } })
    sandbox.seed()
    const a = sandbox.device('Device A')
    const b = sandbox.device('Device B')
    for (let index = 0; index < 25; index++) sandbox.deleteEntity(a, 'sl_tasks', 'Task', `t-${index}`)
    sandbox.tryPush(a)
    expect(sandbox.pull(b).ok).toBe(true)
    for (let round = 0; round < 3; round++) {
      expect(sandbox.tryPush(b).ok).toBe(true)
      expect(sandbox.pull(a).ok).toBe(true)
      expect(sandbox.pull(b).ok).toBe(true)
    }
    expect(b.local.sl_tasks).toHaveLength(5)
    expect(b.tombstones).toHaveLength(25)
    expect(sandbox.integrity(b)).toEqual([])
  })

  it('accepts a manifest-backed account sync payload and detects tampering', () => {
    const upgraded = { sl_tasks: [task('upgraded', '新版任务')] }
    const manifest = buildSyncManifest(upgraded, { tombstones: [] })
    expect(validateSyncManifest(upgraded, manifest)).toEqual([])
    expect(validateSyncManifest({ sl_tasks: [task('upgraded', '被篡改')] }, manifest)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'manifest-entity-hash-mismatch' }),
    ]))
  })

  it('rolls back localStorage when the real batch restore fails midway', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'old-task' }]))
    localStorage.setItem('sl_courses', JSON.stringify([{ id: 'old-course' }]))
    const originalSetItem = localStorage.setItem.bind(localStorage)
    let calls = 0
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      calls += 1
      if (calls === 2) throw new Error('injected commit failure')
      originalSetItem(key, value)
    })
    await expect(restoreStoredValues({
      sl_tasks: [{ id: 'new-task' }],
      sl_courses: [{ id: 'new-course' }],
    }, { markChanged: false })).rejects.toThrow('injected commit failure')
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'old-task' }])
    expect(JSON.parse(localStorage.getItem('sl_courses'))).toEqual([{ id: 'old-course' }])
  })
})
