// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const adapter = vi.hoisted(() => ({ getSupabaseClient: vi.fn(), getSupabaseConfig: vi.fn(() => null) }))
vi.mock('../src/services/supabase.js', () => adapter)
import { accountUser } from '../src/composables/accountAuth.js'
import { requestAccountSync } from '../src/services/accountSync.js'
let client
let query
let rpcQuery
beforeEach(() => {
  vi.clearAllMocks()
  accountUser.value = { id: 'fictional-account-a' }
  query = { select: vi.fn(), eq: vi.fn(), setHeader: vi.fn(), abortSignal: vi.fn(), maybeSingle: vi.fn() }
  query.setHeader.mockReturnValue(query); query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.abortSignal.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue({ data: null, error: null, status: 200 })
  rpcQuery = { setHeader: vi.fn(), abortSignal: vi.fn(async () => ({ data: { ok: true, revision: 1 }, error: null, status: 200 })) }
  rpcQuery.setHeader.mockReturnValue(rpcQuery)
  client = { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'fictional-account-a' }, access_token: 'fictional-session-a' } }, error: null })) }, from: vi.fn(() => query), rpc: vi.fn(() => rpcQuery) }
  adapter.getSupabaseClient.mockResolvedValue(client)
})
describe('账号同步传输边界', () => {
  it('读取仅查询当前账号，未登录或不同身份不会发送请求', async () => {
    expect((await requestAccountSync('pull', { accountUserId: 'different-account' })).status).toBe(401)
    expect(adapter.getSupabaseClient).not.toHaveBeenCalled()
    await requestAccountSync('pull', { accountUserId: 'fictional-account-a' }, new AbortController().signal)
    expect(query.eq).toHaveBeenCalledWith('user_id', 'fictional-account-a')
  })
  it('同步轮询可以只查询版本元数据，不读取完整快照', async () => {
    query.maybeSingle.mockResolvedValue({ data: { revision: 9, updated_at: '2026-10-08T00:00:00Z', device_name: '虚构设备' }, error: null, status: 200 })
    const result = await requestAccountSync('probe', { accountUserId: 'fictional-account-a' })
    const payload = await result.json()
    expect(query.select).toHaveBeenCalledWith('revision,updated_at,device_name')
    expect(payload).toMatchObject({ exists: true, revision: 9 })
    expect(payload.data).toBeUndefined()
  })
  it('写入由服务端决定 owner，携带期望版本并保留 CAS 冲突', async () => {
    rpcQuery.abortSignal.mockResolvedValue({ data: { conflict: true, revision: 4 }, error: null, status: 200 })
    const result = await requestAccountSync('push', { accountUserId: 'fictional-account-a', expectedRevision: 3, data: { sample: true }, deviceName: '虚构设备' })
    expect(result.status).toBe(409)
    expect(rpcQuery.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer fictional-session-a')
    expect(client.rpc).toHaveBeenCalledWith('write_account_sync_snapshot', { expected_revision: 3, snapshot_payload: { sample: true }, source_device_name: '虚构设备' })
  })
  it('SDK 载入期间退出会取消请求', async () => {
    adapter.getSupabaseClient.mockImplementation(async () => { accountUser.value = null; return client })
    expect((await requestAccountSync('pull', { accountUserId: 'fictional-account-a' })).status).toBe(401)
    expect(client.from).not.toHaveBeenCalled()
  })
  it('SDK 实际会话属于另一账号时拒绝写入', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'fictional-account-b' }, access_token: 'fictional-session-b' } }, error: null })
    expect((await requestAccountSync('push', { accountUserId: 'fictional-account-a', data: {} })).status).toBe(401)
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('延迟取令牌期间切换账号，请求仍只绑定原账号令牌，旧响应被丢弃', async () => {
    rpcQuery.abortSignal.mockImplementation(async () => {
      accountUser.value = { id: 'fictional-account-b' }
      return { data: { ok: true, revision: 2 }, error: null, status: 200 }
    })
    const result = await requestAccountSync('push', { accountUserId: 'fictional-account-a', data: {} })
    expect(result.status).toBe(401)
    expect(rpcQuery.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer fictional-session-a')
  })
  it('数据库未部署与权限拒绝给出可读错误', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST205' }, status: 404 })
    const response = await requestAccountSync('pull', { accountUserId: 'fictional-account-a' })
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('尚未部署')
  })
})
