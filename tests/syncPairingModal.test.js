// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import SyncPairingModal from '../src/components/SyncPairingModal.vue'

let mounted = null

function mountPairingModal() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render: () => h(SyncPairingModal, { open: true }) })
  app.mount(root)
  mounted = { app, root }
}

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = null
  document.body.querySelector('.overlay')?.remove()
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

describe('SyncPairingModal 手机手动绑定入口', () => {
  it('把完整绑定内容输入框放在未开启摄像头的首屏，避免空预览挤掉输入区', async () => {
    mountPairingModal()
    await nextTick()

    const manual = document.querySelector('.pair-manual')
    expect(manual?.textContent).toContain('完整绑定内容')
    expect(manual?.querySelector('textarea')).not.toBeNull()
    expect(document.querySelector('.pair-camera')).toBeNull()
  })
})
