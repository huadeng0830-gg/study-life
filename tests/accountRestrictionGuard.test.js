import { describe, expect, it, vi } from 'vitest'
import { assertAccountAccess, requiresPublishing } from '../supabase/functions/_shared/accountRestrictions.js'
class ApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }
describe('业务权限检查', () => {
  it.each([
    ['campus-life', 'content_resubmit'], ['campus-life', 'matter_clarification_reply'],
    ['campus-life', 'matter_set_choice'], ['campus-life', 'message_send'],
    ['campus-social', 'campus_place_rating_save'], ['campus-social', 'project_deliverable_draft_save'],
    ['campus-community', 'submit'],
  ])('限制 %s 的发布及内容修改动作 %s', (service, action) => expect(requiresPublishing(service, action)).toBe(true))
  it('私信阅读与发送分开，收藏、撤回和普通读取不受禁发影响', () => {
    expect(requiresPublishing('campus-community', 'message_thread')).toBe(false)
    expect(requiresPublishing('campus-community', 'message_thread', { body: '虚构文本' })).toBe(true)
    expect(requiresPublishing('campus-social', 'project_meeting_respond', { response: 'decline' })).toBe(false)
    expect(requiresPublishing('campus-social', 'project_meeting_respond', { response: 'propose' })).toBe(true)
    expect(requiresPublishing('campus-social', 'project_adjustment_decide', { decisionNote: '虚构说明' })).toBe(true)
    expect(requiresPublishing('campus-social', 'project_adjustment_decide', { decisionNote: '' })).toBe(false)
    for (const action of ['content_withdraw', 'matter_response_delete', 'favorite_set', 'mine_list']) expect(requiresPublishing('campus-life', action)).toBe(false)
  })
  it('每次检查实时数据库状态，不从旧令牌或客户端缓存授权', async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { allowed: true } }).mockResolvedValueOnce({ data: { allowed: false, code: 'publishing_restricted' } }) }
    await assertAccountAccess(client, 'fictional-user', 'campus-life', 'content_resubmit', {}, ApiError)
    await expect(assertAccountAccess(client, 'fictional-user', 'campus-life', 'content_resubmit', {}, ApiError)).rejects.toMatchObject({ status: 403, code: 'publishing_restricted' })
    expect(client.rpc).toHaveBeenCalledTimes(2)
    expect(client.rpc).toHaveBeenLastCalledWith('platform_account_access', { p_actor: 'fictional-user', p_publish: true })
  })
  it('全账号封禁也拒绝读取，权限服务失败时不继续业务操作', async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { allowed: false, code: 'account_suspended' } }).mockResolvedValueOnce({ error: new Error('fictional unavailable') }).mockResolvedValueOnce({ data: {} }) }
    await expect(assertAccountAccess(client, 'fictional-user', 'campus-life', 'mine_list', {}, ApiError)).rejects.toMatchObject({ code: 'account_suspended', status: 403 })
    for (let n = 0; n < 2; n++) await expect(assertAccountAccess(client, 'fictional-user', 'campus-life', 'mine_list', {}, ApiError)).rejects.toMatchObject({ code: 'service_unavailable', status: 503 })
  })
})
