// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('../src/composables/accountAuth.js', async () => ({ accountUser: (await import('vue')).ref(null) }))
vi.mock('../src/services/campusLife.js', () => ({ campusLifeFavorites: vi.fn(), setCampusFavorite: vi.fn() }))

import { accountUser } from '../src/composables/accountAuth.js'
import { campusLifeFavorites, setCampusFavorite } from '../src/services/campusLife.js'
import { useCampusFavorites } from '../src/composables/campusFavorites.js'
import { useCampusLifePage } from '../src/composables/campusLifePage.js'
import { useCampusBusyKeys } from '../src/composables/campusRequest.js'
import { useCampusConfirm } from '../src/composables/campusConfirm.js'
import { useCampusLifeDraft } from '../src/composables/campusLifeDraft.js'

let scope
let owner = 0
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
beforeEach(() => { vi.resetAllMocks(); accountUser.value = { id: `fictional-${++owner}` }; scope = effectScope() })
afterEach(() => scope.stop())

describe('campus asynchronous account isolation', () => {
  it('only lets the latest action update feedback, while earlier successes still refresh', async () => {
    const page = scope.run(useCampusLifePage)
    const earlier = deferred()
    const first = page.act(() => earlier.promise, '旧操作')
    await page.act(async () => {}, '新操作')
    earlier.reject(new Error('较早的失败'))
    expect(await first).toBe(false)
    expect(page.notice.value).toBe('新操作')
    expect(page.actionError.value).toBe('')
  })
  it('deduplicates row actions and never unlocks a new account from an old completion', async () => {
    const rows = scope.run(useCampusBusyKeys)
    const old = deferred(), next = deferred()
    const first = rows.run('same-row', () => old.promise)
    const duplicate = vi.fn()
    expect(await rows.run('same-row', duplicate)).toBe(false)
    expect(duplicate).not.toHaveBeenCalled()
    accountUser.value = { id: 'other-account' }
    const second = rows.run('same-row', () => next.promise)
    old.resolve()
    await first
    expect(rows.busy('same-row')).toBe(true)
    next.resolve()
    await second
    expect(rows.busy('same-row')).toBe(false)
  })
  it('drops a confirmation and its captured action when the account changes', async () => {
    const dialog = scope.run(useCampusConfirm)
    const mutate = vi.fn()
    dialog.ask({ title: '确认操作', onConfirm: mutate })
    accountUser.value = { id: 'other-account' }
    await dialog.confirm()
    expect(dialog.pending.value).toBeNull()
    expect(mutate).not.toHaveBeenCalled()
  })
  it('exposes draft storage failure and recovers on a later save', () => {
    const draft = scope.run(() => useCampusLifeDraft('test-storage', { title: '' }))
    const store = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    draft.value.value.title = '虚构草稿'
    expect(draft.saveError.value).toContain('暂未保存')
    expect(draft.savedRevision.value).toBe(0)
    store.mockRestore()
    draft.value.value.title = '下一份虚构草稿'
    expect(draft.saveError.value).toBe('')
    expect(draft.savedRevision.value).toBe(1)
  })
  it('coalesces favorites across consumers for the same target', async () => {
    const first = scope.run(useCampusFavorites), second = scope.run(useCampusFavorites)
    campusLifeFavorites.mockResolvedValue({ favorites: [] })
    await first.load()
    const pending = deferred()
    setCampusFavorite.mockReturnValue(pending.promise)
    const one = first.toggle('course', 'fixture-course')
    const two = second.toggle('course', 'fixture-course')
    expect(setCampusFavorite).toHaveBeenCalledTimes(1)
    pending.resolve()
    expect(await one).toBe(true)
    expect(await two).toBe(true)
    expect(second.favorites.value.size).toBe(1)
  })
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
    // act() 报告的是「这次操作对当前界面还算不算数」，而不是服务端返回了什么。
    // 账号切换后它必须报告失败，即使服务端其实已经写入了。
    expect(await action).toBe(false)
    expect(page.notice.value).toBe('')
  })
  it('reports a successful action even when the server returns nothing', async () => {
    const page = scope.run(useCampusLifePage)
    // 多个 campus 变更接口成功时 resolve undefined。旧的 act() 直接透传返回值，
    // 调用方的 `if (result)` 会误判成失败：提示成功但表单不关闭、列表不刷新。
    await expect(page.act(async () => undefined, '已提交。')).resolves.toBe(true)
    expect(page.notice.value).toBe('已提交。')
    // 同样地，0 / false / '' 也不能被当成失败。
    await expect(page.act(async () => 0)).resolves.toBe(true)
    await expect(page.act(async () => '')).resolves.toBe(true)
    expect(page.error.value).toBe('')
  })
  it('reports a failed action as false and surfaces the server message', async () => {
    const page = scope.run(useCampusLifePage)
    await expect(page.act(async () => { throw new Error('请稍后再试') })).resolves.toBe(false)
    // 写失败落在 actionError，不落在 error：error 会把整张列表换成错误态，
    // 而列表此时并没有坏。
    expect(page.actionError.value).toBe('请稍后再试')
    expect(page.error.value).toBe('')
    expect(page.notice.value).toBe('')
  })
  it('keeps a failed write out of the read-error slot', async () => {
    const page = scope.run(useCampusLifePage)
    await page.load(async () => ({ rows: [1, 2, 3] }))
    await page.act(async () => { throw new Error('添加到日程失败') })
    expect(page.error.value).toBe('')
    expect(page.data.value.rows).toHaveLength(3)
    expect(page.actionError.value).toBe('添加到日程失败')
  })
  it('routes a local failure through actionError so the list survives', async () => {
    const page = scope.run(useCampusLifePage)
    await page.load(async () => ({ rows: [1] }))
    // 校园活动页曾把「加不进本机日程」写进读取错误槽，结果整屏活动列表
    // 被一条本地错误顶掉，还只剩一个没有意义的「重试」。
    page.reportFailure('这条活动缺少完整的开始或结束时间。')
    expect(page.error.value).toBe('')
    expect(page.actionError.value).toContain('缺少完整')
    expect(page.data.value.rows).toHaveLength(1)
  })
  it('keeps a success banner across the refresh that follows it', async () => {
    const page = scope.run(useCampusLifePage)
    await page.load(async () => ({ rows: [1] }))
    await page.act(async () => {}, '内容已撤回。')
    await page.load(async () => ({ rows: [1] }))
    // 动作之后一定会跟一次刷新；刷新若清掉提示，用户永远看不到自己刚做的操作。
    expect(page.notice.value).toBe('内容已撤回。')
    page.dismissNotice()
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
