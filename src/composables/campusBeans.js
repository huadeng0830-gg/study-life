import { computed, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusErrorMessage } from './campusContentModel.js'
import { useCampusRequest } from './campusRequest.js'
import { campusBeanHome, redeemCampusBean } from '../services/campusCommunity.js'

/** @typedef {{purchased?: number, contribution?: number, contributionDebt?: number}} CampusBeanWallet */
/** @typedef {{code: string, title: string, description?: string, price: number, stock?: number|null, durationDays?: number|null}} CampusBeanEntitlement */
/** @typedef {{id: string, title: string, createdAt: string, expiresAt?: string|null}} CampusBeanOwned */
/** @typedef {{id: string, entry_type: string, bean_type: string, amount: number, reason: string, created_at: string}} CampusBeanLedgerEntry */

/**
 * 三两豆：余额、权益目录、我的权益与兑换。
 *
 * 【为什么需要它】此前贡献豆只有「进」没有「出」：`campus_bean_ledger.entry_type`
 * 早就允许 `'redemption'`，钱包也预留了 `entitlementRedemptionEnabled`，但全仓没有
 * 任何写入方 —— 余额只涨不减，用户拿到豆没有任何用处。这里接上支出侧：
 * 目录来自服务端（`beans_home` 一次取全），兑换走带幂等键的 RPC。
 *
 * 【幂等键为什么由前端生成并在重试时复用】扣豆不可逆。如果每次重试都换一个键，
 * 「请求已入库但响应丢失」后的重试就会再扣一次。所以同一个兑换意图失败后重试，
 * 必须沿用同一个键 —— 服务端据此返回原结果而不是重复扣费。
 */

function defaultRandomUUID() {
  const cryptoRef = globalThis.crypto
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** 服务端要求 8–220 位、只含 `[A-Za-z0-9:_-]`；前缀便于在日志里认出用途。 */
export function createRedeemAttemptKey(randomUUID = defaultRandomUUID) {
  return `beans:${randomUUID()}`
}

export function useCampusBeans() {
  const wallet = ref(/** @type {CampusBeanWallet|null} */ (null))
  const catalog = ref(/** @type {CampusBeanEntitlement[]} */ ([]))
  const owned = ref(/** @type {CampusBeanOwned[]} */ ([]))
  const ledger = ref(/** @type {CampusBeanLedgerEntry[]} */ ([]))
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')
  const redeeming = ref('')
  const request = useCampusRequest()
  const signedIn = computed(() => Boolean(accountUser.value?.id))
  const contribution = computed(() => Number(wallet.value?.contribution) || 0)
  /** 同一个兑换意图在重试时必须复用同一个键，所以它活在组件之外的单次会话里。 */
  let attempt = null

  async function load({ clearNotice = true } = {}) {
    // 清空而不是保留旧余额：上一个账号的数字挂在页面上，比显示「读取中」更糟。
    wallet.value = null
    catalog.value = []
    owned.value = []
    ledger.value = []
    error.value = ''
    // 兑换成功后要紧接着刷新一次；那次刷新不能把刚写好的成功提示一起清掉，
    // 否则用户永远看不到「已兑换」——这正是最初实现的 bug。
    if (clearNotice) notice.value = ''
    attempt = null
    if (!signedIn.value) { loading.value = false; return }
    const revision = request.begin()
    loading.value = true
    try {
      const result = await campusBeanHome()
      if (!request.live(revision)) return
      wallet.value = result?.wallet || null
      catalog.value = Array.isArray(result?.catalog) ? result.catalog : []
      owned.value = Array.isArray(result?.owned) ? result.owned : []
      ledger.value = Array.isArray(result?.ledger) ? result.ledger : []
    } catch (cause) {
      if (request.live(revision)) error.value = campusErrorMessage(cause, '三两豆暂时无法读取，请稍后重试。')
    } finally {
      if (request.live(revision)) loading.value = false
    }
  }

  /** @param {CampusBeanEntitlement} item */
  function affordable(item) {
    return contribution.value >= (Number(item?.price) || 0)
  }

  /** @param {CampusBeanEntitlement} item
   * @returns {Promise<boolean>} 是否兑换成功
   */
  async function redeem(item) {
    if (!item?.code || redeeming.value) return false
    if (!affordable(item)) {
      notice.value = `贡献豆还差 ${(Number(item.price) || 0) - contribution.value} 个。`
      return false
    }
    if (!attempt || attempt.code !== item.code) attempt = { code: item.code, key: createRedeemAttemptKey() }
    const revision = request.begin()
    redeeming.value = item.code
    notice.value = ''
    try {
      const result = await redeemCampusBean(item.code, attempt.key)
      if (!request.live(revision)) return false
      attempt = null
      const message = result?.duplicate
        ? `这条权益之前已经兑换过了：${item.title || item.code}。`
        : `已兑换「${item.title || item.code}」，可在「我的权益」里查看。`
      await load({ clearNotice: false })
      notice.value = message
      return true
    } catch (cause) {
      // 失败时**保留** attempt.key：用户再点一次必须沿用同一个键，否则会重复扣费。
      notice.value = campusErrorMessage(cause, '兑换没有完成，请稍后重试。')
      return false
    } finally {
      // 这里不能加 request.live(revision) 判断：成功路径里的 load() 已经开启了新一代，
      // 那样会把「正在兑换」永久留在界面上。
      redeeming.value = ''
    }
  }

  watch(() => accountUser.value?.id, () => { void load() }, { immediate: true })

  return { wallet, catalog, owned, ledger, loading, error, notice, redeeming, signedIn,
    contribution, affordable, load, redeem }
}
