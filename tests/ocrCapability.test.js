// @vitest-environment happy-dom
/**
 * 图片识课的第二类能力闸门：**离线 + 识别资源从未缓存**。
 *
 * 为什么这条要单独守：引擎（3.8MB）与中文语言包（2.4MB）被 vite.config.js 的
 * `globIgnores` 排除在 PWA 预缓存之外，靠 CacheFirst 在**第一次识图**时才写进
 * `study-life-ocr-language-v1`。于是「断网 + 第一次识课」必然失败，而失败点在 45 秒的
 * 引擎初始化里——用户只拿到一句技术报错。上一轮只处理了 SIMD 能力，这条路径是哑的。
 *
 * 本用例同时守一条**性能约束**：这份探测必须是纯本地的。它只许读 CacheStorage 与
 * `navigator.onLine`，一旦有人为了「提前判断」改成发请求去探资源，下面的 fetch/XHR
 * 零调用断言就会红——因为那恰恰是把「不该发生的下载」提前到了用户点按钮之前。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ocrAvailabilityBlockReason,
  ocrAvailabilityHint,
  probeOcrAvailability,
  resetOcrAvailability,
  supportsSimd,
} from '../src/composables/ocrCapability.js'

const ASSET_FILES = ['chi_sim.traineddata', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-worker.min.js']
// `missing` 报的是资源相对路径（与 ocrPipeline 的 `ocr/<file>` 口径一致），方便直接定位文件。
const ASSET_PATHS = ASSET_FILES.map((file) => `ocr/${file}`)
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
const originalOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine')

function setOnline(value) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true, writable: true })
}

/** 假的 CacheStorage：只认「完整 URL 以某文件结尾」的命中，与 Workbox 的缓存键一致。 */
function installCaches(cachedFiles = ASSET_FILES) {
  const match = vi.fn(async (url) => (
    ASSET_FILES.some((file) => String(url).endsWith(file) && cachedFiles.includes(file)) ? { ok: true, url: String(url) } : undefined
  ))
  Object.defineProperty(globalThis, 'caches', { value: { match }, configurable: true, writable: true })
  return match
}

function removeCaches() {
  Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true, writable: true })
}

beforeEach(() => {
  resetOcrAvailability()
  vi.restoreAllMocks()
})

afterEach(() => {
  resetOcrAvailability()
  vi.unstubAllGlobals()
  if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches)
  else removeCaches()
  if (originalOnLine) Object.defineProperty(globalThis.navigator, 'onLine', originalOnLine)
})

describe('OCR 能力探测（离线 + 未缓存）', () => {
  it('在线且还没下载过模型：不阻断，也不会替用户提前下载', async () => {
    setOnline(true)
    const match = installCaches([])
    const availability = await probeOcrAvailability({ force: true })
    expect(availability).toMatchObject({ online: true, cacheReachable: true, cached: false })
    expect(ocrAvailabilityBlockReason(availability)).toBe('')
    expect(ocrAvailabilityHint(availability)).toBe('')
    // 三个资源各查一次，全部落在本地缓存索引上。
    expect(match).toHaveBeenCalledTimes(ASSET_FILES.length)
  })

  it('离线且没缓存过模型：阻断并给出「先联网加载一次」的可操作说明', async () => {
    setOnline(false)
    installCaches([])
    const availability = await probeOcrAvailability({ force: true })
    const reason = ocrAvailabilityBlockReason(availability)
    expect(reason).toContain('离线')
    expect(reason).toContain('缓存识别模型')
    expect(reason).toContain('先联网加载一次')
    // 同时给出替代路径，不让用户卡在唯一入口上。
    expect(reason).toContain('Excel')
    expect(availability.missing).toEqual(ASSET_PATHS)
  })

  it('离线但模型已缓存：可用，并明确告诉用户可以离线识别', async () => {
    setOnline(false)
    installCaches(ASSET_FILES)
    const availability = await probeOcrAvailability({ force: true })
    expect(availability).toMatchObject({ online: false, cacheReachable: true, cached: true, missing: [] })
    expect(ocrAvailabilityBlockReason(availability)).toBe('')
    expect(ocrAvailabilityHint(availability)).toContain('已缓存')
  })

  it('只缓存了一部分（例如刚下到引擎就断网）：仍算未就绪', async () => {
    setOnline(false)
    installCaches(['tesseract-core-simd-lstm.wasm.js'])
    const availability = await probeOcrAvailability({ force: true })
    expect(availability.cached).toBe(false)
    expect(availability.missing).toEqual(['ocr/chi_sim.traineddata', 'ocr/tesseract-worker.min.js'])
    expect(ocrAvailabilityBlockReason(availability)).not.toBe('')
  })

  it('这台环境没有 CacheStorage（桌面版 file:// 等）：不阻断，退回原有行为', async () => {
    setOnline(false)
    removeCaches()
    const availability = await probeOcrAvailability({ force: true })
    expect(availability.cacheReachable).toBe(false)
    expect(ocrAvailabilityBlockReason(availability)).toBe('')
    expect(ocrAvailabilityHint(availability)).toContain('无法确认')
  })

  it('探测本身不产生任何网络请求（性能规则：不得新增请求/轮询）', async () => {
    setOnline(false)
    installCaches([])
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)
    await probeOcrAvailability({ force: true })
    await probeOcrAvailability()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })

  it('未 force 时复用缓存结果，force 才重新读缓存；并发调用共享一次探测', async () => {
    setOnline(true)
    const match = installCaches(ASSET_FILES)
    const [first, second] = await Promise.all([probeOcrAvailability(), probeOcrAvailability()])
    expect(first).toBe(second)
    expect(match).toHaveBeenCalledTimes(ASSET_FILES.length)
    await probeOcrAvailability()
    expect(match).toHaveBeenCalledTimes(ASSET_FILES.length)
    await probeOcrAvailability({ force: true })
    expect(match).toHaveBeenCalledTimes(ASSET_FILES.length * 2)
  })

  it('SIMD 探测仍是同步布尔值，且不影响缓存闸门', () => {
    expect(typeof supportsSimd()).toBe('boolean')
    // 判断不了缓存时，离线也不该阻断——否则桌面版会被误伤。
    expect(ocrAvailabilityBlockReason(null)).toBe('')
    expect(ocrAvailabilityBlockReason(undefined)).toBe('')
  })
})