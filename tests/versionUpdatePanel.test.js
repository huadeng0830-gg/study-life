// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import AppUpdateSection from '../src/components/data/AppUpdateSection.vue'
import { lastCheckOutcome, needsManualReload, updateChecking, updateMessage, updateStage } from '../src/composables/appUpdate.js'
import { APP_RELEASE, PREVIOUS_RELEASE_GROUPS, RELEASE_SEEN_KEY } from '../src/composables/releaseNotes.js'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let app
let host

beforeEach(() => {
  updateStage.value = 'idle'
  updateChecking.value = false
  needsManualReload.value = false
  lastCheckOutcome.value = ''
  updateMessage.value = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(AppUpdateSection)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('版本与更新面板', () => {
  it('保留上次检查结果，在重新检查时显示本轮状态和语气', async () => {
    lastCheckOutcome.value = '检查失败'
    app.mount(host)
    expect(host.querySelector('.update-status').classList.contains('is-error')).toBe(true)
    updateChecking.value = true
    updateStage.value = 'checking'
    await nextTick()
    expect(host.querySelector('.update-status').textContent).toBe('检查中')
    expect(host.querySelector('.update-status').classList.contains('is-info')).toBe(true)
    expect(host.querySelector('.update-check-button').disabled).toBe(true)
    expect(host.querySelector('.update-check-button').getAttribute('aria-busy')).toBe('true')
  })

  it('下载状态覆盖检查中和上次已是最新的结果', () => {
    lastCheckOutcome.value = '已是最新版本'
    updateChecking.value = true
    updateStage.value = 'downloading'
    app.mount(host)
    expect(host.querySelector('.update-status').textContent).toBe('正在下载新版本')
    expect(host.querySelector('.update-status').classList.contains('is-info')).toBe(true)
    expect(host.querySelector('.update-check-button').textContent.trim()).toBe('正在下载…')
  })

  it('待应用时只突出重新加载这个主操作', () => {
    needsManualReload.value = true
    updateStage.value = 'manual-reload'
    app.mount(host)
    expect([...host.querySelectorAll('.update-actions .btn-primary')].map((button) => button.textContent.trim()))
      .toEqual(['立即重新加载'])
    expect(host.querySelector('.update-check-button').classList.contains('btn-secondary')).toBe(true)
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
      expect(history.querySelectorAll('li')).toHaveLength(PREVIOUS_RELEASE_GROUPS[0].notes.length)
    }
    document.querySelector('.release-notes .btn').click()
    await nextTick()
    expect(document.querySelector('.release-notes')).toBeNull()
    expect(localStorage.getItem(RELEASE_SEEN_KEY)).toBe(APP_RELEASE)
  })
})
