// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const legacy = vi.hoisted(() => vi.fn())
vi.mock('../src/services/social.js', () => ({ campusCommunityRequest: legacy }))
import { campusFeedbackPublicList, myCampusFeedback } from '../src/services/campusCommunity.js'
let testOrigin = 0
beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_API_URL', `https://public-${++testOrigin}.example.invalid`)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { items: [], total: 0, limit: 30, offset: 0 } }))))
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  legacy.mockReset().mockResolvedValue({ items: [] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('public Worker transport', () => {
  it('honors Retry-After across different filters without retries or an Edge fallback', async () => {
    vi.useFakeTimers()
    fetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '4' } }))
    await expect(campusFeedbackPublicList({ q: 'first' })).rejects.toMatchObject({ status: 429 })
    await expect(campusFeedbackPublicList({ q: 'second' }, { forceRefresh: true })).rejects.toMatchObject({ status: 429 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4001)
    await expect(campusFeedbackPublicList({ q: 'second' })).resolves.toHaveProperty('items')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('sends public filters without cookies or account authorization', async () => {
    expect((await campusFeedbackPublicList({ status: 'resolved', limit: 10, author_id: 'not-allowed' })).items).toEqual([])
    const [url, options] = fetch.mock.calls[0]
    expect(url.href).toBe(`https://public-${testOrigin}.example.invalid/v1/feedback?status=resolved&limit=10`)
    expect(options.credentials).toBe('omit')
    expect(options.headers).toBeUndefined()
    expect(legacy).not.toHaveBeenCalled()
  })
  it('keeps private routes on the existing authenticated service and supports rollback', async () => {
    await myCampusFeedback()
    expect(legacy).toHaveBeenCalledWith('mine')
    expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv('VITE_PUBLIC_API_URL', '')
    await campusFeedbackPublicList({ limit: 10 })
    expect(legacy).toHaveBeenCalledWith('public_list', { limit: 10 })
  })
  it('does not double-call the legacy service when the Worker fails', async () => {
    fetch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    await expect(campusFeedbackPublicList()).rejects.toThrow('公开建议')
    expect(legacy).not.toHaveBeenCalled()
  })
  it('coalesces repeated public reads and bypasses them on explicit refresh', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => campusFeedbackPublicList({ view: 'summary' })))
    await campusFeedbackPublicList({ view: 'summary' })
    expect(fetch).toHaveBeenCalledTimes(1)
    results[0].items.push({ title: 'Fictional change' })
    expect(results[1].items).toEqual([])
    await campusFeedbackPublicList({ view: 'summary' }, { forceRefresh: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('avoids repeated Worker requests for a minute while still expiring the result', async () => {
    vi.useFakeTimers()
    for (let seconds = 0; seconds < 60; seconds++) {
      await campusFeedbackPublicList({ view: 'summary' })
      vi.advanceTimersByTime(1000)
    }
    expect(fetch).toHaveBeenCalledTimes(1)
    await campusFeedbackPublicList({ view: 'summary' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
