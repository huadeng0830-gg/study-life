import { describe, expect, it, vi } from 'vitest'
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js'
import { onRequestPost as pull } from '../functions/api/sync/pull.js'
import { onRequestPost as push } from '../functions/api/sync/push.js'
import { onRequestPost as verify } from '../functions/api/auth/verify.js'

function createKv(initialValue = null) {
  let value = initialValue
  return {
    get: vi.fn(async () => value),
    put: vi.fn(async (_key, nextValue) => {
      value = JSON.parse(nextValue)
    }),
  }
}

// 限流测试需要真正的多键存储：createKv 是单槽桩，所有键共享同一个值，
// 而限流现在有"粗粒度兜底 + 按设备配额"两个独立桶，单槽桩会把它们算成一个计数器。
function createRateKv() {
  const store = new Map()
  return {
    get: vi.fn(async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null)),
    put: vi.fn(async (key, value) => { store.set(key, value) }),
  }
}

describe('Pages Functions 云同步', () => {
  it('访问码只在 API 中间层校验', async () => {
    const response = await apiMiddleware({
      request: new Request('https://example.com/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env: { STUDY_LIFE_SYNC: createKv() },
      data: {},
      next: vi.fn(),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '需要访问码' })
  })

  it('拒绝将访问码放在 URL 中', async () => {
    const response = await apiMiddleware({
      request: new Request('https://example.com/api/sync/pull?code=123456'),
      env: { STUDY_LIFE_SYNC: createKv() },
      data: {},
      next: vi.fn(),
    })

    expect(response.status).toBe(405)
  })

  it('对同一来源的同步请求实施冷却', async () => {
    const kv = createKv()
    let response
    for (let index = 0; index < 13; index++) {
      response = await apiMiddleware({
        request: new Request('https://example.com/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.8' },
          body: JSON.stringify({ code: '123456' }),
        }),
        env: { STUDY_LIFE_SYNC: kv },
        data: {},
        next: vi.fn(async () => new Response(null, { status: 204 })),
      })
    }

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).not.toBeNull()
  })

  it('通过 context.data 向下游传递哈希和 KV', async () => {
    const kv = createKv()
    const context = {
      request: new Request('https://example.com/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      }),
      // 旧版访问码鉴权默认关闭；这里显式打开，才能走到"传递哈希"这一步。
      env: { STUDY_LIFE_SYNC: kv, SYNC_LEGACY_CODE_AUTH: 'enabled' },
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
      env: { STUDY_LIFE_SYNC: createKv(), SYNC_LEGACY_CODE_AUTH: 'enabled' },
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
        body: JSON.stringify({ code: '123456', data: 'ciphertext', expectedRevision: null, deviceId: 'iphone-id', deviceName: '我的 iPhone' }),
      }),
    })
    const pullResponse = await pull({ data })

    expect(pushResponse.status).toBe(200)
    expect((await pullResponse.json()).data).toBe('ciphertext')
  })

  it('使用 expected revision 阻止旧页面覆盖新版本，并保留来源设备 metadata', async () => {
    const kv = createKv({ payload: 'old', revision: 2, updatedAt: '2026-08-28T00:00:00.000Z', updatedByDeviceId: 'ipad-id', updatedByDeviceName: '我的 iPad' })
    const data = { codeHash: 'hash', kv }
    const response = await push({
      data,
      request: new Request('https://example.com/api/sync/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456', data: 'new', expectedRevision: 1, deviceId: 'iphone-id', deviceName: '我的 iPhone' }),
      }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ conflict: true, revision: 2, updatedByDeviceName: '我的 iPad' })
    const meta = await verify({ data })
    expect(await meta.json()).toMatchObject({ revision: 2, updatedByDeviceName: '我的 iPad' })
  })

  it('两台设备顺序手动推送时来源随成功推送变更，旧 revision 会被拒绝', async () => {
    const kv = createKv()
    const data = { codeHash: 'hash', kv }
    const post = (payload) => push({ data, request: new Request('https://example.com/api/sync/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456', ...payload }),
    }) })
    const first = await post({ data: 'iphone-data', expectedRevision: null, deviceId: 'iphone-id', deviceName: '我的 iPhone' })
    expect(await first.json()).toMatchObject({ revision: 1, updatedByDeviceName: '我的 iPhone' })
    const second = await post({ data: 'ipad-data', expectedRevision: 1, deviceId: 'ipad-id', deviceName: '我的 iPad' })
    expect(await second.json()).toMatchObject({ revision: 2, updatedByDeviceName: '我的 iPad' })
    const pulled = await pull({ data })
    expect(await pulled.json()).toMatchObject({ data: 'ipad-data', revision: 2, updatedByDeviceName: '我的 iPad' })
    const stale = await post({ data: 'old-iphone-data', expectedRevision: 1, deviceId: 'iphone-id', deviceName: '我的 iPhone' })
    expect(stale.status).toBe(409)
  })

  // ── 下面两条是安全回归守卫，改中间件时必须一起看 ──

  it('旧版访问码鉴权默认关闭：光有 6 位数字不会被放行', async () => {
    // 不设置 SYNC_LEGACY_CODE_AUTH。旧版只有 10^6 种可能且服务端不校验正确性，
    //  默认放行等于对外提供一个可爆破的端点。
    for (const code of ['123456', '000000', '999999']) {
      const context = {
        request: new Request('https://example.com/api/sync/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }),
        env: { STUDY_LIFE_SYNC: createKv() },
        data: {},
        next: vi.fn(async () => new Response(null, { status: 204 })),
      }
      const response = await apiMiddleware(context)
      expect(response.status, `${code} 不该被放行`).toBe(410)
      expect(context.next).not.toHaveBeenCalled()
    }
  })

  it('换访问码不能无限刷新限流桶：粗粒度兜底额度最终会拦住', async () => {
    // 曾经的缺陷：限流键里含"被猜的码"的哈希，于是换一个码就换一个桶，
    // 每个猜测值各自享有独立额度 —— 整条路径的限流等于不存在。
    // 现在第 1 层只按 来源+端点 分桶，完全不受请求体影响。
    //
    // 注意这一层是**粗粒度兜底**（额度 = 设备额度的 4 倍），不是精确配额 ——
    // 精确配额是第 2 层按设备隔离的桶，否则同一 NAT 下的多台设备会互相饿死。
    // 真正堵住旧版访问码的是 SYNC_LEGACY_CODE_AUTH 默认关闭，不是限流。
    const kv = createRateKv()
    const attempt = async (code) => {
      const context = {
        request: new Request('https://example.com/api/sync/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
          body: JSON.stringify({ code }),
        }),
        env: { STUDY_LIFE_SYNC: kv, SYNC_LEGACY_CODE_AUTH: 'enabled' },
        data: {},
        next: vi.fn(async () => new Response(null, { status: 204 })),
      }
      return apiMiddleware(context)
    }

    // /pull 设备额度 60，粗粒度兜底 = max(60*4, 40) = 240。连着换 260 个不同的码。
    let limitedAt = 0
    for (let index = 0; index < 260 && !limitedAt; index++) {
      const response = await attempt(String(100000 + index))
      if (response.status === 429) limitedAt = index + 1
    }

    expect(limitedAt, '换访问码把兜底额度也绕过去了，桶仍按被猜的码在分').toBeGreaterThan(0)
    // 兜底额度 240 意味着前 240 次放行、第 241 次被拒。
    expect(limitedAt, '兜底额度是 240，被拒的应是第 241 次').toBe(241)
  })

  it('粗粒度兜底不会误杀同一 NAT 下的多台设备', async () => {
    // 反向约束：兜底额度必须容得下几台设备各自用满自己的 burst。
    // 这条与上一条是一对 —— 只满足上一条（把兜底压到等于设备额度）就会误杀正常用户。
    const kv = createRateKv()
    const responses = []
    for (let index = 0; index < 3; index++) {
      for (let burst = 0; burst < 30; burst++) {
        responses.push(await apiMiddleware({
          request: new Request('https://example.com/api/sync/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'shared-nat' },
            body: JSON.stringify({ code: `999${String(index).padStart(3, '0')}` }),
          }),
          env: { STUDY_LIFE_SYNC: kv, SYNC_LEGACY_CODE_AUTH: 'enabled' },
          data: {},
          next: vi.fn(async () => new Response(null, { status: 204 })),
        }))
      }
    }
    expect(responses.every((response) => response.status === 204), '正常多设备使用被兜底额度误杀').toBe(true)
  })
})
