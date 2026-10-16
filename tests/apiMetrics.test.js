import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiMetricsSnapshot, configureApiMetrics, measureApiRequest, measuredSupabaseFetch } from '../src/services/apiMetrics.js'
afterEach(() => { configureApiMetrics(false); vi.unstubAllGlobals() })
describe('local sampled API monitoring', () => {
  it('bounds timings and records only numeric aggregates for fixed labels', async () => {
    configureApiMetrics(true)
    for (let i = 0; i < 200; i++) await measureApiRequest('database', async () => new Response('fictional-private-body'))
    const [metric] = apiMetricsSnapshot()
    expect(metric).toMatchObject({ endpoint: 'database', observedRequests: 200, errors: 0, sampleCount: 128 })
    expect(JSON.stringify(metric)).not.toContain('private')
    await measureApiRequest('fictional-user-id/secret-token', async () => new Response())
    expect(apiMetricsSnapshot()).toHaveLength(1)
  })
  it('reports HTTP errors and cancellations separately without changing responses', async () => {
    configureApiMetrics(true)
    const response = new Response('private-error', { status: 429 })
    expect(await measureApiRequest('public-feedback', async () => response)).toBe(response)
    await expect(measureApiRequest('public-feedback', async () => { throw new DOMException('cancelled', 'AbortError') })).rejects.toHaveProperty('name', 'AbortError')
    expect(apiMetricsSnapshot()[0]).toMatchObject({ observedRequests: 2, errors: 1, cancelled: 1, sampleCount: 1 })
  })
  it('passes credentials and cancellation through without recording them', async () => {
    configureApiMetrics(true)
    const fetcher = vi.fn(async () => new Response())
    vi.stubGlobal('fetch', fetcher)
    const url = 'https://fictional.supabase.co/rest/v1/private_table?user_id=private-id'
    const options = { headers: { Authorization: 'Bearer private-token' } }
    await measuredSupabaseFetch(url, options)
    expect(fetcher).toHaveBeenCalledWith(url, options)
    expect(JSON.stringify(apiMetricsSnapshot())).not.toMatch(/private|token|supabase/)
  })
})
