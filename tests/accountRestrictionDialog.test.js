// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountRestrictionDialog from '../src/components/admin/AccountRestrictionDialog.vue'
const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/services/platformAdmin.js', async importOriginal => ({ ...await importOriginal(), platformAdminRequest: api.request }))
let app, host
const account = { id: 'fictional-target', email: 'fictional@example.invalid', restrictions: { publish: { enabled: true, expiresAt: null, reason: '虚构旧原因', revision: 'fictional-revision' } } }
async function mount(scope = 'publish') {
  host = document.createElement('div'); document.body.append(host)
  app = createApp(AccountRestrictionDialog, { target: { account, scope } }); app.mount(host); await nextTick()
}
async function field(id, value) { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await nextTick() }
async function submit() { document.querySelector('.restriction-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await nextTick() }
beforeEach(() => { api.request.mockReset(); api.request.mockResolvedValue({ notificationSaved: true }) })
afterEach(() => { app?.unmount(); host?.remove() })
describe('管理中心限制对话框', () => {
  it('支持任意时长并明确通知对象与所选限制', async () => {
    await mount()
    expect(document.body.textContent).toContain('账号会收到此说明')
    await field('restriction-preset', 'custom'); await field('restriction-amount', '90'); await field('restriction-unit', 'minutes'); await field('restriction-reason', '虚构的禁发说明')
    await submit()
    expect(api.request).toHaveBeenCalledWith('user_restriction_set', { userId: account.id, scope: 'publish', enabled: true, expectedRevision: 'fictional-revision', reason: '虚构的禁发说明', durationSeconds: 5400 })
  })
  it('提前解除只解除当前 scope，不携带永久或截止时间', async () => {
    await mount(); await field('restriction-operation', 'lift'); await field('restriction-reason', '虚构解除原因'); await submit()
    expect(api.request).toHaveBeenCalledWith('user_restriction_set', { userId: account.id, scope: 'publish', enabled: false, expectedRevision: 'fictional-revision', reason: '虚构解除原因' })
  })
  it('验证失败不请求；保存失败保留管理员填写内容', async () => {
    await mount('account'); await submit(); expect(api.request).not.toHaveBeenCalled()
    await field('restriction-preset', 'permanent'); await field('restriction-reason', '虚构的处理依据')
    api.request.mockRejectedValue(new Error('虚构网络失败'))
    await submit(); await vi.waitFor(() => expect(document.body.textContent).toContain('虚构网络失败'))
    expect(document.getElementById('restriction-reason').value).toBe('虚构的处理依据')
    expect(api.request).toHaveBeenCalledWith('user_restriction_set', expect.objectContaining({ scope: 'account', permanent: true, expectedRevision: null }))
  })
})
