// @vitest-environment happy-dom
/**
 * 全局搜索增强：功能 34（专注记录进搜索）与功能 32（按类型筛选 + 相关度排序）。
 *
 * 【为什么要拆成"纯函数 + 渲染级"两层】改造前这两样都藏在 `SearchPanel.vue` 的局部
 * `matches` 与一句 `slice(0, 6)` 里：只能靠渲染后读 DOM 反推，于是两处最容易写反的
 * 地方——"先截后排"与"筛完之后数据没变、只是 UI 变了"——会跟着测试一起绿。
 * 现在排序口径在 `src/composables/searchRelevance.js` 里是可导出的纯函数，
 * 这一层直接断言口径；渲染级只负责证明"筛选真的换了数据"。
 *
 * 【存储键隔离的由来】`useStoredRef` 在**模块级**缓存 ref，所以每个用例都要
 * `vi.resetModules()` 再动态 import —— 否则上一条用例播种的数据会被下一条读到。
 * 同理，`createApp` / `createRouter` / `settle` 里的 `nextTick` 全部取自同一次
 * 动态 import：混用重置前的 `vue` 实例，flush 的就不是这一棵组件树了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MATCH_RANKS,
  focusSearchDate,
  focusSearchMeta,
  focusSearchTitle,
  matchRank,
  matchesText,
  pickHits,
  rankCandidates,
} from '../src/composables/searchRelevance.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// 输入框有 160ms 防抖（useDebouncedRef），比它多等一点再断言，避免"还没算完就查 DOM"。
const AFTER_TYPING = 280

/** 轮询到条件成立。router.push 是异步的，两帧 settle 不足以等它落地。 */
async function waitFor(check, timeout = 1500) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return true
    await sleep(10)
  }
  return check()
}

/* ==================== ① 纯函数：口径本身 ==================== */

describe('命中判定的语义一字未改（大小写不敏感 includes）', () => {
  it('大小写不敏感、null/undefined 当空串', () => {
    expect(matchesText('abc', 'xxABCxx')).toBe(true)
    expect(matchesText('abc', 'xxabcxx')).toBe(true)
    expect(matchesText('ABC', 'xxabcxx')).toBe(true)
    expect(matchesText('abc', null, undefined, 'abc')).toBe(true)
    expect(matchesText('abc', '', 'abd')).toBe(false)
  })

  it('空关键词一律不命中（纯函数自洽，不靠调用方提前返回）', () => {
    // 这条是**新加**的防御：原来的局部 matches 在空关键词下会返回 true（includes('')），
    // 只靠面板那句 `if (!text) return []` 挡着。
    expect(matchesText('', '任何东西')).toBe(false)
    expect(rankCandidates([{ title: '任何东西' }], '')).toEqual([])
  })

  it('判别力自证：搜一个不存在的词就是零命中（不是"都命中"）', () => {
    expect(matchesText('xyzzy', '高数习题第 3 章', '顺带把高数作业写了')).toBe(false)
    expect(rankCandidates([
      { title: '高数习题第 3 章', contents: ['顺带把高数作业写了'] },
      { title: '复习高数', contents: [''] },
    ], 'xyzzy')).toEqual([])
  })
})

describe('相关度等级：完全 > 前缀 > 标题包含 > 内容包含', () => {
  it('四级依次落在 MATCH_RANKS 上，且不命中是最后一级', () => {
    expect(matchRank('高数', [], '高数')).toBe(MATCH_RANKS.EXACT)
    expect(matchRank('高数习题第 3 章', [], '高数')).toBe(MATCH_RANKS.PREFIX)
    expect(matchRank('复习高数', [], '高数')).toBe(MATCH_RANKS.TITLE)
    expect(matchRank('周计划', ['顺带把高数作业写了'], '高数')).toBe(MATCH_RANKS.CONTENT)
    expect(matchRank('周计划', ['顺带把高数作业写了'], 'xyzzy')).toBe(MATCH_RANKS.NONE)
  })

  it('标题首尾的残留空格不该把「完全匹配」降级', () => {
    expect(matchRank('  高数  ', [], '高数')).toBe(MATCH_RANKS.EXACT)
  })

  it('只认 ISO 开头的时间戳（Date.parse("25") 会被当成 2025 年）', () => {
    // "25" 这种字段一旦被当成时间戳，"同级按更新时间倒序"就会悄悄失真。
    const ranked = rankCandidates([
      { title: '高数B', updatedAt: '25' },
      { title: '高数C', updatedAt: '2026-10-07T00:00:00.000Z' },
    ], '高数')
    expect(ranked.map((row) => row.title)).toEqual(['高数C', '高数B'])
  })
})

describe('排序：等级优先，其次更新时间倒序，最后原顺序（稳定）', () => {
  const candidates = [
    // 故意让"最新的"排在最后，用来证明等级压过时间：
    // 只按时间排的话"周计划"会跑到第一条。
    { id: 'title', title: '复习高数', updatedAt: '2026-10-04T10:00:00.000Z' },
    { id: 'content', title: '周计划', contents: ['顺带把高数作业写了'], updatedAt: '2026-10-06T10:00:00.000Z' },
    { id: 'exact', title: '高数', updatedAt: '2026-10-01T10:00:00.000Z' },
    { id: 'prefixOld', title: '高数习题第 3 章', updatedAt: '2026-10-02T10:00:00.000Z' },
    { id: 'prefixNew', title: '高数B', updatedAt: '2026-10-03T10:00:00.000Z' },
    { id: 'prefixNewest', title: '高数C', updatedAt: '2026-10-07T10:00:00.000Z' },
  ]

  it('等级 → 时间倒序 → 原下标', () => {
    expect(rankCandidates(candidates, '高数').map((row) => row.id))
      .toEqual(['exact', 'prefixNewest', 'prefixNew', 'prefixOld', 'title', 'content'])
  })

  it('等级与时间都相同就按原顺序（不随引擎 sort 抖动）', () => {
    const same = [
      { id: 'a', title: '高数甲' },
      { id: 'b', title: '高数乙' },
    ]
    expect(rankCandidates(same, '高数').map((row) => row.id)).toEqual(['a', 'b'])
    expect(rankCandidates([...same].reverse(), '高数').map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('没有 updatedAt 的记录（清单条目）算同级，按原顺序排，不被甩到最后', () => {
    const rows = [
      { id: 'noTime', title: '高数卡片' },
      { id: 'timed', title: '高数便签', updatedAt: '2026-10-08T00:00:00.000Z' },
    ]
    expect(rankCandidates(rows, '高数').map((row) => row.id)).toEqual(['timed', 'noTime'])
  })
})

describe('先排后截：pickHits 的不变式', () => {
  const many = (count, prefix) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    title: `高数练习${index}`,
    updatedAt: '2026-10-01T00:00:00.000Z',
  }))

  it('完全匹配落在数组末尾也必须活下来（先截后排会把它切掉）', () => {
    const candidates = [...many(8, 'noise'), { id: 'gem', title: '高数', updatedAt: '2026-10-01T00:00:00.000Z' }]
    const { items, hitCount } = pickHits(candidates, '高数', 6)
    expect(hitCount, 'hitCount 是截断前的命中数——芯片上的计数靠它').toBe(9)
    expect(items).toHaveLength(6)
    expect(items[0].id, '高相关度的结果被挤出可视区了').toBe('gem')
  })

  it('limit 缺省或非正数时返回全部命中，不静默变成零结果', () => {
    expect(pickHits(many(3, 'x'), '高数').items).toHaveLength(3)
    expect(pickHits(many(3, 'x'), '高数', 0).items).toHaveLength(3)
  })
})

describe('专注记录（功能 34）：标题回落与日期', () => {
  it('自由专注的 title 是空串，回落到类型标签——而且必须能搜到', () => {
    expect(focusSearchTitle({ focusType: 'free', title: '' })).toBe('自由专注')
    expect(matchRank(focusSearchTitle({ focusType: 'free', title: '' }), [], '自由'))
      .toBe(MATCH_RANKS.PREFIX)
    expect(matchRank(focusSearchTitle({ focusType: 'free', title: '' }), [], '自由专注'))
      .toBe(MATCH_RANKS.EXACT)
    expect(focusSearchTitle({ focusType: 'temporary', title: '  高数习题 ' })).toBe('高数习题')
    expect(focusSearchTitle({ focusType: 'todo-linked', title: '' })).toBe('关联待办')
    expect(focusSearchTitle({})).toBe('自由专注')
  })

  it('日期只切出 YYYY-MM-DD，读不出 ISO 就当没有', () => {
    expect(focusSearchDate({ startedAt: '2026-10-05T09:25:31.000Z' })).toBe('2026-10-05')
    expect(focusSearchDate({ startedAt: '不是日期' })).toBe('')
    expect(focusSearchDate({})).toBe('')
  })

  it('副信息是「日期 · 时长」；没实际时长时退回计划时长', () => {
    expect(focusSearchMeta({ startedAt: '2026-10-05T09:00:00.000Z', actualFocusSeconds: 1500 })).toBe('2026-10-05 · 25分钟')
    expect(focusSearchMeta({ startedAt: '2026-10-05T09:00:00.000Z', actualFocusSeconds: 0, plannedMinutes: 15 })).toBe('2026-10-05 · 15分钟')
  })
})

/* ==================== ② 渲染级：筛选真的换了数据 ==================== */

const PANEL_ROUTES = [
  { path: '/', name: 'home', component: { template: '<div>首页</div>' } },
  { path: '/tasks', name: 'tasks', component: { template: '<div>待办</div>' } },
  { path: '/:pathMatch(.*)*', name: 'fallback', component: { template: '<div>兜底</div>' } },
]

let mounted = null
let warnings = []

beforeEach(() => {
  warnings = []
  vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args.join(' ')) })
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

const EMPTY_SEED = {
  sl_tasks: [],
  sl_events: [],
  sl_quick_notes: [],
  sl_exams: [],
  sl_bills: [],
  sl_expenses: [],
  sl_courses: [],
  sl_checklists: [],
  sl_focus_sessions: [],
}

/**
 * 播种 → 重置模块 → 动态 import → 挂载。
 *
 * `vi.resetModules()` 必须在播种**之前**：`useStoredRef` 是模块级缓存，
 * 不重置就会拿到上一条用例留下的 ref。
 */
async function mountPanel(seed = {}) {
  vi.resetModules()
  localStorage.clear()
  for (const [key, value] of Object.entries({ ...EMPTY_SEED, ...seed })) {
    localStorage.setItem(key, JSON.stringify(value))
  }

  const { createApp, h, nextTick, ref } = await import('vue')
  const { createRouter, createMemoryHistory } = await import('vue-router')
  const { default: SearchPanel } = await import('../src/components/SearchPanel.vue')

  const router = createRouter({ history: createMemoryHistory(), routes: PANEL_ROUTES })
  const open = ref(true)
  const closed = { count: 0 }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({
    render: () => h(SearchPanel, {
      open: open.value,
      onClose: () => { closed.count += 1; open.value = false },
    }),
  })
  // ⚠ `app.use(router)` 必须在 `await router.isReady()` **之前**：vue-router 的初始导航
  // 是在 install 时发起的，isReady() 等的正是它。只 create 不 install，isReady() 永不落地。
  app.use(router)
  await router.isReady()
  app.mount(host)

  const settle = async () => {
    await nextTick()
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    await nextTick()
  }
  await settle()
  mounted = { app, host, unmount: () => { app.unmount(); host.remove() } }
  return { router, open, closed, settle }
}

async function typeSearch(value, settle) {
  const input = document.querySelector('.search-panel input[type="search"]')
  expect(input, '搜索框没渲染出来').not.toBeNull()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  await sleep(AFTER_TYPING)
  await settle()
}

/** 分组标题（去掉图标与末尾计数）：['✅ 待办', '📅 课程'] → ['待办', '课程'] */
const groupLabels = () => [...document.querySelectorAll('.search-group h4')]
  .map((el) => el.textContent.trim().replace(/^[^\s]+\s+/, '').replace(/\s+\d+$/, ''))

function resultsOf(label) {
  const section = [...document.querySelectorAll('.search-group')]
    .find((el) => el.querySelector('h4')?.textContent.trim().replace(/^[^\s]+\s+/, '').replace(/\s+\d+$/, '') === label)
  if (!section) return null
  return [...section.querySelectorAll('.result-title')].map((el) => el.textContent.trim())
}

const allResults = () => [...document.querySelectorAll('.result-title')].map((el) => el.textContent.trim())
const chips = () => [...document.querySelectorAll('.search-filters .filter-chip')]
const chipOf = (label) => chips().find((el) => el.textContent.includes(label))
const emptyTitle = () => document.querySelector('.empty-state h2, .empty-state h3, .empty-state h4')?.textContent.trim() ?? ''
const storageKeys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort()

const task = (id, title, extra = {}) => ({
  id,
  title,
  course: '',
  note: '',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
})

/* ---------------- 功能 34 ---------------- */

const FOCUS_SEED = {
  sl_tasks: [task('t1', '英语听力材料')],
  sl_focus_sessions: [
    {
      sessionId: 'focus-1', focusType: 'temporary', title: '高数习题', todoId: '',
      courseId: 'c-math-9', plannedMinutes: 25, actualFocusSeconds: 1500,
      startedAt: '2026-10-05T09:00:00.000Z', endedAt: '2026-10-05T09:25:00.000Z', status: 'completed',
    },
    {
      sessionId: 'focus-2', focusType: 'free', title: '', todoId: '',
      courseId: '', plannedMinutes: 15, actualFocusSeconds: 900,
      startedAt: '2026-10-04T20:00:00.000Z', endedAt: '2026-10-04T20:15:00.000Z', status: 'completed',
    },
    {
      sessionId: 'focus-3', focusType: 'todo-linked', title: '英语听力', todoId: 't1',
      courseId: '', plannedMinutes: 45, actualFocusSeconds: 2700,
      startedAt: '2026-10-06T08:00:00.000Z', endedAt: '2026-10-06T08:45:00.000Z', status: 'completed',
    },
  ],
}

describe('功能 34：专注记录能被搜到', () => {
  it('按标题搜得到，出现在「专注记录」分组里', async () => {
    const { settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('高数习题', settle)
    expect(groupLabels()).toEqual(['专注记录'])
    expect(resultsOf('专注记录')).toEqual(['高数习题'])
    expect(document.querySelector('.result-meta').textContent).toContain('2026-10-05 · 25分钟')
  })

  it('自由专注靠类型标签回落也能搜到', async () => {
    const { settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('自由', settle)
    expect(resultsOf('专注记录')).toEqual(['自由专注'])
  })

  it('按日期搜得到（只切出 YYYY-MM-DD，不是时间戳全文）', async () => {
    const { settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('2026-10-04', settle)
    expect(resultsOf('专注记录')).toEqual(['自由专注'])
  })

  it('刻意不匹配 courseId / todoId：那不是人话，搜 id 必须零结果', async () => {
    const { settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('c-math-9', settle)
    expect(allResults(), '搜 courseId 命中了，id 不该参与匹配').toEqual([])
    expect(emptyTitle()).toBe('没有找到相关内容')

    await typeSearch('t1', settle)
    expect(allResults(), '搜 todoId 命中了').toEqual([])
  })

  it('判别力自证：搜一个谁都不沾的词就是零结果零分组', async () => {
    const { settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('xyzzy', settle)
    expect(document.querySelectorAll('.search-group')).toHaveLength(0)
    expect(allResults()).toEqual([])
    expect(emptyTitle()).toBe('没有找到相关内容')
  })

  it('关联待办还在就跳那条待办', async () => {
    const { router, closed, settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('英语听力', settle)
    const target = [...document.querySelectorAll('.search-result')]
      .find((el) => el.textContent.includes('英语听力'))
    expect(target, '没渲染出这条专注记录').toBeTruthy()
    target.click()
    await settle()
    expect(closed.count, '点结果必须先关掉面板').toBe(1)
    await waitFor(() => router.currentRoute.value.path === '/tasks')
    expect(router.currentRoute.value.path).toBe('/tasks')
    expect(router.currentRoute.value.query.focus, 'focus 参数必须指向那条待办').toBe('t1')
  })

  it('没有关联待办就回首页，且刻意不挂 focus 查询参数', async () => {
    // TodayView 只消费 `section=event`，挂一个没人读的 `?focus=` 只会让地址栏留垃圾。
    const { router, settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('高数习题', settle)
    document.querySelector('.search-result').click()
    await settle()
    await waitFor(() => router.currentRoute.value.path === '/')
    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.query.focus ?? '').toBe('')
  })

  it('整个过程没有 Vue 警告（模板或绑定写坏了会在这里冒出来）', async () => {
    const { settle } = await mountPanel(FOCUS_SEED)
    await typeSearch('高数', settle)
    chipOf('课程')?.click()
    await settle()
    expect(warnings, warnings.join('\n')).toEqual([])
  })
})

/* ---------------- 功能 32 ---------------- */

const RANK_SEED = {
  sl_tasks: [
    task('t-exact', '高数', { updatedAt: '2026-10-01T10:00:00.000Z' }),
    task('t-prefixOld', '高数习题第 3 章', { updatedAt: '2026-10-02T10:00:00.000Z' }),
    task('t-prefixNew', '高数B', { updatedAt: '2026-10-03T10:00:00.000Z' }),
    task('t-title', '复习高数', { updatedAt: '2026-10-04T10:00:00.000Z' }),
    task('t-prefixNewest', '高数C', { updatedAt: '2026-10-07T10:00:00.000Z' }),
    // 故意是**最新**的一条，却只在备注里命中：等级必须压过时间。
    task('t-content', '周计划', { note: '顺带把高数作业写了', updatedAt: '2026-10-06T10:00:00.000Z' }),
  ],
  sl_courses: [
    { id: 'c1', name: '高数A', teacher: '李老师', room: '教三 201', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
  ],
  sl_bills: [
    { id: 'b1', name: '高数资料费', note: '', amount: 1200, nextDate: '2026-10-08', active: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
  ],
}

describe('功能 32：相关度排序（先排后截）', () => {
  it('渲染出来的顺序就是「完全 > 前缀（新的在前）> 标题包含 > 内容包含」', async () => {
    const { settle } = await mountPanel(RANK_SEED)
    await typeSearch('高数', settle)
    expect(resultsOf('待办')).toEqual(['高数', '高数C', '高数B', '高数习题第 3 章', '复习高数', '周计划'])
  })

  it('每组上限 6 条，但完全匹配排在最后也必须活下来（先截后排会切掉它）', async () => {
    const noise = Array.from({ length: 8 }, (_, index) => task(`n${index}`, `高数练习${index}`))
    const { settle } = await mountPanel({ sl_tasks: [...noise, task('gem', '高数')] })
    await typeSearch('高数', settle)
    const titles = resultsOf('待办')
    expect(titles).toHaveLength(6)
    expect(titles[0], '高相关度的结果被挤出可视区了').toBe('高数')
    expect(chipOf('待办').textContent).toContain('待办 9')
  })
})

describe('功能 32：按类型筛选', () => {
  it('只看待办时，课程与固定账单的分组整个消失（而不是留一个空壳）', async () => {
    const { settle } = await mountPanel(RANK_SEED)
    await typeSearch('高数', settle)
    expect(groupLabels().sort()).toEqual(['固定账单', '待办', '课程'])

    chipOf('待办').click()
    await settle()
    expect(groupLabels()).toEqual(['待办'])
    expect(allResults()).toHaveLength(6)
    expect(document.querySelectorAll('.search-group')).toHaveLength(1)
  })

  it('用普通按钮 + aria-pressed 表达选中态（不套 tab 语义）', async () => {
    const { settle } = await mountPanel(RANK_SEED)
    // 【必须先有查询】芯片本身一直都在，但分组只由"有命中"产生（group() 命中为空
    // 返回 null，不产出空壳分组）。没输入关键词时 allGroups 是空的，
    // 筛「课程」当然还是空 —— 那样这条断言测到的不是筛选，是"空集上做筛选"。
    // 隔壁那条同样点「待办」的用例就先 typeSearch，这里对齐。
    await typeSearch('高数', settle)
    const all = chips()
    expect(all.length, '芯片数应当是「全部」+ 九个类型').toBe(10)
    expect(all.every((el) => el.tagName === 'BUTTON')).toBe(true)
    expect(all.every((el) => el.getAttribute('aria-pressed') !== null)).toBe(true)
    expect(chipOf('全部').getAttribute('aria-pressed')).toBe('true')
    expect(chipOf('待办').getAttribute('aria-pressed')).toBe('false')
    // 键盘可达：按钮天然进 Tab 序，且这组有可访问名称
    const group = document.querySelector('.search-filters')
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBeTruthy()
    expect(document.querySelectorAll('[role="tab"], [role="tablist"]')).toHaveLength(0)

    chipOf('课程').click()
    await settle()
    expect(chipOf('课程').getAttribute('aria-pressed')).toBe('true')
    expect(chipOf('全部').getAttribute('aria-pressed')).toBe('false')
    expect(groupLabels()).toEqual(['课程'])
    expect(resultsOf('课程')).toEqual(['高数A'])
  })

  it('芯片上的计数是**截断前**的命中数，所以芯片不会随 LIMIT 跳动', async () => {
    const noise = Array.from({ length: 8 }, (_, index) => task(`n${index}`, `高数练习${index}`))
    const { settle } = await mountPanel({ sl_tasks: [...noise, task('gem', '高数')], sl_courses: [] })
    await typeSearch('高数', settle)
    expect(chipOf('待办').textContent).toContain('待办 9')
    expect(chipOf('课程').textContent).toContain('课程 0')
    expect(chipOf('全部').textContent).toContain('全部 9')
    await typeSearch('xyzzy', settle)
    expect(chipOf('全部').textContent).toContain('全部 0')
  })

  it('筛到没有命中的类型：零分组，且空态文案要说出"是筛选挡掉了"', async () => {
    const { settle } = await mountPanel(RANK_SEED)
    await typeSearch('高数', settle)
    chipOf('清单').click()
    await settle()
    expect(document.querySelectorAll('.search-group')).toHaveLength(0)
    expect(emptyTitle(), '有命中却被筛空，文案却还说"没找到相关内容"').toBe('这个类型下没有匹配结果')
    expect(document.querySelector('.empty-state p').textContent).toContain('换个类型')

    // 同一个关键词、去掉筛选就又有结果了 —— 这才是"筛选真的在起作用"的判据
    chipOf('全部').click()
    await settle()
    expect(document.querySelectorAll('.search-group').length).toBeGreaterThan(0)
  })

  it('摘要行在筛选后要报出当前类型与条数', async () => {
    const { settle } = await mountPanel(RANK_SEED)
    await typeSearch('高数', settle)
    expect(document.querySelector('.search-summary').textContent).toContain('找到 8 条')
    chipOf('课程').click()
    await settle()
    expect(document.querySelector('.search-summary').textContent).toContain('在「课程」里找到 1 条')
  })

  it('筛选状态只活在组件里：不新增任何 sl_* 键，重开回到「全部」', async () => {
    const { open, settle } = await mountPanel(RANK_SEED)
    const before = storageKeys()
    await typeSearch('高数', settle)
    chipOf('课程').click()
    await settle()
    expect(storageKeys(), '筛选竟然落了盘').toEqual(before)

    // 关掉再打开：查询与筛选都回到初始态（搜索面板是临时浮层，不该记住上次看的是哪一类）
    open.value = false
    await settle()
    open.value = true
    await settle()
    expect(chipOf('全部').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.search-panel input[type="search"]').value).toBe('')
    expect(emptyTitle(), '重开后不该还挂着上一轮的筛选结果').toBe('')
    expect(document.querySelector('.search-hint')).toBeTruthy()
    expect(storageKeys()).toEqual(before)
  })

  it('没输入关键词时不显示任何分组（空态是提示而不是"无结果"）', async () => {
    const { settle } = await mountPanel(RANK_SEED)
    expect(document.querySelectorAll('.search-group')).toHaveLength(0)
    expect(document.querySelector('.search-hint').textContent).toContain('专注记录')
    expect(chipOf('待办').textContent).toContain('待办 0')
    await settle()
  })
})
