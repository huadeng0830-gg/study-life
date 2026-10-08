import { accountUser } from '../composables/accountAuth.js'
import { accountSyncStatus, syncAccountNow } from '../composables/accountSyncState.js'
import { accountSyncViaAccount } from '../composables/accountSyncMode.js'
import { getSupabaseClient } from './supabase.js'

export class SocialError extends Error {
  constructor(code, message, status = 0) {
    super(message)
    this.name = 'SocialError'
    this.code = code
    this.status = status
  }
}

function signedInUser({ requireVerified = true } = {}) {
  const user = accountUser.value
  if (!user?.id) throw new SocialError('signed_out', '请先登录账号，再使用好友协作。', 401)
  if (requireVerified && !user.email_confirmed_at) throw new SocialError('email_verification_required', '请先完成邮箱验证，再使用好友协作。', 403)
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

function messageFor(code, fallback) {
  const messages = {
    unauthorized: '登录已失效，请重新登录。',
    email_verification_required: '请先完成邮箱验证，再使用好友协作。',
    invalid_input: '内容格式不正确，请检查后重试。',
    not_found: '内容已更新，请刷新后查看。',
    rate_limited: '操作太频繁了，请稍后再试。',
    schedule_unknown: '暂时无法确认双方的课表范围，请检查双方的课表完整日期和账号同步状态。',
    schedule_changed: '课表或可约偏好刚刚发生变化，请刷新共同时间后重试。',
    conflict: '所选时间已不再空闲，请刷新后重新选择。',
    friendship_required: '只能与已添加的好友匹配共同时间。',
    state_changed: '邀约状态已变化，请刷新后查看。',
  }
  return messages[code] || fallback || '操作没有完成，请稍后重试。'
}

async function parseFunctionError(error) {
  try {
    const context = error?.context
    if (context && typeof context.json === 'function') {
      const body = await context.json()
      return { code: body?.code || 'service_unavailable', message: body?.error || error.message, status: context.status || 0 }
    }
  } catch { /* 由固定文案兜底，避免把提供方错误原样展示。 */ }
  return { code: 'service_unavailable', message: '', status: 0 }
}

export async function socialRequest(action, payload = {}) {
  const user = signedInUser({ requireVerified: !['profile_get', 'profile_save'].includes(action) })
  if (!navigator.onLine) throw new SocialError('offline', '当前离线，操作尚未保存；联网后请重试。', 0)
  const client = await getSupabaseClient()
  const { data: authData, error: authError } = await client.auth.getSession()
  if (authError || !currentSessionMatches(user.id, authData?.session)) {
    throw new SocialError('unauthorized', '登录已失效，请重新登录。', 401)
  }
  const { data, error } = await client.functions.invoke('campus-social', { body: { action, payload } })
  if (accountUser.value?.id !== user.id) throw new SocialError('account_changed', '登录账号已切换，本次操作已取消。', 401)
  if (error) {
    const detail = await parseFunctionError(error)
    throw new SocialError(detail.code, messageFor(detail.code, detail.message), detail.status)
  }
  if (!data || typeof data !== 'object' || !('data' in data)) {
    throw new SocialError('service_unavailable', '服务没有返回有效结果，请稍后重试。', 503)
  }
  return data.data
}

export async function subscribeSocialNotifications(userId, onChange) {
  const client = await getSupabaseClient()
  if (accountUser.value?.id !== userId) return () => {}
  const channel = client.channel(`social-notices-${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'social_notifications', filter: `recipient_id=eq.${userId}`,
    }, onChange)
    .subscribe()
  return () => { void client.removeChannel(channel) }
}
