// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getSupabaseClient: vi.fn(), getSupabaseConfig: vi.fn() }))
vi.mock('../src/services/supabase.js', () => mocks)
let auth, account
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_ACCOUNT_OAUTH_PROVIDERS', 'github')
  vi.stubEnv('VITE_ACCOUNT_EMAIL_SIGNUP_ENABLED', 'false')
  vi.stubEnv('VITE_ACCOUNT_EMAIL_DELIVERY_ENABLED', 'false')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  window.history.replaceState(null, '', '/#/')
  mocks.getSupabaseConfig.mockReturnValue({ url: 'https://example.supabase.co', key: 'sb_publishable_example' })
  auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: {} } })),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: 'https://example.invalid/oauth' }, error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'fictional-oauth-user' } } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'fictional-email-user' } } }, error: null }),
    signUp: vi.fn(), resend: vi.fn(), resetPasswordForEmail: vi.fn(),
  }
  mocks.getSupabaseClient.mockResolvedValue({ auth })
  account = await import('../src/composables/accountAuth.js')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete window.studyLifeDesktop })

describe('zero-budget authentication capabilities', () => {
  it('starts only an enabled OAuth provider using the existing PKCE callback', async () => {
    expect((await account.loginAccountWithOAuth('github')).ok).toBe(true)
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'github', options: { redirectTo: window.location.origin + '/' } })
    expect((await account.loginAccountWithOAuth('google')).ok).toBe(false)
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1)
  })
  it('does not advertise unavailable mail operations but preserves existing password login', async () => {
    expect((await account.registerAccount({ email: 'student@example.test', password: 'Fictional123!', confirmation: 'Fictional123!' })).ok).toBe(false)
    expect((await account.resendAccountConfirmation('student@example.test')).ok).toBe(false)
    expect((await account.requestAccountPasswordReset('student@example.test')).ok).toBe(false)
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(auth.resend).not.toHaveBeenCalled()
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
    expect((await account.loginAccount({ email: 'student@example.test', password: 'Fictional123!' })).ok).toBe(true)
  })
  it('rejects offline, desktop and signed-in account switches without redirecting', async () => {
    window.studyLifeDesktop = { isDesktop: true }
    expect((await account.loginAccountWithOAuth('github')).ok).toBe(false)
    delete window.studyLifeDesktop
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    expect((await account.loginAccountWithOAuth('github')).ok).toBe(false)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    account.accountUser.value = { id: 'fictional-current-user' }
    expect((await account.loginAccountWithOAuth('github')).ok).toBe(false)
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
  })
  it('exchanges the OAuth code once and removes provider credentials from history', async () => {
    window.history.replaceState(null, '', '/?code=fictional-code&provider_token=fictional-provider-token&provider_refresh_token=fictional-refresh')
    expect(await account.prepareAccountCallback()).toBe(true)
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('fictional-code')
    expect(account.accountUser.value.id).toBe('fictional-oauth-user')
    expect(window.location.href).not.toContain('fictional-')
  })
})
