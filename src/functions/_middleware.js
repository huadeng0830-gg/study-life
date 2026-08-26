export async function onRequest(context) {
  const { request, env, next } = context

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders(),
    })
  }

  // 从 query 或 body 读取 code
  let code = ''
  const url = new URL(request.url)
  code = url.searchParams.get('code') || ''

  if (request.method === 'POST' && !code) {
    try {
      const body = await request.json()
      code = body.code || ''
    } catch {}
  }

  // 只有 /auth/verify 允许无 code（仅校验格式）
  const isAuthVerify = url.pathname.endsWith('/auth/verify')
  if (!code && !isAuthVerify) {
    return json({ error: '需要访问码' }, 400)
  }

  if (code && !/^\d{6}$/.test(code)) {
    return json({ error: '访问码必须是 6 位数字' }, 400)
  }

  // 把 code 和 codeHash 挂到 context 供后续 handler 使用
  context.code = code
  context.codeHash = code ? await codeHash(code) : ''
  context.kv = env.STUDY_LIFE_SYNC

  return next()
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