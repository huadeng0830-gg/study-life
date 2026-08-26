export async function onRequest(context) {
  const { request, env, next } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  if (!env.STUDY_LIFE_SYNC) {
    return json({ error: '云同步服务尚未配置' }, 503)
  }

  const url = new URL(request.url)
  let code = url.searchParams.get('code') || ''

  if (request.method === 'POST' && !code) {
    try {
      const body = await request.clone().json()
      code = body.code || ''
    } catch {
      // 交给下游接口返回更具体的请求体错误。
    }
  }

  if (!/^\d{6}$/.test(code)) {
    return json({ error: code ? '访问码必须是 6 位数字' : '需要访问码' }, 400)
  }

  context.data.code = code
  context.data.codeHash = await hashCode(code)
  context.data.kv = env.STUDY_LIFE_SYNC

  return next()
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}
