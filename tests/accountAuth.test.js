// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const adapter = vi.hoisted(() => ({ getSupabaseClient: vi.fn(), getSupabaseConfig: vi.fn() }))
vi.mock('../src/services/supabase.js', () => adapter)

let account
let client
let emitAuth
const user = { id: 'fictional-account', email: 'student@example.test' }
const session = { user }

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  window.history.replaceState(null, '', '/#/')
  adapter.getSupabaseConfig.mockReturnValue({ url: 'https://example.supabase.co', key: 'sb_publishable_example' })
  client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn((listener) => {
        emitAuth = listener
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signUp: vi.fn().mockResolvedValue({ data: { user, session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      setSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  }
  adapter.getSupabaseClient.mockResolvedValue(client)
  account = await import('../src/composables/accountAuth.js')
})

afterEach(() => vi.restoreAllMocks())

describe('邮箱注册与账号生命周期', () => {
  it('无效表单不会调用账号服务，登录兼容已有的较短密码', async () => {
    const result = await account.registerAccount({ email: 'invalid', password: 'short', confirmation: 'other' })
    expect(Object.keys(result.errors)).toEqual(['email', 'password', 'confirmation'])
    expect(adapter.getSupabaseClient).not.toHaveBeenCalled()
    expect(account.validateAccountForm({ email: user.email, password: 'old123', mode: 'login' })).toEqual({})
  })

  it('规范化邮箱但保留密码原文；需要验证时不把用户标成已登录', async () => {
    const password = '  Example password  '
    const result = await account.registerAccount({ email: ' STUDENT@EXAMPLE.TEST ', password, confirmation: password })
    expect(result).toEqual({ ok: true, needsConfirmation: true })
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: user.email, password, options: { emailRedirectTo: window.location.origin + '/' },
    })
    expect(account.accountUser.value).toBeNull()
    expect(account.accountBusy.value).toBe(false)
  })

  it('关闭邮箱验证的服务返回 session 时直接完成登录', async () => {
    client.auth.signUp.mockResolvedValue({ data: { user, session }, error: null })
    const result = await account.registerAccount({ email: user.email, password: 'Example123!', confirmation: 'Example123!' })
    expect(result).toEqual({ ok: true, needsConfirmation: false })
    expect(account.accountUser.value).toEqual(user)
  })

  it('重复注册的隐藏响应不会产生登录会话', async () => {
    client.auth.signUp.mockResolvedValue({ data: { user: { ...user, identities: [] }, session: null }, error: null })
    expect((await account.registerAccount({ email: user.email, password: 'Example123!', confirmation: 'Example123!' })).needsConfirmation).toBe(true)
    expect(account.accountUser.value).toBeNull()
  })

  it('服务拒绝时返回可读错误并解除提交锁', async () => {
    client.auth.signUp.mockResolvedValue({ data: {}, error: { code: 'weak_password' } })
    const result = await account.registerAccount({ email: user.email, password: '12345678', confirmation: '12345678' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('密码强度不足')
    expect(account.accountBusy.value).toBe(false)
  })

  it('登录、会话恢复和远端退出事件都会更新账号状态', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session }, error: null })
    await account.initializeAccountAuth()
    expect(account.accountUser.value).toEqual(user)
    emitAuth('SIGNED_OUT', null)
    expect(account.accountUser.value).toBeNull()
    await account.loginAccount({ email: user.email, password: 'Example123!' })
    expect(account.accountUser.value).toEqual(user)
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: 'Example123!' })
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('恢复会话的旧响应不会覆盖先到的退出事件', async () => {
    let finish
    client.auth.getSession.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = account.initializeAccountAuth()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    emitAuth('SIGNED_OUT', null)
    finish({ data: { session }, error: null })
    await pending
    expect(account.accountUser.value).toBeNull()
  })

  it('退出当前设备会话并清理本机业务数据与账号归属标记', async () => {
    localStorage.setItem('sl_courses', '[{"id":"demo-course","name":"虚构课程"}]')
    localStorage.setItem('sl_notes', 'fictional note')
    await account.loginAccount({ email: user.email, password: 'Example123!' })
    expect((await account.logoutAccount()).ok).toBe(true)
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(account.accountUser.value).toBeNull()
    expect(localStorage.getItem('sl_courses')).toBeNull()
    expect(localStorage.getItem('sl_notes')).toBeNull()
    expect(localStorage.getItem('study-life-data-owner')).toBeNull()
  })

  it('全设备退出请求会撤销其它设备会话', async () => {
    await account.loginAccount({ email: user.email, password: 'Example123!' })
    expect((await account.logoutAccount({ scope: 'global' })).ok).toBe(true)
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(account.accountUser.value).toBeNull()
  })

  it('重发邮件使用同一个安全回跳地址', async () => {
    expect((await account.resendAccountConfirmation(' STUDENT@EXAMPLE.TEST ')).ok).toBe(true)
    expect(client.auth.resend).toHaveBeenCalledWith({
      type: 'signup', email: user.email, options: { emailRedirectTo: window.location.origin + '/' },
    })
  })

  it('邮箱未验证的登录提示可以引导重发验证邮件', async () => {
    client.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'email_not_confirmed' } })
    const result = await account.loginAccount({ email: user.email, password: 'Example123!' })
    expect(result.code).toBe('email_not_confirmed')
    expect(result.message).toContain('邮箱验证')
    expect(account.accountUser.value).toBeNull()
  })

  it('重复提交只产生一次注册请求', async () => {
    let finish
    client.auth.signUp.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const credentials = { email: user.email, password: 'Example123!', confirmation: 'Example123!' }
    const pending = account.registerAccount(credentials)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect((await account.registerAccount(credentials)).ok).toBe(false)
    expect(client.auth.signUp).toHaveBeenCalledTimes(1)
    finish({ data: { user, session: null }, error: null })
    await pending
    expect(account.accountBusy.value).toBe(false)
  })

  it('未配置服务时可继续使用本机，不创建客户端', async () => {
    adapter.getSupabaseConfig.mockReturnValue(null)
    expect((await account.initializeAccountAuth()).ok).toBe(false)
    expect(adapter.getSupabaseClient).not.toHaveBeenCalled()
    expect(account.accountOpen.value).toBe(false)
  })

  it('初始化网络失败后允许重试，不重复安装监听器', async () => {
    client.auth.getSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthRetryableFetchError' } })
    // 用户点过一次登录/注册，才允许把失败写进会被渲染的 accountAuthError。
    account.markAccountAttempted()
    expect((await account.initializeAccountAuth()).ok).toBe(false)
    expect(account.accountAuthError.value).toContain('网络')
    expect((await account.initializeAccountAuth()).ok).toBe(true)
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('冷启动的网络抖动不会变成用户面前的一条账号错误', async () => {
    // main.js 在挂载后无条件 void initializeAccountAuth()。手机弱网冷启动失败
    // 一次，用户**什么都没做**，却会在打开面板时看到「无法连接账号服务」，
    // 而那条路径上没有任何重试按钮。所以：没人操作过时不写界面状态。
    account.resetAccountAttempted()
    client.auth.getSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthRetryableFetchError' } })
    expect((await account.initializeAccountAuth()).ok).toBe(false)
    expect(account.accountAuthError.value, '无人操作时不应把启动抖动摆到界面上').toBe('')
  })
})

describe('邮箱回调和 Hash Router', () => {
  it('SDK 在路由启动前消费 fragment，之后清理令牌并打开账号面板', async () => {
    window.history.replaceState(null, '', '/?keep=demo#access_token=fictional-access&refresh_token=fictional-refresh&type=signup')
    client.auth.getSession.mockImplementation(async () => {
      expect(window.location.hash).toContain('access_token=fictional-access')
      return { data: { session }, error: null }
    })
    expect(await account.prepareAccountCallback()).toBe(true)
    expect(window.location.hash).toBe('#/')
    expect(window.location.search).toBe('?keep=demo')
    expect(window.location.href).not.toContain('fictional-access')
    expect(account.accountUser.value).toEqual(user)
    expect(account.accountOpen.value).toBe(true)
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: 'fictional-access', refresh_token: 'fictional-refresh' })
  })

  it('网页 PKCE 邮件回跳先交换 code，再清理地址栏', async () => {
    window.history.replaceState(null, '', '/?keep=demo&code=fictional-code')
    client.auth.getSession.mockImplementation(async () => {
      expect(window.location.search).toContain('code=fictional-code')
      return { data: { session: null }, error: null }
    })
    client.auth.exchangeCodeForSession.mockImplementation(async (code) => {
      expect(window.location.search).toContain('code=fictional-code')
      return { data: { session }, error: null }
    })
    expect(await account.prepareAccountCallback()).toBe(true)
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('fictional-code')
    expect(window.location.search).toBe('?keep=demo')
    expect(window.location.hash).toBe('#/')
    expect(account.accountUser.value).toEqual(user)
  })

  it('过期链接显示重发提示，不泄漏服务端错误详情', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=private-detail')
    await account.prepareAccountCallback()
    expect(account.accountCallbackError.value).toContain('已过期')
    expect(account.accountCallbackError.value).not.toContain('private-detail')
    expect(window.location.hash).toBe('#/')
    await account.initializeAccountAuth()
    expect(account.accountCallbackError.value).toContain('已过期')
  })

  it('普通 Hash Router 地址不进入验证流程', async () => {
    window.history.replaceState(null, '', '/#/schedule')
    expect(await account.prepareAccountCallback()).toBe(false)
    expect(window.location.hash).toBe('#/schedule')
    expect(account.accountOpen.value).toBe(false)
    expect(adapter.getSupabaseClient).not.toHaveBeenCalled()
  })
})

describe('前端配置的密钥边界', () => {
  it('只接受公开密钥，拒绝 secret/service_role 以及非本机 HTTP 地址', async () => {
    const { getSupabaseConfig, supabaseClientOptions, ACCOUNT_STORAGE_KEY } = await vi.importActual('../src/services/supabase.js')
    const url = 'https://example.supabase.co'
    const key = 'sb_publishable_example'
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toEqual({ url, key })
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' })).toBeNull()
    const legacy = (role) => 'header.' + btoa(JSON.stringify({ role })) + '.signature'
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('service_role') })).toBeNull()
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: legacy('anon') })).not.toBeNull()
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: 'http://example.test', VITE_SUPABASE_PUBLISHABLE_KEY: key })).toBeNull()
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: key })).not.toBeNull()
    expect(ACCOUNT_STORAGE_KEY.startsWith('sl_')).toBe(false)
    expect(supabaseClientOptions(false).auth).toMatchObject({ flowType: 'pkce', detectSessionInUrl: false })
    expect(supabaseClientOptions(true).auth).toMatchObject({ flowType: 'implicit', detectSessionInUrl: false })
  })
})
