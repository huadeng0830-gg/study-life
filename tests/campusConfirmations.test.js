// @vitest-environment happy-dom
//
// 校园「不可逆操作必须先确认」与闭环动作的行为层回归。
//
// 【这个文件覆盖的问题】
//   1. **误触即不可撤销**：失物「确认归还」、集市「确认成交」、互助「接受接单者」、
//      发布页「清空当前草稿」全都是单击生效，没有二次确认。失主拿着手机点错一次，
//      一条已经结束的线索就没了，而且用户那边连记录都不会留下。
//   2. **闭环缺口**：联系意向有服务端接口 `market_interest_withdraw`，但页面没有
//      入口，只能等对方处理；课程评价五项全跳过也能提交，服务端收到一条空评价。
//   3. **待办式忙碌态**：校车页用一个全局 `busy`，在 1 号线送审时把 2 号线的
//      表单一起变灰。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const serviceState = vi.hoisted(() => ({ calls: {}, responses: {}, lastArgs: undefined }))

vi.mock('../src/services/campusLife.js', () => Object.fromEntries(
  [
    'campusLifeSearch', 'campusLifeMine', 'withdrawCampusContent', 'resubmitCampusContent',
    'campusLifeFavorites', 'setCampusFavorite', 'reportCampusContent',
    'campusCourses', 'submitCampusTeacher', 'submitCampusCourse', 'submitCampusTeachingAssignment',
    'submitCampusCourseReview', 'campusMarketListings', 'submitCampusMarketListing', 'createMarketInterest',
    'listMarketInterests', 'decideMarketInterest', 'withdrawMarketInterest', 'updateMarketListingStatus',
    'campusHelpTasks', 'submitCampusHelpTask', 'applyToCampusHelpTask', 'listCampusHelpApplications',
    'decideHelpApplication', 'withdrawHelpApplication', 'transitionCampusHelpTask', 'campusShuttles',
    'submitCampusShuttleRoute', 'submitCampusShuttleCorrection', 'submitCampusShuttleException', 'campusLostFound',
    'submitLostFoundItem', 'submitLostFoundClaim', 'listLostFoundClaims', 'decideLostFoundClaim', 'campusEvents',
    'submitCampusEvent', 'registerCampusEvent', 'cancelCampusEventRegistration', 'campusGuides', 'submitCampusGuide',
    'listCampusMessages', 'sendCampusMessage', 'campusModerationQueue', 'decideCampusModeration', 'resolveCampusHelpDispute',
    'campusGovernanceAccess', 'campusModerationHistory', 'campusMyReports', 'resolveCampusReport',
  ].map((name) => [name, vi.fn(async (...args) => {
    serviceState.calls[name] = (serviceState.calls[name] || 0) + 1
    serviceState.lastArgs = args
    // responses 里放函数时必须调用它；直接返回函数会被当成结果用。
    if (typeof serviceState.responses[name] === 'function') return serviceState.responses[name](...args)
    return name in serviceState.responses ? serviceState.responses[name] : {}
  })]),
))

vi.mock('../src/composables/accountAuth.js', async () => {
  const { shallowRef, computed } = await import('vue')
  return {
    accountUser: shallowRef({ id: 'fictional-account' }),
    accountOpen: shallowRef(false),
    openAccountSection: vi.fn(),
    accountReady: shallowRef(true),
    accountBusy: shallowRef(false),
    accountAuthError: shallowRef(''),
    accountCallbackError: shallowRef(''),
    accountAvailable: computed(() => true),
    accountPasswordRecovery: computed(() => false),
  }
})

vi.mock('../src/services/social.js', () => ({
  socialRequest: vi.fn(async (action) => (action === 'profile_get' ? { profile: { school: '虚构大学', campus: '东区' } } : {})),
  campusLifeRequest: vi.fn(async () => ({})),
}))

vi.mock('../src/services/campusCommunity.js', () => ({
  campusBeanWallet: vi.fn(async () => ({ wallet: { purchased: 0, contribution: 0, contributionDebt: 0 }, ledger: [] })),
  campusFeedbackPublicList: vi.fn(async () => ({ items: [] })),
  myCampusFeedback: vi.fn(async () => ({ items: [] })),
  submitCampusFeedback: vi.fn(), applyCampusReviewer: vi.fn(), myCampusReviewerApplication: vi.fn(),
  replyToCampusReviewerApplication: vi.fn(), campusFeedbackMessages: vi.fn(),
}))

let app = null
let host = null

async function settle(ticks = 5) {
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

/**
 * 只在页面自己的 DOM 里找按钮；确认框 Teleport 到 body，要单独找。
 */
function clickIn(node, text) {
  const button = [...node.querySelectorAll('button')].find((item) => item.textContent.trim() === text)
  expect(button, `页面上找不到按钮：${text}`).toBeTruthy()
  button.dispatchEvent(new Event('click', { bubbles: true }))
  return settle()
}

/**
 * 点确认框里的按钮。
 *
 * 必须排除页面内的按钮：触发按钮和确认按钮常常同名（「确认归还」），
 * 直接在 body 里取第一个会点到触发按钮上，于是确认框反复开关、动作永远不执行。
 */
function clickDialog(text) {
  const button = [...document.body.querySelectorAll('button')]
    .find((node) => !host?.contains(node) && node.textContent.trim() === text)
  expect(button, `确认框里找不到按钮：${text}`).toBeTruthy()
  button.dispatchEvent(new Event('click', { bubbles: true }))
  return settle()
}

function dialogText() {
  return [...document.body.querySelectorAll('.message')].map((node) => node.textContent).join(' ')
}

beforeEach(() => {
  serviceState.calls = {}
  serviceState.responses = {}
  globalThis.localStorage.clear()
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  document.body.innerHTML = ''
  globalThis.localStorage.clear()
})

describe('失物招领：确认归还必须先确认', () => {
  async function mountLostFound() {
    const { decideLostFoundClaim } = await import('../src/services/campusLife.js')
    // 模块实例在文件内共享，调用次数必须逐条清干净，否则上一条用例的
    // 调用会算到这一条头上。
    decideLostFoundClaim.mockClear()
    decideLostFoundClaim.mockResolvedValue({})
    serviceState.responses.campusLostFound = { items: [{ id: 'item-a', mode: 'lost', category: 'card', title: '校园卡', description: '', approximate_location: '', occurred_at: '2026-03-04', status: 'open' }] }
    serviceState.responses.listLostFoundClaims = { claims: [{ id: 'claim-a', item_id: 'item-a', itemTitle: '校园卡', claimant: '乙同学', claimant_id: 'u2', private_evidence: '背面有贴纸', status: 'pending' }], ownClaims: [] }
    serviceState.responses.campusLifeMine = { lostFound: [] }
    const { default: view } = await import('../src/views/campus/CampusLostFoundView.vue')
    await mountView(view)
    return decideLostFoundClaim
  }

  it('点「确认归还」不会直接提交，确认之后才提交', async () => {
    const decide = await mountLostFound()
    await clickIn(host, '确认归还')
    // 这一步只是弹确认：认领还没被关闭。
    expect(decide).not.toHaveBeenCalled()
    expect(dialogText()).toContain('无法再改回待确认')
    expect(dialogText()).toContain('归档')
    await clickDialog('确认归还')
    expect(decide).toHaveBeenCalledWith('claim-a', 'approve')
  })

  it('取消确认不会提交', async () => {
    const decide = await mountLostFound()
    await clickIn(host, '确认归还')
    await clickDialog('取消')
    expect(decide).not.toHaveBeenCalled()
  })

  it('失物日期按本地日期显示，不因为 UTC 偏移少一天', async () => {
    await mountLostFound()
    // occurred_at 是 Postgres 的 date 列（YYYY-MM-DD）。
    // 旧实现用 String(v).slice(0,10) 原样打印，新实现走 campusDateLabel。
    expect(host.textContent).not.toContain('2026-03-04T')
    expect(host.textContent).toMatch(/2026.{0,2}03.{0,2}04|03.{0,2}04/)
  })
})

describe('二手集市：确认成交与撤回意向', () => {
  async function mountMarket(interests = []) {
    const { updateMarketListingStatus, withdrawMarketInterest } = await import('../src/services/campusLife.js')
    updateMarketListingStatus.mockResolvedValue({})
    withdrawMarketInterest.mockResolvedValue({})
    serviceState.responses.campusMarketListings = { listings: [] }
    serviceState.responses.listMarketInterests = { interests }
    serviceState.responses.campusLifeMine = { listings: [{ id: 'listing-a', title: '线性代数教材', listing_type: 'sale', status: 'reserved', price_cents: 1000 }] }
    const { default: view } = await import('../src/views/campus/CampusMarketplaceView.vue')
    await mountView(view)
    return { updateMarketListingStatus, withdrawMarketInterest }
  }

  it('标记成交先确认，取消则什么也不做', async () => {
    const { updateMarketListingStatus } = await mountMarket()
    await clickIn(host, '确认成交')
    expect(updateMarketListingStatus).not.toHaveBeenCalled()
    expect(dialogText()).toContain('无法自行改回在售')
    await clickDialog('确认成交')
    expect(updateMarketListingStatus).toHaveBeenCalledWith('listing-a', 'sold')
  })

  it('买家用得上撤回意向：接口终于有了入口', async () => {
    const { withdrawMarketInterest } = await mountMarket([
      { id: 'interest-a', listing_id: 'listing-a', listingTitle: '线性代数教材', listingType: 'sale', perspective: 'applicant', counterpart: '卖书同学', counterpartId: 'u9', status: 'pending' },
    ])
    await clickIn(host, '撤回意向')
    expect(dialogText()).toContain('发布者不会看到你的留言')
    await clickDialog('撤回意向')
    expect(withdrawMarketInterest).toHaveBeenCalledWith('interest-a')
  })

  it('卖家不提供撤回意向：那是买家自己的动作', async () => {
    await mountMarket([
      { id: 'interest-b', listing_id: 'listing-a', listingTitle: '线性代数教材', listingType: 'sale', perspective: 'seller', counterpart: '买书同学', counterpartId: 'u9', status: 'pending' },
    ])
    expect([...host.querySelectorAll('button')].some((node) => node.textContent.trim() === '撤回意向')).toBe(false)
  })
})

describe('校园互助：接受接单者与取消任务先确认', () => {
  async function mountHelp() {
    const { decideHelpApplication, transitionCampusHelpTask } = await import('../src/services/campusLife.js')
    decideHelpApplication.mockClear()
    transitionCampusHelpTask.mockClear()
    serviceState.responses.campusHelpTasks = { tasks: [] }
    serviceState.responses.listCampusHelpApplications = {
      applications: [{ id: 'app-a', task_id: 'task-a', taskTitle: '代取快递', perspective: 'owner', counterpart: '甲同学', counterpartId: 'u3', message: '', status: 'pending' }],
      activeTasks: [],
    }
    serviceState.responses.campusLifeMine = { helpTasks: [{ id: 'task-a', title: '代取快递', status: 'open' }] }
    const { default: view } = await import('../src/views/campus/CampusHelpView.vue')
    await mountView(view)
    return { decideHelpApplication, transitionCampusHelpTask }
  }

  it('接受接单者要先确认，其余申请会被记为未接受', async () => {
    const { decideHelpApplication } = await mountHelp()
    await clickIn(host, '接受')
    expect(decideHelpApplication).not.toHaveBeenCalled()
    expect(dialogText()).toContain('其余待处理申请会记为未接受')
    await clickDialog('选择接单者')
    expect(decideHelpApplication).toHaveBeenCalledWith('task-a', 'app-a', 'accept')
  })

  it('取消任务要先确认，确认后才真的取消', async () => {
    const { transitionCampusHelpTask } = await mountHelp()
    await clickIn(host, '取消任务')
    expect(transitionCampusHelpTask).not.toHaveBeenCalled()
    expect(dialogText()).toContain('停止接单')
    await clickDialog('取消任务')
    expect(transitionCampusHelpTask).toHaveBeenCalledWith('task-a', 'cancelled', '')
  })

  it('取消确认不提交任何状态变更', async () => {
    const { transitionCampusHelpTask } = await mountHelp()
    await clickIn(host, '取消任务')
    await clickDialog('取消')
    expect(transitionCampusHelpTask).not.toHaveBeenCalled()
  })
})

describe('老师与课程：空评价不发出去', () => {
  it('五项全跳过、正文空白时拦住并说明原因', async () => {
    const { submitCampusCourseReview } = await import('../src/services/campusLife.js')
    submitCampusCourseReview.mockResolvedValue({})
    serviceState.responses.campusCourses = {
      courses: [{ id: 'c1', name: '线性代数', department: '数学系' }],
      teachers: [{ id: 't1', name: '虚构老师', department: '数学系' }],
      assignments: [{ id: 'a1', course_id: 'c1', teacher_id: 't1', term: '2026 秋' }],
      reviews: [],
    }
    serviceState.responses.campusLifeMine = { courseReviews: [] }
    const { default: view } = await import('../src/views/campus/CampusCoursesView.vue')
    await mountView(view)

    const submitEmpty = () => host.querySelector('.campus-course-review-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    submitEmpty()
    await settle()
    // 旧实现没有任何校验，服务端会收到一条五项皆空的评价，而用户看到的是「已提交」。
    expect(submitCampusCourseReview).not.toHaveBeenCalled()
    expect(host.textContent).toContain('至少给一项评分')

    // 重新取一次表单：被拦下之后界面重渲染过，旧的节点已经不在文档里。
    const select = host.querySelector('.campus-course-review-form select')
    select.value = '5'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    submitEmpty()
    await settle()
    // 选项用 :value="score" 绑定，拿到的是数字而不是字符串。
    expect(submitCampusCourseReview).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: 'a1', clarity: 5 }))
  })
})

describe('校车：纠错草稿不会串到另一条线路', () => {
  it('给 A 号线写完纠错、送审后，B 号线的表单是空的', async () => {
    const { submitCampusShuttleCorrection } = await import('../src/services/campusLife.js')
    submitCampusShuttleCorrection.mockClear()
    submitCampusShuttleCorrection.mockResolvedValue({})
    serviceState.responses.campusShuttles = {
      routes: [
        { id: 'route-a', name: '1 号线', source_url: 'https://example.edu/a', effective_from: '2026-01-01', effective_to: null, updated_at: '2026-10-01T00:00:00.000Z' },
        { id: 'route-b', name: '2 号线', source_url: 'https://example.edu/b', effective_from: '2026-01-01', effective_to: null, updated_at: '2026-10-01T00:00:00.000Z' },
      ],
      stops: [], departures: [], exceptions: [],
    }
    const { default: view } = await import('../src/views/campus/CampusShuttleView.vue')
    await mountView(view)

    // 纠错表单按设计一次只展开一条，用一个共享的 correctionRoute 标记当前目标。
    const openCorrection = async (index) => {
      const opener = [...host.querySelectorAll('button')].filter((node) => node.textContent.trim() === '提交纠错')[index]
      expect(opener, `第 ${index + 1} 条线路的「提交纠错」`).toBeTruthy()
      opener.dispatchEvent(new Event('click', { bubbles: true }))
      await settle()
    }

    await openCorrection(0)
    const field = host.querySelector('.campus-shuttle-form textarea')
    field.value = '只给 1 号线的纠错说明'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    host.querySelector('.campus-shuttle-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(submitCampusShuttleCorrection).toHaveBeenCalledWith('route-a', '只给 1 号线的纠错说明', '')

    await openCorrection(1)
    // 纠错内容描述的是某一条具体线路的运行事实。带着上一条线路的说明去提交，
    // 等于把一条线路的错误挂到另一条线路上，让审核员去核对一件不存在的事。
    expect(host.querySelector('.campus-shuttle-form textarea').value).toBe('')
  })
})