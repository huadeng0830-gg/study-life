// @vitest-environment happy-dom
//
// 校园生活中心的行为层回归：断言都对着「用户真的会踩到的那一步」，
// 而不是对着源码字符串。
//
// 【这个文件覆盖的三类问题】
//   1. **本机草稿回灌**：草稿存在 localStorage，`kind` 曾经是一个没有校验的自由字符串。
//      一旦它指向一个当前不存在的表单 id，`form` 就是 `undefined`，模板里的 `form.name`
//      立刻抛 TypeError，整页变白屏，而且没有任何兜底，用户只能靠清缓存自救。
//   2. **共用输入框串味**：接单留言、认领核验特征在模板里都是**单例 ref**。
//      从 A 切到 B 时如果不重置，上一条内容会被带去提交给另一条内容。核验特征尤其危险：
//      它只对失主可见，顺手发给另一位失主就是隐私事故。
//   3. **缺前置条件时的死路**：校园全部接口都按个人资料里的学校做服务端范围过滤。
//      没填学校时列表必然空；旧页面既不解释也不给出路，用户只能反复点「重试」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { accountUser } from '../src/composables/accountAuth.js'

const serviceState = vi.hoisted(() => ({
  calls: {},
  responses: {},
  lastArgs: undefined,
  accountSectionRequests: [],
  // 与 src/services/campusLife.js 的具名导出一一对应；少一个，对应用例就会静默失效。
  serviceNames: [
    'campusLifeSearch', 'campusLifeMine', 'resubmitCampusContent', 'campusLifeFavorites', 'setCampusFavorite',
    'reportCampusContent', 'campusCourses', 'submitCampusTeacher', 'submitCampusCourse', 'submitCampusTeachingAssignment',
    'submitCampusCourseReview', 'campusMarketListings', 'submitCampusMarketListing', 'createMarketInterest',
    'listMarketInterests', 'decideMarketInterest', 'withdrawMarketInterest', 'updateMarketListingStatus',
    'campusHelpTasks', 'submitCampusHelpTask', 'applyToCampusHelpTask', 'listCampusHelpApplications',
    'decideHelpApplication', 'withdrawHelpApplication', 'transitionCampusHelpTask', 'campusShuttles',
    'submitCampusShuttleRoute', 'submitCampusShuttleCorrection', 'submitCampusShuttleException', 'campusLostFound',
    'submitLostFoundItem', 'submitLostFoundClaim', 'listLostFoundClaims', 'decideLostFoundClaim', 'campusEvents',
    'submitCampusEvent', 'registerCampusEvent', 'cancelCampusEventRegistration', 'campusGuides', 'submitCampusGuide',
    'listCampusMessages', 'sendCampusMessage', 'campusModerationQueue', 'decideCampusModeration', 'resolveCampusHelpDispute',
    'campusGovernanceAccess', 'campusModerationHistory', 'campusMyReports', 'resolveCampusReport', 'withdrawCampusContent',
  ],
}))

// 【为什么必须逐个具名导出、不能用 Proxy】
// Proxy 的 get 陷阱会把 `then` 也返回成一个函数，于是 Vitest 判定这个「模块命名空间」
// 是 thenable 并去 await 它，整个模块解析不出来 —— 视图里所有服务调用一次都没发生
// （实测 serviceState.calls 只剩一个 'then'，页面永远停在「正在读取」）。
vi.mock('../src/services/campusLife.js', () => Object.fromEntries(serviceState.serviceNames.map((name) => [name, async (...args) => {
  serviceState.calls[name] = (serviceState.calls[name] || 0) + 1
  serviceState.lastArgs = args
  // responses 里放的是**函数**，这里必须调用它；直接把函数返回出去会被当成结果用。
  if (typeof serviceState.responses[name] === 'function') return serviceState.responses[name](...args)
  return name in serviceState.responses ? serviceState.responses[name] : {}
}])))

// vi.mock 被提升到文件顶部，工厂里引用不到顶层 import，所以 vue 要在工厂内部动态拿。
vi.mock('../src/composables/accountAuth.js', async () => {
  const { shallowRef, ref, computed } = await import('vue')
  return {
    accountUser: shallowRef({ id: '00000001-0000-4000-8000-000000000001' }),
    accountOpen: shallowRef(false),
    openAccountSection: vi.fn((section) => { serviceState.accountSectionRequests.push(section) }),
    accountReady: shallowRef(true),
    accountBusy: shallowRef(false),
    accountAuthError: shallowRef(''),
    accountCallbackError: shallowRef(''),
    accountAvailable: computed(() => true),
    accountPasswordRecovery: computed(() => false),
    accountRecoveryUserId: ref(''),
  }
})

vi.mock('../src/services/social.js', () => ({
  // 走 serviceState 分发，避免某条用例改了实现之后泄漏到下一条。
  socialRequest: vi.fn(async (action) => {
    if (action === 'profile_get') return typeof serviceState.responses.profileGet === 'function' ? serviceState.responses.profileGet() : { profile: serviceState.responses.profileGet || { school: '虚构大学', campus: '东区' } }
    return {}
  }),
  campusLifeRequest: vi.fn(async () => ({})),
}))

vi.mock('../src/services/campusCommunity.js', () => ({
  campusBeanWallet: vi.fn(async () => serviceState.responses.campusBeanWallet || {
    wallet: { purchased: 0, contribution: 0, contributionDebt: 0 }, ledger: [],
  }),
  campusFeedbackPublicList: vi.fn(async () => serviceState.responses.campusFeedbackPublicList || { items: [] }),
  myCampusFeedback: vi.fn(async () => ({ items: [] })),
  submitCampusFeedback: vi.fn(async () => ({})),
  applyCampusReviewer: vi.fn(async () => ({})),
  myCampusReviewerApplication: vi.fn(async () => ({ application: null })),
  replyToCampusReviewerApplication: vi.fn(async () => ({})),
  campusFeedbackMessages: vi.fn(async () => ({ messages: [] })),
}))

let app = null
let host = null

/** 让挂载后连续几个宏任务跑完：视图的 onMounted 会发一轮异步请求。 */
async function settle(ticks = 4) {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

async function mountView(component, props = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(component, props) })
  app.config.warnHandler = () => {}
  // 视图用 useRoute() 读 ?kind / ?editType / ?id，也用 RouterLink 跳转，
  // 所以给一个真实的路由上下文（它自带 RouterLink，不必再手工注册桩）。
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'stub', component: { template: '<div />' } }, { path: '/:rest(.*)*', name: 'stub-fallback', component: { template: '<div />' } }],
  })
  await router.push('/')
  await router.isReady()
  app.use(router)
  app.mount(host)
  await settle()
}

function clickButton(text) {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
  expect(button, `找不到按钮：${text}`).toBeTruthy()
  button.dispatchEvent(new Event('click', { bubbles: true }))
  return settle()
}

function typeInto(selector, value) {
  const field = host.querySelector(selector)
  expect(field, `找不到输入框：${selector}`).toBeTruthy()
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return nextTick()
}

function draftKey() {
  return 'study-life:campus-draft:v1:00000001-0000-4000-8000-000000000001:unified-publisher'
}

const stubChoices = {
  campusCourses: async () => ({ courses: [], teachers: [], assignments: [], reviews: [] }),
  campusShuttles: async () => ({ routes: [] }),
}

beforeEach(() => {
  serviceState.calls = {}
  serviceState.responses = {}
  serviceState.accountSectionRequests = []
  serviceState.lastArgs = undefined
  globalThis.localStorage.clear()
  accountUser.value = { id: '00000001-0000-4000-8000-000000000001' }
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  globalThis.localStorage.clear()
})

describe('校园治理工作台', () => {
  const guide = { type: 'guide', item: { id: 'fictional-guide', title: '虚构指南', school: '虚构大学', campus: '东区', body: '待核对内容', revision: 1 } }
  function reviewerQueue(items = [guide]) {
    serviceState.responses.campusGovernanceAccess = { owner: false, reviewer: true, scope: { school: '虚构大学', campus: '东区' } }
    serviceState.responses.campusModerationQueue = { items, total: items.length, counts: { guide: items.length } }
  }
  it('普通用户不能加载审核队列或授权界面', async () => {
    serviceState.responses.campusGovernanceAccess = { owner: false, reviewer: false }
    const { default: view } = await import('../src/views/campus/CampusGovernanceView.vue')
    await mountView(view)
    expect(host.textContent).toContain('当前账号没有审核权限')
    expect(serviceState.calls.campusModerationQueue).toBeUndefined()
    expect(host.textContent).not.toContain('审核人员与范围')
  })
  it('刷新传入页码，审核失败保留队列和处理依据', async () => {
    reviewerQueue()
    serviceState.responses.decideCampusModeration = async () => { throw new Error('虚构网络失败') }
    const { default: view } = await import('../src/views/campus/CampusGovernanceView.vue')
    await mountView(view)
    await clickButton('刷新队列')
    expect(serviceState.lastArgs).toEqual([0, { type: '' }])
    await clickButton('退回修改')
    expect(serviceState.calls.decideCampusModeration).toBeUndefined()
    expect(host.querySelector('.campus-review-item')).toBeTruthy()
    await typeInto('textarea', '请补充公开来源')
    await clickButton('退回修改')
    expect(host.textContent).toContain('虚构网络失败')
    expect(host.querySelector('textarea').value).toBe('请补充公开来源')
    expect(host.querySelector('.campus-review-item')).toBeTruthy()
    expect(host.textContent).not.toContain('审核人员与范围')
  })
  it('举报下架须确认并携带原内容与举报两个版本', async () => {
    reviewerQueue([{ type: 'report', item: { id: 'fictional-report', school: '虚构大学', target_type: 'guide', reason: 'inaccurate', revision: 3, target: { title: '虚构指南', body: '待核对正文', revision: 7 } } }])
    const { default: view } = await import('../src/views/campus/CampusGovernanceView.vue')
    await mountView(view)
    await typeInto('textarea', '已核对公开资料，需要补正')
    await clickButton('下架原内容')
    expect(serviceState.calls.resolveCampusReport).toBeUndefined()
    let request
    serviceState.responses.resolveCampusReport = async (...args) => { request = args; return { notificationSent: true } }
    serviceState.responses.campusModerationQueue = { items: [], total: 0 }
    const confirm = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '确认下架')
    expect(confirm).toBeTruthy()
    confirm.click()
    await settle()
    expect(request).toEqual(['fictional-report', 'remove', '已核对公开资料，需要补正', 3, 7])
    expect(host.textContent).toContain('处理结果已保存')
    expect(host.querySelector('.campus-review-item')).toBeNull()
  })
  it('举报记录展示处理依据，且不会显示其他账号的旧记录', async () => {
    serviceState.responses.campusMyReports = { reports: [{ id: 'fictional-report', target_type: 'guide', reason: 'inaccurate', status: 'resolved', detail: '虚构举报', resolution: '已下架等待补正', resolution_action: 'remove' }], total: 1 }
    const { default: view } = await import('../src/views/campus/CampusReportsView.vue')
    await mountView(view)
    expect(host.textContent).toContain('已下架等待补正')
    serviceState.responses.campusMyReports = { reports: [], total: 0 }
    accountUser.value = { id: 'fictional-next-account' }
    await settle()
    expect(host.textContent).not.toContain('已下架等待补正')
    expect(host.textContent).toContain('暂时没有举报记录')
  })
})

describe('统一发布：本机草稿回灌不会让页面变白屏', () => {
  it('恢复数字输入自动转换后的价格与活动名额', async () => {
    localStorage.setItem(draftKey(), JSON.stringify({ kind: 'market', forms: { market: { price: 12.5 }, event: { capacity: 30 } } }))
    const { default: view } = await import('../src/views/campus/CampusPublishView.vue')
    await mountView(view)
    expect(host.querySelector('input[type=number]').value).toBe('12.5')
    const eventChoice = [...host.querySelectorAll('.campus-publish-choice')].find((node) => node.textContent.includes('活动'))
    eventChoice.querySelector('input').click()
    await settle()
    expect(host.querySelector('input[type=number]').value).toBe('30')
  })
  it('恢复已保存的表单并持久化新的输入', async () => {
    localStorage.setItem(draftKey(), JSON.stringify({ kind: 'course', forms: { course: { name: '草稿课程' } } }))
    const { default: view } = await import('../src/views/campus/CampusPublishView.vue')
    await mountView(view)
    expect(host.querySelector('.campus-life-form input').value).toBe('草稿课程')
    await typeInto('.campus-life-form input', '修改后的课程')
    await settle()
    expect(JSON.parse(localStorage.getItem(draftKey())).forms.course.name).toBe('修改后的课程')
  })

  it('切换发布类型后更新表单，清空草稿要确认后才清空', async () => {
    const { default: view } = await import('../src/views/campus/CampusPublishView.vue')
    await mountView(view)
    const choice = [...host.querySelectorAll('.campus-publish-choice')].find((node) => node.textContent.includes('课程资料'))
    choice.querySelector('input').click()
    await settle()
    expect(host.querySelector('.campus-life-form').textContent).toContain('课程名称')
    await typeInto('.campus-life-form input', '临时课程')

    await clickButton('清空当前草稿')
    // 清空要连本机存储一起抹掉，且没有撤销。先弹确认，不直接清。
    expect(host.querySelector('.campus-life-form input').value).toBe('临时课程')
    const confirmButton = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '清空这份草稿')
    expect(confirmButton).toBeTruthy()
    confirmButton.click()
    await settle()
    expect(host.querySelector('.campus-life-form input').value).toBe('')
  })

  it('切换账号恢复该账号的草稿，不沿用上一账号的输入', async () => {
    localStorage.setItem(draftKey(), JSON.stringify({ kind: 'course', forms: { course: { name: '甲账号课程' } } }))
    const { default: view } = await import('../src/views/campus/CampusPublishView.vue')
    await mountView(view)
    accountUser.value = { id: 'account-b' }
    await settle()
    expect(host.querySelector('.campus-life-form input').value).toBe('')
    expect(JSON.parse(localStorage.getItem(draftKey())).forms.course.name).toBe('甲账号课程')
  })

  it('草稿指向已不存在的表单类型时，仍然渲染出可用的默认表单', async () => {
    // 一份「曾经存在过、现在已不在 options 里」的草稿。
    globalThis.localStorage.setItem(draftKey(), JSON.stringify({
      kind: 'place',
      forms: { market: { listingType: 'sale', category: 'textbook', title: '旧草稿标题', description: '', condition: '', price: '', meetupArea: '' } },
    }))
    serviceState.responses = { ...stubChoices }

    const { default: CampusPublishView } = await import('../src/views/campus/CampusPublishView.vue')
    await mountView(CampusPublishView)

    expect(host.querySelector('.campus-life-form')).toBeTruthy()
    expect(host.querySelector('input, select, textarea')).toBeTruthy()
    // kind 必须退回到一个真实存在的表单，而不是继续指向 undefined。
    expect(host.querySelector('input[name="campus-publish-kind"]:checked')?.value).toBe('market')
    expect(host.querySelector('.campus-publish-form-heading h2').textContent).toContain('二手')
  })

  it('草稿结构整体损坏时也回退到默认表单', async () => {
    globalThis.localStorage.setItem(draftKey(), JSON.stringify({ forms: '不是对象', kind: 42 }))
    serviceState.responses = { ...stubChoices }

    const { default: CampusPublishView } = await import('../src/views/campus/CampusPublishView.vue')
    await mountView(CampusPublishView)

    expect(host.querySelector('.campus-life-form')).toBeTruthy()
  })
})

describe('共用输入框不会串到另一条内容上', () => {
  it('切换互助任务时清空上一次的接单留言', async () => {
    serviceState.responses = {
      campusHelpTasks: async () => ({ tasks: [
        { id: 'task-a', title: '任务甲', task_type: 'parcel', status: 'open', description: '', pickup_area: '', delivery_area: '', deadline: null },
        { id: 'task-b', title: '任务乙', task_type: 'errand', status: 'open', description: '', pickup_area: '', delivery_area: '', deadline: null },
      ] }),
      listCampusHelpApplications: async () => ({ applications: [], activeTasks: [] }),
      campusLifeMine: async () => ({ helpTasks: [] }),
    }

    const { default: CampusHelpView } = await import('../src/views/campus/CampusHelpView.vue')
    await mountView(CampusHelpView)
    expect(host.querySelectorAll('.campus-life-card').length).toBe(2)

    await clickButton('申请接单')
    await typeInto('.campus-help-inline-form textarea', '给任务甲写的留言')
    expect(host.querySelector('.campus-help-inline-form textarea').value).toBe('给任务甲写的留言')

    await clickButton('取消')
    await clickButton('申请接单')

    expect(host.querySelector('.campus-help-inline-form textarea').value).toBe('')
  })

  it('切换失物信息时清空上一次的私密核验特征', async () => {
    serviceState.responses = {
      campusLostFound: async () => ({ items: [
        { id: 'item-a', mode: 'lost', category: 'card', title: '物品甲', description: '', approximate_location: '', occurred_at: null, status: 'open' },
        { id: 'item-b', mode: 'found', category: 'keys', title: '物品乙', description: '', approximate_location: '', occurred_at: null, status: 'open' },
      ] }),
      listLostFoundClaims: async () => ({ claims: [], ownClaims: [] }),
      campusLifeMine: async () => ({ lostFound: [] }),
    }

    const { default: CampusLostFoundView } = await import('../src/views/campus/CampusLostFoundView.vue')
    await mountView(CampusLostFoundView)
    expect(host.querySelectorAll('.campus-life-card').length).toBe(2)

    await clickButton('申请认领')
    await typeInto('.campus-lost-claim-form textarea', '只给物品甲的核验特征')
    await clickButton('取消')
    await clickButton('申请认领')

    // 核验特征是私密信息，绝不能跟着上一次的目标一起提交给另一位失主。
    expect(host.querySelector('.campus-lost-claim-form textarea').value).toBe('')
  })

  it('切换二手商品时清空上一次的联系留言', async () => {
    serviceState.responses = {
      campusMarketListings: async () => ({ listings: [
        { id: 'listing-a', listing_type: 'sale', category: 'textbook', title: '商品甲', description: '', condition: '', price_cents: 100, meetup_area: '', status: 'active', created_at: '2026-10-14T00:00:00.000Z' },
        { id: 'listing-b', listing_type: 'sale', category: 'textbook', title: '商品乙', description: '', condition: '', price_cents: 200, meetup_area: '', status: 'active', created_at: '2026-10-14T00:00:00.000Z' },
      ] }),
      listMarketInterests: async () => ({ interests: [] }),
      campusLifeMine: async () => ({ listings: [] }),
    }

    const { default: CampusMarketplaceView } = await import('../src/views/campus/CampusMarketplaceView.vue')
    await mountView(CampusMarketplaceView)
    expect(host.querySelectorAll('.campus-life-card').length).toBe(2)

    await clickButton('联系 / 表达意向')
    await typeInto('.campus-market-interest-form textarea', '写给商品甲的留言')
    await clickButton('收起')
    await clickButton('联系 / 表达意向')

    expect(host.querySelector('.campus-market-interest-form textarea').value).toBe('')
  })
})

describe('校车时刻：常规班次与特殊日期安排合并', () => {
  const route = { id: 'route-a', name: '1 号线', school: '虚构大学', campus: '东区', source_url: 'https://example.edu/shuttle', effective_from: '2026-01-01', effective_to: null, updated_at: '2026-10-01T00:00:00.000Z' }
  const stopRows = [
    { id: 'stop-1', route_id: 'route-a', direction: 'outbound', position: 1, name: '东门' },
    { id: 'stop-2', route_id: 'route-a', direction: 'outbound', position: 2, name: '教学区' },
  ]
  const weekdayDepartures = [
    { id: 'dep-1', route_id: 'route-a', direction: 'outbound', service_day: 'weekday', departure_time: '08:00:00', stop_name: '东门' },
    { id: 'dep-2', route_id: 'route-a', direction: 'outbound', service_day: 'weekday', departure_time: '10:00:00', stop_name: '教学区' },
  ]
  // 视图按所选日期自己推算运行日历，用例必须用同一个算法，否则断言的是错误的日期。
  const weekdayOf = (value) => {
    const day = new Date(`${value}T12:00:00`).getDay()
    return day === 0 || day === 6 ? 'weekend' : 'weekday'
  }

  async function mountShuttle(exceptions) {
    // 固定在 09:30：08:00 与 09:00 都已发车，10:00 才是「下一班」，相隔 30 分钟。
    vi.setSystemTime(new Date(2026, 9, 14, 9, 30, 0))
    serviceState.responses.campusShuttles = async () => ({
      routes: [route],
      stops: stopRows,
      departures: weekdayOf('2026-10-14') === 'weekday' ? weekdayDepartures : [],
      exceptions,
    })
    const { default: CampusShuttleView } = await import('../src/views/campus/CampusShuttleView.vue')
    await mountView(CampusShuttleView)
  }

  function outboundTimes() {
    return [...host.querySelectorAll('.campus-shuttle-times')][0]
      ? [...host.querySelectorAll('.campus-shuttle-time b')].map((node) => node.textContent.trim())
      : []
  }

  afterEach(() => vi.useRealTimers())

  it('把审核通过的加班车并进当天的班次，并按时间排序', async () => {
    if (weekdayOf('2026-10-14') !== 'weekday') return
    await mountShuttle([
      { id: 'exc-1', route_id: 'route-a', direction: 'outbound', service_date: '2026-10-14', exception_type: 'additional', departure_time: '09:00:00', note: '体育馆赛事', source_url: 'https://example.edu/x' },
    ])

    expect(outboundTimes()).toEqual(['08:00', '09:00', '10:00'])
    expect(host.textContent).toContain('特殊加班车')
    // now 固定在 09:30，08:00 与 09:00 都已发车，下一班应是 10:00，也就是 30 分钟之后。
    expect(host.textContent).toContain('下一班计划：10:00')
    expect(host.textContent).toContain('30 分钟后')
  })

  it('单班停运只移除那一班，其余班次不受影响', async () => {
    if (weekdayOf('2026-10-14') !== 'weekday') return
    await mountShuttle([
      { id: 'exc-2', route_id: 'route-a', direction: 'outbound', service_date: '2026-10-14', exception_type: 'suspended', departure_time: '08:00:00', note: '', source_url: 'https://example.edu/x' },
    ])

    expect(outboundTimes()).toEqual(['10:00'])
    expect(host.textContent).toContain('停运覆盖')
  })

  it('全日停运时不再展示任何班次，也不谎报下一班', async () => {
    if (weekdayOf('2026-10-14') !== 'weekday') return
    await mountShuttle([
      { id: 'exc-3', route_id: 'route-a', direction: 'outbound', service_date: '2026-10-14', exception_type: 'suspended', departure_time: null, note: '全线暂停', source_url: 'https://example.edu/x' },
    ])

    expect(outboundTimes()).toEqual([])
    expect(host.textContent).not.toContain('下一班计划')
  })

  it('超出生效期的线路不计算下一班', async () => {
    serviceState.responses.campusShuttles = async () => ({
      routes: [{ ...route, effective_from: '2026-11-01' }],
      stops: stopRows,
      departures: weekdayDepartures,
      exceptions: [],
    })
    const { default: CampusShuttleView } = await import('../src/views/campus/CampusShuttleView.vue')
    await mountView(CampusShuttleView)

    expect(host.textContent).toContain('超出线路生效期')
    expect(host.textContent).not.toContain('下一班计划')
  })
})

describe('缺少学校时给出可执行的下一步', () => {
  it('校园总览优先展示反馈、发布与治理入口，并提供校园服务分类', async () => {
    serviceState.responses.campusBeanWallet = { wallet: { purchased: 0, contribution: 12, contributionDebt: 2 }, ledger: [] }
    const { default: CampusHubView } = await import('../src/views/CampusHubView.vue')
    await mountView(CampusHubView)

    expect(host.querySelector('.campus-hub-hero h2')?.textContent).toContain('校园里要找的、想说的')
    expect(host.querySelector('.campus-hub-feature.campus-hub-feature-feedback[href="/campus/feedback"]')?.textContent).toContain('反馈与建议')
    expect(host.querySelector('.campus-hub-feature[href="/campus/publish"]')?.textContent).toContain('统一发布')
    expect(host.querySelector('.campus-hub-service[href="/campus/places"]')?.textContent).toContain('校园地点')
    expect(host.querySelector('.campus-hub-beans')?.textContent).toContain('12')
    expect(host.querySelector('.campus-hub-beans')?.textContent).toContain('3 豆')
    expect(host.querySelector('.campus-hub-beans')?.textContent).toContain('0–20 豆')
    expect(host.querySelector('.campus-hub-beans')?.textContent).toContain('待抵扣 2 豆')
    host.querySelector('.campus-hub-beans-account')?.click()
    await settle()
    expect(serviceState.accountSectionRequests).toEqual(['beans'])
    expect(host.querySelector('.campus-life-quick-nav')).toBeNull()
  })

  it('公开建议明确展示管理员设置的解决奖励金额', async () => {
    serviceState.responses.campusFeedbackPublicList = { items: [{
      id: 'fictional-suggestion', category: 'campus', title: '改善校园指引', body: '建议补充校区指引信息。', status: 'resolved',
      public_reply: '已补充指引。', public_reason: '', reward_beans: 8, reward_issued: true, created_at: '2026-10-15T02:00:00.000Z',
    }] }
    const { default: CampusFeedbackView } = await import('../src/views/campus/CampusFeedbackView.vue')
    await mountView(CampusFeedbackView)

    expect(host.querySelector('.feedback-row')?.textContent).toContain('管理员设置奖励 8 个贡献豆')
    expect(host.querySelector('.feedback-row .admin-reply')?.textContent).toContain('已补充指引')
  })

  it('个人资料没有学校时说明原因并给出填写入口', async () => {
    serviceState.responses.profileGet = { school: '', campus: '' }

    const { default: CampusLifeLayout } = await import('../src/components/campus/CampusLifeLayout.vue')
    await mountView(CampusLifeLayout, { title: '校园生活中心', description: '测试用描述' })

    const alert = host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('学校')
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/together')
  })

  it('已经填了学校时不再显示该提示', async () => {
    const { default: CampusLifeLayout } = await import('../src/components/campus/CampusLifeLayout.vue')
    await mountView(CampusLifeLayout, { title: '校园生活中心', description: '测试用描述' })

    expect(host.textContent).toContain('虚构大学')
    expect(host.textContent).not.toContain('请先在个人资料中填写')
  })

  it('在校园子页面顶部直接提供反馈、发布、总览和举报入口', async () => {
    const { default: CampusLifeLayout } = await import('../src/components/campus/CampusLifeLayout.vue')
    await mountView(CampusLifeLayout, { title: '校园指南' })

    const quickLinks = [...host.querySelectorAll('.campus-life-quick-nav a')]
    expect(quickLinks.map((link) => [link.textContent.replace(/\s+/g, ' ').trim(), link.getAttribute('href')]))
      .toEqual([
        ['反馈与建议查看公开进度', '/campus/feedback'],
        ['统一发布分享校园信息', '/campus/publish'],
        ['校园总览查找校园服务', '/campus'],
        ['我的举报跟进处理结果', '/campus/reports'],
      ])
  })
})


describe('校园列表筛选与失败反馈', () => {
  async function mountMarket() {
    serviceState.responses = {
      campusMarketListings: { listings: [
        { id: 'fixture-a', title: '线性代数教材', listing_type: 'sale', status: 'active', price_cents: 1200 },
        { id: 'fixture-b', title: '台灯', listing_type: 'free', status: 'active', price_cents: 0 },
      ] },
      listMarketInterests: { interests: [] }, campusLifeMine: { listings: [] },
    }
    const { default: view } = await import('../src/views/campus/CampusMarketplaceView.vue')
    await mountView(view)
  }
  it('按关键词与发布方式组合筛选，清除后恢复列表', async () => {
    await mountMarket()
    await typeInto('input[type=search]', '台灯')
    await settle()
    expect(host.querySelectorAll('.campus-life-card')).toHaveLength(1)
    expect(host.querySelector('.campus-life-card h3').textContent).toBe('台灯')
    const category = host.querySelector('select[aria-label="筛选分类"]')
    category.value = 'sale'
    category.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(host.textContent).toContain('没有找到匹配内容')
    await clickButton('清除筛选')
    expect(host.querySelectorAll('.campus-life-card')).toHaveLength(2)
  })
  it('联系提交失败时保留错误和留言，可以原样再发一次', async () => {
    await mountMarket()
    serviceState.responses.createMarketInterest = () => { throw new Error('请稍后再试') }
    await clickButton('联系 / 表达意向')
    await typeInto('.campus-market-interest-form textarea', '在图书馆交接可以吗')
    host.querySelector('.campus-market-interest-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(host.textContent).toContain('请稍后再试')
    // 写失败不该触发重新读取：列表刚刚才是对的，没有坏到需要重读。
    expect(serviceState.calls.campusMarketListings).toBe(1)
    // 列表也必须留在页面上。之前这条错误写进了读取错误槽，
    // 整屏商品被顶成一条错误加一个「重试」——重试的是列表，不是这次失败的上报。
    expect(host.querySelectorAll('.campus-life-card')).toHaveLength(2)
    expect(host.querySelector('.campus-market-interest-form textarea').value).toBe('在图书馆交接可以吗')
    // 不再提供「重试」：重试这次发送的动作是再点一次发送。
    expect([...host.querySelectorAll('button')].some((node) => node.textContent.trim() === '重试')).toBe(false)
    serviceState.responses.createMarketInterest = async () => ({})
    host.querySelector('.campus-market-interest-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(host.textContent).toContain('联系意向已发送')
  })
  it('学校资料请求乱序返回时，不覆盖新账号的学校', async () => {
    let resolveOld
    const oldRequest = new Promise((resolve) => { resolveOld = resolve })
    serviceState.responses.profileGet = () => oldRequest
    const { default: layout } = await import('../src/components/campus/CampusLifeLayout.vue')
    await mountView(layout, { title: '测试校园' })
    serviceState.responses.profileGet = () => ({ profile: { school: '新账号大学', campus: '新校区' } })
    accountUser.value = { id: 'profile-account-b' }
    await settle()
    resolveOld({ profile: { school: '旧账号大学', campus: '旧校区' } })
    await settle()
    expect(host.textContent).toContain('新账号大学')
    expect(host.textContent).not.toContain('旧账号大学')
  })
})
