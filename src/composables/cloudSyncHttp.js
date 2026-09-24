// 同步 HTTP：API 路径、受控 fetch 与 requestSpaceEndpoint。
import { raceWithControls } from './asyncTask.js'
import { parseRetryAfterMs } from './syncErrors.js'
import {
  VERIFY_TIMEOUT_MS,
  SYNC_TIMEOUT_MS,
  runtime,
  syncKindForStatus,
} from './cloudSyncState.js'

export const API = {
  verify: '/api/auth/verify',
  spaceVerify: '/api/sync/space/verify',
  spaceRevision: '/api/sync/space/revision',
  spaceCreate: '/api/sync/space/create',
  spaceRecover: '/api/sync/space/recover',
  pairCreate: '/api/sync/pair/create',
  pairPrepare: '/api/sync/pair/prepare',
  pairClaim: '/api/sync/pair/claim',
  deviceRevoke: '/api/sync/device/revoke',
  deviceRename: '/api/sync/device/rename',
  pull: '/api/sync/pull',
  push: '/api/sync/push',
}


export function makeHttpError(status, message, headers = null, code = '') {
  const error = new Error(message)
  error.status = Number(status) || 0
  error.code = code || ''
  error.syncKind = syncKindForStatus(error.status, error.code)
  error.retryAfterMs = error.syncKind === 'rate-limited'
    ? parseRetryAfterMs(headers?.get?.('Retry-After') ?? headers?.['Retry-After'], Date.now())
    : null
  return error
}

export async function responseError(response, fallback) {
  let message = fallback
  let code = ''
  try {
    const body = await response.json()
    message = body.error || fallback
    code = body.code || ''
  } catch {
  }
  return makeHttpError(response.status, message, response.headers, code)
}

export function reportProgress(onProgress, step, message, partial = null) {
  onProgress?.({ step, message, partial })
}

export async function controlledFetch(url, init = {}, { signal = null, timeoutMs = SYNC_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  runtime.activeAbortControllers.add(controller)
  try {
    return await raceWithControls(fetch(url, { ...init, signal: controller.signal }), {
      signal,
      timeoutMs,
      timeoutMessage: '云端请求超时，请检查网络后重试',
      onInterrupt: () => controller.abort(),
    })
  } finally {
    runtime.activeAbortControllers.delete(controller)
  }
}

export async function requestSpaceEndpoint(url, body, { signal = null, timeoutMs = VERIFY_TIMEOUT_MS } = {}) {
  const res = await controlledFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { signal, timeoutMs })
  let response = {}
  try { response = await res.json() } catch {}
  if (!res.ok) throw makeHttpError(res.status, response.error || '同步空间操作失败', res.headers, response.code)
  return response
}
