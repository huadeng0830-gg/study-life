import { computed, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusLifeFavorites, setCampusFavorite } from '../services/campusLife.js'

const rows = ref([])
const loading = ref(false)
const error = ref('')
let currentUser = ''
let request = null
let loadedUser = ''
let generation = 0

watch(() => accountUser.value?.id || '', (userId) => {
  currentUser = userId
  generation += 1
  rows.value = []
  request = null
  loadedUser = ''
  error.value = ''
  loading.value = false
}, { immediate: true, flush: 'sync' })

async function load() {
  if (!currentUser) return
  if (loadedUser === currentUser) return rows.value
  if (request) return request
  loading.value = true
  error.value = ''
  const userId = currentUser
  const revision = generation
  const pending = campusLifeFavorites().then((result) => {
    if (currentUser !== userId || generation !== revision) return []
    rows.value = result.favorites || []; loadedUser = userId
    return rows.value
  }).catch((cause) => {
    if (currentUser === userId && generation === revision) error.value = cause?.message || '收藏状态暂时无法读取。'
    return []
  }).finally(() => {
    if (currentUser === userId && generation === revision) loading.value = false
    if (request === pending) request = null
  })
  request = pending
  return request
}

export function useCampusFavorites() {
  const set = computed(() => new Set(rows.value.map((item) => `${item.target_type}:${item.target_id}`)))
  async function toggle(targetType, targetId) {
    const userId = currentUser
    const revision = generation
    if (!userId) throw new Error('请先登录账号再收藏。')
    if (loadedUser !== currentUser) await load()
    if (userId !== currentUser || generation !== revision) return null
    if (loadedUser !== userId) throw new Error(error.value || '请先重试读取收藏状态。')
    const saved = set.value.has(`${targetType}:${targetId}`)
    await setCampusFavorite(targetType, targetId, !saved)
    if (userId !== currentUser || generation !== revision) return null
    rows.value = saved
      ? rows.value.filter((item) => item.target_type !== targetType || item.target_id !== targetId)
      : [{ target_type: targetType, target_id: targetId, created_at: new Date().toISOString() }, ...rows.value]
    return !saved
  }
  return { favorites: set, loading, error, load, toggle }
}
