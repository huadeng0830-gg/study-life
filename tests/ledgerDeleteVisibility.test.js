// @vitest-environment happy-dom
/**
 * 「删掉的记录不消失，刷新一次才没了」——回归守卫。
 *
 * 【实际发生过的事】账本里删除一条消费记录后，列表那一行还在；
 * 数据其实已经存好了（刷新后记录就没了），停在旧值上的是**界面**。
 *
 * 【根因】`useStoredRef` 的「显式提交」性能改造（EXPLICIT_COMMIT_KEYS）把这些
 * 集合换成了 `shallowRef`：`push` / `splice` / 就地改字段都不再通知任何依赖，
 * 只有整份引用被换掉才算变更。领域命令改完之后调用的 `touchStoredRef` 那时
 * 只负责**排一次写盘**，不负责通知视图 → 持久化对了、computed 永远返回旧结果。
 * 于是「删了不消失」；而刷新会重新从 localStorage 读，所以刷新后记录才不见。
 *
 * 【修法】`touchStoredRef` 在排写盘的同时 `triggerRef`：调用方声明「这次业务变更
 * 已完成」，视图必须跟着重算。这条 seam 本来就是为「一次完整业务变更」设计的，
 * 它漏掉的正是通知这一半。
 *
 * 本文件钉住用户可见的三件事：
 *   1. 删除后那一行**当场**从列表消失（详情面板删除 / 左滑删除两条真实入口）；
 *   2. 新增的记录**当场**出现在列表里（不能也要刷新）；
 *   3. 刷新能修好这件事本身就是证据：数据早就写对了，错的只是视图。
 * 另外单开 `tests/storeExplicitCommitSeam.test.js` 守接缝不变量本身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { expenses } from '../src/composables/ledger.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { useLedgerBudget } from '../src/composables/ledgerBudget.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'
import { appToday } from '../src/composables/timeContext.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const domain = useDomainCommands()
const { budget } = useLedgerBudget()
const { fx } = useLedgerFx()

let mounted = null

const TARGET_ID = 'del-target'
const TARGET_NAME = '待删除的消费'

function record(over = {}) {
  return {
    id: TARGET_ID,
    name: TARGET_NAME,
    amount: 30,
    cat: 'food',
    date: appToday.value,
    time: '12:00',
    direction: 'expense',
    ...over,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expenses.value = [record()]
  budget.value = { monthly: null, updatedAt: '' }
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
})

afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
  expenses.value = []
  budget.value = { monthly: null, updatedAt: '' }
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
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

// Vue 的事件 invoker 有去重守卫（`e._vts <= 挂载时刻` 就跳过），刚挂载的同一毫秒内
// 点击会被跳过，和其它账本 DOM 测试一样等 8ms。
async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  await new Promise((resolveTick) => setTimeout(resolveTick, 8))
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle()
}

const byText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))

/**
 * 列表里当前渲染出来的行。
 * 【注意】行标题是「分类图标 + 名称」（例如 `🍜 待删除的消费`），
 * 所以判定必须用「包含」而不是整串相等——第一版断言就是被这个图标骗过的。
 */
const feedRows = () => [...document.querySelectorAll('.feed-item')]
const feedNames = () => feedRows().map((row) => (row.querySelector('.fi-main b')?.textContent || row.textContent || '').trim())
const feedHasTarget = () => feedNames().some((name) => name.includes(TARGET_NAME))

async function openLedger() {
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, '/bills')
  await settle()
}

describe('删除消费记录：那一行必须当场消失', () => {
  it('详情面板的「删除」：数据没了，列表也不许再显示它', async () => {
    await openLedger()
    expect(feedHasTarget(), '前置条件：列表里本来应该有这一行').toBe(true)

    await click(feedRows()[0])
    expect(await waitFor(() => document.querySelector('.detail-body')), '详情面板没打开').toBeTruthy()
    await click(byText('.detail-actions button', '删除'))

    // 立刻（不重新挂载、不刷新）检查
    expect(expenses.value.some((item) => item.id === TARGET_ID), '数据层没删掉').toBe(false)
    expect(feedHasTarget(), '删除后列表里还留着这一行').toBe(false)
    expect(feedRows()).toHaveLength(0)
  })

  it('左滑的「删除」按钮：同一条路径也要消失', async () => {
    await openLedger()
    expect(feedHasTarget()).toBe(true)

    // 滑动动作按钮渲染在 .swipe-item 里、.feed-item 的兄弟节点上（不是行内）。
    await click(byText('.swipe-action', '删除'))

    expect(expenses.value.some((item) => item.id === TARGET_ID)).toBe(false)
    expect(feedHasTarget(), '左滑删除后列表里还留着这一行').toBe(false)
  })

  it('删除后撤销能把它放回来（撤销本身也要能看见）', async () => {
    await openLedger()
    await click(byText('.swipe-action', '删除'))
    expect(feedHasTarget()).toBe(false)

    await click(byText('.toast button', '撤销'))
    expect(expenses.value.some((item) => item.id === TARGET_ID), '撤销后数据没回来').toBe(true)
    expect(feedHasTarget(), '撤销后列表里没有这一行').toBe(true)
  })
})

describe('新增与删除同一个口径：都不能等刷新', () => {
  it('当场新增的记录必须当场出现（刷新能修好不代表可以晚一拍）', async () => {
    expenses.value = []
    await openLedger()
    expect(feedRows()).toHaveLength(0)

    domain.createTransaction({ name: '当场新增', amount: 12, cat: 'food', date: appToday.value, time: '10:00', direction: 'expense' })

    expect(await waitFor(() => feedNames().some((name) => name.includes('当场新增'))), '新增的记录没立刻出现').toBe(true)
  })

  it('当场新增再当场删除：来回都对', async () => {
    expenses.value = []
    await openLedger()

    const created = domain.createTransaction({ name: '来回了', amount: 12, cat: 'food', date: appToday.value, time: '10:00', direction: 'expense' })
    expect(await waitFor(() => feedNames().some((name) => name.includes('来回了')))).toBe(true)

    domain.deleteTransaction(created.id)
    expect(await waitFor(() => !feedNames().some((name) => name.includes('来回了'))), '删掉之后那一行还在').toBe(true)
  })
})