// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../src/utils/formatters.js'
import { addAppDays, appCalendarDaysBetween, appNow, appToday, getAppTime, getAppToday } from '../src/composables/timeContext.js'
import { courseTiming } from '../src/composables/courseTime.js'
import { clock } from '../src/composables/store/core.js'

describe('统一应用时间与相对时间', () => {
  it('共享时钟跨午夜时同步更新 appNow 与 appToday', () => {
    const previous = clock.value
    try {
      clock.value = new Date('2026-12-31T15:59:00Z')
      const before = appNow.value.getTime()
      clock.value = new Date('2027-01-01T00:01:00Z')
      expect(appNow.value.getTime()).not.toBe(before)
      expect(getAppToday(clock.value, 'UTC')).toBe('2027-01-01')
      expect(appToday.value).toBeTruthy()
    } finally {
      clock.value = previous
    }
  })

  it('覆盖月末、年末、UTC 与 Asia/Shanghai 跨日', () => {
    expect(getAppToday(new Date('2026-01-31T16:01:00Z'), 'UTC')).toBe('2026-01-31')
    expect(getAppToday(new Date('2026-02-01T00:01:00Z'), 'UTC')).toBe('2026-02-01')
    expect(getAppToday(new Date('2026-12-31T23:30:00Z'), 'UTC')).toBe('2026-12-31')
    expect(getAppToday(new Date('2027-01-01T00:01:00Z'), 'UTC')).toBe('2027-01-01')
    expect(getAppToday(new Date('2026-12-31T16:01:00Z'), 'Asia/Shanghai')).toBe('2027-01-01')
  })

  it('省略 0 单位并输出常用时长', () => {
    expect(formatRelativeTime(8 * 60 * 1000)).toBe('8 分钟')
    expect(formatRelativeTime(2 * 60 * 60 * 1000)).toBe('2 小时')
    expect(formatRelativeTime((21 * 60 + 39) * 60 * 1000)).toBe('21 小时 39 分钟')
  })

  it('21 小时 39 分钟和跨日时长不会退化成分钟总数', () => {
    expect(formatRelativeTime((21 * 60 + 39) * 60 * 1000 - 20 * 60 * 1000)).toBe('21 小时 19 分钟')
    expect(formatRelativeTime((27 * 60) * 60 * 1000)).toBe('1 天 3 小时')
  })

  it('应用时区跨日、月末与时间都来自配置时区', () => {
    const instant = new Date('2026-09-06T23:30:00Z')
    expect(getAppToday(instant, 'UTC')).toBe('2026-09-06')
    expect(getAppToday(instant, 'Asia/Shanghai')).toBe('2026-09-07')
    expect(getAppTime(instant, 'Asia/Shanghai')).toBe('07:30')
    expect(addAppDays('2026-01-31', 1, 'UTC')).toBe('2026-02-01')
    expect(appCalendarDaysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('日期型重要日期使用今天/明天/后天规则', () => {
    expect(formatRelativeTime(0, { mode: 'date', calendarDays: 0 })).toBe('今天')
    expect(formatRelativeTime(1, { mode: 'date', calendarDays: 1 })).toBe('明天')
    expect(formatRelativeTime(1, { mode: 'date', calendarDays: 2 })).toBe('后天')
    expect(formatRelativeTime(-1, { mode: 'date', calendarDays: -3 })).toBe('3 天前')
  })
})

describe('课程状态', () => {
  const now = new Date('2026-09-06T10:00:00Z')
  it('区分提前、进行中、结束和次日课程', () => {
    expect(courseTiming(now.getTime() + 8 * 60 * 1000, now.getTime() + 60 * 60 * 1000, now).text).toBe('距开始 8 分钟')
    expect(courseTiming(now.getTime() - 10 * 60 * 1000, now.getTime() + 42 * 60 * 1000, now).text).toBe('上课中 · 还剩 42 分钟')
    expect(courseTiming(now.getTime() - 2 * 60 * 60 * 1000, now.getTime(), now).state).toBe('ended')
    expect(courseTiming(now.getTime() + 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000, now.getTime() + 25 * 60 * 60 * 1000, now).text).toBe('距开始 1 天 2 小时')
  })
})
