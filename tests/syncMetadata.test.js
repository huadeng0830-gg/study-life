// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSyncManifest, hashSyncValue, readSyncMetadata, recordTombstone, validateStableEntityIds } from '../src/composables/syncMetadata.js'

describe('P2-B 同步 manifest 与 tombstone', () => {
  beforeEach(() => localStorage.clear())

  it('核心实体使用稳定 id，特殊集合使用确定性复合 id', () => {
    const values = {
      sl_tasks: [{ id: 'task-1', title: '复习' }],
      sl_focus_sessions: [{ sessionId: 'focus-1', duration: 25 }],
      sl_course_checkins: [{ date: '2026-09-02', courseId: 'course-1', status: 'present' }],
    }
    const manifest = buildSyncManifest(values, { tombstones: [] })
    expect(manifest.entities.sl_tasks['task-1'].hash).toBe(hashSyncValue(values.sl_tasks[0]))
    expect(manifest.entities.sl_focus_sessions['focus-1']).toBeDefined()
    expect(manifest.entities.sl_course_checkins['2026-09-02:course-1']).toBeDefined()
    expect(validateStableEntityIds(values)).toEqual([])
  })

  it('缺失与重复稳定 id 会被阻止，而不是生成不可合并记录', () => {
    const issues = validateStableEntityIds({ sl_tasks: [{ title: '无 id' }, { id: 'same' }, { id: 'same' }] })
    expect(issues.map((issue) => issue.reason)).toEqual(['missing-id', 'duplicate-id'])
  })

  it('删除 tombstone 保存删除前基线指纹，并可覆盖同实体旧 tombstone', () => {
    const entity = { id: 'task-1', title: '基线' }
    const first = recordTombstone('Task', entity.id, { entity, now: new Date('2026-09-02T00:00:00.000Z'), deviceId: 'device-a' })
    const second = recordTombstone('Task', entity.id, { entity: { ...entity, title: '再次删除' }, now: new Date('2026-09-02T01:00:00.000Z'), deviceId: 'device-a' })
    expect(first.baseHash).toBe(hashSyncValue(entity))
    expect(readSyncMetadata().tombstones).toEqual([second])
    expect(second.revision).toBe(2)
  })
})
