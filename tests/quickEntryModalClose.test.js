// @vitest-environment happy-dom
/**
 * 「记一笔」弹窗的关闭与保存，钉在**真实点击**上。
 *
 * 【为什么必须单独一条】这两个缺陷靠别的用例一个都测不到：
 *   - 点 ✕ / 点遮罩 / 按 Esc 之后弹窗不消失；
 *   - 点「记下」之后弹窗也不消失。
 * 共同原因是：弹窗开关 `showQuick` 是页面持有的 ref，而页面把 `@close` 绑到了
 * composable 的 closeQuick —— 那个函数只做表单收尾（keepAdding / savingExpense 复位），
 * 从来不碰 showQuick。纯函数用例不渲染，DOM 用例又只断言「保存后列表出现那一行」，
 * 于是两条关闭路径一路活到了线上。
 *
 * 之前同族的「记录详情关不掉」也是同一形状（给只有 getter 的 computed 赋值）。
 * 所以这里显式地**点那些按钮**，而不是断言字符串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { expenses } from '../src/composables/ledger.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let mounted = null

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expenses.value = []
})

afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
  expenses.value = []
})

async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  // Vue 的事件 invoker 有一条去重守卫（e._vts <= 挂载时刻就跳过），
  // 元素刚挂载的同一毫秒内点击会被吞掉，所以先让一个 tick 过去。
  await new Promise((tick) => setTimeout(tick, 8))
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle()
}

async function waitFor(check, timeout = 1500) {
  const started = Date.now()
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() - started > timeout) return null
    await settle()
    await new Promise((tick) => setTimeout(tick, 5))
  }
}

const byText = (selector, text) =>
  [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))

async function openQuickEntry() {
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, '/bills')
  const entry = byText('.ledger-quick-entry button', '记一笔')
  expect(entry, '找不到「记一笔」入口').toBeTruthy()
  await click(entry)
  return waitFor(() => document.querySelector('.quick-form .amount-input'))
}

async function setInput(node, value) {
  expect(node, '要填写的输入框不存在').toBeTruthy()
  node.value = value
  node.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

describe('记一笔弹窗：关闭与保存', () => {
  it('点右上角 × 能关闭弹窗', async () => {
    const amountInput = await openQuickEntry()
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    const close = document.querySelector('.overlay .close')
    expect(close, '弹窗上找不到关闭按钮').toBeTruthy()
    await click(close)

    const stillOpen = await waitFor(() => document.querySelector('.quick-form .amount-input'), 300)
    expect(stillOpen, '点了 × 之后弹窗没有关闭').toBe(null)
  })

  it('点遮罩空白处能关闭弹窗', async () => {
    const amountInput = await openQuickEntry()
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    const overlay = document.querySelector('.overlay')
    expect(overlay, '找不到遮罩').toBeTruthy()
    await click(overlay)

    const stillOpen = await waitFor(() => document.querySelector('.quick-form .amount-input'), 300)
    expect(stillOpen, '点了遮罩之后弹窗没有关闭').toBe(null)
  })

  it('按 Esc 能关闭弹窗', async () => {
    const amountInput = await openQuickEntry()
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()

    const stillOpen = await waitFor(() => document.querySelector('.quick-form .amount-input'), 300)
    expect(stillOpen, '按 Esc 之后弹窗没有关闭').toBe(null)
  })

  it('点「记下」保存成功后弹窗自动关闭，且记录真的落库', async () => {
    const amountInput = await openQuickEntry()
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    await setInput(amountInput, '38.5')
    await setInput(document.querySelector('.quick-form .name-input'), '测试午餐')
    await click(document.querySelector('.quick-actions .save-btn'))

    expect(expenses.value.find((item) => item.name === '测试午餐'), '记录没有落库').toBeTruthy()
    const stillOpen = await waitFor(() => document.querySelector('.quick-form .amount-input'), 300)
    expect(stillOpen, '保存成功后弹窗没有自动关闭').toBe(null)
  })

  it('「连续记」保持弹窗打开，记完能点「完成」退出', async () => {
    const amountInput = await openQuickEntry()
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    await setInput(amountInput, '12')
    await setInput(document.querySelector('.quick-form .name-input'), '连续记账甲')
    const keepGoing = [...document.querySelectorAll('.quick-actions button')]
      .find((node) => (node.textContent || '').includes('连续记'))
    expect(keepGoing, '找不到「连续记」按钮').toBeTruthy()
    await click(keepGoing)

    expect(expenses.value.find((item) => item.name === '连续记账甲'), '记录没有落库').toBeTruthy()
    const reopened = await waitFor(() => document.querySelector('.quick-form .amount-input'))
    expect(reopened, '「连续记」之后弹窗被关掉了，应保持打开').toBeTruthy()

    // 连续记账模式下这个按钮变成「完成」，语义是退出连续记账。
    // 之前它仍然调 saveExpense(true)，于是点「完成」只会去存一张空表单，
    // 用户走不出去 —— 必须能靠它正常收工。
    const finish = [...document.querySelectorAll('.quick-actions button')]
      .find((node) => (node.textContent || '').includes('完成'))
    expect(finish, '连续记账模式下没有出现「完成」按钮').toBeTruthy()
    expect(finish.textContent.trim(), '「完成」按钮文案不对').toBe('完成')
    await click(finish)

    const closed = await waitFor(() => document.querySelector('.quick-form .amount-input'), 300)
    expect(closed, '点「完成」之后弹窗没有关闭').toBe(null)
  })

  it('金额非法时不能关闭弹窗：否则用户刚填的内容会全部丢掉', async () => {
    const amountInput = await openQuickEntry()
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    // 只填名称、金额留空 → 属于「没存」，必须留在原地
    await setInput(document.querySelector('.quick-form .name-input'), '只有名字没有金额')
    await click(document.querySelector('.quick-actions .save-btn'))

    expect(expenses.value.length, '金额为空居然存进去了').toBe(0)
    const stillOpen = await waitFor(() => document.querySelector('.quick-form .amount-input'))
    expect(stillOpen, '保存失败时弹窗被关掉了，用户填的内容丢了').toBeTruthy()
  })
})
