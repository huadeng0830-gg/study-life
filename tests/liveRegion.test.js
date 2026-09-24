// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { announce, clearAnnouncement, liveMessage } from '../src/composables/liveRegion.js'

afterEach(() => {
  clearAnnouncement()
  vi.useRealTimers()
})

describe('读屏播报区', () => {
  it('写入文本前先清空，保证连续两次相同播报都被读到', async () => {
    vi.useFakeTimers()
    announce('待办已删除')
    // 清空是同步的，真正写入延后一拍。
    expect(liveMessage.value).toBe('')
    vi.advanceTimersByTime(40)
    expect(liveMessage.value).toBe('待办已删除')

    announce('待办已删除')
    expect(liveMessage.value).toBe('')
    vi.advanceTimersByTime(40)
    expect(liveMessage.value).toBe('待办已删除')
  })

  it('空文本不会写入播报区', () => {
    vi.useFakeTimers()
    liveMessage.value = '原有内容'
    announce('   ')
    announce('')
    announce(null)
    vi.advanceTimersByTime(80)
    expect(liveMessage.value).toBe('原有内容')
  })

  it('clearAfter 到期后自动清空', () => {
    vi.useFakeTimers()
    announce('已保存', { clearAfter: 1000 })
    vi.advanceTimersByTime(40)
    expect(liveMessage.value).toBe('已保存')
    vi.advanceTimersByTime(1000)
    expect(liveMessage.value).toBe('')
  })

  it('clearAnnouncement 立即清空并取消待写入内容', () => {
    vi.useFakeTimers()
    announce('稍后播报')
    clearAnnouncement()
    vi.advanceTimersByTime(100)
    expect(liveMessage.value).toBe('')
  })

  it('连续播报只有最后一条会落下', () => {
    vi.useFakeTimers()
    announce('第一条')
    announce('第二条')
    vi.advanceTimersByTime(40)
    expect(liveMessage.value).toBe('第二条')
  })
})