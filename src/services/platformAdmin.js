import { EDGE_FUNCTION_TIMEOUT_MS } from './cloudConfig.js'
import { accountUser } from '../composables/accountAuth.js'
import { getSupabaseClient } from './supabase.js'

const SAFE_MESSAGES = Object.freeze({
  unauthorized: '登录状态已失效，请重新登录。',
  email_verification_required: '请先完成邮箱验证。',
  forbidden: '当前账号没有平台管理权限。',
  registration_changed: '注册设置已在其他页面更新，请刷新状态后重试。',
  self_action_forbidden: '不能暂停或恢复当前平台所有者账号。',
  invalid_input: '输入内容有误，请检查后重试。',
  origin_not_allowed: '当前访问来源未获授权。',
  not_found: '没有找到这个账号，请刷新列表。',
  state_changed: '账号状态已变化，请刷新后重试。',
  reviewer_unverified: '对方需要先注册并验证邮箱，再授予审核权限。',
  operation_failed: '账号状态修改失败，请稍后重试。',
  place_not_found: '没有找到这个地点，请刷新审核队列。',
  place_state_changed: '地点内容或状态已变化，请刷新后重新检查。',
  review_operation_failed: '审核结果没有保存，请稍后重试。',
  service_unavailable: '平台管理服务暂时不可用，请稍后重试。',
})

export class PlatformAdminRequestError extends Error {
  constructor(code, status = 0) {
    super(SAFE_MESSAGES[code] || '管理操作未完成，请稍后重试。')
    this.name = 'PlatformAdminRequestError'
    this.code = code
    this.status = status
  }
}

async function readFunctionError(error) {
  try {
    const response = error?.context
    if (response && typeof response.json === 'function') {
      const body = await response.json()
      return { code: String(body?.code || 'service_unavailable'), status: response.status || 0 }
    }
  } catch { /* 使用固定错误文案，不展示服务端或数据库原始异常。 */ }
  return { code: 'service_unavailable', status: 0 }
}

export async function platformAdminRequest(action, payload = {}) {
  const userId = accountUser.value?.id
  if (!userId) throw new PlatformAdminRequestError('unauthorized', 401)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new PlatformAdminRequestError('service_unavailable', 0)

  const client = await getSupabaseClient()
  const { data: auth, error: authError } = await client.auth.getSession()
  const session = auth?.session
  if (authError || !session?.access_token || session.user?.id !== userId || accountUser.value?.id !== userId) {
    throw new PlatformAdminRequestError('unauthorized', 401)
  }

  const result = await client.functions.invoke('platform-admin', {
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
    body: { action, payload },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (accountUser.value?.id !== userId) throw new PlatformAdminRequestError('unauthorized', 401)
  if (result.error) {
    const detail = await readFunctionError(result.error)
    throw new PlatformAdminRequestError(detail.code, detail.status)
  }
  if (!result.data || typeof result.data !== 'object' || !('data' in result.data)) {
    throw new PlatformAdminRequestError('service_unavailable', 503)
  }
  return result.data.data
}
