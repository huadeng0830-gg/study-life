import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(readFileSync(path.join(root, 'workers/public-api/wrangler.jsonc'), 'utf8'))
let upstreamCalls = 0
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: path.join(root, '.wrangler/public-api-build/index.js'),
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  bindings: { SUPABASE_URL: 'https://fictional.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fictional', ALLOWED_ORIGINS: 'https://app.example.invalid' },
  // No real upstream or cloud resource is used by this runtime test.
  outboundService: async (request) => {
    upstreamCalls++
    assert.equal(request.headers.get('Authorization'), null)
    const url = new URL(request.url)
    assert.equal(url.searchParams.get('visibility'), 'eq.public')
    if (url.searchParams.get('offset') === '1') return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example.invalid' } })
    return new Response('[]', { headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' } })
  },
  log: new Log(LogLevel.ERROR),
}))
try {
  const url = 'https://worker.example.invalid/v1/feedback?limit=1'
  const requestOptions = { headers: { Origin: 'https://app.example.invalid' } }
  const first = await runtime.dispatchFetch(url, requestOptions)
  assert.equal(first.status, 200, 'Native Workers fetch must reach the upstream')
  assert.deepEqual(await first.json(), { data: { items: [], total: 0, offset: 0, limit: 1 } })
  const second = await runtime.dispatchFetch(url, requestOptions)
  assert.equal(second.status, 200)
  await second.arrayBuffer()
  assert.equal(upstreamCalls, 1, 'Repeated public request must use the Workers cache')
  const redirect = await runtime.dispatchFetch(url + '&offset=1', requestOptions)
  assert.equal(redirect.status, 503, 'Upstream redirects must be rejected')
  await redirect.arrayBuffer()
  assert.equal(upstreamCalls, 2, 'A redirect must not forward the API key to another host')
  const forbidden = await runtime.dispatchFetch(url, { headers: { Origin: 'https://untrusted.example.invalid' } })
  assert.equal(forbidden.status, 403)
  await forbidden.arrayBuffer()
  console.log('✓ 真实 Workers 运行时：公开回源、缓存命中、重定向拒绝和来源隔离均通过。')
} finally { await runtime.dispose() }
