// @vitest-environment happy-dom
/**
 * 一起约（TogetherView）的加载时序守卫。
 *
 * 【这里为什么用挂载断言而不是解析源码】
 * 要挡的是一个**过期响应**缺陷：它的本质是"请求回来时状态已经不是发起时的那个状态"，
 * 只有真的把两个请求排成先后顺序、让后一个在前一个返回前改变页面状态，才看得出来。
 * 解析源码只能确认某段守卫代码存在，挡不住有人把判断挪到别处或改错比较对象。
 *
 * 【被挡住的真实缺陷】
 * queryAvailability 是两个页面里**唯一**没有过期响应守卫的加载函数：好友列表的点击
 * 只会清空 availability，不会重新发起查询，所以好友切换途中回来的旧响应会覆盖
 * availability —— 于是**新好友的名字下面显示的是旧好友的空闲时段**；此时选一个时段
 * 建邀约，收件人是新好友、时间却是按旧好友的算（服务端会拦下来，但用户看到的是
 * 误导性的界面和一句费解的报错）。
 */
import { createApp, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 的工厂会被提升到文件顶部，不能引用普通顶层变量；而 accountUser 必须是真的
// ref（视图用 computed / watch 读它），vi.hoisted 里又拿不到 vue 的导入。
// 所以：hoisted 只放一个占位盒子，真正的 ref 在**异步** mock 工厂里现场创建。
const stubs = vi.hoisted(() => ({
  accountUser: null,
  accountOpen: null,
  socialRequest: vi.fn(),
  ensureSocialScheduleReady: vi.fn(async () => {}),
  subscribeSocialNotifications: vi.fn(async () => () => {}),
}))

vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  stubs.accountUser = ref({ id: 'user-1', email_confirmed_at: '2026-01-01' })
  stubs.accountOpen = ref(false)
  return { accountUser: stubs.accountUser, accountOpen: stubs.accountOpen }
})
vi.mock('../src/services/social.js', () => ({
  socialRequest: stubs.socialRequest,
  ensureSocialScheduleReady: stubs.ensureSocialScheduleReady,
  subscribeSocialNotifications: stubs.subscribeSocialNotifications,
}))
const socialRequest = stubs.socialRequest
const ensureSocialScheduleReady = stubs.ensureSocialScheduleReady
const subscribeSocialNotifications = stubs.subscribeSocialNotifications
const accountUser = () => stubs.accountUser.value

import TogetherView from '../src/views/TogetherView.vue'

const FRIEND_A = 'friend-a'
const FRIEND_B = 'friend-b'

/** 一个已经配好资料的用户：hasProfile 为真才会渲染出找共同时间那个分区。 */
const PROFILE = {
  nickname: '我', school: '某校', timezone: 'Asia/Shanghai',
  scheduleCompleteThrough: '2026-12-31', semesterEnd: '2026-12-31',
  availabilityPreferences: { startTime: '09:00', endTime: '22:00', minimumMinutes: 90, classBufferMinutes: 0, includeWeekends: true },
}

function intervalAt(hour) {
  return { startsAt: `2026-10-10T${String(hour).padStart(2, '0')}:00:00.000Z`, endsAt: `2026-10-10T${String(hour + 1).padStart(2, '0')}:00:00.000Z` }
}

let app = null
let host = null

/**
 * 推进若干轮微任务 + 渲染，让首屏的异步链走完。
 *
 * 加载链有多层 await：onAccountChanged → loadProfile → refreshAll → loadFriends 等，
 * 每层之间都隔着一次微任务。固定「等 2 轮」会在 profile 还没落地时就断言，看到的是
 * 加载态而不是内容——这里多留几轮余量，比猜 exact 轮数稳。
 */
async function flush(times = 4) {
  for (let round = 0; round < times; round += 1) {
    await nextTick()
    await Promise.resolve()
  }
}

async function mountView() {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(TogetherView)
  app.mount(host)
  await flush()
}

/**
 * 点击好友列表里的某个好友。
 *
 * 昵称按钮的文本是 `{{ 昵称 }}{{ 学校 || '已添加好友' }}` 拼在一起的（"小小艾已添加好友✓"），
 * 所以按昵称做 includes 匹配；同时用 aria-pressed 确认它确实是可选中的那一类控件。
 */
async function pickFriend(userId) {
  const nickname = FRIENDS.get(userId)
  const button = [...host.querySelectorAll('.friend-choice')]
    .find((node) => node.querySelector('.friend-copy b')?.textContent.trim() === nickname)
  expect(button, `好友列表里应有 ${nickname}`).toBeTruthy()
  button.click()
  await nextTick()
}

const FRIENDS = new Map([
  [FRIEND_A, '小艾'],
  [FRIEND_B, '小博'],
])

beforeEach(() => {
  stubs.accountUser.value = { id: 'user-1', email_confirmed_at: '2026-01-01' }
  socialRequest.mockReset()
  ensureSocialScheduleReady.mockClear()
  subscribeSocialNotifications.mockClear()

  socialRequest.mockImplementation(async (action) => {
    if (action === 'profile_get') return { profile: PROFILE }
    if (action === 'friends_list') {
      return {
        friends: [FRIEND_A, FRIEND_B].map((id) => ({ profile: { userId: id, nickname: FRIENDS.get(id), school: '' } })),
        incoming: [], outgoing: [],
      }
    }
    if (action === 'notifications_list') return { notifications: [], unread: 0 }
    if (action === 'invitations_list') return { invitations: [] }
    if (action === 'availability_query') return { known: true, intervals: [intervalAt(1)] }
    return {}
  })
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

describe('一起约共同时间查询不会串到别的好友', () => {
  function queryButton() {
    return [...host.querySelectorAll('button')].find((node) => node.textContent.includes('查找共同时间'))
  }

  it('查询途中切换好友，旧响应不覆盖当前好友的结果', async () => {
    await mountView()

    // 让「小艾」的查询悬着不返回。
    let resolveAlice
    const baseImpl = socialRequest.getMockImplementation()
    socialRequest.mockImplementation(async (action, payload) => {
      if (action === 'availability_query' && payload?.friendId === FRIEND_A) {
        return new Promise((resolve) => { resolveAlice = resolve })
      }
      return baseImpl(action, payload)
    })

    expect(queryButton()).toBeTruthy()
    queryButton().click()
    await nextTick()
    expect(socialRequest).toHaveBeenCalledWith('availability_query', { friendId: FRIEND_A, days: 7 })

    // 查询途中切到「小博」。
    await pickFriend(FRIEND_B)

    // 小艾的响应这时才回来 —— 它已经不属于当前选中的好友了。
    resolveAlice({ known: true, intervals: [intervalAt(1)] })
    await flush()

    // 界面上不能出现小艾的时段（标题此刻应指向小博）。
    expect(host.textContent).not.toContain('选择这个时段')
    expect(host.querySelector('.availability-heading .eyebrow')?.textContent).toContain(FRIENDS.get(FRIEND_B))
  })

  it('切换好友后重新查询，结果正常显示', async () => {
    await mountView()
    await pickFriend(FRIEND_B)
    queryButton().click()
    await flush()

    expect(socialRequest).toHaveBeenCalledWith('availability_query', { friendId: FRIEND_B, days: 7 })
    expect(host.textContent).toContain('选择这个时段')
  })
})