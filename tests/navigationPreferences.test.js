// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
import { restoreStoredValues } from '../src/composables/store/cloudAccess.js'
import {
  DEFAULT_DESKTOP_NAVIGATION,
  DEFAULT_MOBILE_NAVIGATION,
  DESKTOP_NAVIGATION_KEY,
  MOBILE_NAVIGATION_KEY,
  desktopNavigation,
  mobileNavigation,
  moveNavigationItem,
  normalizeDesktopNavigation,
  normalizeMobileNavigation,
} from '../src/composables/navigationPreferences.js'
import { navigationRegistry } from '../src/router/navigation.js'
import { routes } from '../src/router/routes.js'

registerMirrorTeardown()
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

describe('navigation registry and saved layouts', () => {
  afterEach(async () => {
    await restoreStoredValues({
      [MOBILE_NAVIGATION_KEY]: [...DEFAULT_MOBILE_NAVIGATION],
      [DESKTOP_NAVIGATION_KEY]: DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] })),
    })
  })

  it('registers unique destinations that exist in the route table', () => {
    const routePaths = new Set(routes.filter((route) => route.name).map((route) => route.path))
    expect(new Set(navigationRegistry.map((item) => item.id)).size).toBe(navigationRegistry.length)
    expect(navigationRegistry.every((item) => routePaths.has(item.path))).toBe(true)
    expect(navigationRegistry.every((item) => item.label && item.icon && item.pinnable)).toBe(true)
  })

  it('deduplicates mobile entries, caps the list, preserves an intentional empty list, and repairs stale IDs', () => {
    expect(normalizeMobileNavigation(['today', 'today', 'missing', 'schedule', 'events', 'projects', 'tasks']))
      .toEqual(['today', 'schedule', 'events'])
    expect(normalizeMobileNavigation(['projects', 'tasks', 'today', 'schedule']))
      .toEqual(['projects', 'tasks', 'today'])
    expect(normalizeMobileNavigation([])).toEqual([])
    expect(normalizeMobileNavigation(['removed-page'])).toEqual([...DEFAULT_MOBILE_NAVIGATION])
  })

  it('filters unknown and repeated desktop route IDs and falls back when every pinned page is stale', () => {
    expect(normalizeDesktopNavigation([
      { id: 'custom-study', label: '学习', items: ['course', 'course', 'removed-page'] },
      { id: 'custom-study', label: '重复分组', items: ['today'] },
    ])).toEqual([{ id: 'custom-study', label: '学习', items: ['course'] }])
    expect(normalizeDesktopNavigation([{ id: 'learning', label: '学习', items: ['removed-page'] }]))
      .toEqual(DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] })))
  })

  it('upgrades only the untouched six-group default and preserves edited layouts', () => {
    const previousDefault = [
      { id: 'workspace', label: '今日', items: ['today'] },
      { id: 'learning', label: '学习', items: ['schedule', 'course', 'tasks', 'exams'] },
      { id: 'schedule', label: '日程', items: ['events', 'together'] },
      { id: 'qixing', label: '齐行', items: ['projects'] },
      { id: 'records', label: '记录', items: ['lists', 'bills'] },
      { id: 'review', label: '回顾', items: ['review'] },
    ]
    expect(normalizeDesktopNavigation(previousDefault)).toEqual(
      DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] })),
    )
    previousDefault[1].label = '我的学习'
    expect(normalizeDesktopNavigation(previousDefault)[1].label).toBe('我的学习')
  })

  it('keeps phone and desktop persistence keys independent', async () => {
    const previousDesktop = JSON.parse(JSON.stringify(desktopNavigation.value))
    await restoreStoredValues({ [MOBILE_NAVIGATION_KEY]: ['projects'] })
    expect(mobileNavigation.value).toEqual(['projects'])
    expect(desktopNavigation.value).toEqual(previousDesktop)

    const previousMobile = [...mobileNavigation.value]
    await restoreStoredValues({ [DESKTOP_NAVIGATION_KEY]: [{ id: 'custom', label: '常用', items: ['today'] }] })
    expect(desktopNavigation.value).toEqual([{ id: 'custom', label: '常用', items: ['today'] }])
    expect(mobileNavigation.value).toEqual(previousMobile)
  })

  it('opens the navigation editor and applies phone and desktop edits immediately', async () => {
    const { mountApp, settle } = await import('./helpers/mountApp.js')
      const app = await mountApp({ hash: '/' })
    try {
      expect(document.querySelectorAll('.mobile-nav > a, .mobile-nav > button')).toHaveLength(5)
      expect(document.querySelector('.mobile-nav a[href="#/schedule"] small')?.textContent).toBe('学习')
      expect(document.querySelector('.mobile-nav a[href="#/schedule"]')?.getAttribute('aria-label')).toBe('学习')
      const quickRecordAction = document.querySelector('.mobile-nav .capture-trigger')
      expect(quickRecordAction).toBeTruthy()
      quickRecordAction.click()
      for (let attempt = 0; attempt < 80 && !document.querySelector('.quick-record'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await settle()
      }
      expect(document.querySelector('.quick-record')).toBeTruthy()
      document.querySelector('[aria-label="关闭弹窗"]').click()
      await settle()
      document.querySelector('.sidebar [aria-label="编辑导航"]').click()
      for (let attempt = 0; attempt < 80 && !document.querySelector('.navigation-settings'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await settle()
      }
      expect(document.querySelector('.navigation-settings')).toBeTruthy()
      expect(document.querySelector('.navigation-settings').closest('.modal').querySelector('.modal-head').textContent).toContain('编辑导航')
      document.querySelector('.navigation-mode-tabs button:first-child').click()
      await settle()
      expect(document.querySelectorAll('.mobile-nav-preview-item')).toHaveLength(5)
      expect(document.querySelector('.mobile-nav-preview-item.capture small')?.textContent).toBe('快速记录')
      expect(document.querySelector('[aria-label="移除快速记录"]')).toBeNull()
      expect([...document.querySelectorAll('.nav-pin-button')].every((button) => button.disabled)).toBe(true)

      const dragHandle = document.querySelector('.navigation-edit-row .nav-drag-handle')
      const targetRow = document.querySelectorAll('.navigation-edit-row')[1]
      const originalElementFromPoint = document.elementFromPoint
      const findElementAtPoint = vi.fn(() => targetRow)
      document.elementFromPoint = findElementAtPoint
      const pointerEvent = (type) => {
        const event = new Event(type, { bubbles: true })
        Object.defineProperties(event, {
          pointerId: { value: 7 }, isPrimary: { value: true }, button: { value: 0 }, clientX: { value: 10 }, clientY: { value: 10 },
        })
        dragHandle.dispatchEvent(event)
      }
      try {
        pointerEvent('pointerdown')
        await settle()
        expect(dragHandle.closest('li').classList.contains('dragging')).toBe(true)
        pointerEvent('pointermove')
        await settle()
        expect(findElementAtPoint).toHaveBeenCalled()
        pointerEvent('pointerup')
        await settle()
      } finally {
        if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
        else delete document.elementFromPoint
      }
      expect([...document.querySelectorAll('.navigation-edit-row .nav-item-name')].map((item) => item.textContent))
        .toEqual(['学习', '今天', '日程'])

      document.querySelector('[aria-label="移除今天"]').click()
      document.querySelector('.nav-save').click()
      await settle()
      await vi.waitFor(() => expect(document.querySelector('.navigation-feedback')?.textContent).toContain('已保存'), { timeout: 2000 })
      expect(mobileNavigation.value).not.toContain('today')
      expect(document.querySelector('.mobile-nav a[aria-label="今天"]')).toBeFalsy()
      expect(document.querySelector('.more-trigger').classList.contains('active')).toBe(true)

      document.querySelector('.navigation-mode-tabs button:nth-child(2)').click()
      await settle()
      document.querySelector('[aria-label="取消固定今天"]').click()
      await settle()
      document.querySelector('.nav-save').click()
      await settle()
      await vi.waitFor(() => expect(document.querySelector('.navigation-feedback')?.textContent).toContain('已保存'), { timeout: 2000 })
      expect(desktopNavigation.value.flatMap((group) => group.items)).not.toContain('today')
      expect(mobileNavigation.value).not.toContain('today')
      expect(document.querySelector('.desktop-nav a[href="#/"]')).toBeFalsy()
    } finally {
      app.unmount()
    }
  }, 30000)

  it('keeps quick record and more available with empty or restored four-page layouts', async () => {
    const { mountApp, settle } = await import('./helpers/mountApp.js')
    const app = await mountApp({ hash: '/' })
    try {
      for (const layout of [[], ['projects', 'tasks', 'today', 'schedule']]) {
        await restoreStoredValues({ [MOBILE_NAVIGATION_KEY]: layout })
        await settle()
        const entries = [...document.querySelectorAll('.mobile-nav > a, .mobile-nav > button')]
        expect(entries.length).toBe(layout.length ? 5 : 2)
        expect(entries.slice(-2).map((entry) => entry.querySelector('small').textContent))
          .toEqual(['快速记录', '更多'])
        expect(mobileNavigation.value).toEqual(layout.slice(0, 3))
      }
      document.querySelector('.more-trigger').click()
      await settle()
      expect([...document.querySelectorAll('.mobile-more-item small')].some((item) => item.textContent === '快速记录')).toBe(false)
      expect(document.querySelector('.mobile-more-item[href="#/schedule"]')).toBeTruthy()
    } finally {
      app.unmount()
    }
  }, 30000)

  it('moves list items using explicit bounded positions', () => {
    expect(moveNavigationItem(['today', 'tasks', 'events'], 2, 0)).toEqual(['events', 'today', 'tasks'])
    expect(moveNavigationItem(['today'], 0, 1)).toEqual(['today'])
  })
})
