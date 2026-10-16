import { inject, onScopeDispose, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusGovernanceAccess } from '../services/campusLife.js'

export const ADMIN_GOVERNANCE_ACCESS = Symbol('admin-governance-access')

export function useCampusGovernanceAccess() {
  const inherited = inject(ADMIN_GOVERNANCE_ACCESS, null)
  if (inherited) return inherited
  const access = ref(null)
  const error = ref('')
  const loading = ref(false)
  let generation = 0
  let active = true
  async function refresh() {
    const revision = ++generation
    const owner = accountUser.value?.id
    access.value = null
    error.value = ''
    loading.value = Boolean(owner)
    if (!owner) return
    try {
      const result = await campusGovernanceAccess()
      if (active && revision === generation && accountUser.value?.id === owner) access.value = result
    } catch (cause) {
      if (active && revision === generation) error.value = cause?.message || '审核身份暂时无法读取。'
    } finally {
      if (active && revision === generation) loading.value = false
    }
  }
  watch(() => accountUser.value?.id, () => { void refresh() }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { active = false; generation += 1 })
  return { access, error, loading, refresh }
}
