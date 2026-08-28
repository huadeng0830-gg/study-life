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

  const limited = await enforceRateLimit(request, env.STUDY_LIFE_SYNC_RATE_LIMIT || env.STUDY_LIFE_SYNC)
  if (limited) return limited

  let code = ''
  try {
    const body = await request.clone().json()
    code = body.code || ''
  } catch {
    // 交给下游接口返回更具体的请求体错误。
  }

  if (!/^\d{6}$/.test(code)) {
    return json({ error: code ? '访问码必须是 6 位数字' : '需要访问码' }, 400)
  }

  context.data.code = code
  context.data.codeHash = await hashCode(code)
  context.data.kv = env.STUDY_LIFE_SYNC

  return next()
}

// KV 计数可阻断普通在线猜测并提供冷却时间；生产环境可绑定独立 KV，避免与业务数据争用。
async function enforceRateLimit(request, limiter) {
  if (!limiter?.get || !limiter?.put) return null
  const client = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
  const key = `rate:${await hashCode(client)}`
  const now = Date.now()
  const previous = await limiter.get(key, 'json')
  const windowStartedAt = Number(previous?.windowStartedAt) || now
  const inWindow = now - windowStartedAt < 60_000
  const count = inWindow ? (Number(previous?.count) || 0) + 1 : 1
  if (count > 12) {
    const retryAfter = Math.max(1, Math.ceil((60_000 - (now - windowStartedAt)) / 1000))
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'Retry-After': String(retryAfter) })
  }
  await limiter.put(key, JSON.stringify({ windowStartedAt: inWindow ? windowStartedAt : now, count }), { expirationTtl: 120 })
  return null
}

async function hashCode(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
