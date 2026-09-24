// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSyncError,
  code,
  connectionState,
  refreshCloudMetadata,
  syncErrorKind,
  syncRetryAfterMs,
} from '../src/composables/cloudSync.js'
import { parseRetryAfterMs } from '../src/composables/syncErrors.js'

describe('同步 HTTP 错误分类与 Retry-After', () => {
  beforeEach(() => {
    localStorage.clear()
    code.value = '123456'
    connectionState.value = 'connected'
    clearSyncError()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('解析秒数、HTTP 日期，并对负数与过大值 fail safe', () => {
    expect(parseRetryAfterMs('3', 0)).toBe(3000)
    expect(parseRetryAfterMs('0', 0)).toBe(0)
    expect(parseRetryAfterMs('-1', 0)).toBeNull()
    expect(parseRetryAfterMs('999999', 0)).toBeNull()
    expect(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 0)).toBe(5000)
    expect(parseRetryAfterMs('not-a-date', 0)).toBeNull()
  })

  it('401 进入 credential-invalid，不能作为普通重试错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: '此设备的同步授权已失效，请重新绑定。' }),
    })))

    const result = await refreshCloudMetadata()
    expect(result).toMatchObject({ ok: false })
    expect(connectionState.value).toBe('credential-invalid')
    expect(syncErrorKind.value).toBe('credential-invalid')
    expect(syncRetryAfterMs.value).toBeNull()
  })

  it('429 记录服务端 Retry-After，异常值留给客户端退避', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => name === 'Retry-After' ? '7' : null },
      json: async () => ({ error: '请求过于频繁，请稍后再试' }),
    })))

    const result = await refreshCloudMetadata()
    expect(result).toMatchObject({ ok: false })
    expect(syncErrorKind.value).toBe('rate-limited')
    expect(syncRetryAfterMs.value).toBe(7000)
  })

  it('协议版本错配与超大 payload 属于永久错误，不进入自动重试', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({ error: '同步协调服务版本不一致', code: 'COORDINATOR_VERSION_MISMATCH' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        headers: { get: () => null },
        json: async () => ({ error: '同步密文过大' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    expect(await refreshCloudMetadata()).toMatchObject({ ok: false })
    expect(syncErrorKind.value).toBe('version-mismatch')
    expect(await refreshCloudMetadata()).toMatchObject({ ok: false })
    expect(syncErrorKind.value).toBe('payload-too-large')
  })
})
