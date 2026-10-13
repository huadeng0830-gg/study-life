const MAX_BODY_BYTES = 8_192
const MAX_REASON_LENGTH = 500
const ACTIONS = new Set(['identity', 'overview', 'users_list', 'audit_list', 'user_suspend', 'user_restore'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class PlatformAdminError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function json(body, status = 200, origin = '') {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info, x-supabase-api-version'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
  }
  return new Response(JSON.stringify(body), { status, headers })
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_BODY_BYTES) throw new PlatformAdminError('invalid_input', '请求内容过大。', 413)
  if (!request.body) return {}
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new PlatformAdminError('invalid_input', '请求内容过大。', 413)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    const value = JSON.parse(text || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body')
    return value
  } catch {
    throw new PlatformAdminError('invalid_input', '请求内容无效。')
  }
}

function requiredText(value, label, maxLength = MAX_REASON_LENGTH) {
  if (typeof value !== 'string') throw new PlatformAdminError('invalid_input', `${label}格式不正确。`)
  const text = value.trim()
  if (!text || text.length > maxLength) throw new PlatformAdminError('invalid_input', `${label}需要填写且不能超过 ${maxLength} 个字符。`)
  return text
}

function requiredUuid(value, label) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new PlatformAdminError('invalid_input', `${label}无效。`)
  return value
}

function positivePage(value) {
  const page = Number(value ?? 1)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new PlatformAdminError('invalid_input', '页码无效，请刷新后重试。')
  return page
}

export function createPlatformAdminHandler({ service, allowedOrigins = [], logger = console }) {
  const origins = new Set(allowedOrigins)

  return async (request) => {
    const requestOrigin = request.headers.get('origin') || ''
    const corsOrigin = origins.has(requestOrigin) ? requestOrigin : ''
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, corsOrigin)
    if (request.method !== 'POST') return json({ error: '仅支持 POST。', code: 'method_not_allowed' }, 405, corsOrigin)
    if (requestOrigin && !corsOrigin) return json({ error: '来源不受支持。', code: 'origin_not_allowed' }, 403)

    try {
      const authorization = request.headers.get('Authorization') || ''
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
      if (!token) throw new PlatformAdminError('unauthorized', '登录已失效，请重新登录。', 401)
      const user = await service.authenticate(token)
      if (!user?.id) throw new PlatformAdminError('unauthorized', '登录已失效，请重新登录。', 401)
      if (!user.email_confirmed_at) throw new PlatformAdminError('email_verification_required', '请先完成邮箱验证。', 403)
      if (!await service.isOwner(user.id)) throw new PlatformAdminError('forbidden', '当前账号没有平台管理权限。', 403)

      const body = await readBody(request)
      if (typeof body.action !== 'string' || !ACTIONS.has(body.action)) throw new PlatformAdminError('invalid_input', '管理操作无效。')
      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {}
      switch (body.action) {
        case 'identity':
          return json({ data: { owner: true, email: user.email || '' } }, 200, corsOrigin)
        case 'overview':
          return json({ data: await service.getOverview() }, 200, corsOrigin)
        case 'users_list': {
          const page = positivePage(payload.page)
          const query = typeof payload.query === 'string' ? payload.query.trim().slice(0, 120) : ''
          return json({ data: await service.listUsers({ page, query }) }, 200, corsOrigin)
        }
        case 'audit_list': {
          const limit = Number(payload.limit ?? 20)
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new PlatformAdminError('invalid_input', '审计记录数量无效。')
          return json({ data: await service.listAudit(limit) }, 200, corsOrigin)
        }
        case 'user_suspend':
        case 'user_restore': {
          const targetUserId = requiredUuid(payload.userId, '账号')
          if (targetUserId === user.id) throw new PlatformAdminError('self_action_forbidden', '不能暂停或恢复当前平台所有者账号。', 403)
          const reason = requiredText(payload.reason, '处理原因')
          const result = await service.setUserSuspended({
            actorUserId: user.id,
            targetUserId,
            suspended: body.action === 'user_suspend',
            reason,
          })
          return json({ data: result }, 200, corsOrigin)
        }
        default:
          throw new PlatformAdminError('invalid_input', '管理操作无效。')
      }
    } catch (error) {
      if (error instanceof PlatformAdminError) return json({ error: error.message, code: error.code }, error.status, corsOrigin)
      logger.error('[platform-admin] request failed', error instanceof Error ? error.name : 'unknown')
      return json({ error: '平台管理服务暂时不可用，请稍后重试。', code: 'service_unavailable' }, 503, corsOrigin)
    }
  }
}
