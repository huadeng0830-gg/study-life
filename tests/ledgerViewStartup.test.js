// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import LedgerView from '../src/views/LedgerView.vue'
import { expenses } from '../src/composables/ledger.js'

let app = null
let host = null
let previousExpenses = []

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  expenses.value = previousExpenses
  previousExpenses = []
})

describe('账本启动', () => {
  it('有历史交易时不会在初始化前读取日期汇总', async () => {
    previousExpenses = expenses.value
    expenses.value = [{
      id: 'startup-ledger-1',
      name: '午饭',
      amount: 18,
      cat: 'food',
      date: '2026-09-13',
      time: '12:00',
    }]

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/bills', component: LedgerView }],
    })
    await router.push('/bills')

    const errors = []
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(LedgerView)
    app.config.errorHandler = (error) => errors.push(error)
    app.use(router)
    app.mount(host)
    await nextTick()

    expect(errors).toEqual([])
    expect(host.textContent).toContain('午饭')
  })
})
