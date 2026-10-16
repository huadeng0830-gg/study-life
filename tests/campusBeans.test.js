// @vitest-environment happy-dom
//
// 三两豆闭环的行为层回归：断言对着「用户真的会踩到的那一步」。
//
// 【这个文件守的是什么】贡献豆在修复前只有收入侧：`campus_bean_ledger` 允许
// `entry_type='redemption'`，钱包也预留了开关，但没有任何写入方 —— 余额只涨不减。
// 接上支出侧之后，最贵的错误不再是「点了没反应」，而是**重复扣豆**：
// 请求已入库但响应丢失时，用户重试必须复用同一个幂等键。第 4 条用例就是守它。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const service = vi.hoisted(() => ({ home: vi.fn(), redeem: vi.fn() }))

vi.mock('../src/composables/accountAuth.js', async () => {
  const { shallowRef, ref, computed } = await import('vue')
  return {
    accountUser: shallowRef({ id: '00000001-0000-4000-8000-000000000001', email: 'student@example.test' }),
    accountOpen: shallowRef(false),
    openAccountSection: vi.fn(),
    accountReady: shallowRef(true),
    accountBusy: shallowRef(false),
    accountAuthError: shallowRef(''),
    accountCallbackError: shallowRef(''),
    accountAvailable: computed(() => true),
    accountPasswordRecovery: computed(() => false),
    accountRecoveryUserId: ref(''),
  }
})

// CampusLifeLayout 会读个人资料；不 mock 的话它会去打真实服务。
vi.mock('../src/services/social.js', () => ({
  socialRequest: vi.fn(async () => ({ profile: { school: '虚构大学', campus: '东区' } })),
  campusLifeRequest: vi.fn(async () => ({})),
}))

vi.mock('../src/services/campusCommunity.js', () => ({
  campusBeanHome: (...args) => service.home(...args),
  redeemCampusBean: (...args) => service.redeem(...args),
}))

const CONTRIBUTOR = {
  code: 'badge_contributor', title: '贡献者徽章',
  description: '在个人资料页显示贡献者徽章，长期有效。',
  beanType: 'contribution', price: 30, stock: null, durationDays: null,
}

function homePayload(overrides = {}) {
  return {
    wallet: { purchased: 0, contribution: 40, contributionDebt: 0, rechargeEnabled: false, entitlementRedemptionEnabled: true },
    catalog: [CONTRIBUTOR], owned: [], ledger: [],
    ...overrides,
  }
}

let app = null
let host = null
async function settle(times = 5) { for (let index = 0; index < times; index += 1) await nextTick() }

beforeEach(() => {
  service.home.mockReset().mockResolvedValue(homePayload())
  service.redeem.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  app?.unmount()
  app = null
  host?.remove()
  host = null
  document.body.innerHTML = ''
})

async function mountBeans() {
  const { default: CampusBeansView } = await import('../src/views/campus/CampusBeansView.vue')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }, { path: '/:rest(.*)', component: { render: () => null } }],
  })
  await router.push('/campus/beans')
  await router.isReady()
  app = createApp({ render: () => h(CampusBeansView) })
  app.use(router)
  app.mount(host)
  await settle()
}

function redeemButtons() { return [...host.querySelectorAll('.beans-card-actions button')] }
// ConfirmDialog 自己 Teleport 到 body；确认键是最后一组 actions 的最后一个按钮。
function confirmButton() {
  const actions = [...document.body.querySelectorAll('.actions')].filter((node) => node.querySelector('button'))
  const buttons = actions.at(-1)?.querySelectorAll('button')
  return buttons?.length ? buttons[buttons.length - 1] : null
}
async function redeemThroughDialog() {
  redeemButtons()[0].click()
  await settle()
  confirmButton()?.click()
  await settle(8)
}

describe('三两豆兑换闭环', () => {
  it('渲染余额、权益目录与规则，价格来自服务端', async () => {
    await mountBeans()
    expect(host.textContent).toContain('40')
    expect(host.textContent).toContain('贡献者徽章')
    expect(host.textContent).toContain('30 豆')
    expect(host.textContent).toContain('长期有效')
    expect(host.textContent).toContain('还没有兑换记录')
  })

  it('贡献豆不足时兑换键不可点，而不是让用户白点一次', async () => {
    service.home.mockResolvedValue(homePayload({ wallet: { purchased: 0, contribution: 5, contributionDebt: 0, entitlementRedemptionEnabled: true } }))
    await mountBeans()
    const button = redeemButtons()[0]
    expect(button.disabled).toBe(true)
    expect(host.textContent).toContain('贡献者徽章')
  })

  it('兑换要经过确认框，并带上服务端能接受的幂等键', async () => {
    service.redeem.mockResolvedValue({ ok: true, duplicate: false })
    await mountBeans()
    await redeemThroughDialog()
    expect(service.redeem).toHaveBeenCalledTimes(1)
    const [code, key] = service.redeem.mock.calls[0]
    expect(code).toBe('badge_contributor')
    // 服务端校验：8–220 位、只含 [A-Za-z0-9:_-]。
    expect(key).toMatch(/^[A-Za-z0-9:_-]{8,220}$/)
  })

  it('兑换失败后重试必须复用同一个幂等键，否则就是重复扣豆', async () => {
    service.redeem
      .mockRejectedValueOnce(new Error('网络中断，兑换没有完成。'))
      .mockResolvedValueOnce({ ok: true, duplicate: false })
    await mountBeans()

    await redeemThroughDialog()
    expect(service.redeem).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('网络中断')

    await redeemThroughDialog()
    expect(service.redeem).toHaveBeenCalledTimes(2)
    const [firstCode, firstKey] = service.redeem.mock.calls[0]
    const [secondCode, secondKey] = service.redeem.mock.calls[1]
    expect(secondCode).toBe(firstCode)
    // 扣豆不可逆：换键就等于再扣一次。这条断言是整段代码最重要的保护。
    expect(secondKey).toBe(firstKey)
  })

  it('兑换成功后刷新账本、给出提示并列出我的权益（提示不能被刷新清掉）', async () => {
    service.redeem.mockResolvedValue({ ok: true, duplicate: false })
    await mountBeans()
    service.home.mockResolvedValue(homePayload({
      wallet: { purchased: 0, contribution: 10, contributionDebt: 0, entitlementRedemptionEnabled: true },
      owned: [{ id: 'fictional-redemption', code: 'badge_contributor', title: '贡献者徽章', beanType: 'contribution', price: 30, expiresAt: null, createdAt: '2026-10-16T10:00:00.000Z' }],
      ledger: [{ id: 'fictional-ledger', bean_type: 'contribution', amount: -30, debt_delta: 0, balance_after: 10, debt_after: 0, entry_type: 'redemption', reason: '兑换：贡献者徽章', created_at: '2026-10-16T10:00:00.000Z' }],
    }))
    await redeemThroughDialog()

    expect(service.home).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('已兑换「贡献者徽章」')
    expect(host.textContent).toContain('10')
    expect(host.textContent).toContain('权益兑换')
    expect(host.textContent).toContain('-30')
  })

  it('服务端说这笔已经兑换过时如实说明，不谎报新兑换', async () => {
    service.redeem.mockResolvedValue({ ok: true, duplicate: true })
    await mountBeans()
    await redeemThroughDialog()
    expect(host.textContent).toContain('之前已经兑换过了')
  })

  it('幂等键满足服务端契约，且两次生成不相同', async () => {
    const { createRedeemAttemptKey } = await import('../src/composables/campusBeans.js')
    const first = createRedeemAttemptKey()
    const second = createRedeemAttemptKey()
    expect(first).toMatch(/^[A-Za-z0-9:_-]{8,220}$/)
    expect(first).not.toBe(second)
  })
})