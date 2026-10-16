// @vitest-environment happy-dom
import { createApp, ref } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminCenterView from '../src/views/AdminCenterView.vue'
import { accountUser } from '../src/composables/accountAuth.js'
import { adminSectionForRoute, visibleAdminSections } from '../src/composables/adminWorkspaceModel.js'

const api = vi.hoisted(() => ({ access: vi.fn(), platform: vi.fn(), feedback: vi.fn(), queue: vi.fn(), history: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', async importOriginal => ({ ...await importOriginal(), accountAvailable: ref(true), accountReady: ref(true), accountUser: ref(null) }))
vi.mock('../src/services/campusLife.js', async importOriginal => ({ ...await importOriginal(), campusGovernanceAccess: api.access, campusModerationQueue: api.queue, campusModerationHistory: api.history }))
vi.mock('../src/services/platformAdmin.js', async importOriginal => ({ ...await importOriginal(), platformAdminRequest: api.platform }))
vi.mock('../src/services/campusCommunity.js', async importOriginal => ({ ...await importOriginal(), campusFeedbackAdminList: api.feedback }))
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))
let app, host, router
async function mount(path = '/admin') {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: AdminCenterView }] })
  await router.push(path)
  await router.isReady()
  host = document.createElement('div'); document.body.append(host)
  app = createApp(AdminCenterView); app.use(router); app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('.admin-workspace')).toBeTruthy())
}
beforeEach(() => {
  vi.clearAllMocks()
  accountUser.value = { id: 'fictional-owner', email: 'owner@example.invalid' }
  api.access.mockResolvedValue({ owner: true, reviewer: true })
  api.feedback.mockResolvedValue({ items: [], total: 100 })
  api.queue.mockResolvedValue({ items: [], total: 12 })
  api.history.mockResolvedValue({ events: [] })
  api.platform.mockImplementation(async action => ({ identity: { owner: true }, places_pending: { places: [], total: 6, page: 1 }, users_list: { users: [], total: 0, pageSize: 25 }, audit_list: [], place_review_audit: [], overview: { services: {}, counts: {} } })[action])
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; accountUser.value = null })

describe('统一管理工作区', () => {
  it('首页显示真实待办数量，点击带处理状态的入口直接过滤反馈', async () => {
    await mount()
    await vi.waitFor(() => expect(host.querySelectorAll('.admin-inbox li')).toHaveLength(4))
    expect([...host.querySelectorAll('.admin-inbox strong')].map(el => el.textContent)).toEqual(['100', '100', '12', '6'])
    expect(api.platform).not.toHaveBeenCalledWith('users_list', expect.anything())
    expect(api.platform).not.toHaveBeenCalledWith('overview')
    await router.push('/admin/feedback?status=processing')
    await vi.waitFor(() => expect(host.querySelector('.feedback-admin-filters select')?.value).toBe('processing'), { timeout: 10000 })
    expect(api.feedback).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'processing', view: 'summary', limit: 40 }))
    expect(host.querySelector('.admin-inbox')).toBeNull()
    expect(api.access).toHaveBeenCalledTimes(1)
  })
  it('地点、账号和运维切换仅加载当前任务，避免进入后台就查询全部账号', async () => {
    await mount('/platform-admin?section=places')
    await vi.waitFor(() => expect(host.querySelector('.ops-place-review')).toBeTruthy())
    expect(host.querySelector('.ops-accounts')).toBeNull()
    expect(api.platform.mock.calls.map(call => call[0])).toEqual(['identity', 'places_pending'])
    api.platform.mockClear()
    await router.push('/platform-admin?section=accounts')
    await vi.waitFor(() => expect(host.querySelector('.ops-accounts')).toBeTruthy())
    expect(host.querySelector('.ops-place-review')).toBeNull()
    expect(api.platform.mock.calls.map(call => call[0])).toEqual(['identity', 'users_list'])
    await router.push('/platform-admin?section=system')
    await vi.waitFor(() => expect(host.querySelector('.ops-signal')).toBeTruthy())
    expect(host.querySelector('.ops-accounts')).toBeNull()
  })
  it('操作记录合并三类来源，部分来源失败仍显示其他记录', async () => {
    api.history.mockRejectedValue(new Error('fixture unavailable'))
    api.platform.mockImplementation(async action => action === 'identity' ? { owner: true } : action === 'audit_list' ? [{ id: 'fictional-event', action: 'user.suspend', outcome: 'succeeded', reason: '虚构的处理原因', created_at: '2026-10-16T02:00:00Z' }] : [])
    await mount('/platform-admin?section=activity')
    await vi.waitFor(() => expect(host.querySelector('.activity-list')).toBeTruthy())
    expect(host.textContent).toContain('封禁账号')
    expect(host.textContent).toContain('校园记录暂不可用')
    expect(api.platform.mock.calls.map(call => call[0])).not.toContain('users_list')
  })
  it('审核员只看到授权导航，首页不读取账号、地点或反馈管理数据', async () => {
    api.access.mockResolvedValue({ owner: false, reviewer: true, scope: { school: '虚构大学' } })
    await mount()
    await vi.waitFor(() => expect(host.querySelectorAll('.admin-inbox li')).toHaveLength(1))
    const links = host.querySelector('nav[aria-label="管理中心功能"]').textContent
    expect(links).toContain('内容审核')
    expect(links).not.toContain('账号管理')
    expect(links).not.toContain('反馈处理')
    expect(api.platform).not.toHaveBeenCalled()
    expect(api.feedback).not.toHaveBeenCalled()
  })
  it('同一地点审核不会因来自两个日志接口而重复，详情保留处理对象', async () => {
    const event = { id: 'fictional-place-event', target_type: 'place', target_id: 'fictional-place', to_status: 'approved', created_at: '2026-10-16T02:00:00Z' }
    api.history.mockResolvedValue({ events: [event] })
    api.platform.mockImplementation(async action => action === 'identity' ? { owner: true } : action === 'place_review_audit' ? [{ ...event, place_id: event.target_id, decision: 'approved', outcome: 'succeeded' }] : [])
    await mount('/platform-admin?section=activity')
    await vi.waitFor(() => expect(host.querySelectorAll('.activity-list li')).toHaveLength(1))
    expect(host.querySelector('.activity-target').textContent).toContain('fictional-place')
  })
  it('账号切换立即卸载旧账号的管理内容，迟到响应不会带回旧权限', async () => {
    let resolveAccess
    api.access.mockReturnValue(new Promise(resolve => { resolveAccess = resolve }))
    await mount()
    accountUser.value = null
    resolveAccess({ owner: true, reviewer: true })
    await vi.waitFor(() => expect(host.querySelector('.admin-personal-home')).toBeTruthy())
    expect(host.querySelector('nav').textContent).not.toContain('账号管理')
    expect(api.feedback).not.toHaveBeenCalled()
  })
  it('待办读取失败展示不可用，不能伪装成零条', async () => {
    api.feedback.mockRejectedValue(new Error('fixture unavailable'))
    await mount()
    await vi.waitFor(() => expect(host.querySelectorAll('.admin-inbox-unavailable')).toHaveLength(2))
    expect(host.querySelectorAll('.admin-inbox strong')).toHaveLength(2)
  })
  it('审核人员直接访问申请标签时只加载申请，不同时加载内容队列', async () => {
    await mount('/admin/campus?tab=reviewers')
    await vi.waitFor(() => expect(host.querySelector('#reviewer-search')).toBeTruthy())
    expect(host.querySelector('[role="tablist"]').textContent).not.toContain('待处理')
    expect(api.queue).not.toHaveBeenCalled()
  })
  it('未知参数安全回到默认分区，普通用户只能看到概览和本机数据', () => {
    expect(adminSectionForRoute({ path: '/platform-admin', query: { section: 'unknown' } })).toBe('system')
    expect(visibleAdminSections(null).map(item => item.id)).toEqual(['overview', 'data'])
  })
})
