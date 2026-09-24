import { COORDINATOR_PROTOCOL_VERSION, coordinatorJson } from './coordinator.js'
import { json } from './spaceUtils.js'

// POST /api/sync/health
// 无需用户凭据，不读取或写入任何同步空间；仅验证 Pages Functions 与协调器协议一致。
export async function onRequestPost(context) {
  const coordinated = await coordinatorJson({
    env: context.env,
    data: { codeHash: 'protocol-health-check' },
  }, { operation: 'capabilities' })

  if (!coordinated) return json({ ok: true, mode: 'legacy', protocolVersion: 1 })
  if (coordinated.status >= 400) return json({ ok: false, ...coordinated.body }, coordinated.status)
  if (coordinated.body?.protocolVersion !== COORDINATOR_PROTOCOL_VERSION) {
    return json({ ok: false, error: '同步协调服务版本不一致，请更新协调器后重试', code: 'COORDINATOR_VERSION_MISMATCH' }, 503)
  }
  return json({
    ok: true,
    mode: 'do',
    protocolVersion: coordinated.body.protocolVersion,
    operations: coordinated.body.operations,
  })
}
