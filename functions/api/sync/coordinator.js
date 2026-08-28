// 可选 Durable Object 协调器。未绑定时保持 KV 兼容路径；绑定后所有同一同步空间的
// 读取与写入都会经过同一个强一致对象，从而让 revision 比较与写入成为原子操作。
export async function requestCoordinator(context, payload) {
  const namespace = context.env?.SYNC_COORDINATOR
  if (!namespace?.idFromName || !namespace?.get) return null

  const id = namespace.idFromName(`sync:${context.data.codeHash}`)
  const response = await namespace.get(id).fetch('https://sync-coordinator.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response
}

export async function readLegacyRecord(context) {
  return context.data.kv.get(`sync:${context.data.codeHash}:data`, 'json')
}

export async function coordinatorJson(context, payload) {
  const response = await requestCoordinator(context, payload)
  if (!response) return null
  let body
  try { body = await response.json() } catch { body = { error: '同步协调服务返回异常响应' } }
  return { status: response.status, body }
}
