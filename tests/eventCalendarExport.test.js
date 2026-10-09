// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildEventCalendar } from '../src/composables/events/eventCalendarExport.js'
import { parseIcsCalendar } from '../src/composables/icalImport.js'

const event = { id: 'demo-meeting', title: '阅读交流', date: '2026-10-09', time: '09:00', endTime: '10:30', location: '讨论室', note: '带上笔记', courseName: '示例课程', reminderMinutes: 15 }
const build = (events) => buildEventCalendar(events, { timezone: 'Asia/Shanghai', now: new Date('2026-10-01T00:00:00Z') })

describe('日程 ICS 导出和往返', () => {
  it('输出 UTC 时刻，按应用时区重新导入后时间、课程和提醒保持一致', () => {
    const result = build([event])
    expect(result.count).toBe(1)
    expect(result.text).toContain('DTSTART:20261009T010000Z')
    expect(result.text).toContain('DTEND:20261009T023000Z')
    expect(result.text).toContain('TRIGGER:-PT15M')
    const { id: _id, ...fields } = event
    expect(parseIcsCalendar(result.text, { timezone: 'Asia/Shanghai' }).events[0]).toMatchObject({ ...fields, reminderEnabled: true })
  })
  it('无时间的单日安排使用次日非包含结束日期，不导出待安排项', () => {
    const result = build([{ ...event, time: '', endTime: '' }, { id: 'inbox', title: '待安排事项', date: '' }])
    expect(result).toMatchObject({ count: 1, skipped: 1 })
    expect(result.text).toContain('DTSTART;VALUE=DATE:20261009')
    expect(result.text).toContain('DTEND;VALUE=DATE:20261010')
    expect(parseIcsCalendar(result.text).events[0]).toMatchObject({ date: event.date, time: '', endTime: '' })
  })
  it('不提醒的日程不生成闹钟，导入仍保留开关', () => {
    const result = build([{ ...event, reminderEnabled: false }])
    expect(result.text).not.toContain('BEGIN:VALARM')
    expect(parseIcsCalendar(result.text).events[0].reminderEnabled).toBe(false)
  })
  it('长中文、换行和保留字符正确转义，物理行不超过 75 字节', () => {
    const note = '中文📚'.repeat(50) + '\n第二行,分号;反斜线\\\nBEGIN:VEVENT'
    const result = build([{ ...event, note }])
    for (const line of result.text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    const imported = parseIcsCalendar(result.text, { timezone: 'Asia/Shanghai' })
    expect(imported.found).toBe(1)
    expect(imported.events[0].note).toBe(note)
  })
  it('重新导入自己导出的日程按内容去重，已删除记录可以重新导入', () => {
    const text = build([event]).text
    expect(parseIcsCalendar(text, { timezone: 'Asia/Shanghai', existingEvents: [event] })).toMatchObject({ events: [], duplicates: 1 })
    expect(parseIcsCalendar(text, { timezone: 'Asia/Shanghai', existingEvents: [{ ...event, deletedAt: '2026-10-01' }] }).events).toHaveLength(1)
  })
  it('无效日期、时间倒置和墓碑不进入导出文件', () => {
    const result = build([{ ...event, date: '2026-02-30' }, { ...event, endTime: '08:30' }, { ...event, tombstone: true }])
    expect(result).toMatchObject({ count: 0, skipped: 3 })
  })
})
