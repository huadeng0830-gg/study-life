// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import EventsView from '../src/views/EventsView.vue'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { clock, flushStoredWrites } from '../src/composables/store/core.js'
import { settings } from '../src/composables/settingsPolicy.js'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { collectDueReminders } from '../src/composables/reminderScheduler.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const domain = useDomainCommands()
let app
let host
let router
const oldClock = clock.value
const base = { id: 'demo-event', title: '示例交流会', date: '2026-10-10', time: '09:00', endTime: '10:00', location: '讨论室', note: '带上笔记', sourceText: '虚构通知原文', reminderMinutes: 30 }

beforeEach(() => {
  domain.events.value = []
  domain.tasks.value = []
  domain.courses.value = []
  settings.value = { timezone: 'UTC' }
  clock.value = new Date('2026-10-09T08:00:00Z')
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  document.body.innerHTML = ''
  app = null
  host = null
  clearAnnouncement()
  domain.events.value = []
  domain.tasks.value = []
  domain.courses.value = []
  clock.value = oldClock
})

async function settle() { await nextTick(); await new Promise((done) => setTimeout(done, 15)); await nextTick() }
async function boot(path = '/events') {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/events', component: EventsView }, { path: '/together', component: { template: '<div>邀约</div>' } }, { path: '/projects', component: { template: '<div>项目</div>' } }] })
  await router.push(path)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(RouterView) })
  app.use(router).mount(host)
  await settle()
}
function byText(root, text) { return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text) }
async function click(button) { expect(button).toBeTruthy(); button.click(); await settle() }
async function fill(input, value) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await settle() }
const form = () => document.querySelector('.event-form')
const cardTitles = () => [...host.querySelectorAll('.event-title')].map((node) => node.textContent.trim())

describe('日程页面实际交互', () => {
  it('月历选日、跨月键盘导航和新建会带入选择的日期', async () => {
    domain.events.value = [{ ...base, date: '2026-10-09' }]
    await boot()
    await click(byText(host, '月历'))
    expect(host.querySelectorAll('.calendar-day')).toHaveLength(42)
    expect(host.querySelectorAll('.calendar-day[tabindex="0"]')).toHaveLength(1)
    await click(host.querySelector('[data-date="2026-10-31"]'))
    const selected = host.querySelector('[data-date="2026-10-31"]')
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await settle()
    expect(document.activeElement.dataset.date).toBe('2026-11-01')
    expect(host.querySelector('.calendar-header').textContent).toContain('11 月')
    await click(byText(host, '＋ 新建日程'))
    expect(form().querySelector('input[type="date"]').value).toBe('2026-11-01')
  })
  it('新建无日期事项后可从待安排筛选找到，并保存到原存储', async () => {
    await boot()
    await click(byText(host, '＋ 新建日程'))
    await fill(form().querySelector('[data-field="title"]'), '安排阅读交流')
    await click(byText(form(), '待安排'))
    await click(byText(form(), '添加'))
    expect(domain.events.value[0]).toMatchObject({ title: '安排阅读交流', date: '', time: '' })
    await click([...host.querySelectorAll('.filter-tab')].find((button) => button.textContent.startsWith('待安排')))
    expect(cardTitles()).toEqual(['安排阅读交流'])
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem('sl_events'))[0].title).toBe('安排阅读交流')
  })
  it('编辑自身不会弹虚假冲突，课程 ID 和提醒关闭会被保存，原文保留', async () => {
    domain.events.value = [{ ...base }]
    domain.courses.value = [{ id: 'demo-course', name: '示例课程', day: 0 }]
    await boot()
    await click(byText(host.querySelector('.event-card'), '编辑'))
    const select = form().querySelector('select')
    select.value = 'demo-course'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    await click(form().querySelector('input[type="checkbox"]'))
    await click(byText(form(), '保存'))
    expect(document.querySelector('.event-form')).toBeNull()
    expect(domain.events.value[0]).toMatchObject({ courseId: 'demo-course', courseName: '示例课程', reminderEnabled: false, sourceText: '虚构通知原文' })
    expect(collectDueReminders(Date.parse('2026-10-10T08:45:00Z')).some((item) => item.key === 'event:demo-event')).toBe(false)
  })
  it('结束时间倒置时保存被阻止，并给具体字段焦点', async () => {
    domain.events.value = [{ ...base, endTime: '08:30' }]
    await boot()
    await click(byText(host.querySelector('.event-card'), '编辑'))
    await click(byText(form(), '保存'))
    expect(document.querySelector('#event-form-error').textContent).toContain('结束时间须晚于开始时间')
    expect(document.activeElement.dataset.field).toBe('endTime')
    expect(domain.events.value[0].endTime).toBe('08:30')
  })
  it('删除确认后可以撤销，归档也可以撤销，完整内容和 ID 保留', async () => {
    domain.events.value = [{ ...base }]
    await boot()
    await click(byText(host.querySelector('.event-card'), '删除'))
    await click(document.querySelector('.modal .btn-danger'))
    expect(domain.events.value).toHaveLength(0)
    await click(byText(document.querySelector('.toast'), '撤销'))
    expect(domain.events.value[0]).toMatchObject(base)
    await click(byText(host.querySelector('.event-card'), '归档'))
    expect(domain.events.value[0].archivedAt).toBeTruthy()
    await click(byText(document.querySelector('.toast'), '撤销'))
    expect(domain.events.value[0].archivedAt).toBeFalsy()
    expect(cardTitles()).toEqual([base.title])
  })
  it('复制不继承通知来源和外部会议身份，确认前不写入', async () => {
    domain.events.value = [{ ...base, sourceType: 'project-meeting', sourceId: 'demo-meeting', relationId: 'demo-project' }]
    await boot()
    await click(host.querySelector('.event-title'))
    await click(byText(document.querySelector('.event-detail'), '复制为新日程'))
    expect(domain.events.value).toHaveLength(1)
    await fill(form().querySelector('input[type="date"]'), '2026-10-11')
    await click(byText(form(), '添加'))
    expect(domain.events.value).toHaveLength(2)
    expect(domain.events.value[1]).toMatchObject({ title: `${base.title}（副本）`, sourceType: '', sourceId: '', relationId: '', sourceText: '' })
  })
  it.each([{ archivedAt: '2026-10-08T00:00:00Z' }, { status: 'archived' }])('全局定位链接可打开新旧归档日程并恢复，清除处理过的查询参数：%j', async (archiveState) => {
    domain.events.value = [{ ...base, ...archiveState }]
    await boot('/events?focus=demo-event')
    expect(document.querySelector('.event-detail').textContent).toContain(base.title)
    expect(router.currentRoute.value.query.focus).toBeUndefined()
    expect(document.querySelector('.event-detail').textContent).toContain('归档期间不提醒')
    await click(byText(document.querySelector('.event-detail'), '恢复日程'))
    expect(cardTitles()).toEqual([base.title])
  })
  it('删除已归档日程再撤销时，保持原归档状态', async () => {
    const archivedAt = '2026-10-08T00:00:00Z'
    domain.events.value = [{ ...base, archivedAt }]
    await boot()
    await click([...host.querySelectorAll('.filter-tab')].find((button) => button.textContent.startsWith('已归档')))
    await click(byText(host.querySelector('.event-card'), '删除'))
    await click(document.querySelector('.modal .btn-danger'))
    await click(byText(document.querySelector('.toast'), '撤销'))
    expect(domain.events.value[0]).toMatchObject({ ...base, archivedAt })
    expect(cardTitles()).toEqual([base.title])
  })
})
