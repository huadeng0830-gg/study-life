import { computed, onScopeDispose, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'

const PREFIX = 'study-life:campus-draft:v1'

function copy(value) { return typeof globalThis.structuredClone === 'function' ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value)) }
function storage() { try { return globalThis.localStorage || null } catch { return null } }

// Restore only fields supported by the current form, including defaults introduced
// since the draft was saved. Local storage may contain incomplete or corrupt data.
function restore(value, fallback) {
  if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return Object.fromEntries(Object.entries(fallback).map(([key, initial]) => [key, restore(source[key], initial)]))
  }
  // Vue number inputs save numeric JSON even when their empty default is ''.
  if (typeof fallback === 'string' && typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === typeof fallback ? value : copy(fallback)
}

function parseDraft(storageKey, fallback) {
  const store = storage()
  if (!storageKey || !store) return copy(fallback)
  try {
    const parsed = JSON.parse(store.getItem(storageKey) || 'null')
    return restore(parsed, fallback)
  } catch { return copy(fallback) }
}

/** Store publication drafts in a per-account, per-domain local namespace. */
export function useCampusLifeDraft(domain, fallback) {
  const ownerId = ref(accountUser.value?.id || '')
  const key = computed(() => ownerId.value ? `${PREFIX}:${ownerId.value}:${domain}` : '')
  const value = ref(parseDraft(key.value, fallback))
  const serial = ref(0)
  const saveError = ref('')

  const stopOwner = watch(() => accountUser.value?.id || '', (next) => {
    ownerId.value = next
    value.value = parseDraft(key.value, fallback)
    serial.value = 0
    saveError.value = ''
  }, { flush: 'sync' })
  const stopValue = watch(value, (next) => {
    const store = storage()
    if (!key.value) return
    if (!store) { saveError.value = '本机存储不可用，离开页面前请保留已填写的内容。'; return }
    try {
      store.setItem(key.value, JSON.stringify(next))
      serial.value += 1
      saveError.value = ''
    } catch { saveError.value = '草稿暂未保存到本机，离开页面前请保留已填写的内容。' }
  }, { deep: true, flush: 'sync' })

  function clear() {
    try { if (key.value) storage()?.removeItem(key.value) } catch { /* Ignore storage restrictions. */ }
    value.value = copy(fallback)
  }
  onScopeDispose(() => { stopOwner(); stopValue() })
  return { value, clear, savedRevision: serial, saveError }
}
