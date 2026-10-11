// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import NavigationSettings from '../src/components/NavigationSettings.vue'
import { restoreStoredValues } from '../src/composables/store/cloudAccess.js'
import { DEFAULT_DESKTOP_NAVIGATION, DEFAULT_MOBILE_NAVIGATION, DESKTOP_NAVIGATION_KEY, MOBILE_NAVIGATION_KEY, mobileNavigation } from '../src/composables/navigationPreferences.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

vi.mock('../src/composables/store/cloudAccess.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, restoreStoredValues: vi.fn(actual.restoreStoredValues) }
})
registerMirrorTeardown()
const realAccess = await vi.importActual('../src/composables/store/cloudAccess.js')
const defaults = () => ({ [MOBILE_NAVIGATION_KEY]: [...DEFAULT_MOBILE_NAVIGATION], [DESKTOP_NAVIGATION_KEY]: JSON.parse(JSON.stringify(DEFAULT_DESKTOP_NAVIGATION)) })
let app, host, open, closed, boundary
const flush = async () => { for (let i = 0; i < 10; i++) await nextTick() }
const buttonText = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
beforeEach(async () => {
  await realAccess.restoreStoredValues(defaults())
  vi.mocked(restoreStoredValues).mockReset().mockImplementation(realAccess.restoreStoredValues)
  host = document.createElement('div'); document.body.append(host)
  open = ref(true); closed = vi.fn(); boundary = vi.fn()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  app = createApp({ render: () => h(NavigationSettings, { open: open.value, initialMode: 'mobile', onClose: () => { closed(); open.value = false } }) })
  app.config.errorHandler = boundary; app.use(router).mount(host)
  await flush()
  document.querySelector('[aria-label="移除今天"]').click(); await flush()
})
afterEach(async () => { app?.unmount(); host?.remove(); await realAccess.restoreStoredValues(defaults()); vi.restoreAllMocks() })

describe('GLO02 navigation save feedback at both real entry points', () => {
  it('main save keeps the draft/error on storage failure and retries the actual write', async () => {
    vi.mocked(restoreStoredValues).mockRejectedValueOnce(new Error('虚构磁盘写入失败'))
    document.querySelector('.nav-save').click(); await flush()
    expect(document.querySelector('.nav-save').dataset.actionPhase).toBe('error')
    expect(document.querySelector('.navigation-feedback[role="alert"]').textContent).toContain('虚构磁盘写入失败')
    expect(mobileNavigation.value).toEqual(DEFAULT_MOBILE_NAVIGATION)
    // A new edit ends the prior visual lock; retries retain the current draft.
    document.querySelector('[aria-label="撤销上一步"]').click(); await flush()
    document.querySelector('[aria-label="移除今天"]').click(); await flush()
    document.querySelector('.nav-save').click(); await flush()
    await vi.waitFor(() => expect(mobileNavigation.value).toEqual(['tasks', 'schedule']))
    expect(restoreStoredValues).toHaveBeenCalledTimes(2)
    expect(boundary).not.toHaveBeenCalled()
  })

  it('save-and-leave locks duplicate clicks, retains failure, then retries without a fake successful result', async () => {
    let fail
    vi.mocked(restoreStoredValues).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    document.querySelector('[aria-label="关闭弹窗"]').click(); await flush()
    const submit = buttonText('保存并离开'); submit.focus(); submit.click(); submit.click(); await flush()
    expect(restoreStoredValues).toHaveBeenCalledTimes(1)
    expect(submit.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(submit)
    expect(buttonText('放弃修改').disabled).toBe(true)
    fail(new Error('虚构保存失败，请重试')); await flush()
    expect(closed).not.toHaveBeenCalled()
    expect(submit.dataset.actionPhase).toBe('idle')
    expect(document.querySelector('.action-check')).toBeNull()
    expect(document.body.textContent).toContain('虚构保存失败，请重试')
    submit.click(); await flush()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    expect(mobileNavigation.value).toEqual(['tasks', 'schedule'])
    expect(restoreStoredValues).toHaveBeenCalledTimes(2)
    expect(boundary).not.toHaveBeenCalled()
  })

  it('a parent closure invalidates the old save-and-leave continuation', async () => {
    let finish
    vi.mocked(restoreStoredValues).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    document.querySelector('[aria-label="关闭弹窗"]').click(); await flush()
    buttonText('保存并离开').click(); await flush()
    open.value = false; await flush()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    finish(); await flush()
    expect(closed).not.toHaveBeenCalled()
    expect(boundary).not.toHaveBeenCalled()
  })

  it('still leaves if an external update makes the draft clean while the confirmation is open', async () => {
    document.querySelector('[aria-label="关闭弹窗"]').click(); await flush()
    await realAccess.restoreStoredValues({ [MOBILE_NAVIGATION_KEY]: ['tasks', 'schedule'] }); await flush()
    const submit = buttonText('保存并离开')
    expect(submit).toBeTruthy()
    submit.click(); await flush()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    expect(restoreStoredValues).not.toHaveBeenCalled()
    expect(document.querySelector('.action-check')).toBeNull()
  })
})
