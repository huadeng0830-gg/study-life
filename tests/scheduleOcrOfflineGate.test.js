// @vitest-environment happy-dom
/**
 * 识图管线里的第二道能力闸门（与面板上的禁用互为兜底）。
 *
 * 为什么面板已经禁用了还要在管线上再拦一次：面板的探测结果可能过期 ——
 * 用户开着面板时断了网，或者关闭面板后从别处触发识别；那时的表现就是
 * 「选了图 → 进度条转 45 秒 → 失败」。管线这一层在**开进度条之前**判一次，
 * 只读本地缓存（不联网、不轮询）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

const control = vi.hoisted(() => ({ ocr: vi.fn(), xlsxRead: vi.fn() }))
vi.mock('../src/composables/ocrPipeline.js', () => ({ performOCR: control.ocr }))
// Excel 解析组件（assets/xlsx-*）同样不在预缓存里：离线且从未用过 Excel 导入时，
// 动态 import 会抛一句带内容哈希文件名的技术错误。这里让 read 复现那句文案。
vi.mock('@e965/xlsx', () => {
  const api = { read: (...args) => control.xlsxRead(...args), utils: { sheet_to_json: () => [] } }
  return { ...api, default: api }
})
vi.mock('../src/composables/dataVault.js', () => ({
  clearPendingRecoveryDraft: vi.fn(async () => true), savePendingRecoveryDraft: vi.fn(async () => true),
  clearDataVault: vi.fn(async () => true), mirrorLocalValue: vi.fn(async () => true),
  mirrorLocalValues: vi.fn(async () => true), setMirrorErrorHandler: vi.fn(), setMirrorSuccessHandler: vi.fn(), setMirrorTimingHandler: vi.fn(),
}))

const ASSET_FILES = ['chi_sim.traineddata', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-worker.min.js']
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
const originalOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine')

function setOnline(value) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true, writable: true })
}
function installCaches(cachedFiles = ASSET_FILES) {
  Object.defineProperty(globalThis, 'caches', {
    value: { match: async (url) => (ASSET_FILES.some((file) => String(url).endsWith(file) && cachedFiles.includes(file)) ? { ok: true } : undefined) },
    configurable: true,
    writable: true,
  })
}

const scopes = []
const image = { name: 'fictional.png', type: 'image/png' }

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  control.ocr.mockReset()
  control.xlsxRead.mockReset()
  const { resetOcrAvailability } = await import('../src/composables/ocrCapability.js')
  resetOcrAvailability()
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches)
  else Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true, writable: true })
  if (originalOnLine) Object.defineProperty(globalThis.navigator, 'onLine', originalOnLine)
})

async function importer() {
  const parser = await import('../src/composables/courseParser.js')
  const { useScheduleOcrImport } = await import('../src/composables/scheduleOcrImport.js')
  const scope = effectScope()
  scopes.push(scope)
  const input = { courses: ref([]), batchText: ref(''), batchError: ref(''), ocrSummary: ref(''), rememberCourseReviews: vi.fn(), loadBatchParser: vi.fn(async () => {}), getBatchParserApi: () => parser }
  const api = scope.run(() => useScheduleOcrImport(input))
  return { api, input }
}

describe('识图管线：离线 + 未缓存时不开进度条', () => {
  it('离线且没缓存过模型：直接给出可操作原因，不初始化引擎、不可重试', async () => {
    setOnline(false)
    installCaches([])
    const { api, input } = await importer()
    await api.ocrImage({ target: { value: '', files: [image] } })
    expect(control.ocr).not.toHaveBeenCalled()
    expect(input.batchError.value).toContain('离线')
    expect(input.batchError.value).toContain('缓存识别模型')
    // 没有「重试」按钮：重试多少次都是同一句离线的结果，那只是再骗用户 45 秒。
    expect(api.batchOcrProgress.state.status).not.toBe('running')
    expect(api.batchOcrProgress.state.retry).toBeFalsy()
  })

  it('离线但模型已缓存：照常进入识别（闸门不能误伤可离线的设备）', async () => {
    setOnline(false)
    installCaches(ASSET_FILES)
    control.ocr.mockResolvedValue({ text: '虚构课程 周一 1-2节', columns: [] })
    const { api, input } = await importer()
    await api.ocrImage({ target: { value: '', files: [image] } })
    expect(control.ocr).toHaveBeenCalledTimes(1)
    expect(input.batchError.value).not.toContain('离线')
  })

  it('在线且没缓存过模型：照常进入识别（首次识课就要下载）', async () => {
    setOnline(true)
    installCaches([])
    control.ocr.mockResolvedValue({ text: '虚构课程 周一 1-2节', columns: [] })
    const { api } = await importer()
    await api.ocrImage({ target: { value: '', files: [image] } })
    expect(control.ocr).toHaveBeenCalledTimes(1)
  })
})

describe('Excel 导入：离线时的技术文案要换成可操作提示', () => {
  const FETCH_FAILURE = 'Failed to fetch dynamically imported module: https://example.invalid/assets/xlsx-fictional.js'
  const excel = { name: 'fictional.xlsx', arrayBuffer: async () => new ArrayBuffer(0) }

  it('离线时把取模块失败换成「先联网一次」的说明', async () => {
    setOnline(false)
    control.xlsxRead.mockImplementation(() => { throw new TypeError(FETCH_FAILURE) })
    const { api, input } = await importer()
    await api.importExcel({ target: { value: '', files: [excel] } })
    expect(input.batchError.value).toContain('当前处于离线状态')
    expect(input.batchError.value).toContain('Excel 解析组件还没有缓存到本机')
    expect(input.batchError.value).not.toContain('xlsx-fictional.js')
    // 联网后重试即可成功，所以这里保留重试按钮是对的。
    expect(api.batchOcrProgress.state.status).toBe('failed')
  })

  it('在线时的真实报错原样保留，不做掩盖', async () => {
    setOnline(true)
    control.xlsxRead.mockImplementation(() => { throw new TypeError(FETCH_FAILURE) })
    const { api, input } = await importer()
    await api.importExcel({ target: { value: '', files: [excel] } })
    expect(input.batchError.value).toContain('xlsx-fictional.js')
  })
})