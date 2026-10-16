import { describe, expect, it, vi } from 'vitest'
import { attachAccountRestrictions, setAccountRestriction } from '../supabase/functions/platform-admin/restrictions.js'
import { PlatformAdminError } from '../supabase/functions/platform-admin/handler.js'
const payload = { actorUserId: 'fictional-owner', targetUserId: 'fictional-user', scope: 'account', enabled: false, reason: '虚构解除说明', expectedRevision: 'fictional-revision' }
function client() { return { rpc: vi.fn(async () => ({ data: { notificationSaved: true } })), auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { banned_until: '2120-01-01T00:00:00Z' } } })), updateUserById: vi.fn(async () => ({ error: null })) } } } }
describe('账号限制服务', () => {
  it('先原子保存限制与通知，再解除旧原生封禁；失败不伪报完全恢复', async () => {
    const db = client()
    db.auth.admin.updateUserById.mockResolvedValue({ error: new Error('fictional auth unavailable') })
    await expect(setAccountRestriction(db, payload, PlatformAdminError)).resolves.toMatchObject({ legacyBanRemaining: true, notificationSaved: true })
    expect(db.rpc.mock.invocationCallOrder[0]).toBeLessThan(db.auth.admin.updateUserById.mock.invocationCallOrder[0])
    expect(db.rpc).toHaveBeenCalledWith('platform_set_account_restriction', expect.objectContaining({ p_actor: payload.actorUserId, p_scope: 'account', p_enabled: false, p_revision: payload.expectedRevision }))
  })
  it('状态冲突不会修改 Auth；禁发不会接触账号登录状态', async () => {
    const db = client()
    db.rpc.mockResolvedValueOnce({ error: { message: 'PLATFORM_STATE_CHANGED' } })
    await expect(setAccountRestriction(db, payload, PlatformAdminError)).rejects.toMatchObject({ code: 'state_changed', status: 409 })
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
    await setAccountRestriction(db, { ...payload, scope: 'publish' }, PlatformAdminError)
    expect(db.auth.admin.getUserById).toHaveBeenCalledTimes(1)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })
  it('仅对返回的一页账号批量取限制，不逐账号发请求', async () => {
    const rows = [{ user_id: 'one', scope: 'publish', enabled: true, expires_at: null, reason: '虚构原因', revision: 'fictional-version' }]
    const inside = vi.fn(async () => ({ data: rows }))
    const select = vi.fn(() => ({ in: inside }))
    const db = { from: vi.fn(() => ({ select })) }
    const page = await attachAccountRestrictions(db, { users: [{ id: 'one', status: 'active' }, { id: 'two', status: 'active' }], total: 2 })
    expect(db.from).toHaveBeenCalledTimes(1)
    expect(inside).toHaveBeenCalledWith('user_id', ['one', 'two'])
    expect(page.users[0].restrictions.publish.reason).toBe('虚构原因')
    expect(page.users[1].restrictions).toEqual({})
  })
})
