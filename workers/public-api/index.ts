const PUBLIC_FIELDS = ['id', 'category', 'title', 'body', 'status', 'public_author_name', 'public_history', 'public_reply', 'public_reason', 'reward_beans', 'reward_issued', 'created_at', 'updated_at']
const SUMMARY_FIELDS = ['id', 'category', 'title', 'status', 'public_author_name', 'created_at', 'updated_at']
const STATUSES = new Set(['pending','needs_info','planned','processing','resolved','not_adopted','duplicate'])
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const CACHE_SECONDS = 15

function publicConfig(env: Env) {
  try {
    const url = new URL(env.SUPABASE_URL)
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) return null
    const key = env.SUPABASE_PUBLISHABLE_KEY
    let publishable = key.startsWith('sb_publishable_')
    if (!publishable && key.split('.').length === 3) {
      try { publishable = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon' } catch { return null }
    }
    return publishable ? { origin: url.origin, key } : null
  } catch { return null }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}

function withCors(response: Response, origin: string) {
  const result = new Response(response.body, response)
  result.headers.set('Cache-Control', 'no-store')
  result.headers.set('Vary', 'Origin')
  if (origin) result.headers.set('Access-Control-Allow-Origin', origin)
  return result
}

async function readJson(response: Response) {
  if (!response.body) throw new Error('empty_response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('response_too_large')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let position = 0
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export async function handlePublicApi(request: Request, env: Env, ctx: ExecutionContext, fetcher: typeof fetch = fetch, cache: Cache = caches.default): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin') || ''
  const allowed = new Set(env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean))
  if (origin && !allowed.has(origin)) return json({ code: 'forbidden', error: '此来源未获授权。' }, 403)
  const respond = (body: unknown, status = 200) => withCors(json(body, status), origin)
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Access-Control-Request-Method') !== 'GET') return respond({ code: 'method_not_allowed' }, 405)
    const response = respond(null, 200)
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    return response
  }
  if (request.method !== 'GET') return respond({ code: 'method_not_allowed', error: '仅支持读取。' }, 405)
  const config = publicConfig(env)
  if (url.pathname === '/health') return respond({ service: 'study-life-public-api', ready: Boolean(config) }, config ? 200 : 503)
  if (url.pathname !== '/v1/feedback') return respond({ code: 'not_found' }, 404)
  if (!config) return respond({ code: 'service_unavailable', error: '服务尚未配置。' }, 503)
  for (const key of url.searchParams.keys()) {
    if (!['status', 'limit', 'offset', 'category', 'q', 'sort', 'view', 'id'].includes(key) || url.searchParams.getAll(key).length !== 1) return respond({ code: 'invalid_input' }, 400)
  }
  const status = url.searchParams.get('status') || ''
  if (status && !STATUSES.has(status)) return respond({ code: 'invalid_input' }, 400)
  const category = url.searchParams.get('category') || ''
  const q = (url.searchParams.get('q') || '').trim()
  const sort = url.searchParams.get('sort') || 'updated'
  const view = url.searchParams.get('view') || 'detail'
  const id = url.searchParams.get('id') || ''
  if ((category && !['product','campus','accessibility','other'].includes(category)) || q.length > 100 || !['newest','updated'].includes(sort) || !['summary','detail'].includes(view) || (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return respond({ code: 'invalid_input' }, 400)
  const fields = view === 'summary' ? SUMMARY_FIELDS : PUBLIC_FIELDS
  const limit = Number(url.searchParams.get('limit') || '30')
  const offset = Number(url.searchParams.get('offset') || '0')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return respond({ code: 'invalid_input' }, 400)

  // The key contains only canonical public filters. Tokens, cookies and arbitrary
  // client parameters never reach either the cache or the upstream request.
  const cacheUrl = new URL('/v1/feedback', url.origin)
  cacheUrl.search = new URLSearchParams({ status, category, q, sort, view, id, limit: String(limit), offset: String(offset) }).toString()
  const cacheKey = new Request(cacheUrl)
  try {
    const hit = await cache.match(cacheKey)
    if (hit) return withCors(hit, origin)
  } catch { /* Cache eviction or failure must not disable the public API. */ }
  const upstream = new URL('/rest/v1/campus_feedback_suggestions', config.origin)
  upstream.search = new URLSearchParams({ select: fields.join(','), visibility: 'eq.public', order: sort === 'newest' ? 'created_at.desc,id.asc' : 'updated_at.desc,id.asc', limit: String(limit), offset: String(offset), ...(status ? { status: `eq.${status}` } : {}), ...(category ? { category: `eq.${category}` } : {}), ...(id ? { id: `eq.${id}` } : {}), ...(q ? { or: '(title.imatch.' + JSON.stringify('***=' + q) + ',body.imatch.' + JSON.stringify('***=' + q) + ')' } : {}) }).toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  let stage = 'fetch'
  let upstreamStatus = 0
  try {
    const response = await fetcher(upstream, { headers: { apikey: config.key, Accept: 'application/json', Prefer: 'count=exact' }, signal: controller.signal, redirect: 'manual' })
    upstreamStatus = response.status
    stage = 'status'
    if (!response.ok) throw new Error('upstream_unavailable')
    stage = 'decode'
    const rows: unknown = await readJson(response)
    stage = 'shape'
    if (!Array.isArray(rows) || rows.length > limit || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('invalid_response')
    const items = rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]])))
    const total = Number(response.headers.get('Content-Range')?.split('/')[1])
    stage = 'count'
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('invalid_count')
    const result = json({ data: { items, total, offset, limit } })
    stage = 'cache'
    const cached = result.clone()
    cached.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
    ctx.waitUntil(cache.put(cacheKey, cached).catch(() => {}))
    return withCors(result, origin)
  } catch (error) {
    // Do not log bodies, public text, credentials or upstream error messages.
    const reason = error instanceof Error && error.message.includes('Illegal invocation') ? 'illegal_invocation'
      : error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'upstream_or_response'
    console.warn(JSON.stringify({ event: 'public_api_unavailable', stage, upstreamStatus, reason }))
    return respond({ code: 'service_unavailable', error: '公开建议暂时无法读取，请稍后重试。' }, 503)
  } finally { clearTimeout(timeout) }
}

export default { fetch: handlePublicApi } satisfies ExportedHandler<Env>
