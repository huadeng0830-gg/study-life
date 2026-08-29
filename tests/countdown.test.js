// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { countdownState, countdownTarget, sortCountdowns } from '../src/composables/store'

const NOW = new Date('2026-06-15T10:00:00')

function dateStrOffset(days) {
  const d = new Date(NOW)
  d.setDate(d.getDate() + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

describe('countdownTarget', () => {
  it('无日期返回 null', () => {
    expect(countdownTarget({ date: '' }, NOW)).toBeNull()
  })

  it('年度重复且已过时滚动到下一年', () => {
    const target = countdownTarget({ date: '2026-01-01', repeat: 'yearly' }, NOW)
    expect(target.getFullYear()).toBe(2027)
    expect(target.getMonth()).toBe(0)
    expect(target.getDate()).toBe(1)
  })
})

describe('countdownState', () => {
  it('未来的全天日期返回天数', () => {
    const state = countdownState({ date: dateStrOffset(3) }, NOW)
    expect(state.text).toBe('3')
    expect(state.label).toBe('天')
    expect(state.isPast).toBe(false)
  })

  it('当天显示"今天"', () => {
    const state = countdownState({ date: '2026-06-15' }, NOW)
    expect(state.text).toBe('今天')
    expect(state.cls).toBe('hot')
  })

  it('已过的全天日期标记为结束', () => {
    const state = countdownState({ date: '2026-06-10' }, NOW)
    expect(state.isPast).toBe(true)
    expect(state.text).toBe('已结束')
  })

  it('带具体时间时按小时倒计时', () => {
    const state = countdownState({ date: '2026-06-15', time: '18:00' }, NOW)
    expect(state.text).toBe('8')
    expect(state.label).toBe('小时')
  })

  it('一小时内按分钟倒计时', () => {
    const state = countdownState({ date: '2026-06-15', time: '10:40' }, NOW)
    expect(state.label).toBe('分钟')
  })

  it('缺少日期给出占位状态', () => {
    const state = countdownState({}, NOW)
    expect(state.text).toBe('无日期')
  })
})

describe('sortCountdowns', () => {
  it('置顶优先，未结束在前，再按时间升序', () => {
    const sorted = sortCountdowns(
      [
        { id: 'a', date: '2026-07-10' },
        { id: 'b', date: '2026-07-01' },
        { id: 'c', date: '2020-01-01', pinned: true },
        { id: 'd', date: '2026-06-20' },
      ],
      NOW
    )
    expect(sorted.map((item) => item.id)).toEqual(['c', 'd', 'b', 'a'])
  })
})
