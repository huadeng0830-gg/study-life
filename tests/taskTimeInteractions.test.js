// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()
let app, host, router, nextTick, domain

function button(element, text) {
  const target = [...element.querySelectorAll('button')].find((item) => item.textContent.includes(text))
  expect(target, `missing button: ${text}`).toBeTruthy()
  return target
}
function value(element, next) {
  element.value = next
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
async function clickElement(element) {
  // happy-dom 的动画帧可能立即执行；跨过一次帧时长，避免 Vue 将同毫秒点击当作旧事件。
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
async function click(element, text) { await clickElement(button(element, text)) }
function submit(form) { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
function task() { return domain.tasks.value.find((item) => item.id === 'generic') }
function row() { return host.querySelector('[data-focus-id="generic"]') }

beforeEach(async () => {
  // 每次挂载隔离测试浮层和播报节点。
  document.body.replaceChildren()
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'generic', title: '示例课程展示', status: 'pending', done: false, timeStages: [
    { id: 'prep', label: '准备材料', kind: 'window', start: { date: '2026-10-09', time: '09:00' }, end: { date: '2026-10-11', time: '18:00' }, completionRequired: true, reminders: [] },
    { id: 'show', label: '现场展示', kind: 'scheduled', start: { date: '2026-10-12', time: '23:45' }, end: { date: '2026-10-13', time: '01:15' }, completionRequired: true, reminders: [] },
  ] }]))
  const vue = await import('vue')
  nextTick = vue.nextTick
  const { createMemoryHistory, createRouter, RouterView } = await import('vue-router')
  ;(await import('../src/composables/store/core.js')).clock.value = new Date('2026-10-10T10:00:00Z')
  domain = (await import('../src/composables/domain/commands.js')).useDomainCommands()
  const TasksView = (await import('../src/views/TasksView.vue')).default
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/tasks', component: TasksView }] })
  await router.push('/tasks')
  await router.isReady()
  host = document.createElement('div')
  document.body.appendChild(host)
  app = vue.createApp({ render: () => vue.h(RouterView) })
  app.use(router)
  app.mount(host)
  await nextTick()
})
afterEach(() => { app?.unmount(); host?.remove() })

describe('实际待办阶段交互', () => {
  it('完成前阶段保留后阶段，最后阶段明确完成事项，撤销恢复原阶段事实', async () => {
    expect(row()).toBeTruthy()
    await click(row(), '完成「准备材料」')
    expect(task().timeStages[0].completedAt).toBeTruthy()
    expect(task().done).toBe(false)
    expect(row().textContent).toContain('现场展示')
    await click(row(), '完成事项')
    expect(task().done).toBe(true)
    await clickElement(host.querySelector('.toast-undo'))
    expect(task().done).toBe(false)
    expect(task().timeStages[0].completedAt).toBeTruthy()
    expect(task().timeStages[1].completedAt).toBeUndefined()
  })

  it('各视图的整体完成入口先说明剩余阶段，取消不会改变记录', async () => {
    await clickElement(row().querySelector('.check'))
    expect(task().done).toBe(false)
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('还有 2 个阶段')
    await click(dialog, '继续处理阶段')
    expect(task().done).toBe(false)
    await clickElement(row().querySelector('.check'))
    await click(document.querySelector('[role="dialog"]'), '直接完成事项')
    expect(task().done).toBe(true)
    expect(task().timeStages.every((item) => !item.completedAt)).toBe(true)
  })

  it('编辑表单组合改期先预览、应用到草稿，再保存，完成历史不移动', async () => {
    domain.setTaskStageCompleted('generic', 'prep', true)
    await nextTick()
    await click(row(), '查看 2 段安排')
    const form = document.querySelector('form.form')
    await click(form, '移动剩余安排')
    await click(form.querySelector('.shift-presets'), '1 天 2 小时')
    expect(form.querySelector('.shift-preview').textContent).toContain('2026-10-14 01:45')
    expect(task().timeStages[1].start.date).toBe('2026-10-12')
    await click(form, '应用到草稿')
    expect(task().timeStages[1].start.date).toBe('2026-10-12')
    submit(form)
    await nextTick()
    expect(task().timeStages[1].start).toEqual({ date: '2026-10-14', time: '01:45' })
    expect(task().timeStages[0].start.date).toBe('2026-10-09')
    expect(task().timeStages[0].completedAt).toBeTruthy()
    await clickElement(host.querySelector('.toast-undo'))
    expect(task().timeStages[1].start).toEqual({ date: '2026-10-12', time: '23:45' })
    expect(task().timeStages[0].completedAt).toBeTruthy()
  })

  it('纯日期按小时改期须补时刻，输入保持可修改，保存为明确的时刻', async () => {
    const item = domain.createTask({ id: 'date-only', title: '示例提交', dueDate: '2026-10-11' })
    await nextTick()
    await click(host.querySelector('[data-focus-id="date-only"]'), '改期')
    const form = document.querySelector('.reschedule-form')
    await click(form, '移动剩余安排')
    expect(button(form, '应用到草稿').disabled).toBe(true)
    value(form.querySelector('.shift-precision input'), '09:00')
    await nextTick()
    expect(form.querySelector('.shift-precision input').value).toBe('09:00')
    expect(form.querySelector('.shift-preview').textContent).toContain('11:00')
    await click(form, '应用到草稿')
    submit(form)
    await nextTick()
    expect(item.dueTime).toBe('11:00')
    await clickElement(host.querySelector('.toast-undo'))
    expect(item.dueTime).toBe('')
  })

  it('未命名未定日期阶段可保存，具体区间错误定位到对应端点并保留输入', async () => {
    await click(host, '添加待办')
    const form = document.querySelector('form.form')
    value(form.querySelector('#tasks-title'), '示例想法')
    await click(form, '添加起止时间')
    expect(form.querySelector('.stage-fields input[placeholder*="例如"]')).toBeNull()
    submit(form)
    await nextTick()
    const saved = domain.tasks.value.find((item) => item.title === '示例想法')
    expect(saved.timeStages[0].label).toBe('阶段 1')
    expect(saved.timeStages[0].start).toBeUndefined()
    await click(row(), '查看 2 段安排')
    const editForm = document.querySelector('form.form')
    value(editForm.querySelector('[data-time-field="timeStages.0.start.date"]'), '2026-10-20')
    await nextTick()
    submit(editForm)
    await nextTick()
    await nextTick()
    expect(editForm.querySelector('[role="alert"]').textContent).toContain('结束须晚于开始')
    expect(document.activeElement.dataset.timeField).toBe('timeStages.0.end.date')
    expect(editForm.querySelector('[data-time-field="timeStages.0.start.date"]').value).toBe('2026-10-20')
    expect(task().timeStages[0].start.date).toBe('2026-10-09')
  })

  it('保存改期后撤销只恢复移动时间，保留后来新增、改名和完成的阶段', async () => {
    await click(row(), '改期')
    const form = document.querySelector('.reschedule-form')
    await click(form, '移动剩余安排')
    await click(form, '应用到草稿')
    submit(form)
    await nextTick()
    domain.updateTask('generic', { timeStages: [
      { ...task().timeStages[0], label: '后来改名', completedAt: '2026-10-10T11:00:00Z' },
      task().timeStages[1],
      { id: 'new', label: '后来新增', kind: 'window', start: { date: '2026-10-20' }, reminders: [] },
    ] })
    await nextTick()
    await clickElement(host.querySelector('.toast-undo'))
    expect(task().timeStages[0].label).toBe('后来改名')
    expect(task().timeStages[0].completedAt).toBeTruthy()
    expect(task().timeStages[0].start.time).toBe('09:00')
    expect(task().timeStages[1].start.time).toBe('23:45')
    expect(task().timeStages[2].label).toBe('后来新增')
  })

  it('日历阶段标记打开同一事项并展开对应阶段', async () => {
    await router.push('/tasks?view=calendar&month=2026-10')
    await nextTick()
    await clickElement(host.querySelector('[aria-label^="10月12日"]'))
    await click(host.querySelector('.cal-detail'), '现场展示开始')
    await nextTick()
    expect(document.querySelector('[data-stage-id="show"] .stage-fields')).toBeTruthy()
    expect(document.querySelector('[data-stage-id="prep"] .stage-fields')).toBeNull()
    expect(document.querySelector('#tasks-title').value).toBe('示例课程展示')
  })

  it.each([
    ['编辑', { dueDate: '2027-03-01' }, '2027-03-01', 1, '2027-04-01'],
    ['改期', { dueDate: '2027-03-01' }, '2027-03-01', 1, '2027-04-01'],
    ['编辑', { repeatAnchorDay: 17 }, '2027-01-31', 17, '2027-02-17'],
    ['改期', { repeatAnchorDay: 17 }, '2027-01-31', 17, '2027-02-17'],
  ])('%s保存后的旧撤销保留后续日期或重复日号改动 %j', async (entry, laterChange, expectedDate, expectedAnchor, expectedNextDate) => {
    const item = domain.createTask({ id: 'monthly-undo', title: '示例每月核对', dueDate: '2027-01-31', repeat: 'monthly' })
    domain.updateTask(item.id, { repeatAnchorDay: 31 })
    await nextTick()
    const itemRow = host.querySelector('[data-focus-id="monthly-undo"]')
    if (entry === '编辑') await clickElement(itemRow.querySelector('[aria-label="编辑待办"]'))
    else await click(itemRow, '改期')
    const form = document.querySelector(entry === '编辑' ? 'form.form' : '.reschedule-form')
    value(form.querySelector('input[type="date"]'), '2027-02-01')
    await nextTick()
    submit(form)
    await nextTick()
    expect(item).toMatchObject({ dueDate: '2027-02-01', repeatAnchorDay: 1 })
    domain.updateTask(item.id, laterChange)
    await nextTick()
    await clickElement(host.querySelector('.toast-undo'))
    expect(item).toMatchObject({ dueDate: expectedDate, repeatAnchorDay: expectedAnchor })
    domain.toggleTask(item.id)
    expect(domain.tasks.value.find((next) => next.sourceId === item.id).dueDate).toBe(expectedNextDate)
  })

  it('改期产生真实占用冲突时可返回修改，确认后才保存', async () => {
    domain.setTaskStageCompleted('generic', 'prep', true)
    domain.createTask({ id: 'other', title: '另一场展示', timeStages: [{ id: 'other-stage', label: '现场', kind: 'scheduled', start: { date: '2026-10-13', time: '01:30' }, end: { date: '2026-10-13', time: '03:30' }, reminders: [] }] })
    await nextTick()
    await click(row(), '改期')
    const form = document.querySelector('.reschedule-form')
    await click(form, '移动剩余安排')
    await click(form, '应用到草稿')
    submit(form)
    await nextTick()
    expect(task().timeStages[1].start.date).toBe('2026-10-12')
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((element) => element.textContent.includes('改期后的时间冲突'))
    expect(dialog.textContent).toContain('另一场展示')
    await click(dialog, '继续保存改期')
    expect(task().timeStages[1].start).toEqual({ date: '2026-10-13', time: '01:45' })
  })
})
