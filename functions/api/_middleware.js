import { constantTimeEqual, hashSecret, hashSpaceId, MAX_ENCRYPTED_PAYLOAD_LENGTH, MAX_SYNC_REQUEST_BODY_BYTES, normalizeSpaceId, readSpaceMeta, validSpaceId } from './sync/spaceUtils.js'
import { readCoordinatorResponse, requestCoordinator } from './sync/coordinator.js'

export async function onRequest(context) {
  const { request, env, next } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  if (!env.STUDY_LIFE_SYNC) {
    return json({ error: '云同步服务尚未配置' }, 503)
  }

  // 凭据只接受 POST 请求体，绝不从 URL 查询参数读取，避免进入访问日志和历史记录。
  if (request.method !== 'POST') return json({ error: '云同步接口只接受 POST 请求' }, 405)

  const path = new URL(request.url).pathname
  const contentLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_SYNC_REQUEST_BODY_BYTES) {
    return json({ error: '同步请求体过大' }, 413)
  }
  // 先按原始 UTF-8 字节数限制，再解析 JSON；不能让超大 JSON 先进入解析器。
  let rawBody = ''
  try { rawBody = await request.clone().text() } catch { return json({ error: '请求体读取失败' }, 400) }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_SYNC_REQUEST_BODY_BYTES) {
    return json({ error: '同步请求体过大' }, 413)
  }
  let body = {}
  try {
    const parsed = JSON.parse(rawBody)
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {}
  if (body?.data?.length > MAX_ENCRYPTED_PAYLOAD_LENGTH || byteLength(body) > MAX_SYNC_REQUEST_BODY_BYTES) {
    return json({ error: '同步请求体过大' }, 413)
  }
  const limited = await enforceRateLimit(request, env.STUDY_LIFE_SYNC_RATE_LIMIT || env.STUDY_LIFE_SYNC, { path, body })
  if (limited) return limited

  context.data.kv = env.STUDY_LIFE_SYNC

  const publicPath = ['/api/sync/health', '/api/sync/space/create', '/api/sync/space/recover', '/api/sync/pair/claim'].includes(path)
  if (publicPath) return next()

  const code = String(body.code || '')
  if (/^\d{6}$/.test(code)) {
    context.data.code = code
    context.data.codeHash = await hashSecret(code)
    context.data.syncKeyHash = context.data.codeHash
    return next()
  }

  const spaceId = normalizeSpaceId(body.spaceId)
  if (spaceId) {
    if (!validSpaceId(spaceId)) return json({ error: '同步空间编号格式无效' }, 400)
    if (typeof body.deviceCredential !== 'string' || body.deviceCredential.length < 32) {
      return json({ error: '需要本设备同步授权' }, 401)
    }
    const spaceHash = await hashSpaceId(spaceId)
    const spaceMeta = await readSpaceMeta(context.data.kv, spaceHash)
    const credentialHash = await hashSecret(body.deviceCredential)
    let device = spaceMeta?.devices?.find((item) => !item.revokedAt && constantTimeEqual(item.credentialVerifier, credentialHash)) || null
    if (!spaceMeta || (!device && !env.SYNC_COORDINATOR)) return json({ error: '此设备的同步授权已失效，请重新绑定。' }, 401)
    context.data.spaceId = spaceId
    context.data.spaceHash = spaceHash
    // 复用现有同步 / Durable Object 路径：space hash 只是新身份命名空间，业务 payload 不变。
    context.data.codeHash = spaceHash
    context.data.syncKeyHash = spaceHash
    context.data.spaceMeta = spaceMeta
    context.data.spaceDevice = device
    if (env.SYNC_COORDINATOR) {
      const authorization = await requestCoordinator({ env, data: { codeHash: spaceHash } }, {
        operation: 'authorize',
        credentialVerifier: credentialHash,
        devices: spaceMeta.devices,
      })
      if (!authorization) return json({ error: '同步协调服务不可用，请稍后重试' }, 503)
      const authorizationResult = await readCoordinatorResponse(authorization)
      const authorizedBody = authorizationResult.body
      if (authorizationResult.status >= 400 || !authorizedBody.device) return json({ error: authorizedBody.error || '此设备的同步授权已失效，请重新绑定。', code: authorizedBody.code }, authorizationResult.status || 401)
      device = authorizedBody.device
      context.data.spaceMeta = { ...spaceMeta, devices: Array.isArray(authorizedBody.devices) ? authorizedBody.devices : spaceMeta.devices }
      context.data.spaceDevice = device
      context.data.authEpoch = Number(device.authEpoch || 1)
    }
    return next()
  }

  return json({ error: Object.keys(body).length ? '需要访问码或设备同步授权' : '需要访问码' }, 400)

  return next()
}

function byteLength(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return MAX_SYNC_REQUEST_BODY_BYTES + 1 }
}

// KV 计数可阻断普通在线猜测并提供冷却时间；生产环境可绑定独立 KV，避免与业务数据争用。
async function enforceRateLimit(request, limiter, { path = '', body = {} } = {}) {
  if (!limiter?.get || !limiter?.put) return null
  const client = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
  const policy = ratePolicy(path)
  const space = normalizeSpaceId(body.spaceId)
  const endpoint = path || '/unknown'
  const devicePart = policy.perDevice
    ? await hashSecret(body.deviceCredential || body.code || '')
    : ''
  const identity = [client, endpoint, space || 'no-space', devicePart].join(':')
  const key = `rate:${await hashSecret(identity)}`
  const now = Date.now()
  const previous = await limiter.get(key, 'json')
  const windowStartedAt = Number(previous?.windowStartedAt) || now
  const inWindow = now - windowStartedAt < policy.windowMs
  const count = inWindow ? (Number(previous?.count) || 0) + 1 : 1
  if (count > policy.limit) {
    const retryAfter = Math.max(1, Math.ceil((policy.windowMs - (now - windowStartedAt)) / 1000))
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'Retry-After': String(retryAfter) })
  }
  await limiter.put(key, JSON.stringify({ windowStartedAt: inWindow ? windowStartedAt : now, count }), { expirationTtl: Math.ceil(policy.windowMs / 1000) + 60 })
  return null
}

function ratePolicy(path) {
  if (path.endsWith('/auth/verify')) return { limit: 12, windowMs: 60_000, perDevice: false }
  if (path.endsWith('/space/verify')) return { limit: 12, windowMs: 60_000, perDevice: false }
  if (path.endsWith('/revision')) return { limit: 120, windowMs: 60_000, perDevice: true }
  if (path.endsWith('/pull') || path.endsWith('/push')) return { limit: 60, windowMs: 60_000, perDevice: true }
  if (path.includes('/pair/') || path.endsWith('/recover') || path.endsWith('/space/create')) return { limit: 5, windowMs: 10 * 60_000, perDevice: false }
  return { limit: 30, windowMs: 60_000, perDevice: false }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  })
}
