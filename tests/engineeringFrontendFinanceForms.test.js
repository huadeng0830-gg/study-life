// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillFormModal from '../src/views/ledger-panels/BillFormModal.vue'

let app, host
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })
async function mount(domain) {
  const notify = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(BillFormModal, {
    domain, notify,
    bills: [{ id: 'fictional-bill', name: '虚构账单', amount: 10, cycle: 'monthly', nextDate: '2026-11-01' }],
  })
  const instance = app.mount(host)
  instance.open({}, 'fictional-bill'); await nextTick()
  return { notify, save: () => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '保存').click() }
}

describe('engineering audit: fixed bill form persistence feedback', () => {
  it('keeps the draft and reports a bill removed before saving', async () => {
    const form = await mount({ updateBill: vi.fn(() => null) })
    form.save(); await nextTick()
    expect(form.notify).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('已不存在')
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('renders a rejected domain update inside the form', async () => {
    const form = await mount({ updateBill: vi.fn(() => { throw new Error('虚构保存失败') }) })
    app.config.errorHandler = () => {}
    form.save(); await nextTick()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('虚构保存失败')
    expect(form.notify).not.toHaveBeenCalled()
  })
})
