export const SPACE_ID_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2,3}$/
export const SPACE_META_VERSION = 1
export const SPACE_PAIR_TTL_SECONDS = 10 * 60
export const MAX_ENCRYPTED_PAYLOAD_LENGTH = 8 * 1024 * 1024
export const MAX_SYNC_REQUEST_BODY_BYTES = 10 * 1024 * 1024
const encoder = new TextEncoder()

export function normalizeSpaceId(value) {
  return String(value ?? '').trim().toUpperCase()
}

export function validSpaceId(value) {
  return SPACE_ID_PATTERN.test(normalizeSpaceId(value))
}

export async function hashSecret(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value ?? '')))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashSpaceId(spaceId) {
  return hashSecret(normalizeSpaceId(spaceId))
}

export function constantTimeEqual(left, right) {
  const a = String(left || '')
  const b = String(right || '')
  let diff = a.length ^ b.length
  const size = Math.max(a.length, b.length)
  for (let index = 0; index < size; index++) diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  return diff === 0
}

export function spaceMetaKey(spaceHash) {
  return `space:${spaceHash}:meta`
}

export function pairKey(spaceHash, tokenHash) {
  return `space:${spaceHash}:pair:${tokenHash}`
}

export function payloadKey(spaceHash) {
  return `sync:${spaceHash}:data`
}

export async function readSpaceMeta(kv, spaceHash) {
  const value = await kv.get(spaceMetaKey(spaceHash), 'json')
  return value?.version === SPACE_META_VERSION && Array.isArray(value.devices) ? value : null
}

export async function writeSpaceMeta(kv, spaceHash, value) {
  await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ ...value, version: SPACE_META_VERSION }))
}

export function safeDevice(device) {
  if (!device || typeof device !== 'object') return null
  const id = typeof device.id === 'string' ? device.id.trim().slice(0, 80) : ''
  const name = typeof device.name === 'string' ? device.name.trim().slice(0, 30) : ''
  if (!id || !name) return null
  const platform = typeof device.platform === 'string' ? device.platform.trim().slice(0, 20) : ''
  return { id, name, platform }
}

export function safeVerifier(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : ''
}

export function publicMetadata(meta, payload = null) {
  const revisionSource = payload || meta
  return {
    // exists 表示“已有业务 envelope”，不是“空间元数据存在”；两者必须分开。
    exists: Number.isInteger(revisionSource?.revision),
    spaceId: meta?.id || null,
    revision: Number.isInteger(revisionSource?.revision) ? revisionSource.revision : null,
    updatedAt: typeof revisionSource?.updatedAt === 'string' ? revisionSource.updatedAt : null,
    updatedByDeviceId: typeof revisionSource?.updatedByDeviceId === 'string' ? revisionSource.updatedByDeviceId : null,
    updatedByDeviceName: typeof revisionSource?.updatedByDeviceName === 'string' ? revisionSource.updatedByDeviceName : null,
    minWriterSchemaVersion: Math.max(1, Number(revisionSource?.minWriterSchemaVersion) || 1),
    lastWriterSchemaVersion: Math.max(1, Number(revisionSource?.lastWriterSchemaVersion) || 1),
    devices: (meta?.devices || []).filter((device) => !device.revokedAt).map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform || '',
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt || null,
    })),
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extraHeaders },
  })
}

export function errorText(response, fallback) {
  return response?.error || fallback
}
