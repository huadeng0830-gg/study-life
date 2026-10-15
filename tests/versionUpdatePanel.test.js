// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import AppUpdateSection from '../src/components/data/AppUpdateSection.vue'
import { lastCheckOutcome, updateMessage, updateStage, webUpdateState } from '../src/composables/appUpdate.js'
import { APP_RELEASE, PREVIOUS_RELEASE_GROUPS, RELEASE_SEEN_KEY } from '../src/composables/releaseNotes.js'
import { formatUpdateDiagnostic } from '../src/composables/updateProtocol.js'
import { performanceMode } from '../src/composables/performanceMode.js'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let app
let host

beforeEach(() => {
  updateStage.value = 'idle'
  Object.assign(webUpdateState, { taskPending: false, error: null, lastCheckedAt: 0, availableVersion: '', timings: [], log: [] })
  lastCheckOutcome.value = ''
  updateMessage.value = ''
  performanceMode.value = 'auto'
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(AppUpdateSection)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('版本与更新面板', () => {
  it('减少动画入口使用全局偏好，面板重新打开后保留选择', async () => {
    app.mount(host)
    host.querySelector('.update-motion-settings').open = true
    const reduce = [...host.querySelectorAll('.update-motion-options button')].find((button) => button.textContent === '减少动画')
    reduce.click()
    await nextTick()
    expect(performanceMode.value).toBe('on')
    expect(reduce.getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.performance).toBe('reduced')
    app.unmount()
    app = createApp(AppUpdateSection)
    app.mount(host)
    expect([...host.querySelectorAll('.update-motion-options button')].find((button) => button.textContent === '减少动画').getAttribute('aria-pressed')).toBe('true')
  })
  it('保留上次检查结果，在重新检查时显示本轮状态和语气', async () => {
    updateStage.value = 'error'
    lastCheckOutcome.value = '检查失败'
    app.mount(host)
    expect(host.querySelector('.update-status').classList.contains('is-error')).toBe(true)
    updateStage.value = 'checking'
    await nextTick()
    expect(host.querySelector('.update-status').textContent).toBe('检查中')
    expect(host.querySelector('.update-status').classList.contains('is-info')).toBe(true)
    expect(host.querySelector('.update-check-button').disabled).toBe(true)
    expect(host.querySelector('.update-check-button').getAttribute('aria-busy')).toBe('true')
  })

  it('下载状态覆盖检查中和上次已是最新的结果', () => {
    lastCheckOutcome.value = '已是最新版本'
    updateStage.value = 'downloading'
    app.mount(host)
    expect(host.querySelector('.update-status').textContent).toBe('正在下载新版本')
    expect(host.querySelector('.update-status').classList.contains('is-info')).toBe(true)
    expect(host.querySelector('.update-check-button').textContent.trim()).toBe('正在下载…')
  })

  it('待应用时只突出重新加载这个主操作', () => {
    updateStage.value = 'manual-reload'
    app.mount(host)
    expect([...host.querySelectorAll('.update-actions [data-primary-action]')].map((button) => button.textContent.trim()))
      .toEqual(['立即重新加载'])
    expect([...host.querySelectorAll('button')].some((button) => button.textContent.trim() === '检查更新')).toBe(false)
  })

  it.each(['checking', 'downloading', 'installing', 'verifying'])('%s 时主操作唯一，且所有检查入口不能被触发', (stage) => {
    Object.assign(webUpdateState, { stage, taskPending: true })
    app.mount(host)
    const primary = host.querySelectorAll('[data-primary-action]')
    expect(primary).toHaveLength(1)
    expect(primary[0].disabled).toBe(true)
    expect(primary[0].getAttribute('aria-busy')).toBe('true')
    expect([...host.querySelectorAll('button')].filter((button) => /检查更新|重新检查/.test(button.textContent) && !button.disabled)).toHaveLength(0)
    if (stage !== 'checking') expect(host.querySelector('[role=progressbar]').hasAttribute('aria-valuenow')).toBe(false)
  })

  it('关闭面板重新打开后仍显示全局下载，不回退为空闲检查', () => {
    Object.assign(webUpdateState, { stage: 'downloading', taskPending: true })
    app.mount(host)
    app.unmount()
    app = createApp(AppUpdateSection)
    app.mount(host)
    expect(host.querySelector('.update-status').textContent).toBe('正在下载新版本')
    expect(host.querySelector('[data-primary-action]').disabled).toBe(true)
  })

  it('错误详情可复制，诊断只保留允许字段', async () => {
    Object.assign(webUpdateState, { stage: 'error', error: { code: 'NETWORK', message: '连接失败', retryAction: 'check' } })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    app.mount(host)
    host.querySelector('.update-diagnostics').open = true
    const copy = [...host.querySelectorAll('button')].find((button) => button.textContent.includes('复制诊断信息'))
    copy.click()
    await Promise.resolve()
    await nextTick()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(JSON.parse(writeText.mock.calls[0][0]).error.code).toBe('NETWORK')
    expect(host.querySelector('.update-copy-result').textContent).toBe('诊断信息已复制')
    const diagnostic = formatUpdateDiagnostic('web', { ...webUpdateState, token: 'fictional-secret',
      error: { ...webUpdateState.error, headers: { token: 'fictional-secret' } }, log: [{ code: 'TIMEOUT', privatePath: 'fictional-secret' }] })
    expect(diagnostic).not.toContain('fictional-secret')
  })

  it('点击后才打开更新记录，历史按需展开且不改变已读标记', async () => {
    localStorage.setItem(RELEASE_SEEN_KEY, APP_RELEASE)
    app.mount(host)
    expect(document.querySelector('.release-notes')).toBeNull()
    host.querySelector('.update-notes-button').click()
    for (let attempt = 0; attempt < 80 && !document.querySelector('.release-notes'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      await nextTick()
    }
    expect(document.querySelector('.release-notes')).toBeTruthy()
    expect(document.querySelector('.release-notes').textContent).toContain(APP_RELEASE)
    if (PREVIOUS_RELEASE_GROUPS.length) {
      const history = document.querySelector('.previous-group')
      expect(history.querySelector('ul')).toBeNull()
      history.open = true
      history.dispatchEvent(new Event('toggle'))
      await nextTick()
      const release = PREVIOUS_RELEASE_GROUPS[0]
      const categorized = Object.values(release.changes).flat()
      const notes = categorized.length ? categorized : release.notes
      expect([...history.querySelectorAll('li')].map((item) => item.textContent)).toEqual([...notes])
    }
    document.querySelector('.release-notes .btn').click()
    await nextTick()
    expect(document.querySelector('.release-notes')).toBeNull()
    expect(localStorage.getItem(RELEASE_SEEN_KEY)).toBe(APP_RELEASE)
  })
})
