import { describe, expect, it, vi } from 'vitest'
import { createReadCache } from '../src/services/readCache.js'

describe('memory and cancellation budgets for shared reads', () => {
  it('does not retain a response larger than the memory budget', async () => {
    const cache = createReadCache({ maxBytes: 200 })
    const load = vi.fn(async () => ({ body: 'x'.repeat(200) }))
    expect((await cache.read('large', load)).body).toHaveLength(200)
    await cache.read('large', load)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('evicts old results when combined response bytes exceed the budget', async () => {
    const cache = createReadCache({ maxBytes: 150 })
    const load = vi.fn(async () => ({ text: 'a'.repeat(30) }))
    await cache.read('one', load)
    await cache.read('two', load)
    await cache.read('one', load)
    expect(load).toHaveBeenCalledTimes(3)
  })
  it('cancels an abandoned caller without cancelling the other consumer', async () => {
    const cache = createReadCache()
    let finish, upstreamSignal
    const load = vi.fn(signal => { upstreamSignal = signal; return new Promise(resolve => { finish = resolve }) })
    const controller = new AbortController()
    const abandoned = cache.read('shared', load, { signal: controller.signal })
    const other = cache.read('shared', load)
    await Promise.resolve()
    controller.abort()
    await expect(abandoned).rejects.toHaveProperty('name', 'AbortError')
    expect(upstreamSignal.aborted).toBe(false)
    finish({ items: [1] })
    await expect(other).resolves.toEqual({ items: [1] })
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('aborts the network when the last consumer leaves and never caches late data', async () => {
    const cache = createReadCache()
    let finish, signal
    const controller = new AbortController()
    const pending = cache.read('search', s => { signal = s; return new Promise(resolve => { finish = resolve }) }, { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toHaveProperty('name', 'AbortError')
    expect(signal.aborted).toBe(true)
    finish({ items: ['stale'] })
    await Promise.resolve()
    await expect(cache.read('search', async () => ({ items: ['fresh'] }))).resolves.toEqual({ items: ['fresh'] })
  })
  it('does not start a request for an already aborted consumer', async () => {
    const load = vi.fn(), controller = new AbortController()
    controller.abort()
    await expect(createReadCache().read('cancelled', load, { signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError')
    expect(load).not.toHaveBeenCalled()
  })
  it('clearing during an in-flight read cannot restore the stale entry or its byte accounting', async () => {
    const cache = createReadCache({ maxBytes: 200 })
    let finish
    const pending = cache.read('old', () => new Promise(resolve => { finish = resolve }))
    await Promise.resolve()
    cache.clear()
    finish({ value: 'old' })
    await pending
    const load = vi.fn(async () => ({ value: 'fresh' }))
    await cache.read('old', load)
    await cache.read('old', load)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
