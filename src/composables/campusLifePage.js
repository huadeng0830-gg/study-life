import { onScopeDispose, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'

/** Small page-level async state helper; never carries data across account changes. */
export function useCampusLifePage() {
  const data = ref(null)
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')
  let generation = 0
  let ownerGeneration = 0
  let active = true
  let lastRequest = null
  onScopeDispose(() => { active = false; generation += 1; ownerGeneration += 1 })
  watch(() => accountUser.value?.id || '', () => {
    generation += 1
    ownerGeneration += 1
    data.value = null
    error.value = ''
    notice.value = ''
    loading.value = false
    const owner = ownerGeneration
    if (lastRequest) void Promise.resolve().then(() => { if (active && owner === ownerGeneration) return load(lastRequest) })
  }, { flush: 'sync' })
  async function load(request, initial = null) {
    lastRequest = request
    const revision = ++generation
    const userId = accountUser.value?.id || ''
    loading.value = true
    error.value = ''
    if (initial !== null) data.value = initial
    try {
      const result = await request()
      if (!active || revision !== generation || (accountUser.value?.id || '') !== userId) return null
      data.value = result
      return result
    } catch (cause) {
      if (active && revision === generation && (accountUser.value?.id || '') === userId) error.value = cause?.message || '暂时无法读取校园信息。'
      return null
    } finally {
      if (active && revision === generation && (accountUser.value?.id || '') === userId) loading.value = false
    }
  }
  async function act(task, successText = '操作已完成。') {
    const owner = ownerGeneration
    const userId = accountUser.value?.id || ''
    notice.value = ''
    error.value = ''
    try {
      const result = await task()
      if (!active || owner !== ownerGeneration || (accountUser.value?.id || '') !== userId) return null
      notice.value = successText
      return result
    } catch (cause) {
      if (active && owner === ownerGeneration && (accountUser.value?.id || '') === userId) error.value = cause?.message || '操作没有完成，请重试。'
      return null
    }
  }
  return { data, loading, error, notice, load, act }
}
