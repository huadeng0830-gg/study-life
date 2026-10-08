// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

registerMirrorTeardown()

/**
 * 外壳工具入口可达性。
 *
 * 【这个文件来自一个真缺陷】`components/FestiveSettings.vue`（节日与纪念日设置）从加进
 * 仓库起，全 `src/` **只有测试**直接 import 它 —— Sidebar 从未挂载，手机「更多」面板里
 * 也没有这一格。于是「开关节日氛围 / 填生日 / 填开始使用日期 / 管理纪念日与农历纪念日」
 * 这一整块设置，用户在任何一个界面都点不到，`sl_festive_config` 只能被备份导入间接改写；
 * 而 2183 条既有用例里有一条**正面**渲染它的测试（`festiveLunarAnniversaryUi.test.js`
 * 直接 createApp 挂载），所以"这个面板工作正常"一直是绿的 —— 绿的是面板，坏的是入口。
 *
 * 【判据】只测**入口那一步**，不重复测面板内部：
 * 1. 外壳渲染后，侧栏里存在一个可访问名称包含「氛围与纪念日」的按钮；
 * 2. 点它之后 body 里出现一个 `role="dialog"`，其可访问名称是面板自己的标题；
 * 3. 再点关闭，浮层消失（证明这条入口接的是真的开/关，而不是只加了个按钮）。
 */
describe('外壳工具入口：氛围与纪念日设置必须能点到', () => {
  let originalConsoleError = null

  beforeEach(() => {
    originalConsoleError = console.error
    console.error = (...args) => { if (String(args[0]).includes('[GlobalError:')) throw new Error(args.join(' ')) }
    localStorage.clear()
  })

  afterEach(() => {
    console.error = originalConsoleError
    document.querySelectorAll('.test-app-host').forEach((node) => node.remove())
  })

  it('侧栏有入口，点击后打开「节日与纪念日设置」，关闭后浮层消失', async () => {
    const { mountApp, settle } = await import('./helpers/mountApp.js')
    const { unmount } = await mountApp({ hash: '/' })
    try {
      await settle()

      const entry = [...document.querySelectorAll('.sidebar button')]
        .find((button) => (button.textContent || '').includes('氛围与纪念日'))
      expect(entry, '侧栏里找不到「氛围与纪念日」入口（FestiveSettings 又变成不可达了）').toBeTruthy()

      entry.click()
      await settle()
      // 面板是 defineAsyncComponent，等它把分块加载完。
      for (let i = 0; i < 100 && !document.querySelector('.overlay [role="dialog"]'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await settle()
      }

      const dialog = document.querySelector('.overlay [role="dialog"]')
      expect(dialog, '点击入口后没有打开任何对话框').toBeTruthy()
      expect(dialog.textContent).toContain('节日与纪念日设置')

      const closeButton = dialog.querySelector('button[aria-label="关闭弹窗"]')
      expect(closeButton, '对话框缺少关闭按钮').toBeTruthy()
      closeButton.click()
      await settle()
      await settle()
      expect(document.querySelector('.overlay [role="dialog"]'), '关闭后浮层仍然留在 body 里').toBeFalsy()
    } finally {
      unmount()
    }
  }, 60000)

  it('手机更多抽屉把我的账号和版本更新列为第一组常用入口', async () => {
    const { mountApp, settle } = await import('./helpers/mountApp.js')
    const { unmount } = await mountApp({ hash: '/' })
    try {
      await settle()
      document.querySelector('.more-trigger').click()
      await settle()

      const groups = [...document.querySelectorAll('.mobile-more-group')]
      expect(groups[0].querySelector('h3').textContent).toBe('常用')
      const entries = [...groups[0].querySelectorAll('button')]
      expect(entries.map(entry => entry.textContent.replace(/\s+/g, ' ').trim())).toEqual([
        expect.stringContaining('我的账号'),
        expect.stringContaining('版本与更新'),
      ])
      expect(entries.every(entry => !entry.classList.contains('subdued'))).toBe(true)
      expect(entries[0].querySelector('em')?.textContent).toMatch(/已登录|未登录/)
    } finally {
      unmount()
    }
  }, 60000)
})
