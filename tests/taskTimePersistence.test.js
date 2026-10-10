// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { flushStoredWrites, useStoredRef } from '../src/composables/store/core.js'
import { settings } from '../src/composables/settingsPolicy.js'
import { completeBackupArchive, createBackupSnapshot, parseBackupArchive, BACKUP_STORAGE_KEYS } from '../src/composables/backupArchive.js'
import { buildBackupRestoreValues } from '../src/composables/backupRestore.js'
import { buildEntityManifest } from '../src/composables/syncMetadata.js'
import { mergeSyncPayload } from '../src/composables/syncMerge.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()
const domain = useDomainCommands()
beforeEach(() => { domain.tasks.value = []; domain.events.value = []; domain.courses.value = []; settings.value = { timezone: 'UTC' } })
const stages = () => [
  { id: 'prep', label: '准备', kind: 'window', start: { date: '2026-10-10' }, end: { date: '2026-10-12' }, completionRequired: true, reminders: [{ id: 'prep-close', anchor: 'end', enabled: true, minutesBefore: 0, dateOnlyTime: '09:00' }] },
  { id: 'show', label: '展示', kind: 'scheduled', start: { date: '2026-10-15', time: '14:00' }, end: { date: '2026-10-15', time: '16:00' }, completionRequired: true, reminders: [] },
]

describe('时间阶段的领域写入与往返', () => {
  it('创建、单阶段完成与刷新、完整备份恢复都保留阶段和稳定标识', async () => {
    const task = domain.createTask({ id: 'demo-times', title: '示例展示', timeStages: stages() })
    domain.setTaskStageCompleted(task.id, 'prep', true)
    expect(task.done).toBe(false)
    expect(task.timeStages[1].completedAt).toBeUndefined()
    flushStoredWrites()
    const saved = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(saved[0].timeStages).toEqual(task.timeStages)
    const parsed = await parseBackupArchive(await completeBackupArchive(createBackupSnapshot()))
    const restored = buildBackupRestoreValues(parsed.data, parsed.providedFields, BACKUP_STORAGE_KEYS)
    expect(restored.sl_tasks[0].timeStages).toEqual(saved[0].timeStages)
    const cloudCopy = mergeSyncPayload({ baseManifest: buildEntityManifest({ sl_tasks: [] }), localValues: { sl_tasks: [] }, remoteValues: { sl_tasks: saved }, keys: ['sl_tasks'] })
    expect(cloudCopy.conflicts).toEqual([])
    expect(cloudCopy.values.sl_tasks[0].timeStages).toEqual(saved[0].timeStages)
  })

  it('共享校验在创建和更新处拒绝非法阶段，不留下半条记录', () => {
    const task = domain.createTask({ title: '示例展示', timeStages: stages() })
    const before = JSON.stringify(task)
    const invalid = stages()
    invalid[1].end.time = '13:00'
    expect(() => domain.updateTask(task.id, { title: '不能写入', timeStages: invalid })).toThrow('结束须晚于开始')
    expect(JSON.stringify(task)).toBe(before)
    expect(() => domain.createTask({ title: '错误事项', timeStages: invalid })).toThrow()
    expect(domain.tasks.value).toHaveLength(1)
  })

  it('整体完成才生成下一期；生成所有阶段，重置完成事实和提醒标识', () => {
    const task = domain.createTask({ id: 'repeat', title: '每周展示', repeat: 'weekly', timeStages: stages() })
    domain.setTaskStageCompleted(task.id, 'prep', true)
    expect(domain.tasks.value).toHaveLength(1)
    domain.setTaskStageCompleted(task.id, 'show', true, true)
    expect(domain.tasks.value).toHaveLength(2)
    const next = domain.tasks.value[1]
    expect(next.timeStages[0].start.date).toBe('2026-10-17')
    expect(next.timeStages[1].start.date).toBe('2026-10-22')
    expect(next.timeStages.every((stage) => !stage.completedAt)).toBe(true)
    expect(next.sourceId).toBe(task.id)
    expect(next.timeStages[0].reminders[0].id).not.toBe('prep-close')
  })

  it('月末改期撤销明确恢复原始重复锚点，下一期仍是 31 日', () => {
    const task = domain.createTask({ id: 'monthly', title: '月末核对', dueDate: '2026-02-28', repeat: 'monthly' })
    domain.updateTask(task.id, { repeatAnchorDay: 31 })
    domain.updateTask(task.id, { dueDate: '2026-03-01' })
    domain.updateTask(task.id, { dueDate: '2026-02-28', repeatAnchorDay: 31 })
    expect(task.repeatAnchorDay).toBe(31)
    domain.toggleTask(task.id)
    expect(domain.tasks.value[1].dueDate).toBe('2026-03-31')
  })

  it('已完成事项重新编辑不会重复生成下一期', () => {
    const task = domain.createTask({ title: '每周展示', repeat: 'weekly', timeStages: stages() })
    domain.toggleTask(task.id)
    domain.updateTask(task.id, { title: '修改标题' })
    expect(useStoredRef('sl_tasks', []).value).toHaveLength(2)
  })
})
