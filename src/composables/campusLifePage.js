import { ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'

/** Small page-level async state helper; never carries data across account changes. */
export function useCampusLifePage() {
  const data = ref(null)
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')
  let generation = 0
  watch(() => accountUser.value?.id || '', () => {
    generation += 1
    data.value = null
    error.value = ''
    notice.value = ''
    loading.value = false
  })
  async function load(request, initial = null) {
    const revision = ++generation
    const userId = accountUser.value?.id || ''
    loading.value = true
    error.value = ''
    if (initial !== null) data.value = initial
    try {
      const result = await request()
      if (revision === generation && accountUser.value?.id === userId) data.value = result
      return result
    } catch (cause) {
      if (revision === generation && accountUser.value?.id === userId) error.value = cause?.message || '暂时无法读取校园信息。'
      return null
    } finally {
      if (revision === generation && accountUser.value?.id === userId) loading.value = false
    }
  }
  async function act(task, successText = '操作已完成。') {
    notice.value = ''
    error.value = ''
    try {
      const result = await task()
      notice.value = successText
      return result
    } catch (cause) {
      error.value = cause?.message || '操作没有完成，请重试。'
      return null
    }
  }
  return { data, loading, error, notice, load, act }
}
