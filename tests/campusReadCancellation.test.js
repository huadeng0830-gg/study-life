// @vitest-environment happy-dom
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ invoke: vi.fn(), session: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser: ref({ id: 'fictional-reader' }) }))
vi.mock('../src/composables/accountVerification.js', () => ({ hasVerifiedContactEmail: () => true }))
vi.mock('../src/composables/accountSyncState.js', () => ({ accountSyncStatus: ref('synced'), syncAccountNow: vi.fn() }))
vi.mock('../src/composables/accountSyncMode.js', () => ({ accountSyncViaAccount: ref(true) }))
vi.mock('../src/services/supabase.js', () => ({ getSupabaseClient: async () => ({ auth: { getSession: mock.session }, functions: { invoke: mock.invoke } }) }))
import { useCampusLifePage } from '../src/composables/campusLifePage.js'
import { campusLifeSearch } from '../src/services/campusLife.js'
import { accountUser } from '../src/composables/accountAuth.js'
let scope
beforeEach(() => {
  accountUser.value = { id: 'fictional-reader' }
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mock.session.mockResolvedValue({ data: { session: { user: { id: 'fictional-reader' }, access_token: 'fictional' } } })
  mock.invoke.mockReset().mockImplementation(async (_name, options) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
  scope = effectScope()
})
afterEach(() => { scope.stop(); vi.restoreAllMocks() })
describe('campus read lifecycle cancellation', () => {
  it('aborts a superseded search at the real Edge transport and preserves the latest result', async () => {
    const page = scope.run(() => useCampusLifePage())
    const old = page.load(signal => campusLifeSearch('first', {}, { signal }))
    await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1))
    const oldSignal = mock.invoke.mock.calls[0][1].signal
    mock.invoke.mockResolvedValueOnce({ data: { data: { results: ['latest'] } } })
    await page.load(signal => campusLifeSearch('second', {}, { signal }))
    await old
    expect(oldSignal.aborted).toBe(true)
    expect(page.data.value).toEqual({ results: ['latest'] })
    expect(page.error.value).toBe('')
  })
  it('aborts pending reads on scope disposal and account switch', async () => {
    const page = scope.run(() => useCampusLifePage({ reloadOnAccountChange: false }))
    const pending = page.load(signal => campusLifeSearch('dispose', {}, { signal }))
    await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1))
    const signal = mock.invoke.mock.calls[0][1].signal
    accountUser.value = null
    await nextTick()
    await pending
    expect(signal.aborted).toBe(true)
    expect(page.data.value).toBe(null)
    expect(page.error.value).toBe('')
  })
})
