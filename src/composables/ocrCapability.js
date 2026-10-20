// 单独成文件的原因：ocrPipeline.js 只能被动态导入（它会拖进 tesseract 与语言包），
// 静态引它等于把整套 OCR 塞进首屏包。但「这台设备能不能识图」是需要在**按钮旁边**
// 显示**的同步信息，不该为了问一句话去下载 6MB 模型。
// 这里只做一次 20 字节的 WebAssembly 校验，零依赖、同步、结果缓存。
//
// 【第二类能力：识别资源在不在本机】
// 引擎（tesseract-core-simd-lstm.wasm.js 3.8MB）、worker 与中文语言包（chi_sim.traineddata
// 2.4MB）被 vite.config.js 的 `globIgnores` 排除在预缓存之外，只在**第一次真正识图**时
// 由 CacheFirst 策略写进 `study-life-ocr-language-v1`。于是「离线 + 从未识过图」这条路径
// 必然失败，而失败点在第 45 秒的引擎初始化里——用户只会看到一句技术报错。
// 这里补一个**纯本地**探测：查 CacheStorage 里那三个文件在不在。
//   - 不新增任何网络请求：`caches.match()` 只读磁盘缓存，不触网；
//   - 不做轮询：只在入口打开/网络状态变化/用户点击时各探一次，结果在模块内缓存；
//   - 探不到（浏览器没有 CacheStorage，如桌面版 file://、老浏览器）时**一律不阻断**，
//     宁可退回原来的行为，也不误伤「资源其实就在本地」的环境。

// 与 ocrPipeline.js 的 OCR_ASSET_BASE / TESSERACT_CORE_FILE / TESSERACT_WORKER_FILE
// 一一对应。三个都齐了才算「可离线识别」——缺任何一个，离线跑都会在初始化里失败。
const OCR_ENGINE_ASSETS = Object.freeze([
  'ocr/chi_sim.traineddata',
  'ocr/tesseract-core-simd-lstm.wasm.js',
  'ocr/tesseract-worker.min.js',
])

// 最小 SIMD 探测模块（字节码取自 wasm-feature-detect 的固定样本）。
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

let simdSupport = null

export function supportsSimd() {
  if (simdSupport !== null) return simdSupport
  try {
    simdSupport = typeof WebAssembly?.validate === 'function' && WebAssembly.validate(SIMD_PROBE)
  } catch {
    simdSupport = false
  }
  return simdSupport
}

/** 不支持时返回一句能直接展示给用户的原因；支持时返回空串。 */
export function ocrUnsupportedReason() {
  if (supportsSimd()) return ''
  return '当前浏览器不支持 WebAssembly SIMD，无法在本机识别图片。请更新浏览器，或改用 Excel / 文字方式导入课表。'
}

export function assertSimdAvailable() {
  if (supportsSimd()) return
  throw new Error(ocrUnsupportedReason())
}

/** `navigator.onLine` 缺失时按「在线」处理：判断不了就不要吓唬用户。 */
export function isOnline() {
  const value = globalThis.navigator?.onLine
  return typeof value === 'boolean' ? value : true
}

let availabilityCache = null
let availabilityProbe = null

/** 测试与「重新打开入口」用：丢掉缓存，下一次探测重新读缓存。 */
export function resetOcrAvailability() {
  availabilityCache = null
  availabilityProbe = null
}

/** 与 ocrPipeline 的 `new URL('ocr/<file>', document.baseURI)` 保持同一口径。 */
function ocrAssetUrls() {
  const base = globalThis.document?.baseURI || globalThis.location?.href || ''
  return OCR_ENGINE_ASSETS.map((path) => {
    try { return new URL(path, base || undefined).href } catch { return path }
  })
}

/**
 * 只读地查「三个 OCR 资源是否已在 CacheStorage 里」。
 * `reachable=false` 表示这台环境根本没有可用的 CacheStorage —— 此时任何结论都不可信。
 */
async function readOcrCacheState() {
  const storage = globalThis.caches
  const unreachable = { reachable: false, cached: false, missing: [...OCR_ENGINE_ASSETS] }
  if (typeof storage?.match !== 'function') return unreachable
  try {
    const hits = await Promise.all(ocrAssetUrls().map((url) => storage.match(url)))
    const missing = OCR_ENGINE_ASSETS.filter((_, index) => !hits[index])
    return { reachable: true, cached: missing.length === 0, missing }
  } catch {
    return unreachable
  }
}

/**
 * 探测一次 OCR 可用性。并发调用共享同一次探测，结果缓存在模块内。
 *
 * @param {{ force?: boolean }} [options] force=true 时忽略缓存（用户刚联网/刚下载完模型后重试）
 * @returns {Promise<{ online: boolean, cacheReachable: boolean, cached: boolean, missing: string[] }>}
 */
export async function probeOcrAvailability({ force = false } = {}) {
  if (!force && availabilityCache) return availabilityCache
  if (!force && availabilityProbe) return availabilityProbe
  const probe = (async () => {
    const online = isOnline()
    const { reachable, cached, missing } = await readOcrCacheState()
    const availability = Object.freeze({ online, cacheReachable: reachable, cached, missing })
    availabilityCache = availability
    if (availabilityProbe === probe) availabilityProbe = null
    return availability
  })()
  availabilityProbe = probe
  return probe
}

/**
 * 该不该在入口直接拦住图片识课。
 *
 * 只有「确定没有 CacheStorage 之外的可能」时才阻断：
 *   - 缓存查得到（cacheReachable）且三个资源都没齐；
 *   - 当前确实离线。
 * 其它情况（在线、已缓存、探测不到）都返回空串，保持原来的行为。
 */
export function ocrAvailabilityBlockReason(availability) {
  if (!availability?.cacheReachable || availability.cached) return ''
  if (availability.online) return ''
  return '当前处于离线状态，本机还没有缓存识别模型（约 6 MB）。图片识课需要先联网加载一次，之后即可离线使用；也可以改用 Excel 文件或粘贴文字导入课表。'
}

/** 一句状态说明（不阻断时展示）；判断不了时返回空串，由调用方使用原有文案。 */
export function ocrAvailabilityHint(availability) {
  if (!availability) return ''
  if (availability.cached) return '识别模型已缓存，可离线识别。'
  if (!availability.online) {
    return availability.cacheReachable
      ? ''
      : '当前处于离线状态，无法确认识别模型是否已缓存；若首次识图失败，请联网后再试。'
  }
  return ''
}