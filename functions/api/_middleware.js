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

  // 旧版 6 位数字访问码：只有 10^6 种，而且下面只校验格式、不校验"是否正确"——
  // 它本来就是 capability 而不是认证（服务端没有"正确访问码"这个概念，codeHash
  // 直接当 KV 命名空间用）。拿到密文的人可以离线全量爆破，PBKDF2 的迭代次数
  // 对这种低熵输入也帮不上忙。
  //
  // 【不要拿 SYNC_LEGACY_MIGRATION 当这里的开关】那个变量只决定 readLegacyRecord
  // 是否回落到旧 KV 命名空间（见 sync/coordinator.js:36），与本条鉴权路径无关。
  // 早期把"关掉旧版"等同于改那个变量，会留下一个看起来已经关掉了的陷阱。
  // 这里用语义明确的 SYNC_LEGACY_CODE_AUTH，且默认关闭。
  const code = String(body.code || '')
  if (code) {
    if (env.SYNC_LEGACY_CODE_AUTH !== 'enabled') {
      return json({ error: '旧版访问码同步已停用，请改用同步空间绑定。' }, 410)
    }
    if (!/^\d{6}$/.test(code)) return json({ error: '访问码格式无效' }, 400)
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
//
// 【为什么是两层】早期实现只有一个桶，键里含 devicePart（设备凭据或访问码的哈希）。
// 旧版访问码路径本来就没有 deviceCredential，devicePart 于是退化成"被猜的那个码"
// 本身：换一个码就换一个桶，每个猜测值各自享有独立额度 —— 整条路径的限流等于没有。
//
// 两层的分工必须分清，否则会互相拆台：
//   · 第 2 层（来源+端点+空间+设备）才是**真正的额度**，按设备隔离，
//     所以同一 NAT 下的多台设备可以各自用满自己的 burst（见 syncSpaceBackend.test.js）。
//   · 第 1 层（来源+端点）只做**粗粒度兜底**，额度取第 2 层的若干倍。
//     它防的是"疯狂换 deviceCredential 刷桶"和整体滥用，**不**用来做精确配额；
//     如果两层取同一个额度，NAT 下的正常多设备使用会被误杀。
//
// 真正堵住旧版 6 位访问码的不是这里，而是下面 SYNC_LEGACY_CODE_AUTH 默认关闭那道闸
// —— 限流只是纵深防御：10^6 的密钥空间靠限流是挡不住的。
async function enforceRateLimit(request, limiter, { path = '', body = {} } = {}) {
  if (!limiter?.get || !limiter?.put) return null
  const client = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
  const policy = ratePolicy(path)
  const space = normalizeSpaceId(body.spaceId)
  const endpoint = path || '/unknown'
  const devicePart = policy.perDevice
    ? await hashSecret(body.deviceCredential || body.code || '')
    : ''
  const now = Date.now()
  // 第 1 层：只看来源与端点，完全不受请求体影响，所以换访问码/换设备凭据都换不掉它。
  const buckets = [{ identity: `${client}|${endpoint}`, limit: ipCeiling(policy) }]
  // 第 2 层：真正的按设备配额。
  buckets.push({
    identity: `${client}|${endpoint}|${space || 'no-space'}|${devicePart}`,
    limit: policy.limit,
  })
  for (const bucket of buckets) {
    const key = `rate:${await hashSecret(bucket.identity)}`
    const previous = await limiter.get(key, 'json')
    const windowStartedAt = Number(previous?.windowStartedAt) || now
    const inWindow = now - windowStartedAt < policy.windowMs
    const count = inWindow ? (Number(previous?.count) || 0) + 1 : 1
    if (count > bucket.limit) {
      const retryAfter = Math.max(1, Math.ceil((policy.windowMs - (now - windowStartedAt)) / 1000))
      return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'Retry-After': String(retryAfter) })
    }
    await limiter.put(key, JSON.stringify({ windowStartedAt: inWindow ? windowStartedAt : now, count }), { expirationTtl: Math.ceil(policy.windowMs / 1000) + 60 })
  }
  return null
}

// 粗粒度兜底额度：按设备额度的 4 倍，并留一个地板值。
// 4 倍是刻意选的 —— 要容得下同一 NAT 下几台设备各自的正常 burst，
// 又要让"不停换 deviceCredential 刷新桶"在几分钟内就撞到天花板。
function ipCeiling(policy) {
  return Math.max(policy.limit * 4, 40)
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
