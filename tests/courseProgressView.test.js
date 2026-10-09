// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))
registerMirrorTeardown()
let mounted
let domain
let router
let host
let nextTick

async function settle() {
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await nextTick()
}

async function mount(path = '/course') {
  const vue = await import('vue')
  nextTick = vue.nextTick
  const { createMemoryHistory, createRouter, RouterView } = await import('vue-router')
  const { default: CourseProgress } = await import('../src/views/CourseArchiveView.vue')
  const { default: Tasks } = await import('../src/views/TasksView.vue')
  const { useDomainCommands } = await import('../src/composables/domain/commands.js')
  const { clock } = await import('../src/composables/store/core.js')
  const { settings } = await import('../src/composables/settingsPolicy.js')
  settings.value = { timezone: 'Asia/Shanghai' }
  clock.value = new Date('2026-10-09T02:00:00Z')
  domain = useDomainCommands()
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/course', component: CourseProgress }, { path: '/tasks', component: Tasks },
    { path: '/:pathMatch(.*)*', component: { template: '<div>其他页面</div>' } },
  ] })
  await router.push(path)
  await router.isReady()
  host = document.createElement('div')
  document.body.appendChild(host)
  mounted = vue.createApp({ render: () => vue.h(RouterView, null, {
    default: ({ Component }) => Component ? vue.h(vue.KeepAlive, null, [vue.h(Component)]) : null,
  }) })
  mounted.use(router)
  mounted.mount(host)
  await settle()
}

function button(root, label) {
  return [...root.querySelectorAll('button')].find((item) => item.textContent.includes(label))
}

function seed() {
  const set = (key, value) => localStorage.setItem(key, JSON.stringify(value))
  set('sl_courses', [
    { id: 'c1', name: '示例数学', teacher: '示例老师甲', room: '示例楼A101', day: 0, start: 'p0', end: 'p1' },
    { id: 'c2', name: '示例英语', teacher: '示例老师乙', day: 2, start: 'p0', end: 'p1' },
    { id: 'old', name: '归档示例课', archivedAt: '2026-09-01', day: 1, start: 'p0', end: 'p1' },
  ])
  set('sl_tasks', [
    { id: 't1', title: '示例章节练习', courseId: 'c1', status: 'pending', dueDate: '2026-10-08', workCheckpoint: { lastStep: '算完前两题', nextStep: '完成第三题', resources: [] } },
    { id: 'completed', title: '已完成的示例预习', courseId: 'c1', done: true },
  ])
  set('sl_events', [{ id: 'ev1', title: '示例答疑', courseId: 'c1', date: '2026-10-10', time: '15:00' }])
  set('sl_exams', [{ id: 'ex1', name: '示例章节测验', courseId: 'c1', kind: 'exam', date: '2026-10-12' }])
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  seed()
})
afterEach(async () => {
  mounted?.unmount()
  host?.remove()
  const { cancelPendingMirrorWrites } = await import('../src/composables/dataVault.js')
  cancelPendingMirrorWrites()
  mounted = null
  document.querySelectorAll('.overlay, .toast').forEach((element) => element.remove())
})

describe('课程进度的实际操作', () => {
  it('opens the overview without a course ID and supports search, pending filters, and archives', async () => {
    await mount()
    expect(host.querySelector('h1').textContent).toBe('课程进度')
    expect([...host.querySelectorAll('.course-card h3')].map((node) => node.textContent)).toEqual(['示例数学', '示例英语'])
    expect(host.textContent).not.toContain('找不到这门课程')
    button(host, '待推进').click()
    await settle()
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    const search = host.querySelector('input[type="search"]')
    search.value = '无匹配'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(host.textContent).toContain('没有匹配的课程')
    button(host, '重置筛选').click()
    await settle()
    button(host, '已归档').click()
    await settle()
    expect(host.querySelector('.course-card h3').textContent).toBe('归档示例课')
  })

  it('resumes prior work in the existing workbench and writes completion back to the original task', async () => {
    await mount('/course?courseId=c1')
    expect(host.textContent).toContain('下一步：完成第三题')
    button(host, '继续这项任务').click()
    await settle()
    expect(document.querySelector('[role="dialog"]').textContent).toContain('算完前两题')
    button(document.querySelector('[role="dialog"]'), '开始执行').click()
    await settle()
    expect(domain.tasks.value.find((task) => task.id === 't1').status).toBe('in_progress')
    host.querySelector('[aria-label="完成待办：示例章节练习"]').click()
    await settle()
    expect(domain.tasks.value.find((task) => task.id === 't1')).toMatchObject({ done: true, status: 'completed' })
    expect(host.textContent).toContain('课程待办已处理完')
    expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('100')
    button(host, '展开记录').click()
    await settle()
    expect(host.querySelector('#course-history').textContent).toContain('示例章节练习')
    const eventLink = [...host.querySelectorAll('#course-history a')].find((link) => link.textContent === '示例答疑')
    expect(eventLink.getAttribute('href')).toContain('/events?focus=ev1')
  })

  it('adds a course task through the shared task form with its stable course ID already selected', async () => {
    await mount('/course?courseId=c1')
    host.querySelector('.course-header-actions .btn-primary').click()
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.querySelector('#tasks-course').value).toBe('示例数学')
    const title = dialog.querySelector('#tasks-title')
    title.value = '新建示例课程待办'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    button(dialog, '保存').click()
    await settle()
    expect(domain.tasks.value.find((task) => task.title === '新建示例课程待办')).toMatchObject({ courseId: 'c1', course: '示例数学' })
    expect(router.currentRoute.value.query).not.toHaveProperty('new')
    await router.push('/course?courseId=c1')
    await settle()
    expect(host.querySelector('.course-task-list').textContent).toContain('新建示例课程待办')
  })

  it('opens a collapsed history for a deep link, preserves the course selection, and recovers from a stale course link', async () => {
    await mount('/course?courseId=c1&focus=completed&section=task')
    await settle()
    expect(host.querySelector('#course-history').textContent).toContain('已完成的示例预习')
    expect(host.querySelector('[data-focus-id="completed"]').classList.contains('focus-target-highlight')).toBe(true)
    expect(router.currentRoute.value.query.courseId).toBe('c1')
    expect(router.currentRoute.value.query).not.toHaveProperty('focus')
    await router.push('/course?courseId=removed')
    await settle()
    expect(host.textContent).toContain('这门课程已不存在')
    button(host, '查看全部课程').click()
    await settle()
    expect(host.querySelectorAll('.course-card')).toHaveLength(2)
  })

  it('leaves other pages’ deep links to their own handlers while the course view is cached', async () => {
    await mount('/course?courseId=c1')
    await router.push('/tasks?focus=t1')
    await settle()
    expect(host.querySelector('[data-focus-id="t1"]').classList.contains('focus-target-highlight')).toBe(true)
  })
})
