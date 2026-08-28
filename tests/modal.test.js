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
})
