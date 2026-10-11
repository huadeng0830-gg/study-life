// @vitest-environment happy-dom
import { createApp, defineAsyncComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Modal from '../src/components/Modal.vue'
import { useScheduleDialogMounts } from '../src/composables/scheduleDialogMounts.js'

let app, host
afterEach(() => { app?.unmount(); host?.remove() })

describe('课表弹窗下载与页面生命周期', () => {
  it('下载完成时已离开 KeepAlive 页面则等待返回；返回后打开，关闭保留实例', async () => {
    const visible = ref(true)
    const open = ref(false)
    let finishDownload, dialogs, instanceCount = 0
    const Editor = {
      setup() {
        instanceCount++
        return () => h(Modal, { open: open.value, title: 'Delayed editor', onClose: () => { open.value = false } }, () => 'Draft')
      },
    }
    const Schedule = {
      setup() {
        dialogs = useScheduleDialogMounts({ editor: () => open.value })
        const Deferred = defineAsyncComponent(() => dialogs.load(() => new Promise(resolve => { finishDownload = () => resolve(Editor) })))
        return () => dialogs.mounted.editor ? h(Deferred) : h('div', 'Schedule')
      },
    }
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(KeepAlive, null, { default: () => visible.value ? h(Schedule) : h('div', 'Other route') }) })
    app.mount(host)
    open.value = true
    await nextTick()
    await vi.waitFor(() => expect(finishDownload).toBeTypeOf('function'))
    visible.value = false
    await nextTick()
    finishDownload()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(instanceCount).toBe(0)
    visible.value = true
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy())
    expect(instanceCount).toBe(1)
    open.value = false
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    open.value = true
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    expect(instanceCount).toBe(1)
  })

  it('页面在等待返回期间卸载，释放等待任务且不再显示弹窗', async () => {
    const visible = ref(true), open = ref(false)
    let finishDownload, loadPromise
    const Schedule = {
      setup() {
        const dialogs = useScheduleDialogMounts({ editor: () => open.value })
        return () => h('button', { onClick: () => { loadPromise = dialogs.load(() => new Promise(resolve => { finishDownload = resolve })) } }, 'Load')
      },
    }
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(KeepAlive, null, { default: () => visible.value ? h(Schedule) : h('div') }) })
    app.mount(host)
    host.querySelector('button').click()
    visible.value = false
    await nextTick()
    finishDownload({ default: {} })
    await new Promise(resolve => setTimeout(resolve, 20))
    app.unmount(); app = null
    await expect(loadPromise).resolves.toEqual({ default: {} })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
