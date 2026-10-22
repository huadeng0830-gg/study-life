// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let app, host, vue, router, stored

async function mountReview() {
  const Review = (await import('../src/views/WeeklyReviewView.vue')).default
  const { createRouter, createMemoryHistory } = await import('vue-router')
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/review', component: Review },
    ...['/', '/tasks', '/events', '/bills', '/schedule', '/course', '/exams'].map(path => ({ path, component: { render: () => null } })),
  ] })
  await router.push('/review')
  host = document.createElement('div')
  document.body.append(host)
  app = vue.createApp(Review)
  app.use(router)
  app.mount(host)
  await vue.nextTick()
}

function type(id, value) {
  const input = host.querySelector(id)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  vue = await import('vue')
  const { clock } = await import('../src/composables/store/core.js')
  clock.value = new Date('2026-10-09T09:00:00Z')
  stored = (await import('../src/composables/store/index.js')).useStoredRef
})

afterEach(() => {
  app?.unmount()
  host?.remove()
})

describe('周回顾工作区的真实表单与样本状态', () => {
  it('无记录时直接显示复盘，分析仍可展开但不绘制空图', async () => {
    await mountReview()
    expect(host.querySelectorAll('h1')).toHaveLength(1)
    expect(host.querySelector('#reflection-title').tagName).toBe('H2')
    expect(host.querySelector('#last-year-empty-title').textContent).toBe('去年的今天还没有记录')
    expect(host.querySelector('#last-year-empty-title').parentElement.textContent).toContain('0 条记录')
    expect(host.querySelector('.last-year-card')).toBeNull()
    expect(host.querySelector('.review-analysis').open).toBe(false)
    expect(host.querySelector('.trend-chart')).toBeNull()
    expect(host.querySelector('.focus-hour-chart')).toBeNull()
    expect(host.querySelector('.review-workspace').firstElementChild.id).not.toBe('next-week-title')
    for (const input of host.querySelectorAll('textarea')) {
      expect(host.querySelector(`label[for="${input.id}"]`).textContent.trim()).toBe(input.getAttribute('aria-label'))
      for (const id of input.getAttribute('aria-describedby').split(' ')) expect(host.querySelector(`#${id}`)).toBeTruthy()
    }
  })

  it('有去年同期记录时只展示专注与完成待办两个数字和一句摘要', async () => {
    stored('sl_focus_sessions', []).value = [{ id: 'fiction-last-year-focus', startedAt: '2025-10-08T09:00:00Z', actualFocusSeconds: 1500 }]
    stored('sl_tasks', []).value = [{ id: 'fiction-last-year-task', completedAt: '2025-10-08T10:00:00Z', done: true }]
    await mountReview()

    expect(host.querySelector('.last-year-metrics').children).toHaveLength(2)
    expect([...host.querySelectorAll('.last-year-metrics strong')].map((node) => node.textContent)).toEqual(['0.4', '1'])
    expect(host.querySelector('.last-year-sentence').textContent).toContain('专注与完成待办')
  })

  it('有业务样本时展示完成率和专注分布，摘要按实体计算', async () => {
    stored('sl_tasks', []).value = [{ id: 'fiction-done', title: '虚构复习', dueDate: '2026-10-08', createdAt: '2026-10-06T10:00:00Z', done: true, completedAt: '2026-10-08T10:00:00Z' }]
    stored('sl_focus_sessions', []).value = [{ id: 'fiction-focus', startedAt: '2026-10-08T09:00:00Z', actualFocusSeconds: 1500, status: 'completed' }]
    await mountReview()
    expect(host.querySelector('.review-analysis').open).toBe(false)
    expect(host.querySelector('.trend-chart')).toBeTruthy()
    expect(host.querySelector('.focus-hour-chart').getAttribute('aria-label')).toContain('1 个有效会话')
    expect(host.querySelector('.metric-progress').getAttribute('aria-valuenow')).toBe('100')
    expect(host.querySelector('.review-card').textContent).toContain('新增 1')
  })

  it('输入后自动保存，重建页面仍恢复内容', async () => {
    await mountReview()
    host.querySelector('.reflection-form button[aria-expanded]').click()
    await vue.nextTick()
    type('#reflection-wins', '虚构记录：已完成本周实验')
    await vue.nextTick()
    expect(host.querySelector('.save-status').textContent).toContain('正在保存')
    await vi.waitFor(() => expect(stored('sl_weekly_reflections', {}).value['2026-10-05']?.wins).toBe('虚构记录：已完成本周实验'), { timeout: 1500 })
    expect(host.querySelector('.save-status').textContent).toContain('已自动保存')
    app.unmount()
    host.remove()
    await mountReview()
    host.querySelector('.reflection-form button[aria-expanded]').click()
    await vue.nextTick()
    expect(host.querySelector('#reflection-wins').value).toBe('虚构记录：已完成本周实验')
  })

  it('未到防抖期限切换周次会保存当前草稿，历史周独立保存', async () => {
    await mountReview()
    type('#reflection-next', '本周重点')
    await vue.nextTick()
    host.querySelector('[aria-label="回顾上一周"]').click()
    await vue.nextTick()
    expect(stored('sl_weekly_reflections', {}).value['2026-10-05'].next).toBe('本周重点')
    expect(host.querySelector('#reflection-next').value).toBe('')
    type('#reflection-next', '历史周重点')
    await vue.nextTick()
    host.querySelector('[aria-label="回顾下一周"]').click()
    await vue.nextTick()
    expect(stored('sl_weekly_reflections', {}).value['2026-09-28'].next).toBe('历史周重点')
    expect(host.querySelector('#reflection-next').value).toBe('本周重点')
    expect(host.querySelector('[aria-label="回顾下一周"]').disabled).toBe(true)
  })
})
