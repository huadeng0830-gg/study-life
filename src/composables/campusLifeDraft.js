import { computed, onScopeDispose, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'

const PREFIX = 'study-life:campus-draft:v1'

function copy(value) { return typeof globalThis.structuredClone === 'function' ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value)) }
function storage() { try { return globalThis.localStorage || null } catch { return null } }

function parseDraft(storageKey, fallback) {
  const store = storage()
  if (!storageKey || !store) return copy(fallback)
  try {
    const parsed = JSON.parse(store.getItem(storageKey) || 'null')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...copy(fallback), ...parsed } : copy(fallback)
  } catch { return copy(fallback) }
}

/** Store publication drafts in a per-account, per-domain local namespace. */
export function useCampusLifeDraft(domain, fallback) {
  const ownerId = ref(accountUser.value?.id || '')
  const key = computed(() => ownerId.value ? `${PREFIX}:${ownerId.value}:${domain}` : '')
  const value = ref(parseDraft(key.value, fallback))
  const serial = ref(0)

  const stopOwner = watch(() => accountUser.value?.id || '', (next) => {
    ownerId.value = next
    value.value = parseDraft(key.value, fallback)
  }, { immediate: false })
  const stopValue = watch(value, (next) => {
    const store = storage()
    if (!key.value || !store) return
    try {
      store.setItem(key.value, JSON.stringify(next))
      serial.value += 1
    } catch { /* Draft persistence is best-effort; the form remains usable. */ }
  }, { deep: true })

  function clear() {
    try { if (key.value) storage()?.removeItem(key.value) } catch { /* Ignore storage restrictions. */ }
    value.value = copy(fallback)
  }
  onScopeDispose(() => { stopOwner(); stopValue() })
  return { value, clear, savedRevision: serial }
}
