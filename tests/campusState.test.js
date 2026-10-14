// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('../src/composables/accountAuth.js', async () => ({ accountUser: (await import('vue')).ref(null) }))
vi.mock('../src/services/campusLife.js', () => ({ campusLifeFavorites: vi.fn(), setCampusFavorite: vi.fn() }))

import { accountUser } from '../src/composables/accountAuth.js'
import { campusLifeFavorites, setCampusFavorite } from '../src/services/campusLife.js'
import { useCampusFavorites } from '../src/composables/campusFavorites.js'
import { useCampusLifePage } from '../src/composables/campusLifePage.js'

let scope
let owner = 0
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
beforeEach(() => { vi.resetAllMocks(); accountUser.value = { id: `fictional-${++owner}` }; scope = effectScope() })
afterEach(() => scope.stop())

describe('campus asynchronous account isolation', () => {
  it('finishes anonymous loading and exposes the login error', async () => {
    accountUser.value = null
    const page = scope.run(useCampusLifePage)
    await page.load(async () => { throw new Error('请先登录') })
    expect(page.loading.value).toBe(false)
    expect(page.error.value).toBe('请先登录')
  })
  it('discards an action result after switching accounts', async () => {
    const page = scope.run(useCampusLifePage)
    const pending = deferred()
    const action = page.act(() => pending.promise)
    accountUser.value = { id: 'other-account' }
    pending.resolve({ saved: true })
    expect(await action).toBeNull()
    expect(page.notice.value).toBe('')
  })
  it('discards a request result after unmount', async () => {
    const page = scope.run(useCampusLifePage)
    const pending = deferred()
    const request = page.load(() => pending.promise)
    scope.stop()
    pending.resolve({ private: 'fixture' })
    expect(await request).toBeNull()
    expect(page.data.value).toBeNull()
  })
  it('retries failed favorite reads instead of caching the failure', async () => {
    const favorites = scope.run(useCampusFavorites)
    campusLifeFavorites.mockRejectedValueOnce(new Error('暂时离线')).mockResolvedValueOnce({ favorites: [{ target_type: 'course', target_id: 'fixture-course' }] })
    await favorites.load()
    await favorites.load()
    expect(campusLifeFavorites).toHaveBeenCalledTimes(2)
    expect(favorites.favorites.value.has('course:fixture-course')).toBe(true)
    expect(favorites.error.value).toBe('')
  })
  it('does not put a completed favorite operation into the new account', async () => {
    const favorites = scope.run(useCampusFavorites)
    campusLifeFavorites.mockResolvedValue({ favorites: [] })
    await favorites.load()
    const pending = deferred()
    setCampusFavorite.mockReturnValue(pending.promise)
    const action = favorites.toggle('course', 'fixture-course')
    accountUser.value = { id: 'new-account' }
    pending.resolve({ saved: true })
    expect(await action).toBeNull()
    expect(favorites.favorites.value.size).toBe(0)
    expect(favorites.loading.value).toBe(false)
  })
})
