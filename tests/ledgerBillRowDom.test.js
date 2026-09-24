// @vitest-environment happy-dom
/**
 * 固定账单行的**渲染 DOM** 级验证（第十九轮）。
 *
 * 起因是一个真缺陷：这三行本来是 `<div role="button" tabindex="0" @click="编辑">`，
 * 里面却装着「已支付 / 跳过本次 / 恢复」这些真按钮。按 ARIA 规范，`button` 的子节点是
 * **presentational**——内层按钮的语义被抹掉：读屏既听不到它们是独立控件，还会把行名拼成
 * 「编辑固定账单「水费」 已支付 跳过本次」。
 *
 * 【为什么单开一个 DOM 测试，而不是只加源码扫描】
 * 源码扫描只能证明「模板里写了什么」，证明不了「渲染出来是什么」。这个修复的价值恰恰在
 * 渲染结果上：真实控件在 DOM 里必须**不是**编辑按钮的后代、且编辑按钮本身可聚焦。
 * `LedgerView` 已经能被 `createApp` 直接挂载（见 ledgerViewStartup.test.js），
 * 所以没有理由只停在文本层面。源码侧的守卫在 keyboardReachability.test.js 里。
 *
 * 【为什么只写一个 it】`useStoredRef` 按 key 全局缓存（store/core.js:304），
 * `sl_bills` 在**首次挂载**时读一次 localStorage 之后就一直复用同一个 ref。
 * 所以数据必须在第一次挂载前就位；拆成多个 it 会让后面几个拿到旧数据。
 */
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import LedgerView from '../src/views/LedgerView.vue'
import { appToday } from '../src/composables/timeContext.js'

const BILLS_KEY = 'sl_bills'
const CONTROL_SELECTOR = 'button, a[href], input, select, textarea, summary'

let app = null
let host = null
let savedBills = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  if (savedBills === null) localStorage.removeItem(BILLS_KEY)
  else localStorage.setItem(BILLS_KEY, savedBills)
  savedBills = null
})

describe('固定账单行渲染出来是真按钮，而不是包着按钮的伪按钮', () => {
  it('编辑入口是 <button.bill-main>，动作按钮是它的兄弟；行本身不再是伪按钮', async () => {
    savedBills = localStorage.getItem(BILLS_KEY)
    localStorage.setItem(BILLS_KEY, JSON.stringify([
      // nextDate 设为「今天」→ billStatus 给出 today → 落在 dueBills（待支付）
      { id: 'dom-due-1', name: '水费', amount: 30, cycle: 'month', nextDate: appToday.value, active: true, remindDays: 3 },
      // active:false → 落在 pausedBills（已暂停）
      { id: 'dom-paused-1', name: '宽带', amount: 60, cycle: 'month', nextDate: appToday.value, active: false, remindDays: 3 },
    ]))

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/bills', component: LedgerView }],
    })
    await router.push('/bills?tab=bills')

    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(LedgerView)
    app.use(router)
    app.mount(host)
    await nextTick()

    const rows = [...host.querySelectorAll('.bill-row')]
    expect(rows.length, '没渲染出固定账单行——判据已与实现脱节').toBeGreaterThanOrEqual(2)

    for (const row of rows) {
      const label = row.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)
      const main = row.querySelector(':scope > button.bill-main')
      expect(main, `${label}：每行都要有一个编辑入口真按钮`).toBeTruthy()
      expect(main.tagName).toBe('BUTTON')
      expect(main.tabIndex, '编辑入口必须可聚焦').toBe(0)
      expect(main.getAttribute('aria-label')).toContain('编辑固定账单')

      // 核心断言：编辑按钮内部不能再有真实控件（否则语义又被抹掉）
      expect(main.querySelector(CONTROL_SELECTOR), `${label}：编辑按钮里不该有控件`).toBe(null)

      // 动作按钮是兄弟、语义完好、仍是真按钮
      const acts = row.querySelector(':scope > .b-actions')
      expect(acts, `${label}：动作按钮组应当是编辑按钮的兄弟`).toBeTruthy()
      expect(acts.contains(main)).toBe(false)
      expect(main.contains(acts)).toBe(false)
      expect(acts.querySelectorAll('button').length).toBeGreaterThanOrEqual(1)

      // 行本身不再是伪按钮
      expect(row.getAttribute('role'), `${label}：行不该再自称 button`).toBe(null)
      expect(row.hasAttribute('tabindex'), `${label}：行不该再进 Tab 序`).toBe(false)

      // 视觉结构没丢：名称与金额仍在编辑按钮里
      expect(main.querySelector('.b-main'), `${label}：名称块应留在编辑按钮内`).toBeTruthy()
      expect(main.querySelector('.b-amount'), `${label}：金额块应留在编辑按钮内`).toBeTruthy()
    }

    // 名称确实渲染出来了（证明上面查的按钮不是空壳）
    const names = rows.map((row) => row.querySelector('.bill-main .b-main b')?.textContent?.trim())
    expect(names).toContain('水费')
    expect(names).toContain('宽带')
  })
})