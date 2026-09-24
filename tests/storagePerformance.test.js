// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { flushStoredWrites, getStoragePerformanceSnapshot, useStoredRef } from '../src/composables/store/core.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

const sizes = [100, 500, 1000, 5000]

afterEach(() => {
  flushStoredWrites()
})

describe('开发态存储性能观测', () => {
  it.each(sizes)('记录 %s 条合成记录的 key、大小和耗时，不记录内容', async (size) => {
    const key = `sl_storage_perf_${size}_${Date.now()}`
    const records = Array.from({ length: size }, (_, index) => ({
      id: `${key}-${index}`,
      name: `synthetic-${index}`,
      title: `synthetic-${index}`,
      note: 'synthetic payload',
      amount: index + 1,
    }))
    const state = useStoredRef(key, [])
    state.value = records
    state.value[0] = { ...state.value[0], note: 'edited synthetic payload' }
    state.value.splice(state.value.length - 1, 1)
    flushStoredWrites()
    await new Promise((resolve) => setTimeout(resolve, 360))

    const metric = getStoragePerformanceSnapshot().find((item) => item.key === key)
    expect(metric).toMatchObject({ key, payloadBytes: expect.any(Number), serializeMs: expect.any(Number), localStorageMs: expect.any(Number) })
    expect(metric.payloadBytes).toBeGreaterThan(0)
    expect(JSON.stringify(metric)).not.toContain('synthetic-')
    console.info('[storage-perf]', JSON.stringify(metric))
  })
})
