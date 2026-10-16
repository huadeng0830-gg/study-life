// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillFormModal from '../src/views/ledger-panels/BillFormModal.vue'
import { accountUser } from '../src/composables/accountAuth.js'
import { accountDataOwner } from '../src/composables/accountSyncIdentity.js'

let app, host
const initialUser = accountUser.value
const initialOwner = accountDataOwner.value
afterEach(() => {
  app?.unmount(); host?.remove(); app = null; host = null
  accountUser.value = initialUser; accountDataOwner.value = initialOwner
})
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

  it('does not copy a bill draft from one account into another account template list', async () => {
    accountUser.value = { id: 'fictional-account-a' }
    accountDataOwner.value = 'fictional-account-a'
    const saveBill = vi.fn()
    const form = await mount({ createBill: saveBill })
    const name = document.querySelector('input[placeholder="例如：ChatGPT Plus、话费"]')
    name.value = '原账号示例模板'
    name.dispatchEvent(new Event('input', { bubbles: true }))

    accountUser.value = { id: 'fictional-account-b' }
    accountDataOwner.value = 'fictional-account-b'
    document.querySelector('button') // settle Vue's account watcher before the action
    await nextTick()
    ;[...document.querySelectorAll('button')].find((button) => button.textContent.includes('存为模板')).click()
    await nextTick()

    expect(saveBill).not.toHaveBeenCalled()
    expect(form.notify).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('变化')
  })
})
