// @vitest-environment happy-dom
import { createApp } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RegistrationControl from '../src/components/admin/RegistrationControl.vue'
const request = vi.hoisted(() => vi.fn())
vi.mock('../src/services/platformAdmin.js', () => ({ platformAdminRequest: request }))
let app, host
async function mount() {
  host = document.createElement('div'); document.body.append(host)
  app = createApp(RegistrationControl); app.mount(host)
  await vi.waitFor(() => expect(host.textContent).toContain('开放中'))
}
function click(text) { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text); expect(button).toBeTruthy(); button.click() }
beforeEach(() => { request.mockReset(); request.mockImplementation(async action => action === 'registration_get' ? { enabled: true, updatedAt: '2026-10-16T01:00:00Z' } : { enabled: false, updatedAt: '2026-10-16T01:00:01Z' }) })
afterEach(() => { app?.unmount(); host?.remove() })
describe('registration operation', () => {
  it('only saves after explicit confirmation and carries the observed settings version', async () => {
    await mount(); click('暂停注册')
    expect(request).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(document.body.textContent).toContain('确认暂停注册'))
    click('确认暂停注册')
    await vi.waitFor(() => expect(host.textContent).toContain('已暂停'))
    expect(request).toHaveBeenLastCalledWith('registration_set', { enabled: false, expectedUpdatedAt: '2026-10-16T01:00:00Z' })
    expect(host.textContent).toContain('已有账号仍可登录')
  })
  it('keeps the last confirmed state and offers refresh after a stale or failed save', async () => {
    await mount()
    request.mockRejectedValueOnce(new Error('注册设置已在其他页面更新，请刷新状态后重试。'))
    click('暂停注册'); await vi.waitFor(() => expect(document.body.textContent).toContain('确认暂停注册')); click('确认暂停注册')
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')).toBeTruthy())
    expect(host.textContent).toContain('开放中')
    expect(host.textContent).not.toContain('已暂停')
  })
})
