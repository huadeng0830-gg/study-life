// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { clock, flushStoredWrites, useStoredRef } from '../src/composables/store/core.js'
import { settings } from '../src/composables/settingsPolicy.js'
import { collectDueReminders, REMINDER_LOG_KEY, startReminderScheduler, stopReminderScheduler } from '../src/composables/reminderScheduler.js'
import { completeBackupArchive, createBackupSnapshot, parseBackupArchive } from '../src/composables/backupArchive.js'
import { sanitizeSyncPayload } from '../src/composables/accountSyncData.js'
import { parseDomainCsvFile } from '../src/composables/domainCsvImport.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const domain = useDomainCommands()
const log = useStoredRef(REMINDER_LOG_KEY, [])
const now = Date.parse('2026-10-09T10:00:00Z')
const event = { id: 'demo-reminder', title: '示例会议', date: '2026-10-09', time: '10:00', endTime: '11:00', reminderMinutes: 0 }
beforeEach(() => {
  domain.events.value = []
  domain.tasks.value = []
  domain.milestones.value = []
  log.value = []
  settings.value = { timezone: 'UTC' }
  clock.value = new Date(now)
})
afterEach(() => { stopReminderScheduler(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('日程提醒和数据保存', () => {
  it('改标题不会重响，改提醒时刻后可以重新排程', () => {
    const notify = vi.fn()
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor(...args) { notify(...args) } })
    vi.spyOn(Date, 'now').mockReturnValue(now)
    domain.createEvent(event)
    startReminderScheduler()
    stopReminderScheduler()
    expect(notify).toHaveBeenCalledTimes(1)
    domain.updateEvent(event.id, { title: '示例会议（已改标题）' })
    expect(collectDueReminders(now)).toEqual([])
    domain.updateEvent(event.id, { time: '10:30' })
    expect(collectDueReminders(now)).toContainEqual(expect.objectContaining({ key: 'event:demo-reminder', fireAt: now + 30 * 60_000 }))
  })
  it('不提醒、旧格式归档和删除标记都不排程，旧数据仍使用默认提醒', () => {
    domain.events.value = [
      { ...event, id: 'off', reminderEnabled: false },
      { ...event, id: 'archived', status: 'archived' },
      { ...event, id: 'deleted', tombstone: true },
      { ...event, id: 'legacy', reminderMinutes: undefined },
    ]
    expect(collectDueReminders(now).map((item) => item.key)).toEqual(['event:legacy'])
  })
  it('提醒开关和时间随原日程通过本机备份和同步快照往返', async () => {
    domain.createEvent({ ...event, reminderEnabled: false, courseId: 'demo-course' })
    flushStoredWrites()
    const snapshot = createBackupSnapshot()
    const parsed = await parseBackupArchive(await completeBackupArchive(snapshot))
    expect(parsed.data.events[0]).toMatchObject({ reminderEnabled: false, reminderMinutes: 0, endTime: '11:00', courseId: 'demo-course' })
    expect(sanitizeSyncPayload({ sl_events: snapshot.data.events }).values.sl_events[0]).toMatchObject({ reminderEnabled: false, endTime: '11:00' })
  })
  it('领域命令校验失败不会改变已有记录或创建半条记录', () => {
    const saved = domain.createEvent(event)
    expect(() => domain.updateEvent(saved.id, { endTime: '09:00' })).toThrow('结束时间须晚于开始时间')
    expect(saved.endTime).toBe('11:00')
    expect(() => domain.createEvent({ title: '错误安排', date: '2026-02-30' })).toThrow('有效的日期')
    expect(domain.events.value).toHaveLength(1)
  })
  it('CSV 导入预览跳过时间倒置的行，保留后续有效安排', () => {
    const csv = '标题,日期,时间,结束时间\n无效安排,2026-10-09,10:00,09:00\n有效安排,2026-10-09,11:00,12:00'
    const result = parseDomainCsvFile(new TextEncoder().encode(csv).buffer, { kind: 'events' })
    expect(result.skipped.invalid).toBe(1)
    expect(result.rows.map((row) => row.title)).toEqual(['有效安排'])
  })
})
