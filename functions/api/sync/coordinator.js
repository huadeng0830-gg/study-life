// 可选 Durable Object 协调器。未绑定时保持 KV 兼容路径；绑定后所有同一同步空间的
// 读取与写入都会经过同一个强一致对象，从而让 revision 比较与写入成为原子操作。
import { COORDINATOR_PROTOCOL_VERSION } from '../../../sync-protocol.js'

export { COORDINATOR_PROTOCOL_VERSION }
const COORDINATOR_VERSION_ERROR = '同步协调服务版本不一致，请更新协调器后重试'

export async function requestCoordinator(context, payload) {
  const namespace = context.env?.SYNC_COORDINATOR
  if (!namespace?.idFromName || !namespace?.get) return null

  const id = namespace.idFromName(`sync:${context.data.codeHash}`)
  const response = await namespace.get(id).fetch('https://sync-coordinator.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: COORDINATOR_PROTOCOL_VERSION, ...payload }),
  })
  return response
}

export async function readCoordinatorResponse(response) {
  let body
  try { body = await response.json() } catch { body = { error: '同步协调服务返回异常响应' } }
  const isVersionMismatch = response.status === 400 && (body?.code === 'UNKNOWN_SYNC_OPERATION' || body?.error === '未知同步操作')
  if (isVersionMismatch) {
    return { status: 503, body: { error: COORDINATOR_VERSION_ERROR, code: 'COORDINATOR_VERSION_MISMATCH' } }
  }
  return { status: response.status, body }
}

function remoteMode(context) {
  return context.env?.SYNC_REMOTE_MODE || (context.env?.SYNC_COORDINATOR ? 'do' : 'legacy')
}

export async function readLegacyRecord(context) {
  if (remoteMode(context) === 'do' && context.env?.SYNC_LEGACY_MIGRATION !== 'enabled') return null
  return context.data.kv.get(`sync:${context.data.codeHash}:data`, 'json')
}

export async function coordinatorJson(context, payload) {
  let response
  try {
    response = await requestCoordinator(context, payload)
  } catch {
    if (remoteMode(context) === 'do') return { status: 503, body: { error: '同步协调服务不可用，请稍后重试' } }
    return null
  }
  if (!response) {
    if (remoteMode(context) === 'do') return { status: 503, body: { error: '同步协调服务不可用，请稍后重试' } }
    return null
  }
  return readCoordinatorResponse(response)
}
