// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useStoredRef 延迟持久化', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('不会漏掉深层监听建立前发生的修改', async () => {
    const { useStoredRef } = await import('../src/composables/store.js')
    const state = useStoredRef('sl_delayed_persistence_test', [])

    state.value.push({ id: 'early-change' })
    await vi.advanceTimersByTimeAsync(500)

    expect(JSON.parse(localStorage.getItem('sl_delayed_persistence_test'))).toEqual([
      { id: 'early-change' },
    ])
  })

  it('页面立即退出时会先安装监听并同步冲刷修改', async () => {
    const { useStoredRef } = await import('../src/composables/store.js')
    const state = useStoredRef('sl_pagehide_persistence_test', [])

    state.value.push({ id: 'before-pagehide' })
    window.dispatchEvent(new Event('pagehide'))

    expect(JSON.parse(localStorage.getItem('sl_pagehide_persistence_test'))).toEqual([
      { id: 'before-pagehide' },
    ])
  })
})
