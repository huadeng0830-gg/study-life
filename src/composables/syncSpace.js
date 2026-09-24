import { computed, ref } from 'vue'

// SyncSpace 元数据与业务 envelope 明确分离：这些值只留在本设备，绝不进入 sl_* 同步负载。
export const SYNC_SPACE_SETTINGS_KEY = 'study_life_sync_space'
export const SYNC_SPACE_VERSION = 1
export const SYNC_SPACE_ID_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2,3}$/
const SPACE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const encoder = new TextEncoder()

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_SPACE_SETTINGS_KEY))
    if (!saved || saved.version !== SYNC_SPACE_VERSION) return null
    if (!SYNC_SPACE_ID_PATTERN.test(String(saved.spaceId || ''))) return null
    if (typeof saved.deviceCredential !== 'string' || !saved.deviceCredential) return null
    if (typeof saved.payloadKey !== 'string' || !saved.payloadKey) return null
    return {
      version: SYNC_SPACE_VERSION,
      spaceId: saved.spaceId,
      deviceCredential: saved.deviceCredential,
      payloadKey: saved.payloadKey,
      autoSyncEnabled: saved.autoSyncEnabled === true,
      bootstrapPending: saved.bootstrapPending === true,
      joinedAt: typeof saved.joinedAt === 'string' ? saved.joinedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export const syncSpaceSettings = ref(readSettings())
export const isSyncSpaceBound = computed(() => Boolean(syncSpaceSettings.value?.spaceId && syncSpaceSettings.value?.deviceCredential && syncSpaceSettings.value?.payloadKey))
export const syncSpaceBootstrapPending = computed(() => isSyncSpaceBound.value && syncSpaceSettings.value.bootstrapPending === true)
export const autoSyncEnabled = computed(() => isSyncSpaceBound.value && !syncSpaceBootstrapPending.value && syncSpaceSettings.value.autoSyncEnabled === true)

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器不支持安全随机数，无法创建同步空间')
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomSecret(byteLength = 32) {
  return base64Url(randomBytes(byteLength))
}

export function randomSyncSpaceId() {
  const bytes = randomBytes(16)
  let value = ''
  for (const byte of bytes) value += SPACE_ALPHABET[byte % SPACE_ALPHABET.length]
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`
}

export async function hashSecret(value) {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持安全加密，无法绑定同步空间')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(String(value ?? '')))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizeSyncSpaceId(value) {
  return String(value ?? '').trim().toUpperCase()
}

export function saveSyncSpaceSettings(value) {
  const next = {
    version: SYNC_SPACE_VERSION,
    spaceId: normalizeSyncSpaceId(value?.spaceId),
    deviceCredential: String(value?.deviceCredential || ''),
    payloadKey: String(value?.payloadKey || ''),
    autoSyncEnabled: value?.bootstrapPending === true ? false : value?.autoSyncEnabled === true,
    bootstrapPending: value?.bootstrapPending === true,
    joinedAt: typeof value?.joinedAt === 'string' ? value.joinedAt : new Date().toISOString(),
  }
  if (!SYNC_SPACE_ID_PATTERN.test(next.spaceId) || !next.deviceCredential || !next.payloadKey) {
    throw new Error('同步空间绑定信息不完整')
  }
  syncSpaceSettings.value = next
  try { localStorage.setItem(SYNC_SPACE_SETTINGS_KEY, JSON.stringify(next)) } catch {}
  dispatchSettingsEvent()
  return next
}

export function setAutoSyncEnabled(enabled) {
  if (!syncSpaceSettings.value) return false
  saveSyncSpaceSettings({ ...syncSpaceSettings.value, autoSyncEnabled: Boolean(enabled) })
  return true
}

export function clearSyncSpaceSettings() {
  syncSpaceSettings.value = null
  try { localStorage.removeItem(SYNC_SPACE_SETTINGS_KEY) } catch {}
  dispatchSettingsEvent()
}

function dispatchSettingsEvent() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('study-life:sync-settings'))
}

export function pairingPayload({ spaceId, pairingToken, expiresAt }) {
  return JSON.stringify({
    format: 'study-life-sync-pairing',
    version: 1,
    spaceId: normalizeSyncSpaceId(spaceId),
    pairingToken: String(pairingToken || ''),
    expiresAt: String(expiresAt || ''),
  })
}

export function parsePairingPayload(value) {
  let parsed
  const rawValue = String(value ?? '').trim()
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value } catch {
    if (SYNC_SPACE_ID_PATTERN.test(normalizeSyncSpaceId(rawValue))) {
      throw new Error('这是同步空间编号，不能用于添加设备。请扫描电脑上的二维码，或粘贴“复制绑定内容”得到的完整文本。')
    }
    throw new Error('绑定二维码内容无法识别')
  }
  const spaceId = normalizeSyncSpaceId(parsed?.spaceId)
  const pairingToken = String(parsed?.pairingToken || '')
  if (parsed?.format !== 'study-life-sync-pairing' || parsed.version !== 1 || !SYNC_SPACE_ID_PATTERN.test(spaceId) || pairingToken.length < 32) {
    throw new Error('这不是有效的学习生活台绑定二维码')
  }
  return { format: parsed.format, version: 1, spaceId, pairingToken, expiresAt: String(parsed.expiresAt || '') }
}

export function buildRecoveryInfo(settings = syncSpaceSettings.value) {
  if (!settings?.spaceId || !settings.payloadKey) return null
  return {
    format: 'study-life-sync-recovery',
    version: 1,
    spaceId: settings.spaceId,
    recoverySecret: settings.payloadKey,
  }
}

export function recoveryText(settings = syncSpaceSettings.value) {
  const info = buildRecoveryInfo(settings)
  if (!info) return ''
  return [
    '学习生活台同步恢复信息',
    'version: 1',
    `syncSpaceId: ${info.spaceId}`,
    `recoverySecret: ${info.recoverySecret}`,
    '',
    '请妥善保存。所有设备丢失后，没有账号找回机制。',
  ].join('\n')
}

export function parseRecoveryText(value) {
  const text = String(value ?? '')
  let info = null
  try { info = JSON.parse(text) } catch {}
  if (!info) {
    const spaceId = text.match(/(?:syncSpaceId|spaceId)\s*:\s*([^\s]+)/i)?.[1]
    const recoverySecret = text.match(/recoverySecret\s*:\s*(\S+)/i)?.[1]
    info = { spaceId, recoverySecret }
  }
  const spaceId = normalizeSyncSpaceId(info?.spaceId)
  const recoverySecret = String(info?.recoverySecret || '')
  if (!SYNC_SPACE_ID_PATTERN.test(spaceId) || recoverySecret.length < 32) throw new Error('恢复信息不完整或格式无效')
  return { spaceId, recoverySecret }
}
