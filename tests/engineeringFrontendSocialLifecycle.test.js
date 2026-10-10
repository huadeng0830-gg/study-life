// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({ user: null, request: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  stubs.user = ref(null)
  return { accountUser: stubs.user, accountOpen: ref(false) }
})
vi.mock('../src/services/social.js', () => ({
  socialRequest: stubs.request,
  ensureSocialScheduleReady: vi.fn(async () => {}),
  subscribeSocialNotifications: stubs.subscribe,
}))
import TogetherView from '../src/views/TogetherView.vue'

const PROFILE = {
  nickname: '虚构用户', timezone: 'Asia/Shanghai', scheduleCompleteThrough: '2026-12-31', semesterEnd: '2026-12-31',
  availabilityPreferences: { startTime: '09:00', endTime: '22:00', minimumMinutes: 90, classBufferMinutes: 0, includeWeekends: true },
}
let app, host
async function flush() { for (let i = 0; i < 15; i++) { await Promise.resolve(); await nextTick() } }
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(TogetherView); app.mount(host); await flush()
}
function button(text) { return [...host.querySelectorAll('button')].find((node) => node.textContent.trim() === text) }
beforeEach(() => {
  stubs.user.value = { id: 'fictional-account-a', email_confirmed_at: '2026-01-01' }
  stubs.subscribe.mockReset().mockResolvedValue(() => {})
  stubs.request.mockReset().mockImplementation(async (action) => {
    if (action === 'profile_get') return { profile: PROFILE }
    if (action === 'friends_list') return { friends: [{ profile: { userId: 'fictional-shared-friend', nickname: '虚构好友' } }], incoming: [], outgoing: [] }
    if (action === 'notifications_list') return { notifications: [], unread: 0 }
    if (action === 'invitations_list') return { invitations: [] }
    return {}
  })
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('engineering audit: social account lifecycle', () => {
  it('discards old availability even when both accounts share the same friend', async () => {
    await mount()
    let resolveAvailability
    const base = stubs.request.getMockImplementation()
    stubs.request.mockImplementation((action, payload) => action === 'availability_query'
      ? new Promise((resolve) => { resolveAvailability = resolve }) : base(action, payload))
    expect(button('查找共同时间')).toBeTruthy()
    button('查找共同时间').click(); await flush()
    expect(resolveAvailability).toBeTypeOf('function')
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }
    await flush()
    resolveAvailability({ known: true, intervals: [{ startsAt: '2026-10-10T01:00:00Z', endsAt: '2026-10-10T03:00:00Z' }] })
    await flush()
    expect(host.querySelector('.interval-card')).toBeNull()
  })

  it('releases a subscription that resolves after account replacement', async () => {
    let resolveOldSubscription
    const oldStop = vi.fn(), currentStop = vi.fn()
    stubs.subscribe.mockImplementation((userId) => userId === 'fictional-account-a'
      ? new Promise((resolve) => { resolveOldSubscription = resolve }) : Promise.resolve(currentStop))
    await mount()
    expect(resolveOldSubscription).toBeTypeOf('function')
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }
    await flush()
    resolveOldSubscription(oldStop); await flush()
    expect(oldStop).toHaveBeenCalledOnce()
    expect(currentStop).not.toHaveBeenCalled()
    app.unmount(); app = null
    expect(currentStop).toHaveBeenCalledOnce()
  })

  it('clears a pending friend-removal confirmation on account replacement', async () => {
    await mount()
    button('好友').click(); await flush()
    const remove = [...host.querySelectorAll('button')].find((node) => node.textContent.trim() === '移除')
    expect(remove).toBeTruthy()
    remove.click(); await flush()
    expect(document.querySelector('.overlay')).toBeTruthy()
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }
    await flush()
    expect(document.querySelector('.overlay')).toBeNull()
  })
})

describe('engineering audit: native social refresh controls', () => {
  it('renders refreshed friends and releases loading after a real button click', async () => {
    await mount()
    const base = stubs.request.getMockImplementation()
    stubs.request.mockImplementation((action, payload) => action === 'friends_list'
      ? Promise.resolve({ friends: [{ profile: { userId: 'fictional-refreshed-friend', nickname: '虚构新好友' } }], incoming: [], outgoing: [] }) : base(action, payload))
    host.querySelector('[aria-label="刷新好友"]').click(); await flush()
    expect(host.textContent).not.toContain('正在读取好友')
    expect(host.textContent).toContain('虚构新好友')
    expect(host.querySelector('[aria-label="刷新好友"]').disabled).toBe(false)
  })

  it.each([
    ['刷新邀约', '正在读取邀约', 'invitations_list'],
    ['刷新通知', '正在读取通知', 'notifications_list'],
  ])('releases loading for %s after a real button click', async (label, loadingText, actionName) => {
    await mount()
    button('邀约与通知').click(); await flush()
    const previousCalls = stubs.request.mock.calls.filter(([action]) => action === actionName).length
    host.querySelector(`[aria-label="${label}"]`).click(); await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === actionName)).toHaveLength(previousCalls + 1)
    expect(host.textContent).not.toContain(loadingText)
    expect(host.querySelector(`[aria-label="${label}"]`).disabled).toBe(false)
  })
})
