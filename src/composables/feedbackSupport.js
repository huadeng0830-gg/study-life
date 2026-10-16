import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { accountOpen, accountUser } from './accountAuth.js'
import { campusFeedbackVotes, setCampusFeedbackVote } from '../services/campusCommunity.js'
import { campusErrorMessage } from './campusContentModel.js'

// Public counts and the caller's private vote state have different cache boundaries.
export function useFeedbackSupport(items, detail) {
  const liked = reactive(/** @type {Record<string, boolean>} */ ({}))
  const busy = reactive(new Set())
  const loading = ref(false)
  const error = ref('')
  const ids = computed(() => [...new Set([...items.value.map(item => item.id), ...(detail.value?.id ? [detail.value.id] : [])])])
  const versions = new Map()
  let accountGeneration = 0
  let readGeneration = 0
  let active = true
  function applyCount(id, count) {
    if (!Number.isSafeInteger(count) || count < 0) return
    for (const row of items.value) if (row.id === id) row.like_count = count
    if (detail.value?.id === id) detail.value.like_count = count
  }
  async function refresh() {
    const read = ++readGeneration
    const generation = accountGeneration
    const userId = accountUser.value?.id
    const currentIds = [...ids.value]
    error.value = ''
    loading.value = Boolean(userId && currentIds.length)
    if (!userId || !currentIds.length) return
    const before = new Map(currentIds.map(id => [id, versions.get(id)]))
    try {
      const result = await campusFeedbackVotes(currentIds)
      if (!active || read !== readGeneration || generation !== accountGeneration) return
      const voted = new Set(result.likedIds || [])
      for (const id of currentIds) {
        if (busy.has(id) || versions.get(id) !== before.get(id)) continue
        liked[id] = voted.has(id)
        const count = result.counts?.find(row => row.id === id)?.like_count
        applyCount(id, count)
      }
    } catch (cause) {
      if (active && read === readGeneration && generation === accountGeneration) error.value = campusErrorMessage(cause, '点赞状态暂时无法读取，请重试。')
    } finally { if (active && read === readGeneration && generation === accountGeneration) loading.value = false }
  }
  async function toggle(item) {
    if (!accountUser.value) { accountOpen.value = true; return }
    if (busy.has(item.id) || loading.value || !Object.hasOwn(liked, item.id)) return
    const generation = accountGeneration
    busy.add(item.id)
    versions.set(item.id, (versions.get(item.id) || 0) + 1)
    error.value = ''
    try {
      const result = await setCampusFeedbackVote(item.id, !liked[item.id])
      if (!active || generation !== accountGeneration) return
      if (typeof result?.liked !== 'boolean' || !Number.isSafeInteger(result?.likeCount) || result.likeCount < 0) throw new Error('点赞结果未确认，请重新读取。')
      versions.set(item.id, (versions.get(item.id) || 0) + 1)
      liked[item.id] = result.liked
      applyCount(item.id, result.likeCount)
    } catch (cause) {
      if (active && generation === accountGeneration) error.value = campusErrorMessage(cause, '点赞未保存，请重试。')
    } finally { if (active && generation === accountGeneration) busy.delete(item.id) }
  }
  function disabled(id) { return busy.has(id) || (Boolean(accountUser.value) && (loading.value || !Object.hasOwn(liked, id))) }
  watch(() => accountUser.value?.id, () => {
    accountGeneration += 1
    readGeneration += 1
    busy.clear(); versions.clear()
    Object.keys(liked).forEach(id => delete liked[id])
    void refresh()
  }, { flush: 'sync' })
  watch([items, () => detail.value?.id], () => { void refresh() }, { immediate: true })
  onScopeDispose(() => { active = false; accountGeneration += 1; readGeneration += 1 })
  return { liked, busy, loading, error, refresh, toggle, disabled }
}
