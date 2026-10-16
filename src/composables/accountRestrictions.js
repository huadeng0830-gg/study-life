import { computed, ref, shallowRef } from 'vue'
import { accountUser } from './accountAuth.js'
import { getSupabaseClient } from '../services/supabase.js'
import { restrictionActive } from './accountRestrictionModel.js'

/** @typedef {{scope:string,enabled:boolean,expiresAt:string|null,reason:string,revision:string,updatedAt:string,unread:boolean,active:boolean}} Restriction */
/** @typedef {{restrictions:Record<string,Restriction>,legacyBannedUntil:string|null,serverTime:string}} RestrictionSnapshot */
export const accountRestrictions = shallowRef(/** @type {RestrictionSnapshot|null} */ (null))
export const restrictionStatus = ref('idle')
export const restrictionError = ref('')
export const restrictionNow = ref(Date.now())
const snapshotUser = ref('')
let generation = 0
let serverOffset = 0
let lastRead = 0
let inFlight = null
let controller = null

export function tickRestrictionClock() { restrictionNow.value = Date.now() + serverOffset }
export const restrictionSnapshotKnown = computed(() => Boolean(accountUser.value?.id && snapshotUser.value === accountUser.value.id && accountRestrictions.value))
export const accountCloudRestricted = computed(() => {
  if (snapshotUser.value !== accountUser.value?.id) return false
  return restrictionActive(accountRestrictions.value?.restrictions.account, restrictionNow.value)
    || Boolean(accountRestrictions.value?.legacyBannedUntil && Date.parse(accountRestrictions.value.legacyBannedUntil) > restrictionNow.value)
})
export const accountPublishingRestricted = computed(() => snapshotUser.value === accountUser.value?.id && restrictionActive(accountRestrictions.value?.restrictions.publish, restrictionNow.value))

export function clearAccountRestrictions() {
  generation += 1
  controller?.abort()
  controller = null
  inFlight = null
  snapshotUser.value = ''
  accountRestrictions.value = null
  restrictionStatus.value = 'idle'
  restrictionError.value = ''
  lastRead = 0
  serverOffset = 0
}

async function ownRequest(name, args, userId, signal) {
  const client = await getSupabaseClient()
  const { data, error } = await client.auth.getSession()
  if (error || !data?.session?.access_token || data.session.user?.id !== userId || accountUser.value?.id !== userId) throw new Error('登录状态已变化，请重新登录。')
  return client.rpc(name, args).setHeader('Authorization', `Bearer ${data.session.access_token}`).abortSignal(signal)
}

export async function refreshAccountRestrictions({ force = false } = {}) {
  const userId = accountUser.value?.id
  if (!userId) { clearAccountRestrictions(); return null }
  if (snapshotUser.value && snapshotUser.value !== userId) clearAccountRestrictions()
  if (inFlight) return inFlight
  if (navigator.onLine === false || (!force && Date.now() - lastRead < 30000)) return accountRestrictions.value
  const run = generation
  const current = new AbortController()
  controller = current
  restrictionStatus.value = 'loading'
  const timer = window.setTimeout(() => current.abort(), 12000)
  const task = (async () => {
    try {
      const { data, error } = await ownRequest('platform_my_restrictions', {}, userId, current.signal)
      if (run !== generation || accountUser.value?.id !== userId) return null
      if (error || !data?.restrictions || !Number.isFinite(Date.parse(data.serverTime))) throw new Error('暂时无法读取账号处理通知，请联网后重试。')
      snapshotUser.value = userId
      serverOffset = Date.parse(data.serverTime) - Date.now()
      tickRestrictionClock()
      accountRestrictions.value = data
      restrictionStatus.value = 'ready'
      restrictionError.value = ''
      lastRead = Date.now()
      return data
    } catch (error) {
      if (run === generation && accountUser.value?.id === userId) {
        restrictionStatus.value = 'error'
        restrictionError.value = error instanceof Error && error.name === 'AbortError' ? '账号状态检查超时，请稍后重试。' : '暂时无法读取账号处理通知，请联网后重试。'
      }
      return null
    } finally {
      window.clearTimeout(timer)
      if (controller === current) { controller = null; inFlight = null }
    }
  })()
  inFlight = task
  return task
}

export async function acknowledgeRestriction(scope, revision) {
  const userId = accountUser.value?.id
  if (!userId || snapshotUser.value !== userId) return false
  const current = new AbortController()
  const timer = window.setTimeout(() => current.abort(), 12000)
  try {
    const { data, error } = await ownRequest('platform_ack_restriction', { p_scope: scope, p_revision: revision }, userId, current.signal)
    const snapshot = accountRestrictions.value
    if (error || data !== true || accountUser.value?.id !== userId || !snapshot || snapshot.restrictions[scope]?.revision !== revision) return false
    accountRestrictions.value = { ...snapshot, restrictions: { ...snapshot.restrictions, [scope]: { ...snapshot.restrictions[scope], unread: false } } }
    return true
  } finally { window.clearTimeout(timer) }
}
