// @vitest-environment happy-dom
/**
 * PlacesView 长列表虚拟化专项守卫。
 *
 * 【守什么】
 *   1. 「我的地点」（单列卡片）超过阈值后只渲染视口窗口内的卡片：本机地点是无上限的，
 *      每张卡片都带评分、事实表、到访明细和六个操作按钮，几百条一起进 DOM 会明显卡顿；
 *   2. 「发现」是两列网格（服务端最多 200 条），同样交给 VirtualList —— 虚拟列表的一项
 *      对应网格的一整行（两两分组 + `.discover-row` 真实行元素），窗口外的卡片不在 DOM 里；
 *   3. 少于阈值时整份渲染（`data-virtual="off"`），没有地点时仍走既有空态分支，
 *      既有 DOM 断言与少量项行为不受影响；
 *   4. `route.query.focus` 指向的目标项仍能被 reveal 定位：虚拟化不能把深链定位吃掉；
 *   5. 键盘与 aria 约定不变：分类页签仍暴露 aria-pressed，Escape 仍关闭到访表单。
 *
 * 【为什么必须真挂载】阈值、窗口计算、reveal 都是运行期行为，源码级断言证明不了
 * 「窗口外的卡片确实不在 DOM 里」。挂载方式沿用 tests/checklistsInteractions.test.js。
 *
 * 【金额口径】卡片里的金额一律走 `moneyRow`；本文件用 12.5 这种不会触发千分位的值，
 * 避免不同 ICU 区域下的分组符号差异把守卫变成脆弱断言。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeOffers, placeVisits, places } from '../src/composables/placeBook.js'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

// 服务端「同校地点」由测试驱动：只关心它喂给页面多少条。
const campusPlaces = vi.hoisted(() => ({ items: [] }))
vi.mock('../src/services/social.js', () => ({
  socialRequest: vi.fn(async () => ({})),
  listCampusPlaces: vi.fn(async () => ({ places: campusPlaces.items })),
  listCampusPlaceInvites: vi.fn(async () => ({ incoming: [], outgoing: [] })),
  publishCampusPlace: vi.fn(async () => ({})),
  deleteCampusPlace: vi.fn(async () => ({})),
  deleteCampusPlaceRating: vi.fn(async () => ({})),
  saveCampusPlaceRating: vi.fn(async () => ({})),
  reportCampusPlace: vi.fn(async () => ({})),
  sendCampusPlaceInvite: vi.fn(async () => ({})),
  acceptCampusPlaceInvite: vi.fn(async () => ({})),
  completeCampusPlaceInvite: vi.fn(async () => ({})),
  rejectCampusPlaceInvite: vi.fn(async () => ({})),
  cancelCampusPlaceInvite: vi.fn(async () => ({})),
}))

const { default: PlacesView } = await import('../src/views/PlacesView.vue')

let app = null
let host = null
let scrollDescriptor = null

beforeEach(() => {
  places.value = []
  placeVisits.value = []
  placeOffers.value = []
  campusPlaces.items = []
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  document.body.innerHTML = ''
  clearAnnouncement()
  if (scrollDescriptor) Object.defineProperty(window, 'scrollTo', scrollDescriptor)
  else delete window.scrollTo
  scrollDescriptor = null
  vi.restoreAllMocks()
  app = null
  host = null
})

async function settle() {
  await nextTick()
  await new Promise((done) => setTimeout(done, 0))
  await new Promise((done) => requestAnimationFrame(() => done()))
  await nextTick()
}

async function boot(query = 'section=mine') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/campus/places', component: PlacesView }, { path: '/campus', component: { template: '<div />' } }],
  })
  await router.push(`/campus/places?${query}`)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(RouterView) })
  app.use(router).mount(host)
  await settle()
}

function placeOf(index, extra = {}) {
  return {
    id: `place-${index}`,
    name: `虚构地点 ${index}`,
    campus: '虚构大学东区',
    area: '第一食堂',
    placeHint: '二楼东侧',
    type: 'restaurant',
    category: 'food',
    scores: { value: 'mixed' },
    description: '',
    openingHours: '',
    serviceInfo: '',
    publicContact: '',
    sourceInfo: '',
    note: '',
    visibility: 'private',
    reviewStatus: 'not_submitted',
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }
}

/** 替换 window.scrollTo 并返回 spy；reveal 的定位结果只在这里可见。 */
function stubScrollTo() {
  scrollDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollTo')
  const scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
  return scrollTo
}

const cards = () => host.querySelectorAll('.personal-place-card')
const discoverCards = () => host.querySelectorAll('.discover-card')
const virtualState = (selector) => host.querySelector(selector)?.getAttribute('data-virtual')

describe('PlacesView 虚拟列表', () => {
  it('「我的地点」超过阈值后只渲染窗口内的卡片', async () => {
    places.value = Array.from({ length: 300 }, (_, index) => placeOf(index))
    await boot('section=mine')

    expect(virtualState('.place-cards'), '长列表应进入虚拟模式').toBe('on')
    const rendered = cards().length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered, '窗口外仍有卡片被渲染').toBeLessThan(60)
    // 窗口初始在顶部：排在第 300 位的地点不该出现在 DOM 里。
    expect(host.textContent).not.toContain('虚构地点 299')
    expect(host.textContent).toContain('虚构地点 0')
  })

  it('「我的地点」少于阈值时整份渲染，空态仍走既有分支', async () => {
    places.value = Array.from({ length: 6 }, (_, index) => placeOf(index))
    await boot('section=mine')

    expect(virtualState('.place-cards')).toBe('off')
    expect(cards()).toHaveLength(6)

    places.value = []
    await settle()
    expect(host.querySelector('.place-cards')).toBeNull()
    expect(host.querySelector('.place-empty')?.textContent).toContain('先收下一处想去的地点')
  })

  it('「发现」按两列一行分组虚拟化，只渲染窗口内的整行', async () => {
    campusPlaces.items = Array.from({ length: 300 }, (_, index) => placeOf(index, { id: `shared-${index}`, name: `同校地点 ${index}` }))
    await boot('section=discover')

    expect(virtualState('.discover-grid'), '长列表应进入虚拟模式').toBe('on')
    const rows = host.querySelectorAll('.discover-row').length
    expect(rows).toBeGreaterThan(0)
    expect(rows, '窗口外仍有网格行被渲染').toBeLessThan(40)
    // 一项 = 一整行 = 两张卡片：网格的两列不被拆散。
    expect(discoverCards()).toHaveLength(rows * 2)
    expect(host.textContent).not.toContain('同校地点 299')
  })

  it('「发现」少量地点时整份渲染，末行单张卡片仍按网格落位', async () => {
    campusPlaces.items = Array.from({ length: 7 }, (_, index) => placeOf(index, { id: `shared-${index}`, name: `同校地点 ${index}` }))
    await boot('section=discover')

    expect(virtualState('.discover-grid')).toBe('off')
    expect(host.querySelectorAll('.discover-row')).toHaveLength(4)
    expect(discoverCards()).toHaveLength(7)
  })

  it('route.query.focus 指向的地点仍能 reveal 定位（数据后到时也能定位）', async () => {
    const scrollTo = stubScrollTo()
    places.value = [placeOf(0)]
    await boot('section=mine&focus=place-280')

    // 真实场景里本机地点可能晚于首帧到达；长度变化会触发 VirtualList 的定位。
    places.value = Array.from({ length: 300 }, (_, index) => placeOf(index))
    await settle()

    expect(virtualState('.place-cards')).toBe('on')
    expect(scrollTo, '未触发滚动定位').toHaveBeenCalled()
    expect(scrollTo.mock.calls.at(-1)[0].top).toBeGreaterThan(0)
  })

  it('少量地点时 reveal 仍然定位（阈值不能把短列表的深链定位吃掉）', async () => {
    const scrollTo = stubScrollTo()
    places.value = [placeOf(0)]
    await boot('section=mine&focus=place-5')

    places.value = Array.from({ length: 6 }, (_, index) => placeOf(index))
    await settle()

    expect(virtualState('.place-cards')).toBe('off')
    expect(cards()).toHaveLength(6)
    expect(scrollTo).toHaveBeenCalled()
    expect(scrollTo.mock.calls.at(-1)[0].top).toBeGreaterThan(0)
  })

  it('两列网格的排版契约由 .discover-row 承担（外层必须是一列行容器）', () => {
    // 「一项 = 一整行」是这套虚拟化的前提：如果外层改回两列、或行内丢掉两列，
    // 滚动窗口的行高与真实 DOM 会错位，且不会有任何断言报错。这里把契约钉在样式上。
    const css = readFileSync(resolve(import.meta.dirname, '..', 'src', 'views', 'places.css'), 'utf8')
    const outer = /\.discover-grid\{([^}]*)\}/.exec(css)?.[1] || ''
    const row = /\.discover-row\{([^}]*)\}/.exec(css)?.[1] || ''
    expect(outer, '外层网格不能自己排两列').not.toContain('grid-template-columns')
    expect(row, '行内仍按两列排').toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(css, '窄屏行内折成一列').toMatch(/@media\(max-width:760px\)\{\.discover-row\{grid-template-columns:1fr\}/)
    expect(css, '单列卡片容器仍由 .place-cards 提供间距').toMatch(/\.place-cards\{display:grid;gap:10px\}/)
  })

  it('键盘与 aria 约定不变：页签 aria-pressed 与 Escape 关闭到访表单', async () => {
    places.value = [placeOf(0)]
    await boot('section=mine')

    const tab = [...host.querySelectorAll('.place-tabs button')].find((button) => button.textContent.trim() === '我的地点')
    expect(tab.getAttribute('aria-pressed')).toBe('true')

    const record = [...host.querySelectorAll('.personal-place-card button')].find((button) => button.textContent.trim() === '记录已到访')
    record.click()
    await settle()
    expect(host.querySelector('.visit-sheet'), '到访表单未打开').not.toBeNull()
    // 拆开超长单行模板后，评分区必须仍然是表单的一部分。
    expect(host.querySelector('.visit-sheet .score-grid')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(host.querySelector('.visit-sheet')).toBeNull()
  })

  it('卡片金额统一走 moneyRow（到访明细与累计口径一致）', async () => {
    places.value = [placeOf(0)]
    placeVisits.value = [{ id: 'visit-0', placeId: 'place-0', visitedAt: '2026-10-02', price: 12.5, scores: { value: 'worth' }, transactionId: '', note: '' }]
    await boot('section=mine')

    expect(host.querySelector('.place-stats').textContent).toContain('累计 ¥12.50 · 到访均价 ¥12.50')
    expect([...host.querySelectorAll('.place-visit-row span')].map((node) => node.textContent).join(' ')).toContain('¥12.50')
  })
})