// @vitest-environment happy-dom
/**
 * 分摊口径必须**真的渲染在页面上**（而不是只存在于纯函数里）。
 *
 * 【为什么单开一条】`tests/ledgerSplit.test.js` 只证明 `mySpendCents` /
 * `personalSpendTotals` 算得对；它证明不了页面用了这些结果。实际发生过的 bug：
 * hero-stat 的切换条件写成了 `mySpendPeriodStats.value && …`，
 * 而 `<script setup>` 里的 ref/computed 在模板中**自动解包**，`mySpendPeriodStats.value`
 * 恒为 `undefined` → 条件恒假 → 永远走全额分支：
 * 列表行显示 -¥200.00、今天/本周/本月按 200 计入，用户看到的分摊系统等于没生效。
 *
 * 这里钉住五件用户可见的事（200 元 5 人 → 我承担 40）：
 *   1. hero 三块数字（标签仍是「今天/本周/本月花费」）数值是**我的份额**；
 *   2. 列表行金额是**我的份额**，总额由副标题的「N 人 · 共 ¥200」交代（信息不丢）；
 *   3. 日期头的「支出 ¥40」与列表行同一个口径；
 *   4. 回顾 tab 的合计/分类/最大一笔同样是份额；
 *   5. 导出 CSV 与记录详情里**总额与分担两个口径都在**（用户明确要求）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { expenses } from '../src/composables/ledger.js'
import { useLedgerBudget } from '../src/composables/ledgerBudget.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'
import { appToday } from '../src/composables/timeContext.js'
import { moneyWithCurrency } from '../src/utils/formatters.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const { budget } = useLedgerBudget()
const { fx } = useLedgerFx()

let mounted = null

// 200 元 5 人 → 我承担 40（余数归我，40×5 精确等于 200）。
const SPLIT_TOTAL = 200
const SPLIT_MINE = 40
const SPLIT_PEOPLE = 5
const MONEY_TOTAL = moneyWithCurrency(SPLIT_TOTAL)
const MONEY_MINE = moneyWithCurrency(SPLIT_MINE)

function splitRecord(id = 'split-1') {
  return {
    id,
    name: '日常支出',
    amount: SPLIT_TOTAL,
    cat: 'other',
    date: appToday.value,
    time: '13:49',
    direction: 'expense',
    split: {
      total: SPLIT_TOTAL,
      mine: SPLIT_MINE,
      participants: Array.from({ length: SPLIT_PEOPLE }, (unused, index) => ({
        label: index === 0 ? '我' : `成员 ${index}`,
        amount: SPLIT_TOTAL / SPLIT_PEOPLE,
      })),
    },
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expenses.value = [splitRecord()]
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

// Vue 的事件 invoker 有一条去重守卫（`e._vts <= 挂载时刻` 就跳过），
// 刚挂载的同一毫秒内点击会被跳过，和其它账本 DOM 测试一样等 8ms。
async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  await new Promise((resolveTick) => setTimeout(resolveTick, 8))
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle()
}

const byText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))

/** 打开账本首页（真实路由 + 真实数据流）。 */
async function openLedger(path = '/bills') {
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, path)
  await settle()
}

async function openReview() {
  await openLedger()
  await click(byText('.ledger-tabs button', '回顾'))
  await waitFor(() => document.querySelector('.review-tab'))
}

describe('分摊记录的账本首页：数字按「我承担的份额」显示', () => {
  it('hero 三块数字走分摊口径：标签仍是「花费」，数值是 40 而不是 200', async () => {
    await openLedger()

    const hero = document.querySelector('.hero-stat')
    expect(hero, 'hero-stat 没渲染').toBeTruthy()

    const metrics = [...hero.querySelectorAll('.spend-metric')]
    expect(metrics.length).toBe(3)
    expect(metrics.map((metric) => metric.querySelector('small').textContent))
      .toEqual(['今天花费', '本周花费', '本月花费'])
    for (const metric of metrics) {
      expect(metric.textContent, `「${metric.textContent}」不是我的份额`).toContain(MONEY_MINE)
      expect(metric.textContent).not.toContain(MONEY_TOTAL)
    }
    // 口径必须写在脸上：否则用户会以为这个 40 是全家总额。
    expect(hero.querySelector('.split-note').textContent).toContain('分摊')
    expect(hero.querySelector('.split-note').textContent).toContain('我承担')
  })

  it('列表行金额是我的份额，总额与人数改由副标题交代（两个数字都在）', async () => {
    await openLedger()

    const item = document.querySelector('.feed-item')
    expect(item, '列表行没渲染').toBeTruthy()

    const amount = item.querySelector('.fi-amount')
    expect(amount.textContent).toContain(`-${MONEY_MINE}`)
    expect(amount.textContent).not.toContain(MONEY_TOTAL)

    const secondary = item.querySelector('.fi-main small')
    expect(secondary.textContent).toContain('已分摊')
    expect(secondary.textContent).toContain(`${SPLIT_PEOPLE} 人`)
    expect(secondary.textContent, '总额不能因为改成份额口径就消失').toContain(MONEY_TOTAL)
  })

  it('日期头的当日支出与列表行同一口径（否则同一天两个数字互相矛盾）', async () => {
    await openLedger()

    const dayHead = document.querySelector('.feed-day')
    expect(dayHead, '日期头没渲染').toBeTruthy()
    expect(dayHead.textContent).toContain(`支出 ${MONEY_MINE}`)
    expect(dayHead.textContent).not.toContain(MONEY_TOTAL)
  })

  it('本月分类条也是份额（同一屏不能出现「本月花费 40 / 其它 200」）', async () => {
    await openLedger()

    const block = document.querySelector('.category-block')
    expect(block, '本月分类块没渲染').toBeTruthy()
    expect(block.textContent).toContain(MONEY_MINE)
    expect(block.textContent).not.toContain(MONEY_TOTAL)
  })
})

describe('分摊记录的回顾 tab：合计 / 分类 / 最大一笔都是份额', () => {
  it('整月合计与分类按我的份额算，并写明口径', async () => {
    await openReview()

    const summary = document.querySelector('.review-summary')
    expect(summary, '回顾合计卡没渲染').toBeTruthy()
    expect(summary.querySelector('.rs-top b').textContent).toContain(MONEY_MINE)
    expect(summary.textContent).not.toContain(MONEY_TOTAL)
    expect(summary.textContent).toContain('我承担')

    const cats = document.querySelector('.review-cats')
    expect(cats.textContent).toContain(MONEY_MINE)
    expect(cats.textContent).not.toContain(MONEY_TOTAL)
  })
})

describe('用户明确要求：导出与详情里总额、分担两个口径都在', () => {
  it('导出的 CSV 同时有「金额」（总额）与「我承担」两列', async () => {
    await openReview()

    const blobs = []
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test' }
    URL.revokeObjectURL = () => {}
    const clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await click(byText('button', '导出 CSV'))
    } finally {
      URL.createObjectURL = realCreate
      URL.revokeObjectURL = realRevoke
      clickSpy.mockRestore()
    }

    expect(blobs, '没有生成导出文件').toHaveLength(1)
    const csv = (await blobs[0].text()).replace(/^\uFEFF/, '')
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('日期,时间,名称,分类,收支,金额,我承担,币种,账户,备注')
    const row = lines.find((line) => line.includes('日常支出'))
    expect(row, '缺这条分摊记录').toBeTruthy()
    // 金额列 = 这一笔的总额，我承担列 = 我的份额，两个都在。
    expect(row).toContain(`,${SPLIT_TOTAL},${SPLIT_MINE},`)
  })

  it('记录详情：大数字是这一笔的总额，副标题写明人数与我的份额', async () => {
    await openLedger()

    await click(document.querySelector('.feed-item'))
    const detail = await waitFor(() => document.querySelector('.detail-body'))
    expect(detail, '详情面板没打开').toBeTruthy()

    expect(detail.querySelector('.detail-amount').textContent).toContain(`-${MONEY_TOTAL}`)
    expect(detail.querySelector('.detail-meta').textContent).toContain(`我承担 ${MONEY_MINE}`)
    expect(detail.querySelector('.detail-meta').textContent).toContain(`${SPLIT_PEOPLE} 人`)
  })
})