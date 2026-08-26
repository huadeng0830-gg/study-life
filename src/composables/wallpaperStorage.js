import { ref } from 'vue'

const DB_NAME = 'study-life-wallpapers'
const STORE_NAME = 'images'
const UNDO_STORE = 'undo-images'
const DB_VERSION = 2

export const wallpaperRevision = ref(0)

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
      if (!request.result.objectStoreNames.contains(UNDO_STORE)) request.result.createObjectStore(UNDO_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getWallpaper(target) {
  const db = await openDb()
  try {
    return await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(target))
  } finally {
    db.close()
  }
}

export async function setWallpaper(target, blob) {
  const db = await openDb()
  try {
    await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(blob, target))
    wallpaperRevision.value++
  } finally {
    db.close()
  }
}

export async function removeWallpaper(target) {
  const db = await openDb()
  try {
    await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(target))
    wallpaperRevision.value++
  } finally {
    db.close()
  }
}

export async function clearAllWallpapers() {
  const db = await openDb()
  try {
    await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear())
    wallpaperRevision.value++
  } finally {
    db.close()
  }
}

export async function listWallpapers() {
  const db = await openDb()
  try {
    const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
    const keyRequest = store.getAllKeys()
    const valueRequest = store.getAll()
    const [keys, values] = await Promise.all([requestResult(keyRequest), requestResult(valueRequest)])
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
  } finally {
    db.close()
  }
}

function drawableFromFile(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    image.src = url
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function dominantColor(context, width, height) {
  const data = context.getImageData(0, 0, width, height).data
  let red = 0
  let green = 0
  let blue = 0
  let weight = 0
  for (let index = 0; index < data.length; index += 16) {
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const light = (max + min) / 2
    if (light < 35 || light > 225) continue
    const saturation = max - min
    const pointWeight = 1 + saturation / 90
    red += r * pointWeight
    green += g * pointWeight
    blue += b * pointWeight
    weight += pointWeight
  }
  if (!weight) return '#456fe8'
  const rgb = [red, green, blue].map((value) => Math.round(value / weight))
  const strongest = Math.max(...rgb)
  const weakest = Math.min(...rgb)
  if (strongest - weakest < 35) {
    const strongestIndex = rgb.indexOf(strongest)
    rgb[strongestIndex] = Math.min(220, rgb[strongestIndex] + 45)
    rgb[(strongestIndex + 1) % 3] = Math.max(45, rgb[(strongestIndex + 1) % 3] - 20)
  }
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  if (luminance > 165) {
    const ratio = 155 / luminance
    for (let index = 0; index < 3; index++) rgb[index] = Math.round(rgb[index] * ratio)
  } else if (luminance < 72) {
    const ratio = 82 / Math.max(1, luminance)
    for (let index = 0; index < 3; index++) rgb[index] = Math.min(210, Math.round(rgb[index] * ratio))
  }
  return '#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function compressWallpaper(file, maxSide = 1920, quality = 0.82) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择图片文件')
  const drawable = await drawableFromFile(file)
  const sourceWidth = drawable.width ?? drawable.naturalWidth
  const sourceHeight = drawable.height ?? drawable.naturalHeight
  const ratio = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  context.drawImage(drawable, 0, 0, width, height)
  drawable.close?.()

  const sample = document.createElement('canvas')
  sample.width = 48
  sample.height = 48
  const sampleContext = sample.getContext('2d', { alpha: false, willReadFrequently: true })
  sampleContext.drawImage(canvas, 0, 0, 48, 48)
  const accent = dominantColor(sampleContext, 48, 48)
  const blob = await canvasBlob(canvas, 'image/webp', quality) ?? await canvasBlob(canvas, 'image/jpeg', quality)
  if (!blob) throw new Error('当前浏览器无法压缩这张图片')
  return { blob, accent, width, height }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function exportWallpapersForTransfer() {
  const images = await listWallpapers()
  const result = {}
  for (const [target, blob] of Object.entries(images)) {
    const reduced = await compressWallpaper(new File([blob], `${target}.webp`, { type: blob.type }), 720, 0.58)
    result[target] = await blobToDataUrl(reduced.blob)
  }
  return result
}

export async function importWallpapersFromTransfer(images, mode = 'merge') {
  const existing = await listWallpapers()
  if (mode === 'replace') {
    const db = await openDb()
    try {
      await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear())
    } finally {
      db.close()
    }
  }
  for (const [target, dataUrl] of Object.entries(images ?? {})) {
    if (!/^data:image\//.test(dataUrl)) continue
    if (mode === 'merge' && existing[target]) continue
    const blob = await (await fetch(dataUrl)).blob()
    await setWallpaper(target, blob)
  }
  wallpaperRevision.value++
}

async function storeEntries(db, storeName) {
  const store = db.transaction(storeName, 'readonly').objectStore(storeName)
  const keyRequest = store.getAllKeys()
  const valueRequest = store.getAll()
  const [keys, values] = await Promise.all([requestResult(keyRequest), requestResult(valueRequest)])
  return keys.map((key, index) => [key, values[index]])
}

export async function backupWallpapersForUndo() {
  const db = await openDb()
  try {
    const entries = await storeEntries(db, STORE_NAME)
    const transaction = db.transaction(UNDO_STORE, 'readwrite')
    const store = transaction.objectStore(UNDO_STORE)
    store.clear()
    for (const [key, blob] of entries) store.put(blob, key)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function restoreWallpaperUndo() {
  const db = await openDb()
  try {
    const entries = await storeEntries(db, UNDO_STORE)
    const transaction = db.transaction([STORE_NAME, UNDO_STORE], 'readwrite')
    const images = transaction.objectStore(STORE_NAME)
    images.clear()
    for (const [key, blob] of entries) images.put(blob, key)
    transaction.objectStore(UNDO_STORE).clear()
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    wallpaperRevision.value++
    return true
  } finally {
    db.close()
  }
}
