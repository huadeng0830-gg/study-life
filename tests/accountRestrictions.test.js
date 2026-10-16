// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
const api = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }))
vi.mock('../src/services/supabase.js', () => ({ getSupabaseClient: async () => ({ rpc: api.rpc, auth: { getSession: api.session } }) }))
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser: shallowRef(null) }))
import { accountUser } from '../src/composables/accountAuth.js'
import { accountRestrictions, restrictionStatus, accountCloudRestricted, accountPublishingRestricted, refreshAccountRestrictions, clearAccountRestrictions, tickRestrictionClock, acknowledgeRestriction } from '../src/composables/accountRestrictions.js'
function query(result) { return { setHeader: vi.fn().mockReturnThis(), abortSignal: vi.fn(() => result) } }
function snapshot(restrictions = {}) { return { restrictions, legacyBannedUntil: null, serverTime: new Date().toISOString() } }
beforeEach(() => {
  clearAccountRestrictions(); api.rpc.mockReset(); api.session.mockReset()
  accountUser.value = { id: 'fictional-a' }
  api.session.mockImplementation(async () => ({ data: { session: { access_token: 'fictional-token', user: { id: accountUser.value.id } } } }))
})
afterEach(() => { clearAccountRestrictions(); accountUser.value = null; vi.useRealTimers() })
describe('账号处理通知状态', () => {
  it('同账号在途请求复用，短期刷新去重，使用服务器时钟自动到期', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
    api.rpc.mockReturnValue(query(Promise.resolve({ data: snapshot({ account: { enabled: true, expiresAt: '2026-10-16T12:01:00Z' }, publish: { enabled: true, expiresAt: null } }) })))
    await Promise.all([refreshAccountRestrictions(), refreshAccountRestrictions()])
    expect(api.rpc).toHaveBeenCalledTimes(1)
    expect(accountCloudRestricted.value).toBe(true)
    expect(accountPublishingRestricted.value).toBe(true)
    await refreshAccountRestrictions(); expect(api.rpc).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-10-16T12:01:00Z')); tickRestrictionClock()
    expect(accountCloudRestricted.value).toBe(false)
    expect(accountPublishingRestricted.value).toBe(true)
  })
  it('账号切换时丢弃旧请求结果，不能显示前一账号的原因', async () => {
    let resolve
    api.rpc.mockReturnValue(query(new Promise(done => { resolve = done })))
    const task = refreshAccountRestrictions()
    await vi.waitFor(() => expect(api.rpc).toHaveBeenCalled())
    accountUser.value = { id: 'fictional-b' }; clearAccountRestrictions()
    resolve({ data: snapshot({ account: { reason: 'fictional private reason', enabled: true, expiresAt: null } }) })
    await task
    expect(accountRestrictions.value).toBeNull()
    expect(accountCloudRestricted.value).toBe(false)
  })
  it('确认通知仅更新匹配版本的已读标记，不解除限制', async () => {
    api.rpc.mockReturnValueOnce(query(Promise.resolve({ data: snapshot({ publish: { scope: 'publish', enabled: true, expiresAt: null, revision: 'fictional-v1', unread: true } }) })))
      .mockReturnValueOnce(query(Promise.resolve({ data: true })))
    await refreshAccountRestrictions()
    expect(await acknowledgeRestriction('publish', 'fictional-v1')).toBe(true)
    expect(accountRestrictions.value.restrictions.publish.unread).toBe(false)
    expect(accountPublishingRestricted.value).toBe(true)
    expect(api.rpc).toHaveBeenLastCalledWith('platform_ack_restriction', { p_scope: 'publish', p_revision: 'fictional-v1' })
  })
  it('无法读取时保留已有封禁，不当作成功解除', async () => {
    api.rpc.mockReturnValueOnce(query(Promise.resolve({ data: snapshot({ account: { enabled: true, expiresAt: null } }) })))
      .mockReturnValueOnce(query(Promise.resolve({ error: { message: 'fictional unavailable' } })))
    await refreshAccountRestrictions()
    await refreshAccountRestrictions({ force: true })
    expect(restrictionStatus.value).toBe('error')
    expect(accountCloudRestricted.value).toBe(true)
  })
})
