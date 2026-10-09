// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import NavigationSettings from '../src/components/NavigationSettings.vue'
import { restoreStoredValues } from '../src/composables/store/cloudAccess.js'
import { DEFAULT_DESKTOP_NAVIGATION, DEFAULT_MOBILE_NAVIGATION, DESKTOP_NAVIGATION_KEY, MOBILE_NAVIGATION_KEY, desktopNavigation, mobileNavigation } from '../src/composables/navigationPreferences.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let mounted
const defaults = () => ({
  [MOBILE_NAVIGATION_KEY]: [...DEFAULT_MOBILE_NAVIGATION],
  [DESKTOP_NAVIGATION_KEY]: DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] })),
})
beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await restoreStoredValues(defaults())
})
afterEach(async () => {
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = null
  await restoreStoredValues(defaults())
  vi.restoreAllMocks()
})

async function mount(mode = 'mobile') {
  const host = document.createElement('div')
  document.body.append(host)
  const open = ref(true)
  const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/tasks', '/schedule'].map((path) => ({ path, component: { template: '<div />' } })) })
  await router.push('/')
  const app = createApp({ setup: () => () => h(NavigationSettings, { open: open.value, initialMode: mode, onClose: () => { open.value = false } }) })
  app.use(router).mount(host)
  await nextTick()
  mounted = { app, host, open, router }
  return mounted
}
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`)
const clickText = async (text) => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === text)
  expect(button, `缺少按钮：${text}`).toBeTruthy()
  button.click()
  await nextTick()
}
const rowNames = () => [...document.querySelectorAll('.navigation-edit-row .nav-item-name')].map((row) => row.textContent)

describe('navigation editor interactions', () => {
  it('keeps per-device drafts across keyboard tab switches and saves both with immediate previews', async () => {
    await mount()
    byLabel('移除今天').click()
    await nextTick()
    expect(document.querySelectorAll('.mobile-nav-preview-item')).toHaveLength(4)
    expect(mobileNavigation.value).toContain('today')
    const tabs = document.querySelector('.navigation-mode-tabs')
    tabs.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await nextTick()
    expect(document.activeElement.getAttribute('aria-selected')).toBe('true')
    const groupName = byLabel('学习分组名称')
    groupName.focus()
    groupName.value = '自定义学习'
    groupName.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('.desktop-nav-preview').textContent).toContain('自定义学习')
    byLabel('撤销上一步').click()
    await nextTick()
    expect(byLabel('学习分组名称')).toBeTruthy()
    byLabel('重做上一步').click()
    await nextTick()
    expect(byLabel('自定义学习分组名称')).toBeTruthy()
    expect(document.querySelector('.nav-save').textContent).toBe('保存两端修改')
    document.querySelector('.nav-save').click()
    await vi.waitFor(() => expect(document.querySelector('.navigation-feedback')?.textContent).toContain('已保存'), { timeout: 2000 })
    expect(mobileNavigation.value).toEqual(['schedule', 'events'])
    expect(desktopNavigation.value[1].label).toBe('自定义学习')
    expect(document.querySelector('.nav-save').disabled).toBe(true)
  })

  it('protects drafts on close and feature navigation, and allows continuing or discarding without saving', async () => {
    const app = await mount()
    byLabel('移除今天').click()
    await nextTick()
    byLabel('关闭弹窗').click()
    await nextTick()
    expect(document.body.textContent).toContain('保存导航修改？')
    await clickText('继续编辑')
    expect(rowNames()).toEqual(['学习', '日程'])
    byLabel('打开待办').click()
    await nextTick()
    expect(app.router.currentRoute.value.path).toBe('/')
    expect(document.body.textContent).toContain('保存导航修改？')
    await clickText('放弃修改')
    await vi.waitFor(() => expect(app.router.currentRoute.value.path).toBe('/tasks'))
    expect(app.open.value).toBe(false)
    expect(mobileNavigation.value).toEqual(DEFAULT_MOBILE_NAVIGATION)
  })

  it('saves when leaving, while an invalid group name keeps the dialog and draft open', async () => {
    const app = await mount('desktop')
    const name = byLabel('学习分组名称')
    name.value = ''
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    byLabel('关闭弹窗').click()
    await nextTick()
    await clickText('保存并离开')
    expect(app.open.value).toBe(true)
    expect(document.body.textContent).toContain('分组名称不能为空')
    await clickText('继续编辑')
    byLabel('撤销上一步').click()
    await nextTick()
    byLabel('取消固定今天').click()
    await nextTick()
    byLabel('关闭弹窗').click()
    await nextTick()
    await clickText('保存并离开')
    await vi.waitFor(() => expect(app.open.value).toBe(false))
    expect(desktopNavigation.value.flatMap((group) => group.items)).not.toContain('today')
  })

  it('ignores drag hits outside the list, rolls back pointer cancellation, and sorts through the keyboard', async () => {
    await mount()
    const handle = byLabel('调整今天顺序')
    const event = (type) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, clientX: 10, clientY: 10 }))
    const hit = vi.fn(() => null)
    const originalHit = document.elementFromPoint
    document.elementFromPoint = hit
    try {
      event('pointerdown')
      event('pointermove')
      await nextTick()
      expect(rowNames()).toEqual(['今天', '学习', '日程'])
      hit.mockReturnValue(document.querySelector('[data-nav-id="events"]'))
      event('pointermove')
      await nextTick()
      expect(rowNames()).toEqual(['学习', '日程', '今天'])
      event('pointercancel')
      await nextTick()
      expect(rowNames()).toEqual(['今天', '学习', '日程'])
      expect(byLabel('撤销上一步').disabled).toBe(true)
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
      await nextTick()
      expect(rowNames()).toEqual(['学习', '今天', '日程'])
      expect(document.activeElement).toBe(handle)
    } finally {
      document.elementFromPoint = originalHit
    }
  })

  it('moves every page to the selected destination before removing a nonempty group, and can undo it', async () => {
    await mount('desktop')
    byLabel('移除学习分组').click()
    await nextTick()
    const destination = byLabel('移除分组后页面的目标分组')
    destination.value = 'qixing'
    destination.dispatchEvent(new Event('change', { bubbles: true }))
    await clickText('移动页面并移除分组')
    const group = document.querySelector('[aria-label="齐行分组名称"]').closest('section')
    expect([...group.querySelectorAll('[data-nav-id]')].map((item) => item.dataset.navId)).toEqual(['projects', 'schedule', 'course', 'tasks', 'exams'])
    expect(byLabel('学习分组名称')).toBeNull()
    byLabel('撤销上一步').click()
    await nextTick()
    expect(byLabel('学习分组名称')).toBeTruthy()
    expect(desktopNavigation.value).toEqual(DEFAULT_DESKTOP_NAVIGATION)
  })

  it('filters features and stages an undoable default layout, including an intentionally empty bottom bar', async () => {
    await restoreStoredValues({ [MOBILE_NAVIGATION_KEY]: [] })
    await mount()
    expect(document.querySelectorAll('.mobile-nav-preview-item')).toHaveLength(2)
    const search = byLabel('搜索可用功能')
    search.value = '待办'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.querySelectorAll('.nav-feature-option')).toHaveLength(1)
    byLabel('添加待办').click()
    await nextTick()
    expect(rowNames()).toEqual(['待办'])
    await clickText('恢复默认')
    expect(rowNames()).toEqual(['今天', '学习', '日程'])
    expect(mobileNavigation.value).toEqual([])
    byLabel('撤销上一步').click()
    await nextTick()
    expect(rowNames()).toEqual(['待办'])
  })
})
