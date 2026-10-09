// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let app, host, router, domain, vue, flushStoredWrites
const instant = new Date('2026-10-09T01:00:00Z')
async function settle() {
  await Promise.resolve()
  await vue.nextTick()
  flushStoredWrites?.()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await vue.nextTick()
}
const button = (root, text) => [...root.querySelectorAll('button')].find((element) => element.textContent.includes(text))
const setInput = (selector, value) => { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }

async function mount(path = '/schedule') {
  vue = await import('vue')
  const { createMemoryHistory, createRouter, RouterView } = await import('vue-router')
  const { settings } = await import('../src/composables/settingsPolicy.js')
  settings.value = { timezone: 'Asia/Shanghai' }
  const { clock, flushStoredWrites: flush } = await import('../src/composables/store/core.js')
  flushStoredWrites = flush
  clock.value = instant
  domain = (await import('../src/composables/domain/commands.js')).useDomainCommands()
  const { appearance } = await import('../src/composables/appearance.js')
  appearance.value.homeModules = appearance.value.homeModules.map((module) => ({ ...module, visible: module.id !== 'focus' }))
  const components = await Promise.all([
    import('../src/views/ScheduleView.vue'), import('../src/views/TasksView.vue'), import('../src/views/ExamsView.vue'),
    import('../src/views/TodayView.vue'), import('../src/views/CourseArchiveView.vue'),
  ])
  await Promise.all([import('../src/components/learning/StudyPlanner.vue'), import('../src/components/schedule/CourseEditorModal.vue')])
  router = createRouter({ history: createMemoryHistory(), routes: [
    ...['/schedule', '/tasks', '/exams', '/', '/course'].map((path, index) => ({ path, component: components[index].default })),
    { path: '/:pathMatch(.*)*', component: { template: '<div>其他示例页面</div>' } },
  ] })
  await router.push(path)
  await router.isReady()
  host = document.createElement('div')
  document.body.appendChild(host)
  app = vue.createApp({ render: () => vue.h(RouterView, null, { default: ({ Component }) => Component ? vue.h(vue.KeepAlive, null, [vue.h(Component)]) : null }) })
  app.use(router)
  app.mount(host)
  await settle()
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(instant)
  localStorage.clear()
  const store = (key, value) => localStorage.setItem(key, JSON.stringify(value))
  store('sl_semester', { start: '2026-10-05' })
  store('sl_courses', [{ id: 'c1', name: '示例数学', teacher: '示例老师', room: '示例楼', day: 4, start: 'p0', end: 'p1', startWeek: 1, endWeek: 16, color: '#456fe8' }])
  store('sl_tasks', [{ id: 't1', title: '示例章节练习', courseId: 'c1', dueDate: '2026-10-08', status: 'pending', workCheckpoint: { lastStep: '算完前两题', nextStep: '完成第三题', resources: [] } }])
  store('sl_exams', [{ id: 'exam', name: '示例测验', category: '学习', kind: 'exam', courseId: 'c1', date: '2026-10-12' }])
})
afterEach(async () => {
  app?.unmount()
  host?.remove()
  app = null
  document.querySelectorAll('.overlay, .toast').forEach((element) => element.remove())
  ;(await import('../src/composables/dataVault.js')).cancelPendingMirrorWrites()
  vi.useRealTimers()
})

describe('以课表为中心的实际学习流程', () => {
  it('opens with the timetable before the collapsed learning plan and shows course task badges', async () => {
    await mount()
    expect(host.querySelector('h1').textContent).toBe('课程表')
    expect(host.querySelector('.learning-plan-toggle').getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('.study-planner')).toBeNull()
    const grid = host.querySelector('.timetable-wrap, .mobile-day-view')
    expect(grid).not.toBeNull()
    expect(grid.compareDocumentPosition(host.querySelector('.learning-plan-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelector('.course-study-badge').textContent).toContain('1 项逾期')
    expect(host.querySelector('nav[aria-label="学习功能"] a[aria-current="page"]').textContent).toBe('课程表')
  })

  it('opens linked learning actions from a course and carries its ID to a new exam', async () => {
    await mount('/tasks')
    await router.push('/schedule')
    await settle()
    host.querySelector('.course, .mobile-course-row').click()
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.querySelector('.form').firstElementChild.className).toContain('course-links')
    expect(dialog.querySelector('.link-list a').getAttribute('href')).toBe('/tasks?focus=t1')
    expect(dialog.querySelector('.link-list small').textContent).toContain('2026-10-08')
    const addExam = [...dialog.querySelectorAll('a')].find((link) => link.textContent.includes('记录考试'))
    addExam.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/exams')
    const courseSelect = document.querySelector('[role="dialog"] select')
    expect([...document.querySelectorAll('[role="dialog"] select')].some((select) => select.value === 'c1')).toBe(true)
    expect(courseSelect).not.toBeNull()
  })

  it('saves a suggested session to the real calendar, supports undo and keeps the task intact', async () => {
    await mount()
    host.querySelector('.learning-plan-toggle').click()
    await settle()
    const planner = host.querySelector('.study-planner')
    button(planner, '加入日程').click()
    await settle()
    expect(domain.events.value).toHaveLength(1)
    expect(domain.events.value[0]).toMatchObject({ sourceType: 'study-block', sourceId: 't1', courseId: 'c1' })
    expect(planner.querySelector('.planned-row').textContent).toContain('示例章节练习')
    button(planner, '撤销').click()
    await settle()
    expect(domain.events.value).toHaveLength(0)
    expect(domain.tasks.value[0]).toMatchObject({ status: 'pending', dueDate: '2026-10-08' })
  })

  it('prepares the original task even when focus is hidden, and preserves unrelated route and appearance settings', async () => {
    await mount('/?focusTask=t1&focusMinutes=15&sample=keep')
    expect(host.querySelector('.focus-panel')).not.toBeNull()
    expect(host.querySelector('#focus-goal-input').value).toBe('示例章节练习')
    expect(host.querySelector('.start-btn').textContent).toContain('15分钟')
    expect(host.querySelector('.focus-checkpoint').textContent).toContain('完成第三题')
    expect(router.currentRoute.value.query).toEqual({ sample: 'keep' })
    const { appearance } = await import('../src/composables/appearance.js')
    expect(appearance.value.homeModules.find((module) => module.id === 'focus').visible).toBe(false)
    expect(localStorage.getItem('sl_focus_active')).toBeNull()
    host.querySelector('.start-btn').click()
    await settle()
    expect(JSON.parse(localStorage.getItem('sl_focus_active'))).toMatchObject({ todoId: 't1', courseId: 'c1', plannedMinutes: 15 })
    expect(domain.tasks.value[0].status).toBe('in_progress')
  })

  it('records real focus time and a work checkpoint onto the existing task after finishing', async () => {
    await mount('/?focusTask=t1&focusMinutes=15')
    host.querySelector('.start-btn').click()
    await settle()
    vi.setSystemTime(new Date(instant.getTime() + 5 * 60000))
    button(host.querySelector('.focus-active'), '结束').click()
    await settle()
    button(document.querySelector('[role="dialog"]'), '保存记录').click()
    await settle()
    expect(domain.focusSessions.value[0]).toMatchObject({ todoId: 't1', courseId: 'c1', actualFocusSeconds: 300 })
    expect(domain.tasks.value[0].focusTotalSeconds).toBe(300)
    button(host.querySelector('.focus-completed'), '记录做到哪里').click()
    await settle()
    setInput('#task-work-checkpoint-last', '完成第三题')
    setInput('#task-work-checkpoint-next', '核对示例答案')
    button(document.querySelector('[role="dialog"]'), '保存进度').click()
    await settle()
    expect(domain.tasks.value).toHaveLength(1)
    expect(domain.tasks.value[0].workCheckpoint).toMatchObject({ lastStep: '完成第三题', nextStep: '核对示例答案' })
  })

  it('does not replace an existing active focus session when another task requests focus', async () => {
    const existing = { sessionId: 'existing', focusType: 'temporary', title: '示例当前专注', plannedMinutes: 25, startedAt: instant.toISOString(), segmentStartedAt: instant.toISOString(), status: 'running', elapsedSeconds: 0 }
    localStorage.setItem('sl_focus_active', JSON.stringify(existing))
    await mount('/?focusTask=t1&focusMinutes=15')
    expect(host.querySelector('.focus-active').textContent).toContain('示例当前专注')
    expect(host.textContent).toContain('已有专注正在进行')
    expect(JSON.parse(localStorage.getItem('sl_focus_active')).sessionId).toBe('existing')
    expect(domain.tasks.value[0].status).toBe('pending')
  })

  it('reuses a review task when preparing repeated review from the timetable', async () => {
    await mount()
    host.querySelector('.learning-plan-toggle').click()
    await settle()
    button(host.querySelector('.study-planner'), '准备复习').click()
    await settle()
    expect(host.querySelector('#focus-goal-input').value).toBe('复习：示例测验')
    expect(domain.tasks.value.filter((task) => task.sourceId === 'exam')).toHaveLength(1)
    await router.push('/schedule')
    await settle()
    button(host.querySelector('.study-planner'), '准备复习').click()
    await settle()
    expect(domain.tasks.value.filter((task) => task.sourceId === 'exam')).toHaveLength(1)
  })
})
