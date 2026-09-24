// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

import DataManager from '../src/components/DataManager.vue'
import { clearSyncSpaceSettings } from '../src/composables/syncSpace.js'

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
  const nav = document.querySelector('.mobile-data-nav')
  return [...nav.querySelectorAll('button')].find((button) => button.textContent.includes(label))
}

describe('数据管理移动端分区导航', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSyncSpaceSettings()
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

    expect(document.querySelectorAll('.mobile-data-nav a[href]')).toHaveLength(0)

    const restoreSection = document.querySelector('#data-restore')
    const scrollIntoView = vi.fn()
    restoreSection.scrollIntoView = scrollIntoView

    sectionButton('恢复').click()
    await nextTick()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(router.currentRoute.value.path).toBe('/')
    expect(window.location.hash).not.toContain('data-restore')
  })

  it('四个分区入口都能定位到各自的区块', async () => {
    await mountDataManager()
    const targets = [
      ['备份', '#data-backup'],
      ['同步', '#data-sync'],
      ['迁移', '#data-transfer'],
      ['恢复', '#data-restore'],
    ]
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
})