// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import Modal from '../src/components/Modal.vue'

const mountedApps = []

function mount(render) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render })
  app.mount(root)
  mountedApps.push({ app, root })
}

afterEach(() => {
  for (const { app, root } of mountedApps.splice(0)) {
    app.unmount()
    root.remove()
  }
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

describe('Modal 页面锁', () => {
  it('v-if 卸载弹窗时会解除页面锁', async () => {
    const visible = ref(true)
    mount(() => visible.value ? h(Modal, { open: true, title: '测试' }) : null)
    expect(document.body.dataset.modalOpen).toBe('true')

    visible.value = false
    await nextTick()

    expect(document.body.dataset.modalOpen).toBeUndefined()
    expect(document.body.style.overflow).toBe('')
  })

  it('关闭叠加弹窗时仍保留底层弹窗的页面锁', async () => {
    const topVisible = ref(true)
    mount(() => h('div', [
      h(Modal, { open: true, title: '底层' }),
      topVisible.value ? h(Modal, { open: true, title: '顶层' }) : null,
    ]))
    expect(document.body.dataset.modalLockCount).toBe('2')

    topVisible.value = false
    await nextTick()

    expect(document.body.dataset.modalLockCount).toBe('1')
    expect(document.body.dataset.modalOpen).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('打开时把焦点放入弹窗，Tab 和 Shift+Tab 都在弹窗内循环', async () => {
    const visible = ref(true)
    mount(() => visible.value ? h(Modal, { open: true, title: '焦点测试' }, {
      default: () => h('div', [
        h('button', { id: 'first' }, '第一项'),
        h('button', { id: 'last' }, '最后一项'),
      ]),
    }) : null)
    await nextTick()
    const last = document.querySelector('#last')
    const close = document.querySelector('.close')
    expect(document.activeElement).toBe(close)

    last.focus()
    document.querySelector('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(close)

    close.focus()
    document.querySelector('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(last)
  })

  it('关闭嵌套弹窗后焦点回到外层触发位置', async () => {
    const innerVisible = ref(false)
    mount(() => h('div', [
      h(Modal, { open: true, title: '外层' }, {
        default: () => h('button', { id: 'outer-trigger' }, '内层'),
      }),
      innerVisible.value ? h(Modal, { open: true, title: '内层' }, { default: () => h('button', { id: 'inner-action' }, '操作') }) : null,
    ]))
    await nextTick()
    document.querySelector('#outer-trigger').focus()
    innerVisible.value = true
    await nextTick()
    innerVisible.value = false
    await nextTick()
    expect(document.activeElement?.id).toBe('outer-trigger')
  })
})
