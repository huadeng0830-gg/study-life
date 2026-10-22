import { computed, ref, toValue, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusErrorMessage } from './campusContentModel.js'
import { useCampusRequest } from './campusRequest.js'
import { campusBeanWallet } from '../services/campusCommunity.js'

/**
 * 三两豆（贡献豆）余额。
 *
 * 校园总览和「我的账号 → 三两豆」各写了一份余额读取：两套 generation 计数、
 * 两套错误文案。规则数字（每条 3 豆、每日 20 条、单次 0–20）还散落在三个地方。
 *
 * 这里只管读取；规则文案走 `CAMPUS_BEAN_RULES`，卡片长什么样交给各自的页面。
 * @param {{ enabled?: import('vue').MaybeRefOrGetter<boolean> }} [options]
 */
export function useCampusBeanWallet({ enabled = true } = {}) {
  const wallet = ref(null)
  const ledger = ref([])
  const loading = ref(false)
  const error = ref('')
  const request = useCampusRequest()
  const signedIn = computed(() => Boolean(accountUser.value?.id))

  async function load() {
    // 清空而不是保留旧余额：上一个账号的数字挂在页面上，比显示「读取中」更糟。
    wallet.value = null
    ledger.value = []
    error.value = ''
    if (!signedIn.value || !toValue(enabled)) { request.invalidate(); loading.value = false; return }
    const revision = request.begin()
    loading.value = true
    try {
      const result = await campusBeanWallet()
      if (!request.live(revision)) return
      wallet.value = result.wallet || null
      ledger.value = Array.isArray(result.ledger) ? result.ledger : []
    } catch (cause) {
      if (request.live(revision)) error.value = campusErrorMessage(cause, '三两豆余额暂时无法读取，请稍后重试。')
    } finally {
      if (request.live(revision)) loading.value = false
    }
  }

  // 换账号即重读。未登录时清空，避免把上一个账号的余额留在页面上。
  watch(() => [accountUser.value?.id, toValue(enabled)], () => { void load() }, { immediate: true })

  return { wallet, ledger, loading, error, signedIn, load }
}
