// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adapter = vi.hoisted(() => ({ getSupabaseClient: vi.fn(), getSupabaseConfig: vi.fn(), verifyAccountCurrentPassword: vi.fn() }))
vi.mock('../src/services/supabase.js', () => adapter)

let app
let host
let client
let account
let clearAnnouncement
let emitAuth
const user = { id: 'fictional-account', email: 'student@example.test' }
const session = { user }

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  adapter.getSupabaseConfig.mockReturnValue({ url: 'https://example.supabase.co', key: 'sb_publishable_example' })
  client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(listener => {
        emitAuth = listener
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signUp: vi.fn().mockResolvedValue({ data: { user, session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  }
  adapter.getSupabaseClient.mockResolvedValue(client)
  adapter.verifyAccountCurrentPassword.mockResolvedValue({ data: { user }, error: null })
  account = await import('../src/composables/accountAuth.js')
  ;({ clearAnnouncement } = await import('../src/composables/liveRegion.js'))
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  clearAnnouncement?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mountPanel(withDataModal = false) {
  const { default: AccountPanel } = await import('../src/components/AccountPanel.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  if (withDataModal) {
    const { default: Modal } = await import('../src/components/Modal.vue')
    app = createApp({ render: () => h('div', [h(Modal, { open: true, title: '数据备份与恢复' }), h(AccountPanel, { open: true })]) })
  } else app = createApp(AccountPanel, { open: true })
  app.mount(host)
  await vi.waitFor(() => expect(document.querySelector('#account-email')).toBeTruthy())
  await nextTick()
}

async function fill(id, value) {
  const input = document.querySelector(id)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function submit() {
  document.querySelector('.account-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}

async function click(text) {
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  expect(button).toBeTruthy()
  button.click()
  await nextTick()
}

describe('注册面板的实际表单行为', () => {
  it('从数据管理打开账号面板时，各弹窗有独立且正确的读屏标题', async () => {
    await mountPanel(true)
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const names = dialogs.map(dialog => document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent.trim())
    expect(names).toEqual(['数据备份与恢复', '我的账号'])
    expect(new Set(dialogs.map(dialog => dialog.getAttribute('aria-labelledby'))).size).toBe(2)
  })
  it('已有账号从面板进入时默认显示登录表单', async () => {
    await mountPanel()
    expect(document.querySelector('#account-password').getAttribute('autocomplete')).toBe('current-password')
    expect(document.querySelector('#account-confirmation')).toBeNull()
    expect(document.querySelector('button[type="submit"]').textContent.trim()).toBe('登录')
  })
  it('错误关联到字段并聚焦第一个无效输入，阻止无效提交', async () => {
    await mountPanel()
    await click('注册')
    await submit()
    expect(document.querySelector('#account-email').getAttribute('aria-invalid')).toBe('true')
    // 同时引用行内错误与顶部横幅：#account-form-error 之前在模板里存在却
    // **没有任何元素引用它**，屏幕阅读器读到字段错误时拿不到横幅那句话，
    // 而"顶部有一条全局错误"这件事正好是描述这个字段的前提。
    expect(document.querySelector('#account-email').getAttribute('aria-describedby')).toBe('account-email-error account-form-error')
    expect(document.activeElement.id).toBe('account-email')
    expect(client.auth.signUp).not.toHaveBeenCalled()
    await fill('#account-email', user.email)
    await fill('#account-password', 'Example123!')
    await fill('#account-confirmation', 'Wrong123!')
    await submit()
    expect(document.querySelector('#account-confirmation-error').textContent).toContain('不一致')
    expect(document.activeElement.id).toBe('account-confirmation')
  })

  it('注册后显示等待验证和重发冷却，并清除密码输入', async () => {
    await mountPanel()
    await click('注册')
    await fill('#account-email', user.email)
    await fill('#account-password', 'Example123!')
    await fill('#account-confirmation', 'Example123!')
    await submit()
    await vi.waitFor(() => expect(document.querySelector('#account-confirmation-title')).toBeTruthy())
    expect(document.querySelector('.account-confirmation').textContent).toContain(user.email)
    expect(document.querySelector('#account-password')).toBeNull()
    expect(document.querySelector('.account-confirmation button').disabled).toBe(true)
    await click('已验证，去登录')
    expect(document.querySelector('#account-password').value).toBe('')
    expect(document.querySelector('#account-confirmation')).toBeNull()
    expect(document.querySelector('#account-password').getAttribute('autocomplete')).toBe('current-password')
  })

  it('登录和退出可操作，退出后清理共享设备上的本机业务记录', async () => {
    await mountPanel()
    localStorage.setItem('sl_tasks', '[{"id":"demo-task","title":"虚构任务"}]')
    await click('登录')
    await fill('#account-email', user.email)
    await fill('#account-password', 'Example123!')
    await submit()
    await vi.waitFor(() => expect(document.querySelector('#account-summary-title')).toBeTruthy())
    expect(document.querySelector('.account-summary').textContent).toContain(user.email)
    await click('账号安全')
    await click('退出当前设备')
    expect(client.auth.signOut).not.toHaveBeenCalled()
    expect(localStorage.getItem('sl_tasks')).not.toBeNull()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await click('退出并清除本机数据')
    await vi.waitFor(() => expect(document.querySelector('#account-email')).toBeTruthy())
    await vi.waitFor(() => expect(document.querySelector('.account-success')).toBeTruthy())
    expect(document.querySelector('.account-success').textContent).toContain('账号已退出')
    expect(localStorage.getItem('sl_tasks')).toBeNull()
  })

  it('服务端登录失败显示提示，表单仍可修改和再次提交', async () => {
    client.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials' } })
    await mountPanel()
    await click('登录')
    await fill('#account-email', user.email)
    await fill('#account-password', 'Wrong123!')
    await submit()
    await vi.waitFor(() => expect(document.querySelector('#account-form-error').textContent).toContain('邮箱或密码不正确'))
    expect(document.querySelector('#account-form-error').textContent).toContain('邮箱或密码不正确')
    expect(document.querySelector('button[type="submit"]').disabled).toBe(false)
    expect(document.querySelector('#account-password').disabled).toBe(false)
  })

  it('未配置服务时提供本机使用提示并禁止提交', async () => {
    adapter.getSupabaseConfig.mockReturnValue(null)
    await mountPanel()
    expect(document.querySelector('.account-service-note').textContent).toContain('本机功能仍可使用')
    expect(document.querySelector('button[type="submit"]').disabled).toBe(true)
    expect(client.auth.signUp).not.toHaveBeenCalled()
  })

  it('忘记密码保留已输入邮箱，仅提交邮箱并给出不泄漏账号存在性的反馈', async () => {
    await mountPanel()
    await fill('#account-email', user.email)
    await fill('#account-password', 'Example123!')
    await click('忘记密码？')
    expect(document.querySelector('#account-email').value).toBe(user.email)
    expect(document.querySelector('#account-password')).toBeNull()
    await submit()
    await vi.waitFor(() => expect(document.querySelector('#account-recovery-title')).toBeTruthy())
    expect(document.querySelector('.account-confirmation').textContent).toContain('如果')
    expect(document.querySelector('.account-confirmation button').disabled).toBe(true)
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1)
    await click('返回登录')
    expect(document.querySelector('#account-password').value).toBe('')
  })

  it('重开面板后邮件冷却继续计时，到期后可以发送', async () => {
    sessionStorage.setItem('study-life-resend-cooldown', String(Date.now() + 2000))
    await mountPanel()
    await click('忘记密码？')
    expect(document.querySelector('button[type="submit"]').disabled).toBe(true)
    app.unmount()
    host.remove()
    vi.useFakeTimers()
    await mountPanel()
    await click('忘记密码？')
    await vi.advanceTimersByTimeAsync(2500)
    expect(document.querySelector('button[type="submit"]').disabled).toBe(false)
  })

  it('邮箱找回成功回跳后直接显示新密码表单，保存后返回概览', async () => {
    await mountPanel()
    emitAuth('PASSWORD_RECOVERY', session)
    await nextTick()
    expect(document.querySelector('#account-new-password')).toBeTruthy()
    expect(document.querySelector('#account-current-password')).toBeNull()
    await fill('#account-new-password', 'NewExample123!')
    await fill('#account-new-confirmation', 'NewExample123!')
    document.querySelector('.account-password-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(document.querySelector('#account-details-title')).toBeTruthy())
    expect(document.querySelector('.account-success').textContent).toContain('密码已更新')
    expect(document.querySelector('#account-new-password')).toBeNull()
    expect(document.activeElement.id).toBe('account-summary-title')
  })

  it('新密码校验会聚焦错误字段，失败后保留输入供修改', async () => {
    await mountPanel()
    emitAuth('PASSWORD_RECOVERY', session)
    await nextTick()
    document.querySelector('.account-password-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    await nextTick()
    expect(document.activeElement.id).toBe('account-new-password')
    expect(client.auth.updateUser).not.toHaveBeenCalled()
    client.auth.updateUser.mockResolvedValue({ data: {}, error: { code: 'weak_password' } })
    await fill('#account-new-password', 'NewExample123!')
    await fill('#account-new-confirmation', 'NewExample123!')
    document.querySelector('.account-password-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(document.querySelector('.account-security .account-error').textContent).toContain('密码强度不足'))
    expect(document.querySelector('#account-new-password').value).toBe('NewExample123!')
    expect(document.querySelector('.account-password-form button[type="submit"]').disabled).toBe(false)
  })

  it('取消退出确认保留会话和数据，账号概览不显示危险操作', async () => {
    await mountPanel()
    emitAuth('SIGNED_IN', session)
    await nextTick()
    expect([...document.querySelectorAll('button')].some(button => button.textContent.includes('退出当前设备'))).toBe(false)
    localStorage.setItem('sl_tasks', '[{"id":"fictional-task"}]')
    await click('账号安全')
    await click('退出所有设备')
    expect(document.querySelector('.message').textContent).toContain('未同步')
    await click('取消')
    expect(account.accountUser.value).toEqual(user)
    expect(localStorage.getItem('sl_tasks')).not.toBeNull()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })
})
