// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetScroll,
  recallScroll,
  rememberScroll,
  resetScrollMemory,
  resolveScrollPosition,
  scrollMemoryKey,
  scrollMemorySize,
} from '../src/composables/viewScrollMemory.js'

afterEach(() => { resetScrollMemory() })

describe('浏览位置记忆', () => {
  it('用完整路径做键，同一页面不同筛选算不同位置', () => {
    expect(scrollMemoryKey({ fullPath: '/tasks?filter=all' })).toBe('/tasks?filter=all')
    expect(scrollMemoryKey({ fullPath: '/bills?month=3' })).not.toBe(scrollMemoryKey({ fullPath: '/bills?month=4' }))
    expect(scrollMemoryKey('/lists')).toBe('/lists')
    expect(scrollMemoryKey({ path: '/exams' })).toBe('/exams')
    expect(scrollMemoryKey({ name: 'tasks' })).toBe('tasks')
    expect(scrollMemoryKey(null)).toBe('')
  })

  it('记住之后可以取回', () => {
    expect(rememberScroll('/tasks', 640)).toBe(true)
    expect(recallScroll('/tasks')).toBe(640)
  })

  it('位置取整，避免亚像素抖动造成无意义写入', () => {
    rememberScroll('/tasks', 640.4)
    expect(recallScroll('/tasks')).toBe(640)
  })

  it('顶部不记：回到顶部本来就是默认行为', () => {
    rememberScroll('/tasks', 900)
    expect(rememberScroll('/tasks', 0)).toBe(false)
    // 并且把之前记的也清掉，否则会「粘」在旧位置
    expect(recallScroll('/tasks')).toBeNull()
    expect(rememberScroll('/tasks', 12)).toBe(false)
    expect(recallScroll('/tasks')).toBeNull()
  })

  it('脏输入不会写进记忆', () => {
    expect(rememberScroll('', 100)).toBe(false)
    expect(rememberScroll('/tasks', Number.NaN)).toBe(false)
    expect(rememberScroll('/tasks', -5)).toBe(false)
    expect(recallScroll('/tasks')).toBeNull()
    expect(scrollMemorySize()).toBe(0)
  })

  it('没记过就是 null，而不是 0（0 会被误解成「记住了顶部」）', () => {
    expect(recallScroll('/never')).toBeNull()
    expect(recallScroll('')).toBeNull()
  })

  it('可以单独忘掉一个页面', () => {
    rememberScroll('/tasks', 300)
    expect(forgetScroll('/tasks')).toBe(true)
    expect(recallScroll('/tasks')).toBeNull()
    expect(forgetScroll('/tasks')).toBe(false)
  })
})

describe('resolveScrollPosition', () => {
  it('浏览器前进/后退的位置优先', () => {
    expect(resolveScrollPosition({ savedPosition: { top: 820 }, remembered: 300 })).toEqual({ top: 820 })
  })

  it('没有前进/后退位置时用记忆位置', () => {
    expect(resolveScrollPosition({ savedPosition: null, remembered: 300 })).toEqual({ top: 300 })
  })

  it('两者都没有就回到顶部', () => {
    expect(resolveScrollPosition({ savedPosition: null, remembered: null })).toEqual({ top: 0 })
    expect(resolveScrollPosition()).toEqual({ top: 0 })
  })

  it('坐标为 0 的 savedPosition 也是有效位置，不能被当成「没有」', () => {
    expect(resolveScrollPosition({ savedPosition: { top: 0 }, remembered: 500 })).toEqual({ top: 0 })
  })

  it('负数与脏值被夹回合法范围', () => {
    expect(resolveScrollPosition({ savedPosition: { top: -40 } })).toEqual({ top: 0 })
    expect(resolveScrollPosition({ remembered: Number.NaN })).toEqual({ top: 0 })
    expect(resolveScrollPosition({ remembered: '420' })).toEqual({ top: 420 })
  })
})