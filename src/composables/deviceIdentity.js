import { ref } from 'vue'

const DEVICE_KEY = 'study_life_device_profile'

function defaultDeviceName() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return '我的 iPhone'
  if (/Android/i.test(ua)) return '我的手机'
  return '我的电脑'
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY))
    if (saved?.id && typeof saved.name === 'string') return saved
  } catch {}
  const profile = { id: newId(), name: defaultDeviceName(), createdAt: new Date().toISOString() }
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(profile)) } catch {}
  return profile
}

export const deviceProfile = ref(loadProfile())

export function setDeviceName(name) {
  const trimmed = String(name ?? '').trim().slice(0, 30)
  if (!trimmed) return false
  deviceProfile.value = { ...deviceProfile.value, name: trimmed }
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(deviceProfile.value)) } catch {}
  return true
}

export function encryptedDeviceMeta() {
  return {
    id: deviceProfile.value.id,
    name: deviceProfile.value.name,
    pushedAt: new Date().toISOString(),
  }
}
