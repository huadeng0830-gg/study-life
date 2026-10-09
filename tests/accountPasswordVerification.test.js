// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => sdk)
const user = { id: 'fictional-account', email: 'student@example.test' }
let auth
let service

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_example')
  auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session: { user } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
  sdk.createClient.mockReturnValue({ auth })
  service = await import('../src/services/supabase.js')
})

afterEach(() => vi.unstubAllEnvs())

describe('当前密码验证的会话隔离', () => {
  it('验证使用不持久化的独立客户端，完成后撤销临时会话，不返回凭据', async () => {
    const result = await service.verifyAccountCurrentPassword(user.email, '  Example123!  ')
    expect(sdk.createClient).toHaveBeenCalledWith('https://example.supabase.co', 'sb_publishable_example', {
      auth: { storageKey: 'study-life-password-check', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: '  Example123!  ' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(result).toEqual({ data: { user }, error: null })
    expect(result.data).not.toHaveProperty('session')
  })

  it('错误密码不生成会话，保留服务错误供账号层转为可读提示', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'invalid_credentials' } })
    const result = await service.verifyAccountCurrentPassword(user.email, 'WrongExample123!')
    expect(result.error.code).toBe('invalid_credentials')
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('临时会话清理失败时停止后续密码更新', async () => {
    const error = { code: 'over_request_rate_limit' }
    auth.signOut.mockResolvedValue({ error })
    await expect(service.verifyAccountCurrentPassword(user.email, 'Example123!')).rejects.toEqual(error)
  })

  it('服务配置缺失时不创建验证客户端', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    await expect(service.verifyAccountCurrentPassword(user.email, 'Example123!')).rejects.toThrow('account_unavailable')
    expect(sdk.createClient).not.toHaveBeenCalled()
  })
})
