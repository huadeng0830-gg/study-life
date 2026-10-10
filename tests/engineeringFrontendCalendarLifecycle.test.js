// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({ user: null, request: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  stubs.user = ref(null)
  return { accountUser: stubs.user }
})
vi.mock('../src/services/social.js', () => ({ socialRequest: stubs.request, subscribeSocialNotifications: stubs.subscribe }))
import SocialCalendarEvents from '../src/components/SocialCalendarEvents.vue'

let app, host
async function flush() { for (let i = 0; i < 15; i++) { await Promise.resolve(); await nextTick() } }
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(SocialCalendarEvents)
  app.component('router-link', { template: '<a><slot /></a>' })
  app.mount(host); await flush()
}
beforeEach(() => {
  stubs.user.value = { id: 'fictional-account-a', email_confirmed_at: '2026-01-01' }
  stubs.request.mockReset().mockImplementation(async (action) => action === 'profile_get'
    ? { profile: { timezone: 'Asia/Shanghai' } } : { invitations: [] })
  stubs.subscribe.mockReset().mockResolvedValue(() => {})
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('engineering audit: calendar account lifecycle', () => {
  it('releases an old subscription without replacing the current account subscription', async () => {
    let resolveOld
    const oldStop = vi.fn(), currentStop = vi.fn()
    stubs.subscribe.mockImplementation((id) => id === 'fictional-account-a'
      ? new Promise((resolve) => { resolveOld = resolve }) : Promise.resolve(currentStop))
    await mount()
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }; await flush()
    resolveOld(oldStop); await flush()
    expect(oldStop).toHaveBeenCalledOnce()
    expect(currentStop).not.toHaveBeenCalled()
    app.unmount(); app = null
    expect(currentStop).toHaveBeenCalledOnce()
  })

  it('does not establish realtime after an initial load resolves following unmount', async () => {
    let resolveInvitations
    stubs.request.mockImplementation(async (action) => action === 'profile_get'
      ? { profile: {} } : new Promise((resolve) => { resolveInvitations = resolve }))
    await mount(); app.unmount(); app = null
    resolveInvitations({ invitations: [] }); await flush()
    expect(stubs.subscribe).not.toHaveBeenCalled()
  })

  it('clears the loading panel on logout while a request is pending', async () => {
    stubs.request.mockImplementation(() => new Promise(() => {}))
    await mount()
    expect(host.textContent).toContain('正在读取')
    stubs.user.value = null; await flush()
    expect(host.querySelector('.social-calendar')).toBeNull()
  })

  it('loads after the current account email becomes verified', async () => {
    stubs.user.value = { id: 'fictional-account-a' }
    await mount()
    expect(stubs.request).not.toHaveBeenCalled()
    stubs.user.value = { id: 'fictional-account-a', email_confirmed_at: '2026-01-01' }; await flush()
    expect(stubs.request).toHaveBeenCalledWith('invitations_list')
  })
})
