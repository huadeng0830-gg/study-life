// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let app, host, router, nextTick, domain

function buttonWithin(element, text) {
  const button = [...element.querySelectorAll('button')].find((item) => item.textContent.includes(text))
  expect(button, `missing button: ${text}`).toBeTruthy()
  return button
}

function inputValue(element, value) {
  element.value = value
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

function visibleIds() {
  return [...host.querySelectorAll('[data-focus-id]')].map((element) => element.dataset.focusId)
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  localStorage.setItem('sl_tasks', JSON.stringify([
    { id: 'today', title: '提交实验报告', dueDate: '2026-10-09', priority: 'high', workCheckpoint: { nextStep: '核对数据' } },
    { id: 'overdue', title: '整理访谈资料', dueDate: '2026-10-08', dueTime: '16:00', status: 'in_progress' },
    { id: 'review', title: '复习：期末考试', dueDate: '2026-10-10', sourceType: 'milestone-review', sourceId: 'exam' },
    { id: 'unplanned', title: '阅读论文', priority: 'low' },
  ]))
  localStorage.setItem('sl_exams', JSON.stringify([
    { id: 'exam', name: '期末考试', date: '2026-10-10', category: '学习', reviewProgress: 40 },
    { id: 'past', name: '上次考试', date: '2026-10-08', category: '学习' },
    { id: 'annual', name: '年度生日', date: '2020-10-08', category: '纪念日', repeat: 'yearly' },
  ]))
  const vue = await import('vue')
  nextTick = vue.nextTick
  const { createMemoryHistory, createRouter, RouterView } = await import('vue-router')
  const { clock } = await import('../src/composables/store/core.js')
  clock.value = new Date('2026-10-09T09:00:00Z')
  const { useDomainCommands } = await import('../src/composables/domain/commands.js')
  domain = useDomainCommands()
  const TasksView = (await import('../src/views/TasksView.vue')).default
  const ExamsView = (await import('../src/views/ExamsView.vue')).default
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/tasks', component: TasksView }, { path: '/exams', component: ExamsView },
  ] })
  await router.push('/tasks')
  await router.isReady()
  host = document.createElement('div')
  document.body.appendChild(host)
  app = vue.createApp({ render: () => vue.h(RouterView) })
  app.use(router)
  app.mount(host)
  await nextTick()
})

afterEach(() => {
  app?.unmount()
  host?.remove()
})

describe('重要日期与待办交互', () => {
  it('更多操作可用键盘关闭，也会在打开粘贴通知后收起', async () => {
    host.querySelector('.task-tools summary').click()
    await nextTick()
    expect(host.querySelector('.task-tools').open).toBe(true)
    host.querySelector('.task-tools summary').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.querySelector('.task-tools').open).toBe(false)
    host.querySelector('.task-tools summary').click()
    buttonWithin(host.querySelector('.task-tools-menu'), '粘贴通知').click()
    await nextTick()
    expect(host.querySelector('.task-tools').open).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('概览筛选逾期，重新安排日期保留工作状态，并可撤销', async () => {
    buttonWithin(host.querySelector('.task-overview'), '已逾期').click()
    await nextTick()
    expect(visibleIds()).toEqual(['overdue'])
    buttonWithin(host.querySelector('[data-focus-id="overdue"]'), '重新安排').click()
    await nextTick()
    const form = document.querySelector('.reschedule-form')
    buttonWithin(form, '一周后').click()
    await nextTick()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(domain.tasks.value.find((task) => task.id === 'overdue')).toMatchObject({ dueDate: '2026-10-16', status: 'in_progress' })
    document.querySelector('.toast-undo').click()
    await nextTick()
    expect(domain.tasks.value.find((task) => task.id === 'overdue')).toMatchObject({ dueDate: '2026-10-08', dueTime: '16:00', status: 'in_progress' })
  })

  it('搜索与优先级同时作用于列表、看板和月历', async () => {
    inputValue(host.querySelector('#tasks-search'), '核对')
    inputValue(host.querySelector('.workspace-select select'), 'high')
    await vi.waitFor(() => expect(visibleIds()).toEqual(['today']))
    buttonWithin(host.querySelector('[aria-label="待办视图"]'), '看板').click()
    await vi.waitFor(() => expect(host.querySelector('.task-board')).toBeTruthy())
    expect(visibleIds()).toEqual(['today'])
    buttonWithin(host.querySelector('[aria-label="待办视图"]'), '月历').click()
    await vi.waitFor(() => expect(host.querySelector('.cal-wrap')).toBeTruthy())
    expect(host.querySelector('.workspace-result').textContent).toContain('1 项待办')
  })

  it('继续复习打开同一条待办，定位会清除当前搜索条件', async () => {
    inputValue(host.querySelector('#tasks-search'), '不存在的待办')
    await vi.waitFor(() => expect(visibleIds()).toEqual([]))
    await router.push('/exams')
    await nextTick()
    buttonWithin(host.querySelector('[data-focus-id="exam"]'), '继续复习').click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/tasks'))
    await vi.waitFor(() => expect(visibleIds()).toContain('review'))
    expect(domain.tasks.value.filter((task) => task.sourceId === 'exam')).toHaveLength(1)
    expect(host.querySelector('#tasks-search').value).toBe('')
  })

  it('从待办定位已结束的重要日期，年度日期显示下一次发生年份', async () => {
    await router.push('/exams')
    await nextTick()
    expect(host.querySelector('[data-focus-id="annual"] .date').textContent).toContain('2027年10月8日')
    await router.push({ path: '/exams', query: { focus: 'past' } })
    await vi.waitFor(() => expect(visibleIds()).toContain('past'))
  })

  it('快捷添加使用表单提交，单项提醒与复习进度可保存', async () => {
    await router.push('/exams')
    await nextTick()
    buttonWithin(host.querySelector('.page-actions'), '添加重要日期').click()
    await nextTick()
    const form = document.querySelector('form.form')
    inputValue(form.querySelector('#exams-name'), '新考试')
    buttonWithin(form.querySelector('.date-shortcuts'), '明天').click()
    inputValue(form.querySelector('#dates-reminder'), '30')
    inputValue(form.querySelector('#exams-review-progress'), '65')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(domain.milestones.value.find((item) => item.name === '新考试')).toMatchObject({ date: '2026-10-10', reminderMinutes: 30, reviewProgress: 65 })
    expect(document.querySelector('form.form')).toBeNull()
    expect(host.querySelector('progress[value="65"]')).toBeTruthy()
  })
})
