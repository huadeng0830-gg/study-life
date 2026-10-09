// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

import DataManager from '../src/components/DataManager.vue'

// 用户上报：手机版“从备份恢复”不可用。
// 数据管理弹窗的移动端分区导航原本是 <a href="#data-restore">，而应用使用 hash 路由，
// 于是点“恢复”会把地址改成 #data-restore —— 路由解析为 /data-restore 命中 404 兜底页；
// 恢复完成后的 location.reload() 又停在这个地址上，用户看到的是一次“把应用弄坏”的恢复。
let mounted = null

async function mountDataManager() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'today', component: { render: () => h('div', 'today') } },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: { render: () => h('div', 'not-found') } },
    ],
  })
  const app = createApp({ render: () => h(DataManager, { open: true }) })
  app.use(router)
  await router.push('/')
  await router.isReady()
  app.mount(root)
  mounted = { app, root }
  return router
}

function sectionButton(label) {
  const nav = document.querySelector('.data-manager-nav')
  return [...nav.querySelectorAll('button')].find((button) => button.textContent.includes(label))
}

describe('数据管理分区导航', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    document.body.querySelectorAll('.overlay').forEach((element) => element.remove())
    vi.unstubAllGlobals()
  })

  it('不用 hash 锚点，点击“恢复”只滚动弹窗，不改写应用路由', async () => {
    const router = await mountDataManager()

    expect(document.querySelectorAll('.data-manager-nav a[href]')).toHaveLength(0)

    const restoreSection = document.querySelector('#data-restore')
    const scrollIntoView = vi.fn()
    restoreSection.scrollIntoView = scrollIntoView

    sectionButton('恢复').click()
    await nextTick()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(router.currentRoute.value.path).toBe('/')
    expect(window.location.hash).not.toContain('data-restore')
    expect(sectionButton('恢复').getAttribute('aria-current')).toBe('location')
  })

  it('备份、账号同步与恢复入口都能定位到各自区块', async () => {
    await mountDataManager()
    const targets = [
      ['备份', '#data-backup'],
      ['同步', '#data-sync'],
      ['恢复', '#data-restore'],
    ]
    expect(document.querySelector('#data-transfer')).toBeNull()
    expect(document.body.textContent).not.toContain('创建同步空间')
    expect(document.body.textContent).not.toContain('扫描绑定码')
    for (const [label, selector] of targets) {
      const section = document.querySelector(selector)
      const scrollIntoView = vi.fn()
      section.scrollIntoView = scrollIntoView
      sectionButton(label).click()
      await nextTick()
      expect(scrollIntoView, label).toHaveBeenCalledTimes(1)
    }
  })

  it('恢复区块仍然提供可用的文件选择入口', async () => {
    await mountDataManager()
    const input = document.querySelector('#data-restore input[type="file"]')
    expect(input).not.toBeNull()
    expect(input.getAttribute('accept')).toContain('json')
  })

  it('概览区分记录与配置，并在本机数据更新后刷新数量', async () => {
    localStorage.setItem('sl_tasks', '[{"id":"fiction-task"}]')
    localStorage.setItem('sl_ledger_categories', '[{},{}]')
    await mountDataManager()
    const overview = document.querySelector('.data-overview')
    expect(overview.querySelector('.overview-metrics').textContent).toContain('1项')
    localStorage.setItem('sl_tasks', '[{"id":"fiction-task"},{"id":"fiction-task-2"}]')
    window.dispatchEvent(new Event('study-life:storage-updated'))
    await vi.waitFor(() => expect(overview.querySelector('.overview-metrics').textContent).toContain('2项'))
  })

  it('恢复预览展示本机与备份对照，清空选择后不能继续恢复', async () => {
    localStorage.setItem('sl_tasks', '[{"id":"fiction-local-task"}]')
    await mountDataManager()
    const input = document.querySelector('#data-restore input[type="file"]')
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'fiction-backup.json', size: 123, text: async () => JSON.stringify({ app: 'study-life', version: 1, data: { courses: [], countdowns: [], tasks: [] } }) }] })
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(document.querySelector('.restore-preview')).not.toBeNull())
    const preview = document.querySelector('.restore-preview')
    expect(preview.textContent).toContain('备份：0 项记录')
    expect(preview.textContent).toContain('本机：1 项记录')
    expect(preview.textContent).toContain('恢复后会清空对应记录')
    const clear = [...preview.querySelectorAll('button')].find(button => button.textContent === '清空选择')
    clear.click()
    await nextTick()
    expect(preview.querySelector('.preview-footer button').disabled).toBe(true)
    expect(preview.querySelector('.preview-footer').textContent).toContain('请至少选择一个分区')
    const cancel = [...preview.querySelectorAll('button')].find(button => button.textContent === '取消选择')
    cancel.click()
    await nextTick()
    expect(document.querySelector('.restore-preview')).toBeNull()
    expect(localStorage.getItem('sl_tasks')).toContain('fiction-local-task')
  })
})
