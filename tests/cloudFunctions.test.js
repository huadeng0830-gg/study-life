import { describe, expect, it, vi } from 'vitest'
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js'
import { onRequestGet as pull } from '../functions/api/sync/pull.js'
import { onRequestPost as push } from '../functions/api/sync/push.js'

function createKv(initialValue = null) {
  let value = initialValue
  return {
    get: vi.fn(async () => value),
    put: vi.fn(async (_key, nextValue) => {
      value = JSON.parse(nextValue)
    }),
  }
}

describe('Pages Functions 云同步', () => {
  it('访问码只在 API 中间层校验', async () => {
    const response = await apiMiddleware({
      request: new Request('https://example.com/api/sync/pull'),
      env: { STUDY_LIFE_SYNC: createKv() },
      data: {},
      next: vi.fn(),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '需要访问码' })
  })

  it('通过 context.data 向下游传递哈希和 KV', async () => {
    const kv = createKv()
    const context = {
      request: new Request('https://example.com/api/sync/pull?code=123456'),
      env: { STUDY_LIFE_SYNC: kv },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    }

    const response = await apiMiddleware(context)

    expect(response.status).toBe(204)
    expect(context.data.kv).toBe(kv)
    expect(context.data.codeHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('读取 POST 访问码时不会消耗下游请求体', async () => {
    const request = new Request('https://example.com/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456', data: 'ciphertext' }),
    })
    const context = {
      request,
      env: { STUDY_LIFE_SYNC: createKv() },
      data: {},
      next: vi.fn(async () => new Response(JSON.stringify(await request.json()))),
    }

    const response = await apiMiddleware(context)

    expect(await response.json()).toEqual({ code: '123456', data: 'ciphertext' })
  })

  it('可推送并拉取密文', async () => {
    const kv = createKv()
    const data = { codeHash: 'hash', kv }
    const pushResponse = await push({
      data,
      request: new Request('https://example.com/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456', data: 'ciphertext' }),
      }),
    })
    const pullResponse = await pull({ data })

    expect(pushResponse.status).toBe(200)
    expect((await pullResponse.json()).data).toBe('ciphertext')
  })
})
