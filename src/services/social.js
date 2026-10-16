import { accountUser } from '../composables/accountAuth.js'
import { hasVerifiedContactEmail } from '../composables/accountVerification.js'
import { accountSyncStatus, syncAccountNow } from '../composables/accountSyncState.js'
import { accountSyncViaAccount } from '../composables/accountSyncMode.js'
import { getSupabaseClient } from './supabase.js'
import { campusReadCache as readCache, campusReadAccountRevision, invalidateCampusReads } from './campusReadCache.js'
import { EDGE_FUNCTION_TIMEOUT_MS } from './cloudConfig.js'

const campusReads = new Set([
  'search', 'courses_list', 'market_list', 'help_list', 'shuttle_list',
  'lost_found_list', 'events_list', 'guides_list', 'mine_list',
  'market_interest_list', 'help_applications_list', 'lost_found_claims_list',
  'favorite_list',
  'matter_overview', 'matter_list', 'matter_detail',
])
// These reads need live authorization/current state on every call, but reading
// notifications or an admin screen must not invalidate unrelated campus data.
const uncachedCampusReads = new Set(['governance_access', 'moderation_queue', 'moderation_history', 'message_list', 'reports_mine'])
const uncachedSocialReads = new Set([
  'email_search', 'friends_list', 'availability_query', 'invitations_list',
  'notifications_list', 'campus_place_invites_list',
  'project_time_availability', 'project_meetings_list',
])
async function cachedCampusRequest(action, payload, request, options = { area: '校园服务' }, signal) {
  const user = signedInUser(options)
  const generation = campusReadAccountRevision()
  if (!navigator.onLine) return request(signal)
  const key = JSON.stringify([user.id, action, payload])
  const result = await readCache.read(key, request, { signal })
  if (campusReadAccountRevision() !== generation) throw new SocialError('account_changed', '登录状态已变化，请重新打开页面。', 401)
  return result
}

export class SocialError extends Error {
  constructor(code, message, status = 0) {
    super(message)
    this.name = 'SocialError'
    this.code = code
    this.status = status
  }
}

function signedInUser({ requireVerified = true, area = '好友协作' } = {}) {
  const user = accountUser.value
  if (!user?.id) throw new SocialError('signed_out', `请先登录账号，再使用${area}。`, 401)
  if (requireVerified && !hasVerifiedContactEmail(user)) throw new SocialError('email_verification_required', `请先完成邮箱验证，再使用${area}。`, 403)
  return user
}

function currentSessionMatches(userId, session) {
  return accountUser.value?.id === userId && session?.user?.id === userId
}

export async function ensureSocialScheduleReady() {
  const user = signedInUser()
  if (!navigator.onLine) throw new SocialError('offline', '需要联网并同步课表，才能查找或确认共同时间。', 0)
  if (!accountSyncViaAccount.value) {
    throw new SocialError('sync_disabled', '请先在“我的账号”中开启账号同步，再共享课表空闲时间。', 409)
  }
  const synced = await syncAccountNow()
  if (!synced || accountSyncStatus.value !== 'synced') {
    throw new SocialError('schedule_not_synced', '课表尚未同步完成；本机数据仍已保留，请解决同步状态后重试。', 409)
  }
  if (accountUser.value?.id !== user.id) throw new SocialError('account_changed', '登录账号已切换，请重新打开好友协作。', 401)
  return user
}

function messageFor(code, fallback, action = '') {
  if (action.startsWith('campus_life_')) {
    const campusMessages = {
      private_contact_not_allowed: '公开内容或私信不能包含个人联系方式、取件码或宿舍房间号。',
        profile_required: '请先在“我的账号”填写学校资料；校园归属是自填信息，不代表学校认证。',
      campus_required: '请先填写学校和当前校区，再浏览该校园内容。',
      event_full: '活动名额已满。',
      event_closed: '活动已截止或暂不可报名。',
      duplicate: '你已提交过相同内容，请刷新后查看。',
    }
    if (campusMessages[code]) return campusMessages[code]
  }
  if (action.startsWith('project_') && ['conflict', 'state_changed'].includes(code)) {
    return fallback || '项目刚刚发生变化，请刷新后重新提交。'
  }
  const messages = {
    unauthorized: '登录已失效，请重新登录。',
    email_verification_required: '请先完成邮箱验证，再使用好友协作。',
    invalid_input: '内容格式不正确，请检查后重试。',
    not_found: '内容已更新，请刷新后查看。',
    rate_limited: '操作太频繁了，请稍后再试。',
    request_timeout: '连接等待超时。请先刷新确认操作状态，再决定是否重试。',
    duplicate_place: '相同校区和区域已有同名地点，请先检查现有资料。',
    schedule_unknown: '暂时无法读取双方的课表，请检查账号同步状态后重试。',
    schedule_changed: '课表或可约偏好刚刚发生变化，请刷新共同时间后重试。',
    conflict: '所选时间已不再空闲，请刷新后重新选择。',
    friendship_required: '只能与已添加的好友匹配共同时间。',
    state_changed: '邀约状态已变化，请刷新后查看。',
  }
  return messages[code] || fallback || '操作没有完成，请稍后重试。'
}

async function parseFunctionError(error) {
  if (error?.context?.name === 'AbortError') return { code: 'request_timeout', message: '', status: 0 }
  try {
    const context = error?.context
    if (context && typeof context.json === 'function') {
      const body = await context.json()
      return { code: body?.code || 'service_unavailable', message: body?.error || error.message, status: context.status || 0 }
    }
  } catch { /* 由固定文案兜底，避免把提供方错误原样展示。 */ }
  return { code: 'service_unavailable', message: '', status: 0 }
}

async function requestFunction(functionName, action, payload, { requireVerified = true, area = '好友协作', messageAction = action, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  const user = signedInUser({ requireVerified, area })
  if (!navigator.onLine) throw new SocialError('offline', '当前离线，操作尚未保存；联网后请重试。', 0)
  const client = await getSupabaseClient()
  const { data: authData, error: authError } = await client.auth.getSession()
  const session = authData?.session
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  if (authError || !session?.access_token || !currentSessionMatches(user.id, session)) {
    invalidateCampusReads()
    throw new SocialError('unauthorized', '登录已失效，请重新登录。', 401)
  }
  // The SDK may resolve its default token after an account switch. Bind this
  // mutation to the session that authorized the user's original action.
  const { data, error } = await client.functions.invoke(functionName, {
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
    signal,
    body: { action, payload }, headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  if (accountUser.value?.id !== user.id) throw new SocialError('account_changed', '登录账号已切换，本次操作已取消。', 401)
  if (error) {
    const detail = await parseFunctionError(error)
    if (detail.status === 401 || detail.status === 403) invalidateCampusReads()
    throw new SocialError(detail.code, messageFor(detail.code, detail.message, messageAction), detail.status)
  }
  if (!data || typeof data !== 'object' || !('data' in data)) {
    throw new SocialError('service_unavailable', '服务没有返回有效结果，请稍后重试。', 503)
  }
  return data.data
}

export function socialRequest(action, payload = {}) {
  const options = { requireVerified: !['profile_get', 'profile_save'].includes(action), area: '好友协作' }
  const request = () => requestFunction('campus-social', action, payload, options)
  if (['profile_get', 'campus_places_list'].includes(action)) return cachedCampusRequest(`social:${action}`, payload, request, options)
  if (uncachedSocialReads.has(action)) return request()
  // Profile edits can change school/campus scope; never reuse earlier lists.
  invalidateCampusReads()
  return request().finally(invalidateCampusReads)
}

export function campusLifeRequest(action, payload = {}, { forceRefresh = false, signal } = {}) {
  const request = upstreamSignal => requestFunction('campus-life', action, payload, { area: '校园服务', messageAction: `campus_life_${action}`, signal: upstreamSignal })
  if (forceRefresh) readCache.clear()
  if (campusReads.has(action)) return cachedCampusRequest(action, payload, request, { area: '校园服务' }, signal)
  if (uncachedCampusReads.has(action)) return request(signal)
  // Invalidate before AND after a write: a read started while the write was
  // pending must not repopulate the next page with the pre-write response.
  invalidateCampusReads()
  return request().finally(invalidateCampusReads)
}

// Public feedback can be read before login. The function still verifies every
// mutation itself; this helper sends the current session only when one exists.
export async function campusCommunityRequest(action, payload = {}, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  if (!navigator.onLine) throw new SocialError('offline', '当前离线，操作尚未保存；联网后请重试。', 0)
  const client = await getSupabaseClient()
  const { data: authData, error: authError } = await client.auth.getSession()
  if (authError) throw new SocialError('unauthorized', '登录状态无法读取，请重新登录。', 401)
  const session = authData?.session
  const callerId = accountUser.value?.id || ''
  const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  const { data, error } = await client.functions.invoke('campus-community', { body: { action, payload }, headers, timeout: EDGE_FUNCTION_TIMEOUT_MS, signal })
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  if (callerId && accountUser.value?.id !== callerId) throw new SocialError('account_changed', '登录账号已切换，本次操作已取消。', 401)
  if (error) {
    const detail = await parseFunctionError(error)
    throw new SocialError(detail.code, messageFor(detail.code, detail.message, `campus_community_${action}`), detail.status)
  }
  if (!data || typeof data !== 'object' || !('data' in data)) throw new SocialError('service_unavailable', '服务没有返回有效结果，请稍后重试。', 503)
  return data.data
}

export function listCampusPlaces({ forceRefresh = false } = {}) {
  if (forceRefresh) readCache.clear()
  return socialRequest('campus_places_list')
}
export function publishCampusPlace(place) {
  return socialRequest('campus_place_publish', { place })
}
export function saveCampusPlaceRating(placeId, category, scores, note, { visited = false } = {}) {
  return socialRequest('campus_place_rating_save', { placeId, category, scores, note, visited })
}
export function reportCampusPlace(placeId, reason, detail = '') {
  return socialRequest('campus_place_report', { placeId, reason, detail })
}
export function deleteCampusPlaceRating(placeId) { return socialRequest('campus_place_rating_delete', { placeId }) }
export function deleteCampusPlace(placeId) { return socialRequest('campus_place_delete', { placeId }) }
export function listCampusPlaceInvites() { return socialRequest('campus_place_invites_list') }
export function sendCampusPlaceInvite(friendId, places, inviteId) {
  return socialRequest('campus_place_invite_send', { friendId, places, inviteId })
}
export function acceptCampusPlaceInvite(inviteId) { return socialRequest('campus_place_invite_preview', { inviteId }) }
export function completeCampusPlaceInvite(inviteId) { return socialRequest('campus_place_invite_complete', { inviteId }) }
export function rejectCampusPlaceInvite(inviteId) { return socialRequest('campus_place_invite_reject', { inviteId }) }
export function cancelCampusPlaceInvite(inviteId) { return socialRequest('campus_place_invite_cancel', { inviteId }) }

export async function subscribeSocialNotifications(userId, onChange) {
  const client = await getSupabaseClient()
  if (accountUser.value?.id !== userId) return () => {}
  let channel = null
  let disposed = false
  let removing = null
  let suspended = false
  const usable = () => !disposed && accountUser.value?.id === userId
    && document.visibilityState !== 'hidden' && navigator.onLine !== false
  const notify = (...args) => { if (usable()) onChange(...args) }
  function reconcile() {
    if (!usable()) {
      if (!disposed && accountUser.value?.id === userId) suspended = true
      if (channel) {
        const previous = channel
        channel = null
        suspended = true
        // Never overlap two same-name channels while unsubscribe is pending.
        removing = Promise.resolve(client.removeChannel(previous)).catch(() => {}).finally(() => {
          removing = null
          reconcile()
        })
      }
      return
    }
    if (channel || removing) return
    const next = client.channel(`social-notices-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'social_notifications', filter: `recipient_id=eq.${userId}`,
      }, (...args) => { if (channel === next) notify(...args) })
    channel = next
    next.subscribe(status => {
      // Catch up only after the live subscription is ready, closing the gap
      // between the snapshot read and receiving subsequent database events.
      if (status === 'SUBSCRIBED' && channel === next && usable() && suspended) {
        suspended = false
        notify()
      }
    })
  }
  document.addEventListener('visibilitychange', reconcile)
  window.addEventListener('online', reconcile)
  window.addEventListener('offline', reconcile)
  reconcile()
  return () => {
    if (disposed) return
    disposed = true
    document.removeEventListener('visibilitychange', reconcile)
    window.removeEventListener('online', reconcile)
    window.removeEventListener('offline', reconcile)
    reconcile()
  }
}
