// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { raceWithControls } from '../src/composables/asyncTask.js'

describe('可取消异步任务', () => {
  it('取消时调用底层中断并返回 AbortError', async () => {
    const controller = new AbortController()
    const interrupt = vi.fn()
    const pending = raceWithControls(new Promise(() => {}), { signal: controller.signal, onInterrupt: interrupt })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(interrupt).toHaveBeenCalledWith('cancelled')
  })

  it('超时会标出真正失败原因并执行清理', async () => {
    vi.useFakeTimers()
    const interrupt = vi.fn()
    const pending = raceWithControls(new Promise(() => {}), { timeoutMs: 1000, timeoutMessage: '引擎初始化超时', onInterrupt: interrupt })
    const assertion = expect(pending).rejects.toThrow('引擎初始化超时')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(interrupt).toHaveBeenCalledWith('timeout')
    vi.useRealTimers()
  })
})
