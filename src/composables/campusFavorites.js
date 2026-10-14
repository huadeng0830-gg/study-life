import { computed, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusLifeFavorites, setCampusFavorite } from '../services/campusLife.js'

const rows = ref([])
const loading = ref(false)
const error = ref('')
let currentUser = ''
let request = null
let loadedUser = ''

watch(() => accountUser.value?.id || '', (userId) => {
  currentUser = userId
  rows.value = []
  request = null
  loadedUser = ''
  error.value = ''
}, { immediate: true })

async function load() {
  if (!currentUser) return
  if (loadedUser === currentUser) return rows.value
  if (request) return request
  loading.value = true
  const userId = currentUser
  request = campusLifeFavorites().then((result) => {
    if (currentUser === userId) { rows.value = result.favorites || []; loadedUser = userId }
    return rows.value
  }).catch((cause) => {
    if (currentUser === userId) { error.value = cause?.message || '收藏状态暂时无法读取。'; loadedUser = userId }
    return []
  }).finally(() => {
    if (currentUser === userId) loading.value = false
    if (request) request = null
  })
  return request
}

export function useCampusFavorites() {
  const set = computed(() => new Set(rows.value.map((item) => `${item.target_type}:${item.target_id}`)))
  async function toggle(targetType, targetId) {
    if (loadedUser !== currentUser) await load()
    const saved = set.value.has(`${targetType}:${targetId}`)
    await setCampusFavorite(targetType, targetId, !saved)
    rows.value = saved
      ? rows.value.filter((item) => item.target_type !== targetType || item.target_id !== targetId)
      : [{ target_type: targetType, target_id: targetId, created_at: new Date().toISOString() }, ...rows.value]
    return !saved
  }
  return { favorites: set, loading, error, load, toggle }
}
