// @vitest-environment happy-dom
import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToastQueue } from '../src/composables/useToastQueue.js'

describe('useToastQueue', () => {
  afterEach(() => vi.useRealTimers())

  it('shows queued messages by priority and expires each one independently', () => {
    vi.useFakeTimers()
    let queue
    const app = createApp(defineComponent({
      setup() {
        queue = useToastQueue()
        return () => h('div')
      },
    }))
    app.mount(document.createElement('div'))

    queue.showToast('普通提示', { type: 'info', duration: 1000 })
    queue.showToast('需要处理', { type: 'error', duration: 500 })
    expect(queue.toast.value.message).toBe('需要处理')

    vi.advanceTimersByTime(500)
    expect(queue.toast.value.message).toBe('普通提示')
    vi.advanceTimersByTime(1000)
    expect(queue.toast.value).toBeNull()

    app.unmount()
  })
})
