import { describe, expect, it } from 'vitest'
import { minutesUntilStart } from '../src/composables/store/utils.js'

describe('首页课程开始倒计时', () => {
  it('课程日期超过 24 小时时不显示倒计时', () => {
    const now = new Date('2026-09-05T00:03:00')

    expect(minutesUntilStart('2026-09-07', '08:10', now)).toBeNull()
  })

  it('课程进入 24 小时内时返回完整日期计算后的分钟数', () => {
    const now = new Date('2026-09-07T00:03:00')

    expect(minutesUntilStart('2026-09-07', '08:10', now)).toBe(487)
  })
})
