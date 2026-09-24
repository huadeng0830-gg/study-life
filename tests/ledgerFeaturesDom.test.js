// @vitest-environment happy-dom
/**
 * 四个新功能在**真实应用**里的渲染证据（挂载 App.vue + 真实路由，见 tests/helpers/mountApp.js）。
 *
 * 为什么必须单开一条：纯函数测试证明不了「页面上真的出现了那一行」。
 * 这里盯住三件产品可见的事：
 *   1. 存在非基准币种记录时，hero-stat 里真的渲染出 `≈ ¥xxx（按 yyyy-mm-dd 汇率）`；
 *   2. 预算超支时 hero-stat 里真的出现 `.pending-block.over` 预警；**未设预算时一个都不出现**；
 *   3. 账单表单里的「从模板套用 / 存为模板 / 删除模板」真的能改到表单与存储。
 *
 * 交互一律用真按钮 + 真事件（不 stub 原生 confirm/prompt）：本文件涉及的流程都不需要确认框。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { expenses } from '../src/composables/ledger.js'
import { useLedgerBudget } from '../src/composables/ledgerBudget.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'
import { useLedgerTemplateCommands } from '../src/composables/ledgerTemplates.js'
import { appToday } from '../src/composables/timeContext.js'
import { moneyWithCurrency } from '../src/utils/formatters.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

// 真实路由会加载到 appUpdate.js → 构建期虚拟模块；不 mock 会让 vitest 整体退出 1
// （三处既有测试的写法一致，见 mountApp.js 头部说明）。
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const { budget } = useLedgerBudget()
const { fx } = useLedgerFx()
const { templates } = useLedgerTemplateCommands()

let mounted = null

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expenses.value = []
  budget.value = { monthly: null, updatedAt: '' }
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
  templates.value = []
})

afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
  expenses.value = []
  budget.value = { monthly: null, updatedAt: '' }
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
  templates.value = []
})

async function waitFor(check, timeout = 1500) {
  const started = Date.now()
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() - started > timeout) return null
    await settle()
    await new Promise((resolveTick) => setTimeout(resolveTick, 5))
  }
}

// Vue 的事件 invoker 有一条去重守卫（`e._vts <= 挂载时刻` 就跳过），
// 在元素刚挂载的同一毫秒内点击会被跳过 —— 既有测试（formValidationA11y）也是等 8ms 再点。
async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  await new Promise((resolveTick) => setTimeout(resolveTick, 8))
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle()
}

async function setInput(node, value) {
  expect(node, '要填写的输入框不存在').toBeTruthy()
  node.value = value
  node.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

const byText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))
const heroText = () => (document.querySelector('.hero-stat')?.textContent || '').replace(/\s+/g, ' ')

describe('账本首页：折算行与预算预警真的渲染出来', () => {
  it('有外币记录时显示 ≈ 折算行，超预算时显示 .pending-block.over 预警', async () => {
    const today = appToday.value
    expenses.value = [
      { id: 'dom-cny', name: '午饭', amount: 300, cat: 'food', date: today, time: '12:00' },
      { id: 'dom-usd', name: '订阅', amount: 100, currency: 'USD', cat: 'sub', date: today, time: '13:00' },
    ]
    fx.value = { base: 'CNY', rates: { USD: 7.2 }, updatedAt: '2026-09-01' }
    budget.value = { monthly: 500, updatedAt: '2026-09-01' }

    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    const expected = moneyWithCurrency(1020, 'CNY') // 300 + 100 × 7.2
    expect(heroText(), '没渲染出折算行').toContain(`≈ ${expected}`)
    expect(heroText()).toContain('按 2026-09-01 汇率')
    const alert = document.querySelector('.hero-stat .pending-block')
    expect(alert, '没渲染出预算预警').toBeTruthy()
    expect(alert.classList.contains('over')).toBe(true)
    expect(alert.textContent).toContain('已超预算')
    expect(alert.textContent).toContain('已按手工汇率折算')

    // 入口可达：汇率设置 / 预算设置 都是真按钮
    expect(byText('.hero-stat button', '汇率设置')).toBeTruthy()
    expect(byText('.hero-stat button', '预算设置')).toBeTruthy()
  })

  it('未设预算、也没有外币记录时，hero-stat 里什么提示都不显示', async () => {
    const today = appToday.value
    expenses.value = [{ id: 'dom-only-cny', name: '午饭', amount: 30, cat: 'food', date: today, time: '12:00' }]

    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    expect(heroText()).not.toContain('≈')
    expect(document.querySelector('.hero-stat .pending-block'), '未设预算却渲染了预警').toBe(null)
    // 入口仍然在（否则用户永远没法第一次设预算）
    expect(byText('.hero-stat button', '设置预算')).toBeTruthy()
  })

  it('缺汇率的记录不出现在折算金额里，且文案如实说明未计入', async () => {
    const today = appToday.value
    expenses.value = [
      { id: 'dom-cny-2', name: '午饭', amount: 100, cat: 'food', date: today, time: '12:00' },
      { id: 'dom-eur', name: '欧版订阅', amount: 50, currency: 'EUR', cat: 'sub', date: today, time: '13:00' },
    ]
    fx.value = { base: 'CNY', rates: {}, updatedAt: '2026-09-01' }

    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    const text = heroText()
    // 折算行本身只含能折算的部分
    const fxLine = [...document.querySelectorAll('.hero-stat p')].find((node) => node.textContent.includes('≈'))
    expect(fxLine, '没渲染出折算行').toBeTruthy()
    expect(fxLine.textContent).toContain(`≈ ${moneyWithCurrency(100, 'CNY')}`)
    expect(fxLine.textContent).not.toContain(moneyWithCurrency(150, 'CNY'))
    expect(fxLine.textContent).toContain('EUR 缺少汇率')
    expect(fxLine.textContent).toContain('另有 1 笔未计入')
    // 既有「本月花费」卡片仍按记录原值相加（老路径一行没改），这正是新折算行存在的理由
    expect(text).toContain(`本月花费${moneyWithCurrency(150, 'CNY')}`)
  })

  it('通过「设置预算」弹窗真的能保存预算并作用到首页', async () => {
    const today = appToday.value
    expenses.value = [{ id: 'dom-budget', name: '午饭', amount: 30, cat: 'food', date: today, time: '12:00' }]

    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    byText('.hero-stat button', '设置预算').click()
    const input = await waitFor(() => document.querySelector('input[aria-label^="月度预算金额"]'))
    expect(input, '预算弹窗没打开').toBeTruthy()
    input.value = '500'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    byText('button', '保存预算').click()
    await settle()

    expect(budget.value.monthly).toBe(500)
    expect(heroText()).toContain('本月预算')
    expect(heroText()).toContain('已用 6%')
  })
})

describe('记一笔表单：报销分摊真的能算出来并标在列表上', () => {
  // 【曾经被跳过，现已解封】这条一度挂着 `it.skip`，理由写的是
  // 「happy-dom VirtualList+async component 渲染限制，待 E2E 补全」。那个理由不成立：
  // 摘掉 store/core.js 里 touchStoredRef 的 triggerRef（集合变更不通知 computed 的那个 bug）时
  // 它必红、装回去就必绿，连跑 5 次稳定。它是被「显式提交漏了通知视图」误诊成了环境限制。
  it('开启分摊 → 预览按分等分 → 保存后列表项出现「已分摊 · 我承担 …」', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    const openButton = byText('.ledger-quick-entry button', '记一笔')
    await click(openButton)
    const amountInput = await waitFor(() => document.querySelector('.quick-form .amount-input'))
    expect(amountInput, '记一笔弹窗没打开').toBeTruthy()

    await setInput(amountInput, '100')
    await setInput(document.querySelector('.quick-form .name-input'), '聚餐')

    // 分摊区在「更多」里，先展开（真按钮，不是 display:none 上硬点）
    await click(byText('.quick-form button', '更多'))
    await settle()
    // 现在直接显示人数输入框（默认 1），改成 2 人
    const splitCountInput = document.querySelector('.more-area input[type="number"]')
    expect(splitCountInput, '分摊人数输入框没渲染').toBeTruthy()
    await setInput(splitCountInput, '2')
    await settle()

    const preview = document.querySelector('.more-area .form-note')
    expect(preview.textContent).toContain('共 2 人')
    expect(preview.textContent).toContain(`我承担 ${moneyWithCurrency(50, 'CNY')}`)
    // 新预览文案不再包含"不记录谁欠我多少"
    expect(preview.textContent).toContain('其余')

    await click(document.querySelector('.quick-actions .save-btn'))

    const saved = expenses.value.find((item) => item.name === '聚餐')
    expect(saved, '分摊记录没落库').toBeTruthy()
    expect(saved.split).toEqual({
      total: 100,
      mine: 50,
      participants: [{ label: '我', amount: 50 }, { label: '成员 1', amount: 50 }],
    })
    // 金额字段语义不变：仍是这一笔的总额
    expect(saved.amount).toBe(100)

    const feedItem = await waitFor(() => document.querySelector('.feed-item'))
    // 列表金额列现在显示「我承担的份额」(-¥50)，总额改由副标题交代（2 人 · 共 ¥100）。
    expect(feedItem.querySelector('.fi-amount').textContent).toContain(`-${moneyWithCurrency(50, 'CNY')}`)
    expect(feedItem.textContent).toContain('已分摊 2 人')
    expect(feedItem.textContent).toContain(moneyWithCurrency(100, 'CNY'))
  })
})

describe('导出：外币记录的金额必须带单位', () => {
  it('导出的 CSV 里多一列币种，金额仍是记录原值（不折算）', async () => {
    const today = appToday.value
    expenses.value = [
      { id: 'dom-exp-cny', name: '午饭', amount: 30, cat: 'food', date: today, time: '12:00' },
      { id: 'dom-exp-usd', name: '订阅', amount: 20, currency: 'USD', cat: 'sub', date: today, time: '13:00' },
    ]
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills?tab=review')

    // 下载动作本身（blob → <a download> 点击导航）在 happy-dom 里没法真的发生，
    // 所以这里只掐掉导航，真正要断言的是导出的**内容**。
    const blobs = []
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test' }
    URL.revokeObjectURL = () => {}
    const clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      byText('button', '导出 CSV').click()
      await settle()
    } finally {
      URL.createObjectURL = realCreate
      URL.revokeObjectURL = realRevoke
      clickSpy.mockRestore()
    }

    expect(blobs, '没有生成导出文件').toHaveLength(1)
    const csv = (await blobs[0].text()).replace(/^\uFEFF/, '')
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('日期,时间,名称,分类,收支,金额,我承担,币种,账户,备注')
    // 「我承担」紧挨「金额」：未分摊的记录两列相等，分摊记录才会不同。
    expect(lines.find((line) => line.includes('订阅')), '缺外币行').toContain(',20,20,USD,')
    expect(lines.find((line) => line.includes('午饭')), '缺本币行').toContain(',30,30,CNY,')
  })
})

describe('固定账单表单：模板套用 / 存为模板 / 删除模板', () => {
  // 【曾经被跳过，现已解封】同上一处：它结尾守的正是「删掉的模板行必须从 DOM 消失」，
  // 当年报的是「模板删除入口没渲染」（行压根没渲染出来）被判成 happy-dom 限制，
  // 实际是 computed 停在旧值。装上 triggerRef 后 5 连跑稳定。
  it('点模板名会回填表单（且不动「下次支付日期」），存为模板与删除都真的改到存储', async () => {
    templates.value = [
      {
        id: 'tpl-dom-1',
        name: '视频会员',
        createdAt: '2026-09-01T00:00:00.000Z',
        bill: { name: 'Netflix', amount: 68, category: 'sub', cycle: 'yearly', remindDays: 7, account: '信用卡', currency: 'USD', note: '年付', autoRenew: true, active: true },
      },
      {
        id: 'tpl-dom-2',
        name: '宽带',
        createdAt: '2026-09-02T00:00:00.000Z',
        bill: { name: '联通宽带', amount: 60, category: 'communication', cycle: 'monthly', remindDays: 3, account: '银行卡', currency: 'JPY', note: '月付', autoRenew: false, active: true },
      },
    ]
    fx.value = { base: 'CNY', rates: { USD: 7.2, JPY: 0.048 }, updatedAt: '2026-09-01' }

    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills?tab=bills')

    byText('button', '添加固定账单').click()
    const nameInput = await waitFor(() => document.querySelector('input[placeholder="例如：ChatGPT Plus、话费"]'))
    expect(nameInput, '账单表单没打开').toBeTruthy()
    const nextDateInput = document.querySelector('input[type="date"]')
    const amountInput = () => document.querySelector('input[aria-label="固定账单金额"]')
    const currencySelect = () => document.querySelector('select[aria-label="固定账单使用的币种"]')
    const noteInput = () => document.querySelector('input[placeholder="补充套餐、用途等信息"]')

    // 「从模板套用」下拉：选中模板即回填（不改「下次支付日期」）
    const templateSelect = document.querySelector('select[aria-label="从模板套用"]')
    expect(templateSelect, '模板下拉没渲染').toBeTruthy()
    expect([...templateSelect.options].map((entry) => entry.value)).toEqual(['', 'tpl-dom-1', 'tpl-dom-2'])
    expect([...templateSelect.options].map((entry) => entry.textContent.trim()))
      .toEqual(['选择模板…', '视频会员', '宽带'])

    templateSelect.value = 'tpl-dom-1'
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(nameInput.value).toBe('Netflix')
    expect(amountInput().value).toBe('68')
    expect(currencySelect().value).toBe('USD')
    expect(noteInput().value).toBe('年付')
    expect(nextDateInput.value, '套用模板不该改「下次支付日期」').toBe('')

    // 换一个模板能再套一次（不是一个模板只能套一次）
    templateSelect.value = 'tpl-dom-2'
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(nameInput.value).toBe('联通宽带')
    expect(amountInput().value).toBe('60')
    expect(currencySelect().value).toBe('JPY')
    expect(noteInput().value).toBe('月付')

    // 存为模板：模板名取表单里当前的账单名（此刻是联通宽带）
    byText('button', '存为模板').click()
    await settle()
    const saved = templates.value.find((entry) => entry.name === '联通宽带')
    expect(saved, '存为模板没写进存储').toBeTruthy()
    expect(saved.bill.amount).toBe(60)
    expect(saved.bill.currency).toBe('JPY')
    expect(saved.bill.nextDate).toBeUndefined()

    // 再点一次：同名模板按 id 覆盖，不会堆出第二份
    byText('button', '存为模板').click()
    await settle()
    expect(templates.value.filter((entry) => entry.name === '联通宽带')).toHaveLength(1)
    expect(templates.value.some((entry) => entry.name === '视频会员')).toBe(true)
    expect(templates.value.some((entry) => entry.name === '宽带')).toBe(true)

    // 删除模板
    const removeButton = document.querySelector('button[aria-label="删除账单模板「联通宽带」"]')
    expect(removeButton, '模板删除入口没渲染').toBeTruthy()
    removeButton.click()
    await settle()
    expect(templates.value.some((entry) => entry.name === '联通宽带')).toBe(false)
    expect(document.querySelector('button[aria-label="删除账单模板「联通宽带」"]')).toBe(null)
    // 别的模板不受影响
    expect(templates.value.map((entry) => entry.name).sort()).toEqual(['宽带', '视频会员'])
  })
})