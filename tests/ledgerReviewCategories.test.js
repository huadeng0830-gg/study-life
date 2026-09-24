// @vitest-environment happy-dom
/**
 * 回顾页「分类分布」必须能把钱看到底（本轮新增的 DOM 回归）。
 *
 * 【为什么单开一条】改造前的分类分布有两个**只在页面上才看得见**的墙：
 *   1. `categoryTotals.slice(0, 5)` —— 第 6 名以后的分类在页面上完全不存在。
 *      纯函数一直算得对（categoryTotals 里 7 条都在），用户却永远看不到
 *      「医疗花了多少」：它只被算进了上方那个整月合计里。
 *   2. 每一行都是 span + 进度条，没有任何入口能看到「这个分类花在哪几笔上」。
 *      当时唯一的办法是去下面的月历里一天天翻。
 *
 * 所以这里钉住的正是上面两件事，以及它们必须与整块回顾同一口径
 * （分类合计、行内金额都是「我承担」的份额，见 tests/ledgerSplitDisplay.test.js）：
 *   1. 第 6 名以后的分类通过「展开其余 N 个分类」能看到金额，且能收回去；
 *   2. 点分类行展开该分类当月的每一笔，点明细行打开那一笔的详情；
 *   3. 分类行的金额与明细行金额都是份额（分摊记录金额 2000 时显示 400）；
 *   4. 概览卡的「花得最多 / 最大一笔」是直达入口，不再是死数字；
 *   5. 首页「本月分类」的一行能直接跳到回顾页并展开该分类的明细；
 *   6. 换月收起下钻（否则上个月展开的分类会「传染」到下个月）。
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

/** 本月记录：7 个分类，我承担的金额从 730 递减到 100（前 5 名与其后 2 名都在断言里点名）。 */
const THIS_MONTH = [
  { cat: 'food', name: '午饭', amount: 700 },
  { cat: 'food', name: '食堂', amount: 30 },
  { cat: 'drink', name: '咖啡', amount: 600 },
  { cat: 'transit', name: '地铁', amount: 500 },
  // 分摊：总额 2000、5 人 → 我承担 400。分类分布里必须只出现 400。
  { cat: 'study', name: '教材', amount: 2000, splitMine: 400 },
  { cat: 'shop', name: '衣服', amount: 300 },
  { cat: 'fun', name: '电影', amount: 200 },
  { cat: 'health', name: '药品', amount: 100 },
]

const splitOf = (mine, total) => ({
  total,
  mine,
  participants: [
    { label: '我', amount: mine },
    { label: '成员 1', amount: total - mine },
  ],
})

/** 上个月第一天：用来验证「换月收起下钻」。 */
function previousMonthDate() {
  const [year, month] = appToday.value.slice(0, 7).split('-').map(Number)
  const date = new Date(year, month - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function monthRecords() {
  const list = THIS_MONTH.map((entry, index) => ({
    id: `rc-${entry.cat}-${index}`,
    name: entry.name,
    amount: entry.amount,
    cat: entry.cat,
    date: appToday.value,
    time: `${String(8 + index).padStart(2, '0')}:00`,
  }))
  const splitEntry = list.find((item) => item.name === '教材')
  splitEntry.split = splitOf(400, 2000)
  // 同一个月里同名分类的历史记录：验证换月时展开状态必须被收起。
  list.push({ id: 'rc-prev-food', name: '上月午饭', amount: 80, cat: 'food', date: previousMonthDate(), time: '12:00' })
  return list
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expenses.value = monthRecords()
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
// 刚挂载的同一毫秒内点击会被跳过，所以和其它账本 DOM 测试一样等 8ms 再点。
async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  await new Promise((resolveTick) => setTimeout(resolveTick, 8))
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle()
}

const byText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))
const catRows = () => [...document.querySelectorAll('.review-cats .cat-bar-row')]
const catRowNames = () => catRows().map((row) => row.querySelector('.cb-label').textContent.trim())
const catRow = (name) => catRows().find((row) => row.querySelector('.cb-label').textContent.includes(name))
const detailRows = () => [...document.querySelectorAll('.review-cats .rc-detail-row')]
const reviewText = () => (document.querySelector('.review-cats')?.textContent || '').replace(/\s+/g, ' ')

/** 打开账本首页（真实路由 + 真实数据流）。 */
async function openLedger() {
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, '/bills')
  await settle()
}

async function openReview() {
  await openLedger()
  await click(byText('.ledger-tabs button', '回顾'))
  await waitFor(() => document.querySelector('.review-cats'))
}

describe('回顾「分类分布」：第 6 名以后的分类不再是隐形的', () => {
  it('默认只列前 5 名，但给出「展开其余 N 个分类」，展开后每个分类的金额都在', async () => {
    await openReview()

    expect(catRowNames()).toHaveLength(5)
    expect(reviewText(), '收起时不该出现第 6 名的金额').not.toContain(moneyWithCurrency(200))

    const expand = byText('.review-cats button', '展开其余')
    expect(expand, '没有「展开其余」入口，第 6 名以后又变成隐形的了').toBeTruthy()
    expect(expand.textContent, '入口必须说清还有几个分类').toContain('2 个分类')
    await click(expand)

    expect(catRowNames()).toHaveLength(7)
    expect(catRow('娱乐'), '展开后仍看不到第 6 名的分类').toBeTruthy()
    expect(reviewText()).toContain(moneyWithCurrency(200))
    expect(reviewText()).toContain(moneyWithCurrency(100))
    // 分类合计 = 份额之和 2830，且这一块的口径合计与整月合计一致
    expect(document.querySelector('.review-cats .rc-sum').textContent).toContain(moneyWithCurrency(2830))

    await click(byText('.review-cats button', '只显示前'))
    expect(catRowNames()).toHaveLength(5)
  })
})

describe('回顾「分类分布」：点分类能看到钱花在哪几笔上', () => {
  it('点分类行展开当月每一笔，再点明细行打开那一笔的详情', async () => {
    await openReview()

    const food = catRow('餐饮')
    expect(food.getAttribute('aria-expanded'), '默认必须是收起的（否则整页会被明细撑爆）').toBe('false')
    expect(detailRows()).toHaveLength(0)

    await click(food)
    expect(catRow('餐饮').getAttribute('aria-expanded')).toBe('true')
    // 分类内按金额倒序：点开就是想看钱花在哪几笔上，最大的那笔在最前
    expect(detailRows().map((row) => row.querySelector('.rd-name').textContent)).toEqual(['午饭', '食堂'])
    expect(detailRows()[0].textContent).toContain(moneyWithCurrency(700))
    expect(detailRows()[1].textContent).toContain(moneyWithCurrency(30))
    expect(document.querySelector('.review-cats .rc-detail-foot').textContent).toContain('共 2 笔')

    // 点明细行 = 打开那一笔的详情（与首页列表、月历明细同一个出口）
    await click(detailRows()[0])
    const detail = await waitFor(() => document.querySelector('.detail-body'))
    expect(detail, '明细行没能打开记录详情').toBeTruthy()
    expect(detail.querySelector('.detail-amount').textContent).toContain(moneyWithCurrency(700))

    // 再点同一个分类是收起，不是重复展开
    await click(catRow('餐饮'))
    expect(catRow('餐饮').getAttribute('aria-expanded')).toBe('false')
    expect(detailRows()).toHaveLength(0)
  })

  it('分类行与明细行的金额都是「我承担」的份额，不是这一笔的总额', async () => {
    await openReview()

    const study = catRow('学习')
    expect(study.textContent, '分类行的金额必须是份额 400').toContain(moneyWithCurrency(400))
    await click(study)

    expect(detailRows()).toHaveLength(1)
    expect(detailRows()[0].textContent).toContain(moneyWithCurrency(400))
    // 总额 2000 只该出现在记录详情/导出里，不能混进回顾这一屏的口径
    expect(reviewText(), '分摊记录的总额混进了分类分布的口径').not.toContain(moneyWithCurrency(2000))
  })

  it('分类行同时交代占比与笔数（只给一根进度条等于没给数字）', async () => {
    await openReview()
    const food = catRow('餐饮')
    const meta = food.querySelector('.cb-meta').textContent
    expect(meta).toContain('2 笔')
    expect(meta).toMatch(/\d+%/)
    expect(food.getAttribute('aria-label'), '读屏用户也要能听到金额、笔数与占比').toContain(moneyWithCurrency(730))
    expect(food.getAttribute('aria-label')).toContain('2 笔')
  })
})

describe('回顾概览卡：从「花得最多 / 最大一笔」直达明细', () => {
  it('点「花得最多」展开下方那个分类的明细', async () => {
    await openReview()

    const top = byText('.review-summary button', '花得最多')
    expect(top, '「花得最多」应该是可点的入口').toBeTruthy()
    expect(top.textContent).toContain(moneyWithCurrency(730))

    await click(top)
    expect(catRow('餐饮').getAttribute('aria-expanded')).toBe('true')
    expect(detailRows().map((row) => row.querySelector('.rd-name').textContent)).toEqual(['午饭', '食堂'])
  })

  it('点「最大一笔」直接打开那一笔的详情', async () => {
    await openReview()

    const max = byText('.review-summary button', '最大一笔')
    expect(max, '「最大一笔」应该是可点的入口').toBeTruthy()
    await click(max)

    const detail = await waitFor(() => document.querySelector('.detail-body'))
    expect(detail, '「最大一笔」没能打开记录详情').toBeTruthy()
    expect(detail.querySelector('.detail-amount').textContent).toContain(moneyWithCurrency(700))
  })
})

describe('首页「本月分类」：一行就是到回顾明细的入口', () => {
  it('点分类跳到回顾页并展开该分类；卡片同时说明还有几个分类没显示', async () => {
    await openLedger()

    const block = document.querySelector('.category-block')
    expect(block, '本月分类块没渲染').toBeTruthy()
    expect(block.querySelector('.cat-more-note').textContent, '没告诉用户还有分类没显示').toContain('2 个分类')

    await click(byText('.category-block .cat-bar-link', '餐饮'))
    await waitFor(() => document.querySelector('.review-cats'))

    expect(document.querySelector('#ledger-tab-review').getAttribute('aria-selected')).toBe('true')
    expect(catRow('餐饮').getAttribute('aria-expanded')).toBe('true')
    expect(detailRows().map((row) => row.querySelector('.rd-name').textContent)).toEqual(['午饭', '食堂'])
  })
})

describe('回顾「分类分布」：换月收起下钻', () => {
  it('翻到上个月时，上个月展开的分类不会带着展开状态出现', async () => {
    await openReview()

    await click(catRow('餐饮'))
    expect(detailRows().length, '当前月没展开').toBeGreaterThan(0)

    await click(document.querySelector('button[aria-label="上一个月"]'))
    await waitFor(() => document.querySelector('.review-cats'))

    // 上个月只有一条「上月午饭」，且必须是收起的
    expect(catRows()).toHaveLength(1)
    expect(catRows()[0].getAttribute('aria-expanded'), '换月后展开状态被带到了上个月').toBe('false')
    expect(detailRows()).toHaveLength(0)
  })
})