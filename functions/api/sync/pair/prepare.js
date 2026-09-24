import { constantTimeEqual, hashSecret, json, pairKey } from '../spaceUtils.js'
import { coordinatorJson } from '../coordinator.js'

// POST /api/sync/pair/prepare { spaceId, pairingToken, wrappedPayloadKey }
// wrappedPayloadKey 是客户端用 pairingToken 加密的 opaque blob，Worker 不解密也不记录明文。
export async function onRequestPost(context) {
  const { request, data } = context
  let body
  try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }
  if (typeof body.pairingToken !== 'string' || body.pairingToken.length < 32 || typeof body.wrappedPayloadKey !== 'string' || !body.wrappedPayloadKey || body.wrappedPayloadKey.length > 100000) {
    return json({ error: '绑定信息不完整' }, 400)
  }
  const tokenHash = await hashSecret(body.pairingToken)
  const key = pairKey(data.spaceHash, tokenHash)
  const pairing = await data.kv.get(key, 'json')
  if (!pairing || pairing.usedAt || new Date(pairing.expiresAt).getTime() <= Date.now() || !constantTimeEqual(pairing.tokenHash, tokenHash)) {
    return json({ error: '绑定二维码已失效，请重新生成' }, 410)
  }
  const coordinated = await coordinatorJson(context, { operation: 'pair-prepare', tokenHash, wrappedPayloadKey: body.wrappedPayloadKey })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  const expirationTtl = Math.max(1, Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000))
  // claim 会先用 KV 做无凭据的廉价校验，再进入 DO 原子消费；两边必须看到同一份 wrapped key。
  await data.kv.put(key, JSON.stringify({ ...pairing, wrappedPayloadKey: body.wrappedPayloadKey }), { expirationTtl })
  if (coordinated) return json(coordinated.body, coordinated.status)
  return json({ ok: true, expiresAt: pairing.expiresAt })
}
