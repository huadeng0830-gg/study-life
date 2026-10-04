// @vitest-environment happy-dom
//
// .ics 导出最容易踩的坑都不是"能不能生成"，而是**生成的东西能不能被真实日历
// 解析器接受**。这一组用例把 RFC 5545 里几条真正会让人失败或静默错位的规则钉死：
//   1. 折行必须按字节且不能切断多字节字符（中文场景的经典失败点）；
//   2. DTSTART/RRULE UNTIL/EXDATE 必须带 Z（UTC），混用本地时间会被解析器拒绝；
//   3. 绝不能出现 VTIMEZONE（手写它是最大错误源，所以一律 UTC 绕开）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_timecfg', JSON.stringify({
    currentCampus: 'south',
    currentSeason: 'summer',
    campuses: [{ id: 'south', name: '南校区' }],
    seasons: [{ id: 'summer', name: '夏季', startDate: '05-01' }],
    periods: [
      { id: 'p1', label: '第1节' }, { id: 'p2', label: '第2节' },
      { id: 'p3', label: '第3节' }, { id: 'p4', label: '第4节' },
    ],
    times: {
      summer: {
        south: [
          { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
          { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
        ],
      },
    },
  }))
  localStorage.setItem('sl_semester', JSON.stringify({ start: '2026-09-07' }))
  localStorage.setItem('sl_schedule_exceptions', '[]')
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  await import('../src/composables/store/core.js')
  await import('../src/composables/settingsPolicy.js')
  return import('../src/composables/icalExport.js')
}

const COURSE = { id: 'c1', name: '高等数学', day: 1, start: 'p1', end: 'p2', room: '教A201', teacher: '王老师' }

describe('iCalendar 导出', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('文本转义遵守 RFC 5545：反斜杠、分号、逗号、换行', async () => {
    const ics = await load()
    expect(ics.escapeText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
    expect(ics.escapeText('第一行\n第二行')).toBe('第一行\\n第二行')
  })

  it('日期一律带 Z（UTC），绝不用浮动时间或 TZID', async () => {
    const ics = await load()
    const text = ics.buildVCalendar({
      courses: [COURSE],
      semesterStart: '2026-09-07',
      timezone: 'UTC',
    })
    expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/)
    // 逐行判定带时刻的 DTSTART 必须以 Z 结尾。用正则一次性匹配会因为
    // [0-9T]+ 的回溯而误报（吃到某个数字就当作"结尾不是 Z"），
    // 所以按行取出来断言更可靠。VALUE=DATE 的全天事件按规范没有 Z。
    const timedStarts = text.split('\r\n').filter((line) => line.startsWith('DTSTART:'))
    expect(timedStarts.length).toBeGreaterThan(0)
    for (const line of timedStarts) {
      expect(line, `带时刻的 DTSTART 必须是 UTC：${line}`).toMatch(/^DTSTART:\d{8}T\d{6}Z$/)
    }
    // 手写 VTIMEZONE 是这个模块最容易出错的地方，一律不用
    expect(text).not.toContain('VTIMEZONE')
    expect(text).not.toMatch(/TZID=/)
  })

  it('RRULE 的 UNTIL 必须是 UTC（很多解析器直接拒收本地时间的 UNTIL）', async () => {
    const ics = await load()
    const text = ics.buildVCalendar({ courses: [COURSE], semesterStart: '2026-09-07', timezone: 'UTC' })
    const until = /RRULE:[^\r\n]*UNTIL=(\S+)/.exec(text)
    expect(until, '课表应当带 RRULE').toBeTruthy()
    expect(until[1]).toMatch(/^\d{8}T\d{6}Z$/)
  })

  it('一门课 = 一个 VEVENT + 一条周重复，而不是按周展开 18 个', async () => {
    const ics = await load()
    const text = ics.buildVCalendar({ courses: [COURSE], semesterStart: '2026-09-07', timezone: 'UTC' })
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO')
  })

  it('超长行按字节折行，且不切断中文字符', async () => {
    const ics = await load()
    const longName = '课'.repeat(120)
    const text = ics.buildVCalendar({
      events: [{ id: 'e1', title: longName, date: '2026-10-04', time: '09:00', reminderMinutes: 30 }],
      timezone: 'UTC',
    })
    const encoder = new TextEncoder()
    for (const line of text.split('\r\n')) {
      expect(encoder.encode(line).length, `有一行超过 75 octet：${line.slice(0, 40)}`).toBeLessThanOrEqual(75)
    }
    // 关键：解码回来必须完整，没有替换字符（U+FFFD）
    expect(text).not.toContain('\uFFFD')
    // 折行会在 CRLF 后插入一个续行空格，所以要先把折行解开再比对内容。
    const unfolded = text.replace(/\r\n /g, '')
    expect(unfolded).toContain(longName)
  })

  it('VALARM 让系统日历负责响铃（App 关闭后也有效）', async () => {
    const ics = await load()
    const withAlarm = ics.buildVCalendar({
      events: [{ id: 'e1', title: '开会', date: '2026-10-04', time: '09:00', reminderMinutes: 30 }],
      timezone: 'UTC',
    })
    expect(withAlarm).toContain('BEGIN:VALARM')
    expect(withAlarm).toContain('TRIGGER:-PT30M')
    const noAlarm = ics.buildVCalendar({
      events: [{ id: 'e2', title: '不提醒', date: '2026-10-04', time: '09:00', reminderMinutes: 0 }],
      timezone: 'UTC',
    })
    expect(noAlarm).not.toContain('BEGIN:VALARM')
  })

  it('只有日期的条目按全天事件导出（VALUE=DATE）', async () => {
    const ics = await load()
    const text = ics.buildVCalendar({
      milestones: [{ id: 'm1', name: '期末考试', date: '2027-01-15' }],
    })
    expect(text).toContain('DTSTART;VALUE=DATE:20270115')
    expect(text).not.toMatch(/BEGIN:VALARM/)
  })

  it('单双周课程展开成各自的 VEVENT，而不是写一条错的 RRULE', async () => {
    const ics = await load()
    const text = ics.buildVCalendar({
      courses: [{ ...COURSE, id: 'odd1', weekType: 'odd' }],
      semesterStart: '2026-09-07',
      timezone: 'UTC',
      maxWeek: 9,
    })
    // 9 周里的奇数周 = 第1、3、5、7、9 周 => 5 个 VEVENT
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(5)
    // 单双周不能写成 INTERVAL=2（那是"隔周"，不是"单周"）
    expect(text).not.toContain('INTERVAL=2')
  })

  it('variants 能把课表与日程分开导出（混在一起系统日历就没法看了）', async () => {
    const ics = await load()
    const onlyCourses = ics.buildVCalendar({
      courses: [COURSE], semesterStart: '2026-09-07', timezone: 'UTC', variants: ['schedule'],
    })
    expect(onlyCourses).toContain('高等数学')
    expect(onlyCourses).not.toContain('CATEGORIES:日程')

    const onlyEvents = ics.buildVCalendar({
      courses: [COURSE], semesterStart: '2026-09-07', timezone: 'UTC',
      events: [{ id: 'e1', title: '社团活动', date: '2026-10-04', time: '19:00' }],
      variants: ['events'],
    })
    expect(onlyEvents).toContain('社团活动')
    expect(onlyEvents).not.toContain('高等数学')
  })

  it('调休 / 停课写进 EXDATE', async () => {
    vi.resetModules()
    localStorage.clear()
    localStorage.setItem('sl_timecfg', JSON.stringify({
      currentCampus: 'south', currentSeason: 'summer',
      campuses: [{ id: 'south', name: '南' }], seasons: [{ id: 'summer', name: '夏', startDate: '05-01' }],
      periods: [{ id: 'p1' }, { id: 'p2' }],
      times: { summer: { south: [{ start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' }] } },
    }))
    localStorage.setItem('sl_semester', JSON.stringify({ start: '2026-09-07' }))
    localStorage.setItem('sl_schedule_exceptions', JSON.stringify([
      { id: 'x1', date: '2026-09-14', type: 'off', makeup: false },
    ]))
    localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
    await import('../src/composables/store/core.js')
    await import('../src/composables/settingsPolicy.js')
    const ics = await import('../src/composables/icalExport.js')
    const text = ics.buildVCalendar({ courses: [{ ...COURSE, weekType: 'all' }], semesterStart: '2026-09-07', timezone: 'UTC' })
    expect(text).toMatch(/EXDATE:[\dTZ,]+/)
  })

  it('整体结构合法：VCALENDAR 包裹，CRLF 行尾，以 END:VCALENDAR 收尾', async () => {
    const ics = await load()
    const text = ics.buildVCalendar({
      courses: [COURSE],
      events: [{ id: 'e1', title: 'x', date: '2026-10-04', time: '09:00' }],
      milestones: [{ id: 'm1', name: 'y', date: '2026-10-05' }],
      semesterStart: '2026-09-07',
      timezone: 'UTC',
    })
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(text).toContain('VERSION:2.0')
    // RFC 5545 要求 CRLF；裸 LF 在部分解析器里会被当成一个超长行
    expect(text).not.toMatch(/[^\r]\n/)
    const begins = text.match(/BEGIN:VEVENT/g) || []
    const ends = text.match(/END:VEVENT/g) || []
    expect(begins).toHaveLength(ends.length)
  })
})