import {
  backupWallpapersForUndo,
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
  restoreWallpaperUndo,
} from './wallpaperStorage.js'
import { throwIfAborted } from './asyncTask.js'
import { restoreStoredValues } from './store/index.js'
import { markLocalChanged } from './cloudSync.js'

export const TRANSFER_MODULES = {
  courses: { label: '课程、课表模板、作息与特殊日期', keys: ['sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_ocr_vocabulary', 'sl_course_checkins'] },
  tasks: { label: '作业、待办、日程与笔记', keys: ['sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_quick_record_settings', 'sl_capture_enabled'] },
  focus: { label: '专注记录', keys: ['sl_focus_sessions'] },
  countdowns: { label: '考试与倒计时', keys: ['sl_exams', 'sl_countdown_show_past'] },
  lists: { label: '生活清单', keys: ['sl_checklists'] },
  bills: { label: '固定账单', keys: ['sl_bills'] },
  expenses: { label: '消费记录与账本偏好', keys: ['sl_expenses', 'sl_ledger_categories', 'sl_ledger_freq'] },
  food: { label: '吃什么选择库', keys: ['sl_food_places', 'sl_food_history', 'sl_food_filters'] },
  appearance: { label: '励志语、首页布局与页面皮肤', keys: ['sl_appearance', 'sl_performance_mode'] },
  wallpapers: { label: '壁纸图片（可选，二维码较多）', keys: ['sl_wallpaper_config', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent'] },
  preferences: { label: '主题与显示偏好', keys: ['sl_theme', 'sl_custom_theme_color'] },
  atmosphere: { label: '节日、纪念日与心情', keys: ['sl_festive_config', 'sl_festive_birthday_full', 'sl_mood_log'] },
}

const ARRAY_KEYS = new Set([
  'sl_courses', 'sl_course_templates', 'sl_schedule_exceptions', 'sl_course_checkins', 'sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_focus_sessions', 'sl_exams', 'sl_checklists',
  'sl_bills', 'sl_expenses', 'sl_food_places', 'sl_food_history',
])
const KEYED_ARRAY_KEYS = new Map([['sl_ledger_categories', 'key']])
const UNDO_KEY = 'sl_transfer_undo'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64ToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function compress(bytes) {
  if (typeof CompressionStream === 'undefined') return { bytes, compressed: false }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compressed: true }
}

async function decompress(bytes, compressed) {
  if (!compressed) return bytes
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压这个迁移码')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deriveKey(password, salt, usage) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  )
}

export async function encryptTransfer(value, password) {
  if (String(password).length < 8) throw new Error('传输密码至少需要 8 个字符')
  const packed = await compress(encoder.encode(JSON.stringify(value)))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, 'encrypt')
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed.bytes))
  return bytesToBase64(encoder.encode(JSON.stringify({
    v: 2,
    c: packed.compressed ? 1 : 0,
    s: bytesToBase64(salt),
    i: bytesToBase64(iv),
    d: bytesToBase64(cipher),
  })))
}

export async function decryptTransfer(payload, password) {
  try {
    const envelope = JSON.parse(decoder.decode(base64ToBytes(payload)))
    if (envelope.v !== 2) throw new Error('迁移码版本不受支持')
    const salt = base64ToBytes(envelope.s)
    const iv = base64ToBytes(envelope.i)
    const key = await deriveKey(password, salt, 'decrypt')
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.d)))
    return JSON.parse(decoder.decode(await decompress(plain, envelope.c === 1)))
  } catch (reason) {
    if (reason instanceof Error && /版本|解压/.test(reason.message)) throw reason
    throw new Error('无法解密，请检查传输密码和二维码是否完整')
  }
}

export function splitIntoFrames(payload, chunkSize = 720) {
  const id = crypto.randomUUID().slice(0, 8)
  const chunks = []
  for (let index = 0; index < payload.length; index += chunkSize) chunks.push(payload.slice(index, index + chunkSize))
  if (chunks.length > 120) throw new Error('所选数据过大，请减少迁移模块或改用备份文件')
  return chunks.map((chunk, index) => `SL2|${id}|${index + 1}|${chunks.length}|${chunk}`)
}

export function parseFrame(value) {
  const match = String(value ?? '').match(/^SL2\|([a-f0-9]{8})\|(\d+)\|(\d+)\|(.+)$/i)
  if (!match) throw new Error('没有识别到学习生活台迁移码')
  const index = Number(match[2])
  const total = Number(match[3])
  if (index < 1 || total < 1 || index > total || total > 120) throw new Error('二维码片段编号无效')
  return { id: match[1], index, total, chunk: match[4] }
}

export function assembleFrames(frameMap) {
  const frames = [...frameMap.values()].sort((a, b) => a.index - b.index)
  if (!frames.length || frames.length !== frames[0].total) return null
  if (frames.some((frame) => frame.id !== frames[0].id || frame.total !== frames[0].total)) {
    throw new Error('扫描到了不同批次的二维码，请清空后重试')
  }
  return frames.map((frame) => frame.chunk).join('')
}

function readStored(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

export async function createTransferPackage(selectedModules, { signal = null, onProgress = null } = {}) {
  const data = {}
  const modules = selectedModules.filter((name) => TRANSFER_MODULES[name])
  for (const [index, moduleName] of modules.entries()) {
    throwIfAborted(signal)
    for (const key of TRANSFER_MODULES[moduleName].keys) {
      const value = readStored(key)
      if (value !== null) data[key] = value
    }
    onProgress?.({ stage: 'collecting', current: index + 1, total: modules.length, moduleName })
  }
  if (modules.includes('wallpapers')) {
    data.__wallpaper_images = await exportWallpapersForTransfer({
      signal,
      onProgress: (progress) => onProgress?.({ ...progress, stage: 'wallpapers' }),
    })
  }
  return {
    app: 'study-life',
    version: 2,
    createdAt: new Date().toISOString(),
    modules,
    data,
  }
}

export function transferSummary(pkg) {
  const data = pkg?.data ?? {}
  return {
    courses: Array.isArray(data.sl_courses) ? data.sl_courses.length : 0,
    tasks: Array.isArray(data.sl_tasks) ? data.sl_tasks.length : 0,
    countdowns: Array.isArray(data.sl_exams) ? data.sl_exams.length : 0,
    lists: Array.isArray(data.sl_checklists) ? data.sl_checklists.length : 0,
    bills: Array.isArray(data.sl_bills) ? data.sl_bills.length : 0,
    food: Array.isArray(data.sl_food_places) ? data.sl_food_places.length : 0,
    wallpapers: data.__wallpaper_images && typeof data.__wallpaper_images === 'object'
      ? Object.keys(data.__wallpaper_images).length
      : 0,
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeArray(current, incoming, key) {
  const result = Array.isArray(current) ? JSON.parse(JSON.stringify(current)) : []
  let added = 0
  let copied = 0
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (result.some((existing) => sameJson(existing, item))) continue
    const idIndex = item?.id ? result.findIndex((existing) => existing?.id === item.id) : -1
    if (idIndex >= 0) {
      result.push({ ...JSON.parse(JSON.stringify(item)), id: `${item.id}_import_${Date.now()}_${copied++}` })
    } else {
      result.push(JSON.parse(JSON.stringify(item)))
    }
    added++
  }
  return { value: result, added, key }
}

function mergeKeyedArray(current, incoming, key, identityKey) {
  const result = Array.isArray(current) ? JSON.parse(JSON.stringify(current)) : []
  const identities = new Set(result.map((item) => item?.[identityKey]).filter(Boolean))
  let added = 0
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const identity = item?.[identityKey]
    if (!identity || identities.has(identity)) continue
    result.push(JSON.parse(JSON.stringify(item)))
    identities.add(identity)
    added++
  }
  return { value: result, added, key }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 快速记录设置是对象而非实体数组。迁移时保留本机开关，并合并两端的最近类型，
// 防止「合并」把整个设置写成空数组后在下次启动被重置。
function mergeQuickRecordSettings(current, incoming) {
  const local = isPlainObject(current) ? current : {}
  const remote = isPlainObject(incoming) ? incoming : {}
  const recentTypes = [...new Set([
    ...(Array.isArray(local.recentTypes) ? local.recentTypes : []),
    ...(Array.isArray(remote.recentTypes) ? remote.recentTypes : []),
  ].filter((item) => typeof item === 'string' && item))].slice(0, 4)
  return {
    clipboardHint: typeof local.clipboardHint === 'boolean'
      ? local.clipboardHint
      : typeof remote.clipboardHint === 'boolean' ? remote.clipboardHint : true,
    recentTypes,
  }
}

function periodMapping(incomingConfig, currentConfig) {
  const current = currentConfig?.periods ?? []
  const map = new Map()
  for (const period of incomingConfig?.periods ?? []) {
    const match = current.find((item) => item.label === period.label)
    if (match) map.set(period.id, match.id)
  }
  return map
}

function remapCourses(list, map, currentIds) {
  return (Array.isArray(list) ? list : []).flatMap((course) => {
    const start = map.get(course.start) ?? (currentIds.has(course.start) ? course.start : '')
    const end = map.get(course.end) ?? (currentIds.has(course.end) ? course.end : '')
    if (!start || !end) return []
    return [{ ...course, start, end }]
  })
}

export async function importTransferPackage(pkg, mode = 'merge', { signal = null, onProgress = null } = {}) {
  if (!pkg || pkg.app !== 'study-life' || pkg.version !== 2 || !pkg.data) throw new Error('迁移数据格式不正确')
  throwIfAborted(signal)
  const wallpaperImages = pkg.data.__wallpaper_images
  const keys = Object.keys(pkg.data).filter((key) => key !== '__wallpaper_images')
  const undo = { createdAt: new Date().toISOString(), values: {}, hadWallpapers: false }
  for (const key of keys) undo.values[key] = localStorage.getItem(key)
  localStorage.setItem(UNDO_KEY, JSON.stringify(undo))
  let committed = false
  try {
    if (wallpaperImages) {
      onProgress?.({ stage: 'snapshot', message: '正在创建壁纸回滚快照' })
      await backupWallpapersForUndo()
      undo.hadWallpapers = true
      localStorage.setItem(UNDO_KEY, JSON.stringify(undo))
    }

    let added = 0
    const details = []
    const localCourses = readStored('sl_courses') ?? []
    const incomingConfig = pkg.data.sl_timecfg
    const currentConfig = readStored('sl_timecfg')
    const shouldRemapCourses = mode === 'merge' && localCourses.length && incomingConfig && currentConfig
    const courseMap = shouldRemapCourses
      ? periodMapping(incomingConfig, currentConfig)
      : new Map()
    const currentPeriodIds = new Set((currentConfig?.periods ?? []).map((period) => period.id))

    const dataEntries = Object.entries(pkg.data).filter(([key]) => key !== '__wallpaper_images')
    const nextValues = {}
    for (const [index, [key, incomingRaw]] of dataEntries.entries()) {
      throwIfAborted(signal)
      let incoming = incomingRaw
      if (shouldRemapCourses && key === 'sl_courses') incoming = remapCourses(incoming, courseMap, currentPeriodIds)
      if (shouldRemapCourses && key === 'sl_course_templates') {
        incoming = (incoming ?? []).map((template) => ({
          ...template,
          courses: remapCourses(template.courses, courseMap, currentPeriodIds),
        }))
      }

      if (mode === 'merge' && key === 'sl_quick_record_settings') {
        const value = mergeQuickRecordSettings(readStored(key), incoming)
        nextValues[key] = value
        details.push({ key, mergedSettings: true })
      } else if (mode === 'merge' && (ARRAY_KEYS.has(key) || KEYED_ARRAY_KEYS.has(key))) {
        const result = KEYED_ARRAY_KEYS.has(key)
          ? mergeKeyedArray(readStored(key), incoming, key, KEYED_ARRAY_KEYS.get(key))
          : mergeArray(readStored(key), incoming, key)
        nextValues[key] = result.value
        added += result.added
        details.push({ key, added: result.added })
      } else if (mode === 'merge' && localStorage.getItem(key) !== null) {
        // 合并时保留本机的作息、学期和主题设置。
        details.push({ key, keptLocal: true })
      } else {
        nextValues[key] = incoming
        details.push({ key, replaced: true })
      }
      onProgress?.({ stage: 'data', current: index + 1, total: dataEntries.length, key })
    }
    throwIfAborted(signal)
    if (Object.keys(nextValues).length) {
      await restoreStoredValues(nextValues)
      committed = true
    }
    if (wallpaperImages) {
      committed = true
      await importWallpapersFromTransfer(wallpaperImages, mode, {
        signal,
        onProgress: (progress) => onProgress?.({ ...progress, stage: 'wallpapers' }),
      })
    }
    return { added, details, affected: keys.length }
  } catch (reason) {
    if (committed) {
      try { await restoreTransferUndo() } catch {}
    } else {
      localStorage.removeItem(UNDO_KEY)
    }
    throw reason
  }
}

export function hasTransferUndo() {
  return Boolean(localStorage.getItem(UNDO_KEY))
}

export async function restoreTransferUndo() {
  const undo = readStored(UNDO_KEY)
  if (!undo?.values) return false
  const values = {}
  const removedKeys = []
  for (const [key, raw] of Object.entries(undo.values)) {
    if (raw === null) removedKeys.push(key)
    else {
      try { values[key] = JSON.parse(raw) } catch { values[key] = null }
    }
  }
  if (Object.keys(values).length) await restoreStoredValues(values)
  for (const key of removedKeys) localStorage.removeItem(key)
  if (removedKeys.length && !Object.keys(values).length) markLocalChanged()
  if (undo.hadWallpapers) {
    await restoreWallpaperUndo()
  }
  localStorage.removeItem(UNDO_KEY)
  return true
}
