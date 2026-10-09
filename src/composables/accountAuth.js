import { computed, ref, shallowRef } from 'vue'
import { ACCOUNT_STORAGE_KEY, getSupabaseClient, getSupabaseConfig, verifyAccountCurrentPassword } from '../services/supabase.js'

export const accountOpen = ref(false)
export const accountUser = shallowRef(/** @type {import('@supabase/supabase-js').User | null} */ (null))
export const accountReady = ref(false)
export const accountBusy = ref(false)
export const accountAuthError = ref('')
export const accountCallbackError = ref('')
export const accountAvailable = computed(() => Boolean(getSupabaseConfig()))
const RECOVERY_STORAGE_KEY = 'study-life-password-recovery'
const recoveryUserId = ref(readRecoveryUserId())
export const accountPasswordRecovery = computed(() => Boolean(accountUser.value && recoveryUserId.value === accountUser.value.id))

function readRecoveryUserId() {
  try { return sessionStorage.getItem(RECOVERY_STORAGE_KEY) || '' } catch { return '' }
}

function setPasswordRecovery(userId = '') {
  recoveryUserId.value = userId
  try {
    if (userId) sessionStorage.setItem(RECOVERY_STORAGE_KEY, userId)
    else sessionStorage.removeItem(RECOVERY_STORAGE_KEY)
  } catch { /* Recovery remains available in memory when session storage is blocked. */ }
}

export function finishAccountPasswordRecovery() { setPasswordRecovery() }

export function hasPersistedAccountSession() {
  try { return Boolean(localStorage.getItem(ACCOUNT_STORAGE_KEY)) } catch { return false }
}

export function normalizeAccountEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function validateAccountForm({ email, password = '', confirmation = '', mode = 'register' }) {
  const errors = /** @type {Record<string, string>} */ ({})
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAccountEmail(email))) errors.email = '请输入有效的邮箱地址。'
  if (mode === 'recovery') return errors
  if (!password) errors.password = '请输入密码。'
  else if (mode === 'register' && password.length < 8) errors.password = '密码至少需要 8 位。'
  if (mode === 'register' && password !== confirmation) errors.confirmation = '两次输入的密码不一致。'
  return errors
}

export function validateAccountPassword({ password = '', confirmation = '', currentPassword = '', recovery = false }) {
  const errors = /** @type {Record<string, string>} */ ({})
  if (!recovery && !currentPassword) errors.currentPassword = '请输入当前密码。'
  if (!password) errors.password = '请输入新密码。'
  else if (password.length < 8) errors.password = '新密码至少需要 8 位。'
  else if (!recovery && password === currentPassword) errors.password = '新密码不能与当前密码相同。'
  if (password !== confirmation) errors.confirmation = '两次输入的密码不一致。'
  return errors
}

export function accountErrorMessage(error) {
  const code = error?.code || error?.message
  const messages = {
    account_unavailable: '账号服务暂未开放，请稍后再试。',
    invalid_credentials: '邮箱或密码不正确，请重新输入。',
    email_not_confirmed: '请先打开验证邮件完成邮箱验证，再登录。',
    user_already_exists: '该邮箱已注册，请切换到登录。',
    email_exists: '该邮箱已注册，请切换到登录。',
    weak_password: '密码强度不足，请使用更长的密码并混合字母、数字和符号。',
    validation_failed: '邮箱或密码格式不符合要求，请检查后重试。',
    email_address_invalid: '邮箱地址无效，请检查后重试。',
    email_address_not_authorized: '验证邮件暂时无法发送，请稍后重试或联系管理员。',
    over_email_send_rate_limit: '邮件发送过于频繁，请稍后再试。',
    over_request_rate_limit: '操作过于频繁，请稍后再试。',
    signup_disabled: '当前暂未开放注册，请稍后再试。',
    email_provider_disabled: '邮箱注册暂时不可用，请稍后再试。',
    otp_expired: '邮件链接已过期，请重新发送邮件。',
    access_denied: '邮件链接无效或已过期，请重新发送邮件。',
    same_password: '新密码不能与原密码相同。',
    current_password_required: '请输入当前密码，或通过邮箱重设密码。',
    current_password_mismatch: '当前密码不正确，请重新输入或通过邮箱重设。',
    reauthentication_needed: '需要重新验证身份，请通过邮箱重设密码。',
    reauthentication_not_valid: '身份验证已失效，请重新发送密码重设邮件。',
    session_not_found: '登录状态已失效，请重新登录。',
    bad_jwt: '登录状态已失效，请重新登录。',
    flow_state_not_found: '邮件链接无法在此设备验证，请在发送邮件的浏览器中打开，或重新发送邮件。',
    flow_state_expired: '邮件链接已过期，请重新发送邮件。',
  }
  if (messages[code]) return messages[code]
  if (error?.status === 429) return '操作过于频繁，请稍后再试。'
  if (error?.name === 'AuthPKCECodeVerifierMissingError') return '请在发送邮件的浏览器中打开链接，或在此设备重新发送邮件。'
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError' || error?.name === 'AbortError') {
    return '无法连接账号服务，请检查网络后重试。'
  }
  return '账号操作未完成，请稍后重试。'
}

export function accountRedirectUrl() {
  if (window.studyLifeDesktop?.isDesktop) return 'https://study-life.pages.dev/desktop-auth-return/'
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).href
}

let initialization = null
let subscription = null
let authRevision = 0
// 用户是否主动做过账号操作（注册/登录/重发/退出）。用来区分"启动时的网络抖动"
// 和"我真的按了按钮但没成功" —— 后者才值得在界面上留一条错误。
const userAttempted = ref(false)

/** 让后续的初始化失败可以在界面上显示（用户已明确表达过意图）。 */
export function markAccountAttempted() { userAttempted.value = true }
/** 复位（测试与"回到未操作"状态用）。 */
export function resetAccountAttempted() { userAttempted.value = false }

function acceptSession(session) {
  authRevision++
  accountUser.value = session?.user || null
  accountReady.value = true
  if (!session?.user || (recoveryUserId.value && recoveryUserId.value !== session.user.id)) setPasswordRecovery()
}

export async function initializeAccountAuth() {
  if (!accountAvailable.value) return { ok: false, message: accountErrorMessage({ code: 'account_unavailable' }) }
  if (initialization) return initialization
  initialization = (async () => {
    try {
      const client = await getSupabaseClient()
      if (!subscription) {
        const { data } = client.auth.onAuthStateChange((event, session) => {
          acceptSession(session)
          if (event === 'PASSWORD_RECOVERY' && session?.user) {
            setPasswordRecovery(session.user.id)
            accountOpen.value = true
            accountCallbackError.value = ''
          }
          if (event === 'SIGNED_IN') {
            accountAuthError.value = ''
            accountCallbackError.value = ''
          }
        })
        subscription = data.subscription
      }
      const revision = authRevision
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      // 登录/退出事件可能在恢复会话的请求完成前发生，不能用旧响应覆盖新状态。
      if (revision === authRevision) acceptSession(data.session)
      accountAuthError.value = ''
      return { ok: true }
    } catch (error) {
      // 【只有用户真的操作过账号，才把这条错误摆到界面上】
      // 原来是无条件写进 accountAuthError，而 main.js 在挂载后立刻
      // void initializeAccountAuth()。于是手机在弱网冷启动失败一次，
      // 用户**什么都没做**就打开面板，看到的却是「无法连接账号服务」，
      // 而且那条路径上没有任何重试按钮（重试按钮只在已登录时的同步面板里）。
      // 冷启动的网络抖动不该由用户来负责，也不该被记成一条待解决的错误。
      if (userAttempted.value) accountAuthError.value = accountErrorMessage(error)
      return { ok: false, message: accountErrorMessage(error) }
    }
  })()
  const result = await initialization
  if (!result.ok) initialization = null
  return result
}

async function accountAction(action) {
  if (accountBusy.value) return { ok: false, message: '账号操作正在进行，请稍候。' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, message: '当前离线，请联网后再使用账号功能。' }
  }
  userAttempted.value = true
  accountBusy.value = true
  try {
    const initialized = await initializeAccountAuth()
    if (!initialized.ok) return initialized
    const client = await getSupabaseClient()
    const { data, error } = await action(client.auth)
    if (error) throw error
    return { ok: true, data }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
    return { ok: false, code, message: accountErrorMessage(error) }
  } finally {
    accountBusy.value = false
  }
}

export async function registerAccount({ email, password, confirmation }) {
  const errors = validateAccountForm({ email, password, confirmation })
  if (Object.keys(errors).length) return { ok: false, errors }
  const result = await accountAction((auth) => auth.signUp({
    email: normalizeAccountEmail(email),
    password,
    options: { emailRedirectTo: accountRedirectUrl() },
  }))
  if (!result.ok) return result
  if (result.data?.session) acceptSession(result.data.session)
  return { ok: true, needsConfirmation: !result.data?.session }
}

export async function loginAccount({ email, password }) {
  const errors = validateAccountForm({ email, password, mode: 'login' })
  if (Object.keys(errors).length) return { ok: false, errors }
  const result = await accountAction((auth) => auth.signInWithPassword({
    email: normalizeAccountEmail(email),
    password,
  }))
  if (!result.ok) return result
  if (!result.data?.session) return { ok: false, message: '登录未完成，请稍后重试。' }
  finishAccountPasswordRecovery()
  acceptSession(result.data.session)
  return { ok: true }
}

export async function resendAccountConfirmation(email) {
  const normalized = normalizeAccountEmail(email)
  if (validateAccountForm({ email: normalized }).email) return { ok: false, message: '请输入有效的邮箱地址。' }
  return accountAction((auth) => auth.resend({
    type: 'signup',
    email: normalized,
    options: { emailRedirectTo: accountRedirectUrl() },
  }))
}

export async function logoutAccount({ scope = 'local' } = {}) {
  if (accountBusy.value) return { ok: false, message: '账号操作正在进行，请稍候。' }
  if (scope === 'global' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, message: '退出所有设备需要联网；当前设备数据尚未清除。' }
  }
  accountBusy.value = true
  let lifecycle = null
  try {
    const client = await getSupabaseClient()
    lifecycle = await import('./accountSyncLifecycle.js')
    lifecycle.stopAccountSyncLifecycle()
    const { error } = await client.auth.signOut({ scope })
    if (error) {
      lifecycle.startAccountSyncLifecycle()
      return { ok: false, message: accountErrorMessage(error) }
    }
    acceptSession(null)
    const cleanupErrors = []
    try {
      const { clearSignedOutAccountData } = await import('./accountLogoutCleanup.js')
      await clearSignedOutAccountData()
    } catch (error) {
      cleanupErrors.push(error)
    }
    return cleanupErrors.length
      ? { ok: true, warning: '账号已退出，但浏览器未能确认清空全部本机副本。请关闭其他标签页后，在数据管理中重试清理。' }
      : { ok: true }
  } catch (error) {
    lifecycle?.startAccountSyncLifecycle?.()
    return { ok: false, message: accountErrorMessage(error) }
  } finally {
    accountBusy.value = false
  }
}

export function accountPasswordRedirectUrl() {
  // Desktop email confirmation discards tokens. Password recovery instead opens
  // the web app, where the verified recovery session can set the new password.
  if (window.studyLifeDesktop?.isDesktop) return 'https://study-life.pages.dev/'
  return accountRedirectUrl()
}

export async function requestAccountPasswordReset(email) {
  const normalized = normalizeAccountEmail(email)
  const errors = validateAccountForm({ email: normalized, mode: 'recovery' })
  if (errors.email) return { ok: false, errors, message: errors.email }
  return accountAction((auth) => auth.resetPasswordForEmail(normalized, { redirectTo: accountPasswordRedirectUrl() }))
}

export async function updateAccountPassword({ password, confirmation, currentPassword = '' }) {
  if (!accountUser.value) return { ok: false, message: '请先登录或打开密码重设邮件中的链接。' }
  const userId = accountUser.value.id
  const email = accountUser.value.email
  const recovery = accountPasswordRecovery.value
  const errors = validateAccountPassword({ password, confirmation, currentPassword, recovery })
  if (Object.keys(errors).length) return { ok: false, errors }
  const result = await accountAction(async (auth) => {
    if (accountUser.value?.id !== userId) throw new Error('session_not_found')
    if (!recovery) {
      const verified = await verifyAccountCurrentPassword(email, currentPassword)
      if (verified.error) return { data: null, error: verified.error }
      if (verified.data?.user?.id !== userId || accountUser.value?.id !== userId) throw new Error('session_not_found')
    }
    // The installed auth-js SDK forwards UserAttributes using snake_case.
    return auth.updateUser({ password, ...(!recovery ? { current_password: currentPassword } : {}) })
  })
  if (!result.ok) {
    if (result.code === 'invalid_credentials') return { ...result, message: '当前密码不正确，请重新输入或通过邮箱重设。' }
    return result
  }
  if (accountUser.value?.id !== userId || result.data?.user?.id !== userId) {
    return { ok: false, message: '登录状态已变化，请重新打开账号面板。' }
  }
  accountUser.value = result.data.user
  finishAccountPasswordRecovery()
  return { ok: true }
}

const CALLBACK_PARAMS = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description', 'code', 'flow_id']

export function hasAccountCallback(href) {
  const url = new URL(href)
  const query = new URLSearchParams(url.search)
  if (query.has('code') || query.has('error') || query.has('error_code')) return true
  if (url.hash.startsWith('#/')) return false
  const hash = new URLSearchParams(url.hash.slice(1))
  return (hash.has('access_token') && hash.has('refresh_token')) || hash.has('error')
}

// Auth 回调必须在 Hash Router 创建前完成交换与清理；兼容旧邮件中的隐式令牌。
export async function prepareAccountCallback() {
  if (!hasAccountCallback(window.location.href)) return false
  const url = new URL(window.location.href)
  const query = new URLSearchParams(url.search)
  const params = url.hash.startsWith('#/') ? new URLSearchParams() : new URLSearchParams(url.hash.slice(1))
  accountOpen.value = true
  try {
    const errorCode = query.get('error_code') || query.get('error') || params.get('error_code') || params.get('error')
    if (errorCode) {
      accountCallbackError.value = accountErrorMessage({ code: errorCode })
    } else {
      const result = await initializeAccountAuth()
      if (!result.ok) accountCallbackError.value = result.message
      else {
        const client = await getSupabaseClient()
        const exchange = query.has('code')
          ? await client.auth.exchangeCodeForSession(query.get('code'))
          : await client.auth.setSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token') })
        if (exchange.error) throw exchange.error
        acceptSession(exchange.data?.session || null)
        if (exchange.data?.session?.user && (params.get('type') === 'recovery' || exchange.data.redirectType === 'recovery')) {
          setPasswordRecovery(exchange.data.session.user.id)
        }
      }
    }
  } catch (error) {
    accountCallbackError.value = accountErrorMessage(error)
  } finally {
    // 无论验证是否成功，都不把令牌或错误参数交给路由、历史记录或页面标题。
    for (const param of CALLBACK_PARAMS) url.searchParams.delete(param)
    url.hash = '/'
    window.history.replaceState(window.history.state, '', url.href)
  }
  return true
}
