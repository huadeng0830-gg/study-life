import { describe, expect, it, vi } from 'vitest'
import { runStartupGate } from '../src/composables/startupGate.js'

describe('启动恢复 gate', () => {
  it('恢复完成前不准备业务、不 mount，并保持既定顺序', async () => {
    const order = []
    let releaseRecovery
    const pendingRecovery = new Promise((resolve) => { releaseRecovery = resolve })
    const gate = runStartupGate({
      initializeVault: async () => { order.push('vault'); return ['sl_tasks'] },
      recoverSync: async () => { order.push('recovery-start'); return pendingRecovery },
      prepareApp: vi.fn(async () => { order.push('prepare') }),
      mountApp: vi.fn(async () => { order.push('mount') }),
    })

    await Promise.resolve()
    expect(order).toEqual(['vault', 'recovery-start'])
    releaseRecovery({ ok: true, recovered: true })
    const result = await gate

    expect(result.ok).toBe(true)
    expect(order).toEqual(['vault', 'recovery-start', 'prepare', 'mount'])
  })

  it('恢复失败时不准备业务和 mount', async () => {
    const prepareApp = vi.fn()
    const mountApp = vi.fn()
    const result = await runStartupGate({
      initializeVault: async () => [],
      recoverSync: async () => ({ ok: false, error: new Error('restore failed') }),
      prepareApp,
      mountApp,
    })

    expect(result.ok).toBe(false)
    expect(prepareApp).not.toHaveBeenCalled()
    expect(mountApp).not.toHaveBeenCalled()
  })

  it('按阶段报告开发态耗时且不改变恢复顺序', async () => {
    const timings = []
    await runStartupGate({
      initializeVault: async () => ['sl_tasks'],
      recoverSync: async () => ({ ok: true }),
      prepareApp: async () => ({ ok: true }),
      onTiming: (entry) => timings.push(entry),
    })
    expect(timings.map((entry) => entry.label)).toEqual(['vault', 'recovery', 'prepare'])
    expect(timings.every((entry) => typeof entry.durationMs === 'number')).toBe(true)
  })
})
