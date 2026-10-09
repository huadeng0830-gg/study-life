// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { ACTION_TIMING, useActionFeedback } from '../src/composables/actionFeedback.js'

let scope
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function feedback(options = {}) {
  scope = effectScope()
  return scope.run(() => useActionFeedback({ motionEnabled: () => true, ...options }))
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { scope?.stop(); vi.useRealTimers() })

describe('action feedback across the real task contract', () => {
  it('does not show a saved animation for a superseded draft, although its earlier write completed', async () => {
    const action = feedback({ kind: 'important' })
    expect(await action.run(() => ({ feedback: false }))).toEqual({ feedback: false })
    expect(action.result.value).toBe('success')
    expect(action.phase.value).toBe('idle')
    expect(action.pending.value).toBe(false)
    action.cancel()
    expect(action.result.value).toBe('') // A completed write was not cancelled.
    await vi.advanceTimersByTimeAsync(5000)
    expect(action.phase.value).toBe('idle')
  })
  it('starts business work synchronously and locks duplicate submissions', async () => {
    const action = feedback({ kind: 'important' })
    const work = deferred()
    const execute = vi.fn(() => work.promise)
    const completion = action.run(execute)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(action.phase.value).toBe('pressed')
    expect(await action.run(execute)).toBe(false)
    await vi.advanceTimersByTimeAsync(ACTION_TIMING.press)
    expect(action.phase.value).toBe('collapsing')
    await vi.advanceTimersByTimeAsync(ACTION_TIMING.collapse)
    expect(action.phase.value).toBe('loading')
    await vi.advanceTimersByTimeAsync(5000)
    expect(action.phase.value).toBe('loading')
    work.resolve({ id: 'fictional-record' })
    expect(await completion).toEqual({ id: 'fictional-record' })
    await vi.advanceTimersByTimeAsync(0)
    expect(action.phase.value).toBe('success')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps the 1200 ms visual minimum without delaying the business continuation', async () => {
    const action = feedback({ kind: 'important' })
    expect(await action.run(() => true)).toBe(true)
    expect(action.phase.value).toBe('pressed')
    await vi.advanceTimersByTimeAsync(1199)
    expect(action.phase.value).toBe('loading')
    await vi.advanceTimersByTimeAsync(1)
    expect(action.phase.value).toBe('success')
    await vi.advanceTimersByTimeAsync(1000)
    expect(action.phase.value).toBe('restoring')
    await vi.advanceTimersByTimeAsync(300)
    expect(action.phase.value).toBe('idle')
    expect(action.locked.value).toBe(false)
  })

  it('allows another frequent save during its brief success indication', async () => {
    const action = feedback()
    expect(await action.run(() => true)).toBe(true)
    expect(action.phase.value).toBe('success')
    expect(action.locked.value).toBe(false)
    const work = deferred()
    const completion = action.run(() => work.promise)
    await vi.advanceTimersByTimeAsync(1000)
    expect(action.phase.value).toBe('loading')
    work.resolve(true)
    await completion
    await vi.advanceTimersByTimeAsync(650)
    expect(action.phase.value).toBe('idle')
  })

  it('never reports success for validation, cancellation, or a failed write', async () => {
    const action = feedback({ kind: 'important' })
    await action.run(() => false)
    expect(action.phase.value).toBe('idle')
    await action.run(() => { throw new Error('存储空间不足，请释放空间后重试') })
    expect(action.phase.value).toBe('error')
    expect(action.error.value).toContain('存储空间不足')
    await vi.advanceTimersByTimeAsync(5000)
    expect(action.phase.value).toBe('idle')
    expect(action.error.value).toContain('存储空间不足')
    expect(action.result.value).toBe('error')
    await action.run(() => true)
    expect(action.error.value).toBe('')
  })

  it('aborts and ignores a late result after disposal', async () => {
    const action = feedback()
    const work = deferred()
    let signal
    const completion = action.run((context) => { signal = context.signal; return work.promise })
    scope.stop()
    expect(signal.aborted).toBe(true)
    work.resolve(true)
    await completion
    await vi.advanceTimersByTimeAsync(5000)
    expect(action.phase.value).toBe('idle')
    expect(action.result.value).toBe('cancelled')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an old generation without allowing it to reset a new task', async () => {
    const action = feedback()
    const old = deferred()
    const first = action.run(() => old.promise)
    action.cancel()
    const next = deferred()
    const second = action.run(() => next.promise)
    old.resolve(true)
    await first
    expect(action.pending.value).toBe(true)
    next.resolve(true)
    await second
    expect(action.phase.value).toBe('success')
  })

  it('interrupts an opted-in timeout and retains its real failure reason', async () => {
    const action = feedback({ timeoutMs: 1000 })
    let signal
    const completion = action.run((context) => { signal = context.signal; return new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(1000)
    await completion
    expect(signal.aborted).toBe(true)
    expect(action.result.value).toBe('error')
    expect(action.error.value).toContain('操作超时')
  })

  it('uses no minimum or morph for reduced motion and no success channel for task feedback', async () => {
    const action = feedback({ kind: 'important', motionEnabled: () => false })
    await action.run(() => true)
    expect(action.morph.value).toBe(false)
    expect(action.phase.value).toBe('success')
    scope.stop()
    const external = feedback({ kind: 'task', feedback: false })
    await external.run(() => true)
    expect(external.phase.value).toBe('idle')
  })
})
