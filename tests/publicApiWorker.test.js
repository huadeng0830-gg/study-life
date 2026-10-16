import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePublicApi } from '../workers/public-api/index.ts'
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fictional', ALLOWED_ORIGINS: 'https://app.example.invalid' }
let cache, fetcher, pending, ctx
const request = (path = '/v1/feedback', options = {}) => new Request('https://worker.example.invalid' + path, { headers: { Origin: 'https://app.example.invalid', ...options.headers }, ...options })
beforeEach(() => {
  const entries = new Map()
  cache = { match: vi.fn(async key => entries.get(key.url)?.clone()), put: vi.fn(async (key, value) => { entries.set(key.url, value.clone()) }) }
  fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 'fictional-public-id', title: 'A public suggestion', author_id: 'must-not-leak' }]), { headers: { 'Content-Range': '0-0/1' } }))
  pending = []
  ctx = { waitUntil: promise => pending.push(promise) }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
const run = (req = request(), config = env) => handlePublicApi(req, config, ctx, fetcher, cache)

describe('Cloudflare public feedback API', () => {
  it('ranks support globally before pagination while exposing only public counts', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify([{ id: 'fictional', like_count: 12, user_id: 'private-voter' }]), { headers: { 'Content-Range': '0-0/1000' } }))
    const response = await run(request('/v1/feedback?view=summary&sort=supported&limit=20'))
    expect(response.status).toBe(200)
    const upstream = fetcher.mock.calls[0][0]
    expect(upstream.searchParams.get('order')).toBe('like_count.desc,created_at.asc,id.asc')
    expect(upstream.searchParams.get('visibility')).toBe('eq.public')
    const item = (await response.json()).data.items[0]
    expect(item.like_count).toBe(12)
    expect(item).not.toHaveProperty('user_id')
  })
  it('returns compact summaries and scopes detail lookups to public rows', async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'fictional', title: 'Fictional title', body: 'large body', public_history: [{ reply: 'large history' }], public_author_name: '虚构昵称' }]), { headers: { 'Content-Range': '0-0/1000' } }))
    const result = await run(request('/v1/feedback?view=summary&limit=20'))
    const payload = await result.json()
    expect(payload.data.total).toBe(1000)
    expect(payload.data.items[0]).not.toHaveProperty('body')
    expect(payload.data.items[0]).not.toHaveProperty('public_history')
    expect(fetcher.mock.calls[0][0].searchParams.get('select')).not.toContain('body')
    await run(request('/v1/feedback?id=10000001-0000-4000-8000-000000000001&view=detail&limit=1'))
    expect(fetcher.mock.calls[1][0].searchParams.get('id')).toBe('eq.10000001-0000-4000-8000-000000000001')
    expect(fetcher.mock.calls[1][0].searchParams.get('visibility')).toBe('eq.public')
  })
  it('searches the entire dataset with literal text and isolated filter caches', async () => {
    const q = 'a,b%"\\example'
    const params = new URLSearchParams({ q, category: 'product', sort: 'newest', view: 'summary' })
    await run(request('/v1/feedback?' + params))
    const url = fetcher.mock.calls[0][0]
    const literal = JSON.stringify('***=' + q)
    expect(url.searchParams.get('or')).toBe('(title.imatch.' + literal + ',body.imatch.' + literal + ')')
    expect(url.searchParams.get('category')).toBe('eq.product')
    expect(url.searchParams.get('order')).toBe('created_at.desc,id.asc')
    await run(request('/v1/feedback?view=summary&q=different'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const query of ['view=private', 'sort=invalid', 'category=private', 'id=invalid', 'q=' + 'a'.repeat(101)]) expect((await run(request('/v1/feedback?' + query))).status).toBe(400)
  })
  it('rejects upstream redirects without forwarding the API key to another host', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://untrusted.example.invalid' } }))
    expect((await run()).status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual')
  })
  it('fetches only published columns as anon, strips identities, and caches without CORS or tokens', async () => {
    const result = await run(request('/v1/feedback', { headers: { Origin: 'https://app.example.invalid', Authorization: 'Bearer fictional-private-token', Cookie: 'fictional-cookie' } }))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ data: { items: [{ id: 'fictional-public-id' }], total: 1 } })
    const [url, options] = fetcher.mock.calls[0]
    expect(url.searchParams.get('visibility')).toBe('eq.public')
    expect(url.searchParams.get('select')).not.toContain('author_id')
    expect(options.headers).not.toHaveProperty('Authorization')
    expect(options.headers).not.toHaveProperty('Cookie')
    await Promise.all(pending)
    const cached = cache.put.mock.calls[0][1]
    expect(cached.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(await cached.clone().text()).not.toContain('must-not-leak')
    expect((await run()).status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps filters isolated and rejects unauthorized origins, mutations and extra filters', async () => {
    await run(request('/v1/feedback?status=resolved'))
    await run(request('/v1/feedback?status=processing'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const path of ['/v1/feedback?author_id=eq.someone', '/v1/feedback?status=private', '/v1/feedback?limit=1000', '/v1/feedback?limit=1&limit=2']) expect((await run(request(path))).status).toBe(400)
    expect((await run(request('/v1/feedback', { method: 'POST' }))).status).toBe(405)
    expect((await run(request('/v1/feedback', { headers: { Origin: 'https://untrusted.example.invalid' } }))).status).toBe(403)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not cache upstream failures, invalid responses or invalid service credentials', async () => {
    fetcher.mockResolvedValueOnce(new Response('fictional-upstream-secret', { status: 403 }))
    const failed = await run()
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('fictional-upstream-secret')
    expect(cache.put).not.toHaveBeenCalled()
    expect((await run(request(), { ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never-use' })).status).toBe(503)
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ private: 'unexpected' })))
    expect((await run()).status).toBe(503)
  })
  it('bounds response bytes and cancels oversized upstream data', async () => {
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    expect((await run()).status).toBe(503)
    expect(cache.put).not.toHaveBeenCalled()
  })
})
