// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 真实路由会加载到 appUpdate.js，它 import 构建期虚拟模块（见 mountApp.js 的说明）。
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

registerMirrorTeardown()

/**
 * 视图渲染矩阵：每个路由都在**有代表性数据**的前提下真实挂载一次。
 *
 * 【这个文件来自一个真缺陷，不是"以防万一"】
 * `src/views/ExamsView.vue` 的模板写了 `reviewSummary(item)`，而组件里只有
 * `reviewSummaryOf(item, tasks)` —— 脚本里根本没有叫 `reviewSummary` 的标识符。
 * 只要存在**一门「学习」类且尚未过期**的重要日期，渲染那张卡片就抛
 * `TypeError: reviewSummary is not a function`；Vue 的错误边界接住它，列表整块不再渲染，
 * 真机上「重要日期」页只剩一个页头（其余内容全空）。
 *
 * 而这条缺陷躲过了当时全部守卫：
 *   - eslint 不检查模板里的表达式是否存在于 setup 作用域；
 *   - `vue-tsc` 也不行 —— tsconfig 是 `checkJs: false`，JS 写法的 `<script setup>`
 *     模板表达式不参与类型检查（TS2304 的棘轮因此永远看不到它）；
 *   - 201 个测试文件 / 2183 条用例里**没有任何一条**在有数据的情况下渲染过 ExamsView。
 *
 * 【判据】三条同时成立才算通过：
 * 1. 控制台没有 `[GlobalError:`（`app.config.errorHandler` 的前缀，等价于"这一页渲染时抛过"）；
 * 2. `#main-content` 存在、不是加载占位、且有实质文本；
 * 3. **本页应当出现的那条播种数据真的出现在页面上**。
 *    第 3 条不可省：只看 1、2 的话 ExamsView 那个坏法照样是绿的 —— 页头本来就渲染出来了，
 *    "内容非空"完全成立。必须要求"数据真的画出来了"。
 */
const ROUTES = [
  { path: '/', name: '今天', mustInclude: ['本周收支'] },
  { path: '/schedule', name: '课程表', mustInclude: ['高等数学'] },
  { path: '/course', name: '课程进度', mustInclude: ['课程进度', '高等数学', '完成高数第三章作业'] },
  { path: '/tasks', name: '待办', mustInclude: ['完成高数第三章作业'] },
  { path: '/exams', name: '重要日期', mustInclude: ['四六级考试'] },
  { path: '/events', name: '日程', mustInclude: ['小组会议'] },
  { path: '/lists', name: '清单', mustInclude: ['本周采购'] },
  { path: '/bills', name: '账本', mustInclude: ['午饭'] },
  { path: '/review', name: '本周回顾', mustInclude: ['本周回顾'] },
]

function day(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 播种数据。
 *
 * 【形状必须与 domain/commands.js 的 create* 对齐】键名同样要对，账目是 `sl_expenses`
 * （不是 `sl_ledger`）。写错键不会报错，
 * 只会让这一页"什么都没有"，于是第 3 条判据静默失效 —— 那正是假绿。
 */
function seedStorage() {
  const now = new Date().toISOString()
  const set = (key, value) => localStorage.setItem(key, JSON.stringify(value))

  set('sl_tasks', [
    {
      id: 't1', title: '完成高数第三章作业', course: '高等数学', courseId: 'c1',
      dueDate: day(1), dueTime: '23:59', priority: 'high', done: false, status: 'pending',
      createdAt: now, updatedAt: now, note: '', estimateMinutes: 0,
    },
  ])
  // e1 是**「学习」类且未过期** —— 正是触发 reviewSummary 那条模板表达式的形状。
  set('sl_exams', [
    { id: 'e1', name: '四六级考试', date: day(23), category: '学习', repeat: 'none', pinned: true, reviewProgress: 0, createdAt: now, updatedAt: now },
    { id: 'e2', name: '普通话考试', date: day(90), category: '其他', repeat: 'none', pinned: false, reviewProgress: 0, createdAt: now, updatedAt: now },
  ])
  set('sl_events', [
    { id: 'v1', title: '小组会议', date: day(0), time: '19:00', endTime: '20:30', note: '讨论选题', createdAt: now, updatedAt: now },
  ])
  set('sl_checklists', [
    {
      id: 'l1', name: '本周采购', type: 'shopping', createdAt: now, updatedAt: now,
      items: [
        { id: 'i1', name: '牛奶', quantity: 2, unit: '盒', price: 12, category: '食品', note: '', done: false },
      ],
    },
  ])
  set('sl_bills', [
    { id: 'b1', name: '视频会员', amount: 25, category: '会员订阅', cycle: 'monthly', nextDate: day(3), autoRenew: true, active: true, note: '' },
  ])
  set('sl_expenses', [
    {
      id: 'x1', name: '午饭', amount: 32.5, cat: 'food', direction: 'expense',
      date: day(0), time: '12:30', note: '', account: '微信', source: 'manual',
      billId: '', billingPeriodKey: '', createdAt: now, updatedAt: now,
    },
  ])
  set('sl_courses', [
    { id: 'c1', name: '高等数学', teacher: '张老师', room: 'A101', day: (new Date(`${day(0)}T00:00:00Z`).getUTCDay() + 6) % 7, start: 'p0', end: 'p1', startWeek: 1, endWeek: 8, weekType: 'all' },
  ])
}

let originalConsoleError = null
const globalErrors = []

function captureConsoleError() {
  originalConsoleError = console.error
  console.error = (...args) => {
    const message = args.join(' ')
    if (message.includes('[GlobalError:')) globalErrors.push(message)
    originalConsoleError.apply(console, args)
  }
}
function restoreConsoleError() {
  console.error = originalConsoleError
  globalErrors.length = 0
}

/** 真实挂载外壳 + 真实路由，导航到某个路径，返回这一页的三条判据。 */
async function renderRoute(route) {
  vi.resetModules()
  localStorage.clear()
  seedStorage()

  const { mountApp, gotoRoute, settle } = await import('./helpers/mountApp.js')
  const { routes } = await import('../src/router/routes.js')

  const { router, unmount } = await mountApp({ routes, hash: '/' })
  try {
    await gotoRoute({ router }, route.path)
    await settle()

    const main = document.querySelector('#main-content')
    return {
      globalError: globalErrors.length ? globalErrors[0] : '',
      hasFallback: Boolean(main?.querySelector('.route-fallback')),
      text: main?.textContent ?? '',
    }
  } finally {
    unmount()
  }
}

describe('视图渲染矩阵：每个路由在有数据时都能完整渲染', () => {
  beforeEach(() => {
    captureConsoleError()
    localStorage.clear()
  })

  afterEach(() => {
    restoreConsoleError()
    document.querySelectorAll('.test-app-host').forEach((node) => node.remove())
  })

  it('基线：未播种任何数据时首页也能渲染（判据本身不会因为"没数据"而假绿）', async () => {
    vi.resetModules()
    localStorage.clear()
    const { mountApp, settle } = await import('./helpers/mountApp.js')
    const { routes } = await import('../src/router/routes.js')
    const { unmount } = await mountApp({ routes, hash: '/' })
    await settle()
    expect(globalErrors).toEqual([])
    expect(document.querySelector('#main-content')?.textContent.trim().length ?? 0).toBeGreaterThan(0)
    unmount()
  }, 60000)

  for (const route of ROUTES) {
    it(`${route.name}（${route.path}）有数据时渲染完整、不抛渲染错误`, async () => {
      const result = await renderRoute(route)

      expect(result.globalError, `${route.name} 渲染时抛了错：${result.globalError}`).toBe('')
      expect(result.hasFallback, `${route.name} 卡在路由加载占位`).toBe(false)
      expect(result.text.trim().length, `${route.name} 主内容为空`).toBeGreaterThan(0)
      for (const needle of route.mustInclude) {
        expect(result.text, `${route.name} 缺少应当渲染的数据「${needle}」`).toContain(needle)
      }
    }, 60000)
  }
})
