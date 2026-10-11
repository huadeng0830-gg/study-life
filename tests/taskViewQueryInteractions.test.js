// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let app, host, router, nextTick, vue, RouterView, domain, routing, TasksView

function setValue(element, value) {
  expect(element).toBeTruthy()
  element.value = value
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

function visibleIds() {
  return [...host.querySelectorAll('[data-focus-id]')].map((element) => element.dataset.focusId)
}

function buttonWithin(element, text) {
  const button = [...element.querySelectorAll('button')].find((item) => item.textContent.includes(text))
  expect(button, `missing button: ${text}`).toBeTruthy()
  return button
}

async function mountPage() {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = vue.createApp({ render: () => vue.h(RouterView) })
  app.use(router)
  app.mount(host)
  await nextTick()
}

async function createPageRouter(url) {
  router = routing.createRouter({ history: routing.createMemoryHistory(), routes: [
    { path: '/tasks', component: TasksView },
    ...['/schedule', '/course', '/exams', '/review'].map((path) => ({ path, component: { render: () => null } })),
  ] })
  await router.push(url)
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  localStorage.setItem('sl_tasks', JSON.stringify([
    { id: 'high', title: '虚构实验报告', dueDate: '2026-10-09', priority: 'high', createdAt: '2026-10-01T10:00:00Z' },
    { id: 'low', title: '虚构阅读记录', dueDate: '2026-10-10', priority: 'low', createdAt: '2026-10-08T10:00:00Z' },
    { id: 'unplanned', title: '虚构待安排事项', priority: 'normal', createdAt: '2026-10-02T10:00:00Z' },
  ]))
  vue = await import('vue')
  nextTick = vue.nextTick
  routing = await import('vue-router')
  RouterView = routing.RouterView
  const { clock } = await import('../src/composables/store/core.js')
  clock.value = new Date('2026-10-09T09:00:00Z')
  domain = (await import('../src/composables/domain/commands.js')).useDomainCommands()
  TasksView = (await import('../src/views/TasksView.vue')).default
  await createPageRouter('/tasks')
  await mountPage()
})

afterEach(() => {
  app?.unmount()
  host?.remove()
})

describe('待办页面真实控件到数据投影', () => {
  it('手机状态选择器使用同一数据与地址状态，浏览器返回恢复筛选', async () => {
    setValue(host.querySelector('#tasks-mobile-state'), 'unplanned')
    await nextTick()
    expect(visibleIds()).toEqual(['unplanned'])
    await vi.waitFor(() => expect(router.currentRoute.value.query.f).toBe('unplanned'))
    await router.push('/tasks?f=all')
    await nextTick()
    expect(visibleIds()).toHaveLength(3)
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.f).toBe('unplanned'))
    await nextTick()
    expect(host.querySelector('#tasks-mobile-state').value).toBe('unplanned')
    expect(visibleIds()).toEqual(['unplanned'])
  })
  it('再次点击当前视图或状态仍保持选择和地址，不会取消必选项', async () => {
    buttonWithin(host.querySelector('[aria-label="待办视图"]'), '列表').click()
    buttonWithin(host.querySelector('[aria-label="待办筛选"]'), '已安排').click()
    await nextTick()
    expect(buttonWithin(host.querySelector('[aria-label="待办视图"]'), '列表').getAttribute('aria-pressed')).toBe('true')
    expect(buttonWithin(host.querySelector('[aria-label="待办筛选"]'), '已安排').getAttribute('aria-pressed')).toBe('true')
    expect(visibleIds()).toEqual(['high', 'low'])
    expect(router.currentRoute.value.query.view).toBeUndefined()
  })

  it('排序下拉框更新顺序、方向和地址', async () => {
    expect(visibleIds()).toEqual(['high', 'low'])
    setValue(host.querySelector('.sort-select select'), 'created')
    await nextTick()
    expect(visibleIds()).toEqual(['low', 'high'])
    await vi.waitFor(() => expect(router.currentRoute.value.query.sort).toBe('created'))
    expect(host.querySelector('.sort-select select').value).toBe('created')
  })

  it('优先级下拉框筛掉不匹配的待办并写入地址', async () => {
    setValue(host.querySelector('.workspace-select select'), 'low')
    await nextTick()
    expect(visibleIds()).toEqual(['low'])
    await vi.waitFor(() => expect(router.currentRoute.value.query.prio).toBe('low'))
    expect(host.querySelector('.workspace-select select').value).toBe('low')
  })

  it('日期范围下拉框允许查看待安排事项并同步状态组', async () => {
    setValue(host.querySelectorAll('.workspace-select select')[1], 'unplanned')
    await nextTick()
    expect(visibleIds()).toEqual(['unplanned'])
    await vi.waitFor(() => expect(router.currentRoute.value.query).toMatchObject({ when: 'unplanned', f: 'all' }))
  })

  it('只剩待安排事项时，明确选择已安排后刷新仍停留在该空列表', async () => {
    domain.tasks.value = domain.tasks.value.filter((task) => task.id === 'unplanned')
    await nextTick()
    expect(visibleIds()).toEqual(['unplanned'])
    buttonWithin(host.querySelector('[aria-label="待办筛选"]'), '已安排').click()
    await nextTick()
    expect(visibleIds()).toEqual([])
    await vi.waitFor(() => expect(router.currentRoute.value.query.f).toBe('scheduled'))
    const savedUrl = router.currentRoute.value.fullPath
    app.unmount()
    host.remove()
    await createPageRouter(savedUrl)
    await mountPage()
    expect(visibleIds()).toEqual([])
    expect(buttonWithin(host.querySelector('[aria-label="待办筛选"]'), '已安排').getAttribute('aria-pressed')).toBe('true')
  })

  it('导航被拒绝时呈现错误并恢复列表，重试成功后清除错误', async () => {
    const removeGuard = router.beforeEach(() => false)
    setValue(host.querySelector('.workspace-select select'), 'low')
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('已恢复原状态'))
    expect(visibleIds()).toEqual(['high', 'low'])
    expect(host.querySelector('.workspace-select select').value).toBe('all')
    removeGuard()
    setValue(host.querySelector('.workspace-select select'), 'low')
    await vi.waitFor(() => expect(router.currentRoute.value.query.prio).toBe('low'))
    expect(visibleIds()).toEqual(['low'])
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('快速设置组合筛选后看板和月历保持一致，清除和排序方向按钮有效', async () => {
    const originalTasks = JSON.stringify(domain.tasks.value)
    setValue(host.querySelector('.sort-select select'), 'created')
    setValue(host.querySelector('.workspace-select select'), 'low')
    setValue(host.querySelectorAll('.workspace-select select')[1], 'week')
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ f: 'all', sort: 'created', prio: 'low', when: 'week' }))
    expect(visibleIds()).toEqual(['low'])
    buttonWithin(host.querySelector('[aria-label="待办视图"]'), '看板').click()
    await vi.waitFor(() => expect(host.querySelector('.task-board')).toBeTruthy())
    expect(visibleIds()).toEqual(['low'])
    buttonWithin(host.querySelector('[aria-label="待办视图"]'), '月历').click()
    await vi.waitFor(() => expect(host.querySelector('.cal-wrap')).toBeTruthy())
    expect(host.querySelector('.workspace-result').textContent).toContain('1 项待办')
    buttonWithin(host.querySelector('.workspace-result'), '清除筛选').click()
    await vi.waitFor(() => expect(router.currentRoute.value.query.prio).toBeUndefined())
    expect(router.currentRoute.value.query.when).toBeUndefined()
    expect(router.currentRoute.value.query.view).toBe('calendar')
    expect(host.querySelector('.workspace-result').textContent).toContain('3 项待办')
    host.querySelector('button[aria-label^="切换排序方向"]').click()
    await vi.waitFor(() => expect(router.currentRoute.value.query.dir).toBe('asc'))
    expect(router.currentRoute.value.query.sort).toBe('created')
    expect(JSON.stringify(domain.tasks.value)).toBe(originalTasks)
  })

  it('搜索和清除按钮同步列表与 URL，重建页面按地址恢复搜索', async () => {
    setValue(host.querySelector('#tasks-search'), '阅读记录')
    await vi.waitFor(() => expect(visibleIds()).toEqual(['low']))
    await vi.waitFor(() => expect(router.currentRoute.value.query.q).toBe('阅读记录'))
    const savedUrl = router.currentRoute.value.fullPath
    app.unmount()
    host.remove()
    await createPageRouter(savedUrl)
    await mountPage()
    expect(host.querySelector('#tasks-search').value).toBe('阅读记录')
    expect(visibleIds()).toEqual(['low'])
    host.querySelector('[aria-label="清除待办搜索"]').click()
    await vi.waitFor(() => expect(router.currentRoute.value.query.q).toBeUndefined())
    expect(host.querySelector('#tasks-search').value).toBe('')
    expect(visibleIds()).toEqual(['high', 'low'])
  })
})
