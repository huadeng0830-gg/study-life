// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import ActionButton from '../src/components/ActionButton.vue'

let app, root
afterEach(() => { app?.unmount(); root?.remove() })
it('external feedback preserves the existing error boundary for an uncaught business failure', async () => {
  const failure = new Error('虚构服务异常')
  const boundary = vi.fn()
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ActionButton, { feedback: 'external', showError: false, action: () => Promise.reject(failure) }, () => '同步') })
  app.config.errorHandler = boundary
  app.mount(root)
  const button = root.querySelector('button')
  button.click()
  await vi.waitFor(() => expect(boundary).toHaveBeenCalledTimes(1))
  expect(boundary.mock.calls[0][0]).toBe(failure)
  expect(button.getAttribute('aria-busy')).toBeNull()
  expect(button.disabled).toBe(false)
  expect(root.querySelector('.action-check')).toBeNull()
})
