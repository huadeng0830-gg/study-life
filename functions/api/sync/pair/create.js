import { hashSecret, json, pairKey, SPACE_PAIR_TTL_SECONDS } from '../spaceUtils.js'
import { coordinatorJson } from '../coordinator.js'

function randomToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// POST /api/sync/pair/create
// 只返回一次性 token；payloadKey 仍留在发起设备，稍后以 token 加密后提交。
export async function onRequestPost(context) {
  const { data } = context
  const pairingToken = randomToken()
  const tokenHash = await hashSecret(pairingToken)
  const createdAt = Date.now()
  const expiresAt = new Date(createdAt + SPACE_PAIR_TTL_SECONDS * 1000).toISOString()
  const pairing = {
    version: 1,
    spaceHash: data.spaceHash,
    tokenHash,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt,
    createdByDeviceId: data.spaceDevice.id,
    wrappedPayloadKey: '',
  }
  const key = pairKey(data.spaceHash, tokenHash)
  await data.kv.put(key, JSON.stringify(pairing), { expirationTtl: SPACE_PAIR_TTL_SECONDS })
  const coordinated = await coordinatorJson(context, { operation: 'pair-create', pairing: { tokenHash, createdAt: pairing.createdAt, expiresAt, wrappedPayloadKey: '' } })
  if (coordinated && coordinated.status >= 400) {
    try { await data.kv.delete(key) } catch {}
    return json(coordinated.body, coordinated.status)
  }
  return json({ ok: true, spaceId: data.spaceId, pairingToken, expiresAt })
}
