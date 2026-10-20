// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { flushStoredWrites, useStoredRef } from '../src/composables/store/core.js'

/**
 * 同键多处以**不同** options 声明时，第一次调用生效、其余静默失效。
 *
 * 这是模块单例 store 的有意设计，但静默丢弃是有代价的：
 * 后来那个 `{ deep: false }` 不生效 → 每次深层遍历一棵不断增长的数组。
 * 这个守卫让不一致在开发期就响起来，而不是等页面变卡才发现。
 */
describe('存储键重复声明的契约告警', () => {
  it('同键不同监听方式时给出开发期告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const key = `sl_test_contract_${Math.random().toString(36).slice(2)}`
      // 首个声明：深监听
      useStoredRef(key, [], { deep: true })
      expect(warn).not.toHaveBeenCalled()
      // 第二个声明：要求 shallow（与首个不一致）
      useStoredRef(key, [], { deep: false })
      expect(warn, '监听方式不一致时应当告警').toHaveBeenCalled()
      expect(String(warn.mock.calls[0]?.[0])).toContain(key)
    } finally {
      warn.mockRestore()
    }
  })

  it('同键声明方式一致时保持安静', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const key = `sl_test_quiet_${Math.random().toString(36).slice(2)}`
      useStoredRef(key, [], { deep: true })
      useStoredRef(key, [], { deep: true })
      useStoredRef(key, [], { deep: true })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('重复声明返回同一个 ref（模块单例语义不变）', () => {
    const key = `sl_test_same_${Math.random().toString(36).slice(2)}`
    const first = useStoredRef(key, [])
    const second = useStoredRef(key, [], { deep: false })
    expect(second).toBe(first)
  })

  it('默认值不一致时给出开发期告警（默认值决定损坏数据的修复形状）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const key = `sl_test_default_${Math.random().toString(36).slice(2)}`
      // 首个声明说它是数组，第二个说它是对象——形状取决于加载顺序。
      useStoredRef(key, [])
      useStoredRef(key, { base: 'CNY' })
      expect(warn, '默认值不一致时应当告警').toHaveBeenCalled()
      expect(String(warn.mock.calls[0]?.[0])).toContain(key)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('只读取，不声明', () => {
  it('readStoredValueWithoutDeclaring 不会替未声明的键定下默认值', async () => {
    const { readStoredValueWithoutDeclaring } = await import('../src/composables/store/snapshotAccess.js')
    const key = `sl_test_readonly_${Math.random().toString(36).slice(2)}`
    localStorage.removeItem(key)
    expect(readStoredValueWithoutDeclaring(key)).toBeUndefined()
    // 读完之后键仍未被声明：再声明时默认值仍然是调用方给的那个。
    expect(localStorage.getItem(key)).toBe(null)
    useStoredRef(key, { base: 'CNY' })
    expect(readStoredValueWithoutDeclaring(key)).toEqual({ base: 'CNY' })
  })

  it('键已声明时返回内存中的当前值，而不是磁盘快照', async () => {
    const { readStoredValueWithoutDeclaring } = await import('../src/composables/store/snapshotAccess.js')
    const key = `sl_test_live_${Math.random().toString(36).slice(2)}`
    const state = useStoredRef(key, [])
    state.value = [{ id: 'a' }]
    flushStoredWrites()
    expect(readStoredValueWithoutDeclaring(key)).toEqual([{ id: 'a' }])
  })
})