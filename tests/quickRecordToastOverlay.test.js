// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountApp, settle } from './helpers/mountApp.js'
import { pushOverlay, removeOverlay } from '../src/composables/overlayStack.js'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

const { undo } = vi.hoisted(() => ({ undo: vi.fn() }))
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))
vi.mock('../src/components/QuickRecordPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { __esModule: true, default: defineComponent({
    props: ['open'], emits: ['saved', 'close'],
    setup(props, { emit }) {
      return () => props.open ? h('button', {
        class: 'save-fixture-record',
        onClick: () => emit('saved', { message: '已保存虚构验收记录', undo }),
      }, '保存验收记录') : null
    },
  }) }
})

registerMirrorTeardown()
let mounted
const entry = { active: true }
afterEach(() => {
  removeOverlay(entry)
  mounted?.unmount()
  mounted = null
  vi.useRealTimers()
  undo.mockReset()
  clearAnnouncement()
})

async function savedToast() {
  mounted = await mountApp()
  document.querySelector('.desktop-record-trigger').click()
  await vi.waitFor(() => expect(document.querySelector('.save-fixture-record')).toBeTruthy())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  document.querySelector('.save-fixture-record').click()
  await nextTick()
  expect(document.querySelector('.quick-record-toast')?.textContent).toContain('已保存虚构验收记录')
}

describe('快速记录反馈与表单互不遮挡', () => {
  it('打开新浮层时隐藏旧反馈，关闭后保留可用的撤销操作', async () => {
    await savedToast()
    await vi.advanceTimersByTimeAsync(4500)
    pushOverlay(entry)
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    await settle()
    expect(document.querySelector('.quick-record-toast')).toBeNull()
    await vi.advanceTimersByTimeAsync(10000)
    removeOverlay(entry)
    await nextTick()
    const toast = document.querySelector('.quick-record-toast')
    expect(toast?.textContent).toContain('已保存虚构验收记录')
    const action = [...toast.querySelectorAll('button')].find(button => button.textContent === '撤销')
    action.click()
    expect(undo).toHaveBeenCalledOnce()
  })

  it('浮层关闭后提供完整五秒反馈时间，再自动收起', async () => {
    await savedToast()
    pushOverlay(entry)
    await nextTick()
    await vi.advanceTimersByTimeAsync(10000)
    removeOverlay(entry)
    await nextTick()
    await vi.advanceTimersByTimeAsync(4999)
    expect(document.querySelector('.quick-record-toast')).toBeTruthy()
    await vi.advanceTimersByTimeAsync(251)
    await settle()
    expect(document.querySelector('.quick-record-toast')).toBeNull()
  })
})
