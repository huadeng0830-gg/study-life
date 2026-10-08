import { ref, shallowRef } from 'vue'
export const accountSyncStatus = ref('signed-out')
export const accountSyncError = ref('')
export const accountSyncLastSyncedAt = ref('')
/** @type {import('vue').ShallowRef<any[]>} */
export const accountSyncConflicts = shallowRef([])
export function accountConflictKey(conflict) { return conflict.key + ':' + (conflict.entityId || conflict.key) }
export async function syncAccountNow() {
  const { runAccountSync } = await import('./accountSyncEngine.js')
  return runAccountSync()
}
export async function resolveAccountConflicts(choices) {
  const { runAccountSync } = await import('./accountSyncEngine.js')
  return runAccountSync(choices)
}
