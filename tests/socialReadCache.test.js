// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { FunctionsClient } from '@supabase/functions-js'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser: ref(null) }))
vi.mock('../src/composables/accountVerification.js', () => ({ hasVerifiedContactEmail: () => true }))
vi.mock('../src/composables/accountSyncState.js', () => ({ accountSyncStatus: ref('synced'), syncAccountNow: vi.fn() }))
vi.mock('../src/composables/accountSyncMode.js', () => ({ accountSyncViaAccount: ref(true) }))
vi.mock('../src/services/supabase.js', () => ({ getSupabaseClient: async () => ({ auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke } }) }))
import { accountUser } from '../src/composables/accountAuth.js'
import { campusLifeRequest, listCampusPlaces, socialRequest } from '../src/services/social.js'
import { useCampusLifePage } from '../src/composables/campusLifePage.js'

beforeEach(() => {
  vi.useFakeTimers()
  accountUser.value = { id: 'fictional-reader' }
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mocks.getSession.mockReset().mockImplementation(async () => ({ data: { session: { user: { id: accountUser.value.id }, access_token: 'fictional-token' } } }))
  mocks.invoke.mockReset().mockResolvedValue({ data: { data: { listings: [{ title: 'Fictional listing' }] } } })
})
afterEach(() => { accountUser.value = null; vi.useRealTimers() })

describe('campus reads on a constrained connection', () => {
  it('stalled network calls release the loading state without silently retrying', async () => {
    const fetcher = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const functions = new FunctionsClient('https://fictional.example.invalid/functions/v1', { customFetch: fetcher })
    mocks.invoke.mockImplementationOnce((name, options) => functions.invoke(name, options))
    let failure = null
    const result = campusLifeRequest('market_list').catch(error => { failure = error })
    await vi.advanceTimersByTimeAsync(30001)
    expect(failure).toMatchObject({ code: 'request_timeout' })
    await result
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('reopening the same list and concurrent callers share one network read', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => campusLifeRequest('market_list', { page: 0 })))
    await campusLifeRequest('market_list', { page: 0 })
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    results[0].listings[0].title = 'Changed in one view'
    expect(results[1].listings[0].title).toBe('Fictional listing')
  })
  it('reuses reads for a minute and separates filters', async () => {
    await campusLifeRequest('market_list', { page: 0 })
    await campusLifeRequest('market_list', { page: 1 })
    vi.advanceTimersByTime(15001)
    await campusLifeRequest('market_list', { page: 0 })
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(45000)
    await campusLifeRequest('market_list', { page: 0 })
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
  })
  it('never reuses a read after a write, or deduplicates writes', async () => {
    await campusLifeRequest('market_list')
    await campusLifeRequest('market_submit', { title: 'Fictional' })
    await campusLifeRequest('market_submit', { title: 'Fictional' })
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(4)
  })
  it('does not retain failed reads', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('temporary network failure'))
    await expect(campusLifeRequest('market_list')).rejects.toThrow()
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })
  it('does not reuse the previous session even when the same account logs back in', async () => {
    await campusLifeRequest('market_list')
    accountUser.value = null
    accountUser.value = { id: 'fictional-reader' }
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })
  it('does not cache permission checks or project workbench reads', async () => {
    await campusLifeRequest('governance_access')
    await campusLifeRequest('governance_access')
    await socialRequest('project_list')
    await socialRequest('project_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(4)
  })
  it('notification and permission reads do not evict the campus list cache', async () => {
    await campusLifeRequest('market_list')
    await socialRequest('notifications_list')
    await campusLifeRequest('governance_access')
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
  })
  it('restores report screens through the real transport while checking for updates', async () => {
    const firstScope = effectScope(), nextScope = effectScope()
    try {
      mocks.invoke.mockResolvedValueOnce({ data: { data: { reports: [{ id: 'fictional-report', status: 'pending' }] } } })
      const first = firstScope.run(useCampusLifePage)
      await first.load(() => campusLifeRequest('reports_mine', { page: 0 }), null, { cacheKey: ['reports', 0] })
      firstScope.stop()
      let finish
      mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const next = nextScope.run(useCampusLifePage)
      const pending = next.load(() => campusLifeRequest('reports_mine', { page: 0 }), null, { cacheKey: ['reports', 0] })
      expect(next.data.value.reports[0].status).toBe('pending')
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      finish({ data: { data: { reports: [{ id: 'fictional-report', status: 'resolved' }] } } })
      await pending
      expect(next.data.value.reports[0].status).toBe('resolved')
      expect(mocks.invoke).toHaveBeenCalledTimes(2)
    } finally { firstScope.stop(); nextScope.stop() }
  })
  it('school profile reads on each layout do not invalidate the list cache', async () => {
    await socialRequest('profile_get')
    await campusLifeRequest('market_list')
    await socialRequest('profile_get')
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    await socialRequest('profile_save', { campus: 'Fictional campus' })
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(4)
  })
  it('rejects cached responses if the account changes while delivering them', async () => {
    await campusLifeRequest('market_list')
    const result = campusLifeRequest('market_list')
    accountUser.value = { id: 'fictional-other-reader' }
    await expect(result).rejects.toMatchObject({ code: 'account_changed' })
  })
  it('normal token refresh for the same account keeps valid reads available', async () => {
    await campusLifeRequest('market_list')
    const result = campusLifeRequest('market_list')
    accountUser.value = { id: 'fictional-reader', refreshed: true }
    await expect(result).resolves.toHaveProperty('listings')
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
  it('explicit refresh bypasses cached lists immediately', async () => {
    await campusLifeRequest('mine_list')
    await campusLifeRequest('mine_list', {}, { forceRefresh: true })
    await listCampusPlaces()
    await listCampusPlaces({ forceRefresh: true })
    expect(mocks.invoke).toHaveBeenCalledTimes(4)
  })
  it('a read started during a write cannot populate the post-write cache', async () => {
    let finishWrite
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve }))
    const write = campusLifeRequest('market_submit')
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'))
    await campusLifeRequest('market_list')
    finishWrite({ data: { data: {} } })
    await write
    await campusLifeRequest('market_list')
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
  })
})
