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
