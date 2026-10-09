// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { dismissPersistenceNotice, flushStoredWrites, persistenceState, restoreStoredValues, useStoredRef } from '../src/composables/store/core.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

const localKey = 'sl_test_persistence_failure'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(localKey)
  dismissPersistenceNotice()
})

describe('本机持久化状态', () => {
  it('恢复点中的空配置保留磁盘空值，运行时回到默认配置', async () => {
    const state = useStoredRef(localKey, { value: 0 })
    await restoreStoredValues({ [localKey]: { value: 9 } }, { markChanged: false })
    expect(state.value).toEqual({ value: 9 })
    await restoreStoredValues({ [localKey]: null }, { markChanged: false })
    expect(localStorage.getItem(localKey)).toBe('null')
    expect(state.value).toEqual({ value: 0 })
  })
  it('localStorage 写入失败时保留内存修改并显示明确提示', async () => {
    localStorage.setItem(localKey, JSON.stringify({ value: 0 }))
    const state = useStoredRef(localKey, { value: 0 })
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })

    state.value.value = 1
    await nextTick()
    flushStoredWrites()

    expect(state.value.value).toBe(1)
    expect(persistenceState.value.status).toBe('error')
    expect(persistenceState.value.key).toBe(localKey)
    expect(persistenceState.value.message).toContain('本次修改未能保存到本机')
    setItem.mockRestore()
  })

  it('IndexedDB 不可用时报告安全副本失败而不是静默吞掉', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    localStorage.setItem(localKey, JSON.stringify({ value: 0 }))
    const state = useStoredRef(localKey, { value: 0 })
    state.value.value = 2
    await nextTick()
    flushStoredWrites()
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(state.value.value).toBe(2)
    expect(persistenceState.value.status).toBe('error')
    expect(persistenceState.value.source).toBe('mirror')
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    else delete globalThis.indexedDB
  })
})
