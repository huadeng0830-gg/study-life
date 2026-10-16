// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('../src/composables/accountAuth.js', async () => ({ accountUser: (await import('vue')).ref(null) }))
import { accountUser } from '../src/composables/accountAuth.js'
import { useCampusLifePage } from '../src/composables/campusLifePage.js'
import { invalidateCampusReads } from '../src/services/campusReadCache.js'

const scopes = []
function page() {
  const scope = effectScope()
  scopes.push(scope)
  return { state: scope.run(useCampusLifePage), close: () => scope.stop() }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const key = ['market', { page: 0, query: '' }]
const original = { listings: [{ id: 'fictional-item', title: '虚构教材' }] }
beforeEach(() => { vi.useFakeTimers(); accountUser.value = { id: 'fictional-reader' } })
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); accountUser.value = null; vi.useRealTimers() })

describe('returning to a campus page on a slow connection', () => {
  it('shows the previous list immediately while refreshing, then renders the new list', async () => {
    const first = page()
    await first.state.load(async () => original, null, { cacheKey: key })
    first.close()
    vi.advanceTimersByTime(16000)
    const next = page(), network = deferred()
    const loading = next.state.load(() => network.promise, null, { cacheKey: key })
    expect(next.state.data.value, 'reopening must not replace previously loaded content with a spinner').toEqual(original)
    expect(next.state.loading.value).toBe(true)
    network.resolve({ listings: [{ id: 'fictional-new', title: '新到的虚构教材' }] })
    await loading
    expect(next.state.data.value.listings[0].id).toBe('fictional-new')
    expect(next.state.loading.value).toBe(false)
  })
  it('never mixes filters or accounts and does not resurrect content after logout', async () => {
    await page().state.load(async () => original, null, { cacheKey: key })
    const changedFilter = page(), network = deferred()
    const pending = changedFilter.state.load(() => network.promise, null, { cacheKey: ['market', { page: 1, query: '' }] })
    expect(changedFilter.state.data.value).toBeNull()
    accountUser.value = null
    accountUser.value = { id: 'fictional-reader' }
    const reentered = page()
    const afterLogout = reentered.state.load(() => network.promise, null, { cacheKey: key })
    expect(reentered.state.data.value).toBeNull()
    network.resolve({ listings: [] })
    await Promise.all([pending, afterLogout])
  })
  it('expires saved page content instead of showing indefinitely stale results', async () => {
    await page().state.load(async () => original, null, { cacheKey: key })
    vi.advanceTimersByTime(300001)
    const next = page(), network = deferred()
    const pending = next.state.load(() => network.promise, null, { cacheKey: key })
    expect(next.state.data.value).toBeNull()
    network.resolve({ listings: [] })
    await pending
  })
  it('isolates restored copies and clears snapshots before and after a write', async () => {
    await page().state.load(async () => original, null, { cacheKey: key })
    const cached = page(), network = deferred()
    const pending = cached.state.load(() => network.promise, null, { cacheKey: key })
    cached.state.data.value.listings[0].title = '仅此页面的修改'
    const other = page()
    const otherPending = other.state.load(() => network.promise, null, { cacheKey: key })
    expect(other.state.data.value.listings[0].title).toBe('虚构教材')
    invalidateCampusReads()
    network.resolve({ listings: [{ title: '写入前的旧响应' }] })
    await Promise.all([pending, otherPending])
    const next = page(), fresh = deferred()
    const nextPending = next.state.load(() => fresh.promise, null, { cacheKey: key })
    expect(next.state.data.value).toBeNull()
    fresh.resolve({ listings: [] })
    await nextPending
  })
  it('bounds retained screens even when many different filters have been visited', async () => {
    for (let index = 0; index < 21; index++) {
      await page().state.load(async () => original, null, { cacheKey: ['market', index] })
    }
    const next = page(), network = deferred()
    const pending = next.state.load(() => network.promise, null, { cacheKey: ['market', 0] })
    expect(next.state.data.value).toBeNull()
    network.resolve({ listings: [] })
    await pending
  })
})
